// Supabase Edge Function: ai-briefings
// Generates a DummDumm Brand OS AI briefing with Claude (claude-opus-5).
//
// The API key lives server-side only (Supabase secret ANTHROPIC_API_KEY) and is
// never exposed to the browser.
//
// Deploy:   supabase functions deploy ai-briefings
// Secret:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Invoke:   POST { request: BriefingRequest, context: BriefingContext }
//
// Core rule enforced in the system prompt: the model may ONLY use numbers that
// appear in `context`. It must never invent metrics. Missing values are marked
// N/A / "일부 데이터". Output is a single JSON object matching the AiBriefing shape.

import Anthropic from "npm:@anthropic-ai/sdk";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const MODEL = "claude-opus-5";

type BriefingRequest = {
  surface: "command" | "channel" | "campaign" | "ad";
  periodMode: "weekly" | "monthly";
  channel?: string;
  campaign?: string;
  ad?: string;
};

type BriefingContext = {
  periodLabel?: string;
  dataSources?: string[];
  dataWarnings?: string[];
  figures?: Record<string, unknown>;
  [key: string]: unknown;
};

const SYSTEM_PROMPT = `당신은 DummDumm Inc. 마케팅팀의 브랜드 인텔리전스 분석가입니다.
멀티채널(YouTube·Instagram·Naver·TikTok·LinkedIn·Website) 마케팅 성과를 바탕으로 간결한 한국어 AI 보고서를 작성합니다.

절대 규칙:
1. context에 실제로 존재하는 수치만 사용합니다. context에 없는 숫자·비율·증감은 절대 만들어내지 않습니다.
2. 데이터가 부분적이거나 없으면 "N/A" 또는 "일부 데이터"로 표시하고 dataWarnings에 명시합니다.
3. evidence에는 context에서 인용한 구체 수치만 넣습니다(예: "Website 사용자 10,657 → 12,840 (+20%)"). 근거가 없으면 evidence를 빈 배열로 둡니다.
4. summary/wins/risks/actions는 근거 있는 해석과 실행 제안만 담고, 과장하지 않습니다.

출력 형식(매우 중요):
- 오직 하나의 JSON 객체만 출력합니다. 코드펜스(\`\`\`), 설명 문장, 앞뒤 텍스트를 절대 붙이지 않습니다.
- 키: title(string), periodLabel(string), summary(string), dataSources(string[]),
  dataWarnings(string[]), wins(string[]), risks(string[]), actions(string[]), evidence(string[]).`;

function buildUserPrompt(request: BriefingRequest, context: BriefingContext): string {
  const periodWord = request.periodMode === "weekly" ? "주간" : "월간";
  const target =
    request.ad ??
    request.campaign ??
    request.channel ??
    (request.surface === "command" ? "Brand Command Center" : request.surface);

  return [
    `분석 대상: ${target}`,
    `보고 주기: ${periodWord} (surface=${request.surface})`,
    "",
    "아래 context가 유일한 사실 출처입니다. 여기에 없는 수치는 사용하지 마세요.",
    "```json",
    JSON.stringify(context, null, 2),
    "```",
    "",
    `title은 "${target} ${periodWord} AI 보고서" 형식을 기본으로 하되 자연스럽게 다듬어도 됩니다.`,
    "periodLabel은 context.periodLabel이 있으면 그대로, 없으면 보고 주기에 맞춰 자연스럽게 만드세요.",
    "다시 강조: JSON 객체 하나만, 다른 텍스트 없이 출력하세요.",
  ].join("\n");
}

// Tolerant JSON extraction: strips code fences and grabs the outermost object.
function extractJson(text: string): unknown {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return JSON.parse(cleaned);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Require an authenticated caller (Supabase forwards the user's JWT here).
  if (!req.headers.get("Authorization")) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY is not configured" }, 500);
  }

  let payload: { request?: BriefingRequest; context?: BriefingContext };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const request = payload.request;
  const context = payload.context ?? {};
  if (!request?.surface || !request?.periodMode) {
    return jsonResponse({ error: "Missing request.surface or request.periodMode" }, 400);
  }

  const client = new Anthropic({ apiKey });

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(request, context) }],
    });

    // Safety classifiers can decline (HTTP 200 with stop_reason "refusal").
    if (message.stop_reason === "refusal") {
      return jsonResponse({ error: "The request was declined by safety filters." }, 422);
    }

    const textBlock = message.content.find((block: { type: string }) => block.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    if (!textBlock) {
      return jsonResponse({ error: "No text content returned from the model." }, 502);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson(textBlock.text) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: "모델 응답을 JSON으로 파싱하지 못했습니다." }, 502);
    }

    const briefing = {
      title: "",
      periodLabel: context.periodLabel ?? "",
      summary: "",
      dataSources: [],
      dataWarnings: [],
      wins: [],
      risks: [],
      actions: [],
      evidence: [],
      ...parsed,
      generatedAt: new Date().toISOString(),
    };

    return jsonResponse(briefing);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: `Claude request failed: ${messageText}` }, 502);
  }
});

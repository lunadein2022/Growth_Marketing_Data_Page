// Supabase Edge Function: ai-briefings
// Generates a concise DummDumm Brand OS AI briefing with Claude.
//
// Deploy: supabase functions deploy ai-briefings
// Secrets:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5

import Anthropic from "npm:@anthropic-ai/sdk";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
const MAX_TOKENS = Number(Deno.env.get("ANTHROPIC_MAX_TOKENS") ?? "1400");
const MAX_CONTEXT_CHARS = Number(Deno.env.get("AI_BRIEFING_MAX_CONTEXT_CHARS") ?? "12000");

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

const SYSTEM_PROMPT = [
  "당신은 DummDumm Inc. 마케팅 대시보드의 AI 브리핑 분석가입니다.",
  "반드시 제공된 context 안의 수치와 문장만 근거로 사용합니다.",
  "없는 수치, 비율, 플랫폼 성과를 추측하거나 만들어내지 않습니다.",
  "마케터가 바로 판단할 수 있게 짧고 실행 중심으로 씁니다.",
  "출력은 코드블록 없이 JSON 객체 하나만 반환합니다.",
  "필수 키: title, periodLabel, summary, dataSources, dataWarnings, wins, risks, actions, evidence",
  "wins/risk/actions/evidence 배열은 각각 최대 4개, 각 항목은 한 문장으로 제한합니다.",
].join("\n");

function labelPeriod(mode: BriefingRequest["periodMode"]) {
  return mode === "weekly" ? "주간" : "월간";
}

function labelTarget(request: BriefingRequest) {
  if (request.ad) return request.ad;
  if (request.campaign) return request.campaign;
  if (request.channel) return request.channel;
  if (request.surface === "command") return "Brand Command Center";
  if (request.surface === "campaign") return "캠페인";
  if (request.surface === "ad") return "광고";
  return "채널";
}

function buildUserPrompt(request: BriefingRequest, context: BriefingContext): string {
  const compactContext = JSON.stringify({
    periodLabel: context.periodLabel,
    dataSources: context.dataSources ?? [],
    dataWarnings: context.dataWarnings ?? [],
    figures: context.figures ?? {},
  });
  const contextText =
    compactContext.length > MAX_CONTEXT_CHARS
      ? `${compactContext.slice(0, MAX_CONTEXT_CHARS)}... [context truncated]`
      : compactContext;

  return [
    `대상: ${labelTarget(request)}`,
    `보고 주기: ${labelPeriod(request.periodMode)} (surface=${request.surface})`,
    "아래 context만 사용해서 한국어 브리핑 JSON을 생성하세요.",
    "summary는 2문장 이내, actions는 담당자가 오늘 바로 할 일 중심으로 작성하세요.",
    "dataWarnings에는 기존 경고와 추가로 확인해야 할 누락 데이터를 넣으세요.",
    `context: ${contextText}`,
  ].join("\n");
}

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

function toString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
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
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(request, context) }],
    });

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
      return jsonResponse({ error: "Model response could not be parsed as JSON." }, 502);
    }

    const briefing = {
      title: toString(parsed.title, `${labelTarget(request)} ${labelPeriod(request.periodMode)} AI 보고서`),
      generatedAt: new Date().toISOString(),
      periodLabel: toString(parsed.periodLabel, context.periodLabel ?? labelPeriod(request.periodMode)),
      dataSources: toStringArray(parsed.dataSources, 8),
      dataWarnings: toStringArray(parsed.dataWarnings, 6),
      summary: toString(parsed.summary, "제공된 데이터 기준으로 생성할 수 있는 요약이 부족합니다."),
      wins: toStringArray(parsed.wins, 4),
      risks: toStringArray(parsed.risks, 4),
      actions: toStringArray(parsed.actions, 4),
      evidence: toStringArray(parsed.evidence, 4),
    };

    return jsonResponse(briefing);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: `Claude request failed: ${messageText}` }, 502);
  }
});

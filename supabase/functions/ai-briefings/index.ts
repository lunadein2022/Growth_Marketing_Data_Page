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

type ModelContentBlock = {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
};

const SYSTEM_PROMPT = [
  "You are an AI briefing analyst for DummDumm Inc.'s marketing dashboard.",
  "Write the final briefing in Korean.",
  "Use only the numbers and facts included in the supplied context.",
  "Do not invent metrics, dates, rankings, campaigns, channels, or performance deltas.",
  "If a metric is missing, mention it as a data warning instead of guessing.",
  "Keep the answer concise and useful for a one-person marketing operator.",
  "Return the briefing by calling the return_briefing tool.",
].join("\n");

const BRIEFING_TOOL = {
  name: "return_briefing",
  description: "Return a concise Korean marketing briefing based only on the supplied dashboard context.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      periodLabel: { type: "string" },
      summary: { type: "string" },
      dataSources: { type: "array", items: { type: "string" }, maxItems: 8 },
      dataWarnings: { type: "array", items: { type: "string" }, maxItems: 6 },
      wins: { type: "array", items: { type: "string" }, maxItems: 4 },
      risks: { type: "array", items: { type: "string" }, maxItems: 4 },
      actions: { type: "array", items: { type: "string" }, maxItems: 4 },
      evidence: { type: "array", items: { type: "string" }, maxItems: 4 },
    },
    required: ["title", "periodLabel", "summary", "dataSources", "dataWarnings", "wins", "risks", "actions", "evidence"],
    additionalProperties: false,
  },
} as const;

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
    `Target: ${labelTarget(request)}`,
    `Report cadence: ${labelPeriod(request.periodMode)} (surface=${request.surface})`,
    "Use only this context. Write a Korean briefing for a marketer.",
    "Summary must be at most 2 sentences. Actions must be concrete next steps.",
    "Include existing data warnings and add missing-data warnings when relevant.",
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

function parseModelBriefing(content: ModelContentBlock[]): Record<string, unknown> {
  const toolBlock = content.find((block) => block.type === "tool_use" && block.name === "return_briefing");
  if (toolBlock?.input && typeof toolBlock.input === "object") {
    return toolBlock.input as Record<string, unknown>;
  }

  const textBlock = content.find((block) => block.type === "text" && typeof block.text === "string");
  if (!textBlock?.text) {
    throw new Error("No text or tool content returned from the model.");
  }

  return extractJson(textBlock.text) as Record<string, unknown>;
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
      tools: [BRIEFING_TOOL],
      tool_choice: { type: "tool", name: "return_briefing" },
      messages: [{ role: "user", content: buildUserPrompt(request, context) }],
    });

    if (message.stop_reason === "refusal") {
      return jsonResponse({ error: "The request was declined by safety filters." }, 422);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parseModelBriefing(message.content as ModelContentBlock[]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown parser error";
      return jsonResponse({ error: `Model response could not be parsed: ${detail}` }, 502);
    }

    const briefing = {
      title: toString(parsed.title, `${labelTarget(request)} ${labelPeriod(request.periodMode)} AI 보고서`),
      generatedAt: new Date().toISOString(),
      periodLabel: toString(parsed.periodLabel, context.periodLabel ?? labelPeriod(request.periodMode)),
      dataSources: toStringArray(parsed.dataSources, 8),
      dataWarnings: toStringArray(parsed.dataWarnings, 6),
      summary: toString(parsed.summary, "제공된 데이터만으로는 충분한 요약을 생성하지 못했습니다."),
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

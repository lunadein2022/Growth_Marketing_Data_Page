import type { AiBriefing, BriefingRequest } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

export type BriefingPeriodRange = {
  start: string;
  end: string;
};

type AiBriefingRow = {
  surface: BriefingRequest["surface"];
  period_mode: BriefingRequest["periodMode"];
  period_start: string;
  period_end: string;
  title: string;
  period_label: string;
  data_sources: unknown;
  data_warnings: unknown;
  summary: string;
  wins: unknown;
  risks: unknown;
  actions: unknown;
  evidence: unknown;
  generated_at: string;
};

export function canUseAiBriefingHistory() {
  return hasSupabaseConfig();
}

export async function loadAiBriefingHistory(limit = 50): Promise<AiBriefing[]> {
  if (!hasSupabaseConfig()) return [];

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ai_briefings")
    .select(
      "surface,period_mode,period_start,period_end,title,period_label,data_sources,data_warnings,summary,wins,risks,actions,evidence,generated_at",
    )
    .eq("org_id", ORG_ID)
    .order("generated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as AiBriefingRow[]).map(rowToBriefing);
}

export async function saveAiBriefingHistory(
  briefing: AiBriefing,
  request: BriefingRequest,
  periodRange: BriefingPeriodRange,
): Promise<AiBriefing> {
  if (!hasSupabaseConfig()) return briefing;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ai_briefings")
    .insert({
      org_id: ORG_ID,
      surface: request.surface,
      period_mode: request.periodMode,
      period_start: periodRange.start,
      period_end: periodRange.end,
      title: briefing.title,
      period_label: briefing.periodLabel,
      data_sources: briefing.dataSources,
      data_warnings: briefing.dataWarnings,
      summary: briefing.summary,
      wins: briefing.wins,
      risks: briefing.risks,
      actions: briefing.actions,
      evidence: briefing.evidence,
      request_context: {
        channel: request.channel ?? null,
        campaign: request.campaign ?? null,
        ad: request.ad ?? null,
      },
      model_provider: "anthropic_or_mock",
      prompt_version: "screen-context-v1",
    })
    .select(
      "surface,period_mode,period_start,period_end,title,period_label,data_sources,data_warnings,summary,wins,risks,actions,evidence,generated_at",
    )
    .single();

  if (error) throw error;

  return rowToBriefing(data as AiBriefingRow);
}

function rowToBriefing(row: AiBriefingRow): AiBriefing {
  return {
    title: row.title,
    generatedAt: formatGeneratedAt(row.generated_at),
    periodLabel: row.period_label,
    dataSources: toStringArray(row.data_sources),
    dataWarnings: toStringArray(row.data_warnings),
    summary: row.summary,
    wins: toStringArray(row.wins),
    risks: toStringArray(row.risks),
    actions: toStringArray(row.actions),
    evidence: toStringArray(row.evidence),
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function formatGeneratedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return formatter.format(date).replace(/\. /g, ".").replace(/\.$/, "");
}

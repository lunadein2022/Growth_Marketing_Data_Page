import type { AdContent } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

// Supabase-backed persistence for Content Lab ads (ad_contents table). Manual
// ads round-trip losslessly via raw_payload; the numeric/key columns are mirrored
// for querying and for connecting ads to channels/accounts.

const ORG_ID = "00000000-0000-0000-0000-000000000001";

export function canUseContentLabData() {
  return hasSupabaseConfig();
}

function parseNumber(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDatePart(part: string, fallback: string): string {
  const text = part.trim();
  const ymd = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  const md = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (md) return `${new Date().getUTCFullYear()}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  return fallback;
}

// Ad period strings vary ("2026.07.29 - 2026.08.05", "7/29 - 8/5"); parse both
// sides best-effort, falling back to today so the NOT NULL date columns are safe.
function parsePeriod(period: string | undefined): { start: string; end: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (!period) return { start: today, end: today };
  const [rawStart, rawEnd] = period.split(/\s*[-~]\s*/);
  const start = parseDatePart(rawStart ?? "", today);
  const end = parseDatePart(rawEnd ?? rawStart ?? "", start);
  return { start, end };
}

type AdRow = {
  platform_ad_id: string;
  channel: string;
  account_key: string | null;
  status: string;
  raw_payload: Record<string, unknown> | null;
};

export async function listAds(): Promise<AdContent[]> {
  if (!hasSupabaseConfig()) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ad_contents")
    .select("platform_ad_id, channel, account_key, status, raw_payload")
    .eq("org_id", ORG_ID)
    .eq("source", "manual_plan")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  return ((data ?? []) as AdRow[]).map((row) => {
    const payload = (row.raw_payload ?? {}) as Partial<AdContent>;
    return {
      ...(payload as AdContent),
      id: row.platform_ad_id,
      channel: row.channel as AdContent["channel"],
      accountKey: row.account_key ?? undefined,
      status: row.status as AdContent["status"],
    };
  });
}

export async function upsertAdToSupabase(ad: AdContent): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error("Supabase 미설정으로 광고를 저장할 수 없습니다.");
  const supabase = getSupabaseClient();
  const period = parsePeriod(ad.period);
  const impressions = Math.round(parseNumber(ad.impressions));
  const clicks = Math.round(parseNumber(ad.clicks));

  const { error } = await supabase.from("ad_contents").upsert(
    {
      org_id: ORG_ID,
      platform_ad_id: ad.id,
      channel: ad.channel,
      account_key: ad.accountKey ?? null,
      title: ad.title || "제목 없는 광고",
      source: "manual_plan",
      period_start: period.start,
      period_end: period.end,
      budget: parseNumber(ad.budget),
      spend: parseNumber(ad.spend),
      impressions: impressions || null,
      clicks: clicks || null,
      ctr: parseNumber(ad.ctr) || null,
      organic_lift: parseNumber(ad.organicLift) || null,
      status: ad.status,
      raw_payload: ad,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,platform_ad_id" },
  );
  if (error) throw new Error(error.message);
}

export async function deleteAdFromSupabase(adId: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error("Supabase 미설정으로 광고를 삭제할 수 없습니다.");
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("ad_contents")
    .delete()
    .eq("org_id", ORG_ID)
    .eq("platform_ad_id", adId);
  if (error) throw new Error(error.message);
}

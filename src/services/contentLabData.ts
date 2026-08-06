import type { AdContent, CampaignRow, ContentItem } from "./adapters/types";
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
    .in("source", ["manual_plan", "meta_ads"])
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

// ---------------------------------------------------------------------------
// Content cards (pipeline / 기획 카드) → content_cards table.
// legacy_mock_id holds the client card id (stable upsert key). The Korean status
// strings map to the content_status enum.
// ---------------------------------------------------------------------------
const STATUS_TO_ENUM: Record<string, string> = {
  아이디어: "idea",
  초안: "draft",
  예약: "scheduled",
  발행됨: "published",
  보관: "archived",
};
const ENUM_TO_STATUS: Record<string, string> = {
  idea: "아이디어",
  draft: "초안",
  scheduled: "예약",
  published: "발행됨",
  archived: "보관",
};

export function contentStatusToEnum(status: string): string {
  return STATUS_TO_ENUM[status] ?? "idea";
}

type ContentCardRow = {
  legacy_mock_id: string | null;
  channel: string;
  account_key: string | null;
  format: string;
  status: string;
  title: string;
  draft: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  external_url: string | null;
};

export async function listContentCards(): Promise<ContentItem[]> {
  if (!hasSupabaseConfig()) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("content_cards")
    .select("legacy_mock_id, channel, account_key, format, status, title, draft, scheduled_at, published_at, external_url")
    .eq("org_id", ORG_ID)
    .not("legacy_mock_id", "is", null)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  return ((data ?? []) as ContentCardRow[]).map((row) => {
    const when = row.published_at ?? row.scheduled_at;
    return {
      id: row.legacy_mock_id as string,
      title: row.title,
      channel: row.channel as ContentItem["channel"],
      accountKey: row.account_key ?? undefined,
      type: row.format,
      status: ENUM_TO_STATUS[row.status] ?? "아이디어",
      publishDate: when ? `${new Date(when).getMonth() + 1}/${new Date(when).getDate()}` : "-",
      publishedAt: row.published_at ? row.published_at.slice(0, 10) : undefined,
      metricLabel: "자동 수집",
      metricValue: "게시물 연결 후",
      draft: row.draft ?? undefined,
      externalUrl: row.external_url ?? undefined,
    };
  });
}

export async function upsertContentCardToSupabase(card: ContentItem): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error("Supabase 미설정으로 콘텐츠를 저장할 수 없습니다.");
  const supabase = getSupabaseClient();
  const status = contentStatusToEnum(card.status);
  const { error } = await supabase.from("content_cards").upsert(
    {
      org_id: ORG_ID,
      legacy_mock_id: card.id,
      channel: card.channel,
      account_key: card.accountKey ?? null,
      format: card.type || "post",
      status,
      title: card.title || "제목 없는 콘텐츠",
      draft: card.draft ?? null,
      external_url: card.externalUrl ?? null,
      published_at: status === "published" && card.publishedAt ? `${card.publishedAt}T00:00:00Z` : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,legacy_mock_id" },
  );
  if (error) throw new Error(error.message);
}

export async function updateContentCardStatus(cardId: string, status: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error("Supabase 미설정으로 상태를 변경할 수 없습니다.");
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("content_cards")
    .update({ status: contentStatusToEnum(status), updated_at: new Date().toISOString() })
    .eq("org_id", ORG_ID)
    .eq("legacy_mock_id", cardId);
  if (error) throw new Error(error.message);
}

export async function deleteContentCardFromSupabase(cardId: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error("Supabase 미설정으로 콘텐츠를 삭제할 수 없습니다.");
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("content_cards")
    .delete()
    .eq("org_id", ORG_ID)
    .eq("legacy_mock_id", cardId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Campaigns → campaigns table (name + objective persisted; content/ad counts and
// per-channel figures are derived from linked ads/content, not stored).
// ---------------------------------------------------------------------------
type CampaignRowDb = { name: string; objective: string | null; status: string };

export async function listCampaigns(): Promise<CampaignRow[]> {
  if (!hasSupabaseConfig()) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("name, objective, status")
    .eq("org_id", ORG_ID)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);

  return ((data ?? []) as CampaignRowDb[]).map((row) => ({
    id: `camp-${row.name}`,
    campaign: row.name,
    objective: row.objective ?? "",
    contentCount: 0,
    linkedPostCount: 0,
    adCount: 0,
    total: "저장된 캠페인",
    bestChannel: "-",
  }));
}

export async function upsertCampaignToSupabase(campaign: CampaignRow): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error("Supabase 미설정으로 캠페인을 저장할 수 없습니다.");
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("campaigns").upsert(
    {
      org_id: ORG_ID,
      name: campaign.campaign,
      objective: campaign.objective || null,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,name" },
  );
  if (error) throw new Error(error.message);
}

export async function deleteCampaignFromSupabase(name: string): Promise<void> {
  if (!hasSupabaseConfig()) throw new Error("Supabase 미설정으로 캠페인을 삭제할 수 없습니다.");
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("campaigns").delete().eq("org_id", ORG_ID).eq("name", name);
  if (error) throw new Error(error.message);
}

// Derive per-campaign counts/summary from the current ads + pipeline so the
// campaign list reflects real linked content organically.
export function enrichCampaigns(campaigns: CampaignRow[], ads: AdContent[], pipeline: ContentItem[]): CampaignRow[] {
  return campaigns.map((campaign) => {
    const adCount = ads.filter((ad) => ad.campaign === campaign.campaign).length;
    const contentCount = pipeline.filter((item) => item.campaign === campaign.campaign).length;
    return {
      ...campaign,
      adCount,
      contentCount,
      total: `소재 ${contentCount}개 · 광고 ${adCount}개`,
    };
  });
}

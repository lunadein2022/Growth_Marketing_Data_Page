// Supabase Edge Function: meta-ads-sync
// Pulls Meta (Facebook/Instagram) ad performance from the Marketing API into
// ad_contents. Tokens live in channel_tokens (provider='meta_ads', one row per
// account_key) with the ad account id stored in external_user_id (e.g.
// "act_1042356035084377"). Each account maps to an Instagram account_key.
//
// Setup (per account): insert into channel_tokens
//   (org_id, provider='meta_ads', account_key, access_token, external_user_id=<act_...>, display_name)
//
// Optional secrets:
//   META_GRAPH_VERSION (default v21.0)
//   MARKETING_OWNER_EMAILS
//   CRON_SECRET

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

type SyncRequest = { datePreset?: string; startDate?: string; endDate?: string };

type MetaAdRow = {
  id: string;
  name?: string;
  effective_status?: string;
  campaign?: { name?: string; objective?: string };
  insights?: {
    data?: Array<{
      spend?: string;
      impressions?: string;
      clicks?: string;
      ctr?: string;
      reach?: string;
      date_start?: string;
      date_stop?: string;
    }>;
  };
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} secret is not configured`);
  return value;
}

async function verifyMarketingUser(authHeader: string, supabase: ReturnType<typeof createClient>) {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) throw new Error("Authenticated marketing user could not be verified");
  const allowed = (Deno.env.get("MARKETING_OWNER_EMAILS") ?? "lunadein2022@gmail.com,lunachae827@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(data.user.email.toLowerCase())) throw new Error("This account is not allowed to run Meta ads sync");
}

type MetaAdsAccount = {
  tokenRowId: string;
  accountKey: string;
  adAccountId: string; // act_...
  accessToken: string;
  displayName?: string;
};

async function loadMetaAdsTokens(supabase: ReturnType<typeof createClient>): Promise<MetaAdsAccount[]> {
  const { data, error } = await supabase
    .from("channel_tokens")
    .select("id, account_key, access_token, external_user_id, display_name")
    .eq("org_id", ORG_ID)
    .eq("provider", "meta_ads");
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    account_key: string;
    access_token: string;
    external_user_id: string | null;
    display_name: string | null;
  }>;
  if (!rows.length) {
    throw new Error("저장된 Meta 광고 토큰이 없습니다. channel_tokens에 provider='meta_ads' 행을 넣어주세요 (external_user_id=광고계정 act_...).");
  }
  return rows
    .filter((row) => row.external_user_id)
    .map((row) => ({
      tokenRowId: row.id,
      accountKey: row.account_key,
      adAccountId: row.external_user_id!.startsWith("act_") ? row.external_user_id! : `act_${row.external_user_id}`,
      accessToken: row.access_token,
      displayName: row.display_name ?? undefined,
    }));
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function mapStatus(effective?: string): "active" | "planned" | "ended" {
  if (effective === "ACTIVE") return "active";
  if (effective === "PENDING_REVIEW" || effective === "IN_PROCESS" || effective === "PREAPPROVED" || effective === "PENDING_BILLING_INFO") {
    return "planned";
  }
  return "ended";
}

// Fetch all ads (with a nested insights edge) for one ad account, paging through.
async function fetchAds(account: MetaAdsAccount, insightsRange: string): Promise<MetaAdRow[]> {
  const ads: MetaAdRow[] = [];
  const fields = `name,effective_status,campaign{name,objective},insights.${insightsRange}{spend,impressions,clicks,ctr,reach,date_start,date_stop}`;
  let url: string | null =
    `${GRAPH_BASE}/${account.adAccountId}/ads?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(account.accessToken)}`;
  let guard = 0;
  while (url && guard < 20) {
    guard += 1;
    const response = await fetch(url);
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = data?.error?.message ?? response.statusText;
      throw new Error(`Meta ads (${account.accountKey}): ${message}`);
    }
    ads.push(...((data.data ?? []) as MetaAdRow[]));
    url = data.paging?.next ?? null;
  }
  return ads;
}

function buildAdPayload(account: MetaAdsAccount, ad: MetaAdRow) {
  const insight = ad.insights?.data?.[0];
  const spend = num(insight?.spend);
  const impressions = num(insight?.impressions);
  const clicks = num(insight?.clicks);
  const ctr = num(insight?.ctr);
  const start = insight?.date_start ?? "";
  const end = insight?.date_stop ?? "";
  const status = mapStatus(ad.effective_status);

  return {
    adAny: {
      id: ad.id,
      title: ad.name ?? `Meta 광고 ${ad.id}`,
      channel: "instagram",
      accountKey: account.accountKey,
      campaign: ad.campaign?.name ?? "Meta 광고",
      performanceSource: "Meta 광고 API",
      period: start && end ? `${start} ~ ${end}` : "-",
      budget: "-",
      spend: spend ? `${formatCount(spend)}원` : "0원",
      impressions: impressions ? formatCount(impressions) : "0",
      clicks: clicks ? formatCount(clicks) : "0",
      ctr: ctr ? `${ctr.toFixed(2)}%` : "0%",
      organicLift: "-",
      status,
    },
    columns: { spend, impressions, clicks, ctr, start, end, status },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const isCron = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;
  if (!isCron) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);
    try {
      await verifyMarketingUser(authHeader, supabase);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : "Unauthorized" }, 403);
    }
  }

  let payload: SyncRequest = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const insightsRange =
    payload.startDate && payload.endDate
      ? `time_range({'since':'${payload.startDate}','until':'${payload.endDate}'})`
      : `date_preset(${payload.datePreset ?? "last_90d"})`;

  try {
    const accounts = await loadMetaAdsTokens(supabase);
    const results: Array<{ accountKey: string; adAccountId: string; adsSynced: number; status: string }> = [];
    let rowsWritten = 0;

    for (const account of accounts) {
      try {
        const ads = await fetchAds(account, insightsRange);
        const rows = ads.map((ad) => {
          const { adAny, columns } = buildAdPayload(account, ad);
          const today = new Date().toISOString().slice(0, 10);
          return {
            org_id: ORG_ID,
            platform_ad_id: ad.id,
            channel: "instagram",
            account_key: account.accountKey,
            title: adAny.title.slice(0, 200),
            source: "meta_ads",
            period_start: columns.start || today,
            period_end: columns.end || today,
            budget: 0,
            spend: columns.spend,
            impressions: Math.round(columns.impressions) || null,
            clicks: Math.round(columns.clicks) || null,
            ctr: columns.ctr || null,
            organic_lift: null,
            status: columns.status,
            raw_payload: adAny,
            updated_at: new Date().toISOString(),
          };
        });

        if (rows.length) {
          const { error } = await supabase.from("ad_contents").upsert(rows, { onConflict: "org_id,platform_ad_id" });
          if (error) throw new Error(error.message);
          rowsWritten += rows.length;
        }

        await supabase
          .from("channel_tokens")
          .update({ last_refreshed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", account.tokenRowId);

        results.push({ accountKey: account.accountKey, adAccountId: account.adAccountId, adsSynced: rows.length, status: "complete" });
      } catch (error) {
        results.push({
          accountKey: account.accountKey,
          adAccountId: account.adAccountId,
          adsSynced: 0,
          status: `error: ${error instanceof Error ? error.message : "failed"}`,
        });
      }
    }

    return jsonResponse({ status: "complete", rowsWritten, accounts: results });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "Meta ads sync failed";
    return jsonResponse({ status: "error", error: message }, 500);
  }
});

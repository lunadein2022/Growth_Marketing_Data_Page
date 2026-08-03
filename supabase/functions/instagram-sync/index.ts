// Supabase Edge Function: instagram-sync
// Pulls Instagram account, media metadata, and insights into Postgres.
//
// Required secrets:
//   META_ACCESS_TOKEN
//
// Optional secrets:
//   META_GRAPH_VERSION=v25.0
//   INSTAGRAM_ACCOUNT_COMPANY_ID
//   INSTAGRAM_ACCOUNT_DUMMDUMM_LOG_ID
//   INSTAGRAM_ACCOUNTS=[{"accountKey":"company","instagramUserId":"...","displayName":"..."}]
//   MARKETING_OWNER_EMAILS

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const ACCOUNT_METRICS = [
  "reach",
  "views",
  "follower_count",
  "profile_views",
  "website_clicks",
  "likes",
  "comments",
  "shares",
  "saves",
  "total_interactions",
];
const MEDIA_METRICS = ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"];
const INSTAGRAM_SCOPES = ["instagram_basic", "instagram_manage_insights", "pages_show_list"];

type PeriodMode = "weekly" | "monthly";

type SyncRequest = {
  periodMode?: PeriodMode;
  startDate?: string;
  endDate?: string;
  maxMedia?: number;
  includeMediaBackfill?: boolean;
};

type InstagramAccountConfig = {
  accountKey: string;
  instagramUserId: string;
  displayName?: string;
  accessToken?: string;
};

type PageAccountsResponse = {
  data?: Array<{
    name?: string;
    access_token?: string;
    instagram_business_account?: {
      id?: string;
      username?: string;
      name?: string;
    };
  }>;
  paging?: { next?: string };
};

type InstagramProfile = {
  id: string;
  username?: string;
  name?: string;
  followers_count?: number;
  media_count?: number;
};

type InstagramMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

type InstagramMediaResponse = {
  data?: InstagramMedia[];
  paging?: { next?: string };
};

type InsightValue = {
  value?: unknown;
  end_time?: string;
};

type InsightsResponse = {
  data?: Array<{
    name?: string;
    period?: string;
    values?: InsightValue[];
    total_value?: { value?: unknown };
  }>;
};

type InsightSeriesPoint = {
  metric: string;
  date: string;
  value: number;
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} secret is not configured`);
  return value;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function defaultRange(periodMode: PeriodMode) {
  const end = addDays(new Date(), -1);
  if (periodMode === "monthly") {
    return { startDate: dateKey(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))), endDate: dateKey(end) };
  }
  return { startDate: dateKey(addDays(end, -6)), endDate: dateKey(end) };
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseRequestRange(payload: SyncRequest) {
  const periodMode = payload.periodMode === "monthly" ? "monthly" : "weekly";
  const fallback = defaultRange(periodMode);
  return {
    periodMode,
    startDate: isDateKey(payload.startDate) ? payload.startDate : fallback.startDate,
    endDate: isDateKey(payload.endDate) ? payload.endDate : fallback.endDate,
    maxMedia: Math.min(Math.max(Number(payload.maxMedia ?? 200), 1), 500),
    includeMediaBackfill: payload.includeMediaBackfill !== false,
  };
}

async function verifyMarketingUser(authHeader: string, supabase: ReturnType<typeof createClient>) {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    throw new Error("Authenticated marketing user could not be verified");
  }

  const allowed = (Deno.env.get("MARKETING_OWNER_EMAILS") ?? "lunadein2022@gmail.com,lunachae827@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(data.user.email.toLowerCase())) {
    throw new Error("This account is not allowed to run Instagram sync");
  }
}

function buildGraphUrl(pathOrUrl: string, params: Record<string, string | number | undefined> = {}, accessToken?: string) {
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(`${GRAPH_BASE}/${pathOrUrl.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  if (accessToken) url.searchParams.set("access_token", accessToken);
  return url.toString();
}

async function graphGet<T>(
  pathOrUrl: string,
  accessToken: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const response = await fetch(buildGraphUrl(pathOrUrl, params, accessToken));
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.error?.message ?? data?.error_description ?? response.statusText;
    throw new Error(message);
  }
  return data as T;
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMetricKey(metric: string) {
  if (metric === "saved") return "saves";
  if (metric === "follower_count") return "followers_gained";
  return metric;
}

function epochSeconds(date: string, endOfDay = false) {
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  return Math.floor(new Date(`${date}${suffix}`).getTime() / 1000);
}

function extractInsightTotal(response: InsightsResponse, metric: string) {
  const row = response.data?.find((item) => item.name === metric);
  if (!row) return 0;
  if (row.total_value) return numeric(row.total_value.value);
  return (row.values ?? []).reduce((total, value) => total + numeric(value.value), 0);
}

function extractInsightSeries(response: InsightsResponse, metric: string) {
  const row = response.data?.find((item) => item.name === metric);
  return (row?.values ?? []).flatMap((value): InsightSeriesPoint[] => {
    const endTime = value.end_time;
    if (!endTime) return [];
    return [
      {
        metric: normalizeMetricKey(metric),
        date: dateKey(new Date(endTime)),
        value: numeric(value.value),
      },
    ];
  });
}

async function fetchAccountInsights(
  instagramUserId: string,
  accessToken: string,
  startDate: string,
  endDate: string,
) {
  const warnings: string[] = [];
  const totals: Record<string, number> = {};
  const series: InsightSeriesPoint[] = [];

  for (const metric of ACCOUNT_METRICS) {
    try {
      const response = await graphGet<InsightsResponse>(`${instagramUserId}/insights`, accessToken, {
        metric,
        period: "day",
        since: epochSeconds(startDate),
        until: epochSeconds(endDate, true),
      });
      totals[normalizeMetricKey(metric)] = extractInsightTotal(response, metric);
      series.push(...extractInsightSeries(response, metric));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      warnings.push(`${metric}: ${detail}`);
    }
  }

  return { totals, series, warnings };
}

async function fetchMediaInsights(mediaId: string, accessToken: string) {
  const insights: Record<string, number> = {};
  const warnings: string[] = [];

  try {
    const response = await graphGet<InsightsResponse>(`${mediaId}/insights`, accessToken, {
      metric: MEDIA_METRICS.join(","),
    });
    for (const metric of MEDIA_METRICS) {
      insights[normalizeMetricKey(metric)] = extractInsightTotal(response, metric);
    }
    return { insights, warnings };
  } catch {
    for (const metric of MEDIA_METRICS) {
      try {
        const response = await graphGet<InsightsResponse>(`${mediaId}/insights`, accessToken, { metric });
        insights[normalizeMetricKey(metric)] = extractInsightTotal(response, metric);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown error";
        warnings.push(`${metric}: ${detail}`);
      }
    }
    return { insights, warnings };
  }
}

function parseConfiguredAccounts(): InstagramAccountConfig[] {
  const rawJson = Deno.env.get("INSTAGRAM_ACCOUNTS");
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) throw new Error("INSTAGRAM_ACCOUNTS must be a JSON array");
    return parsed
      .map((item, index) => ({
        accountKey: String(item.accountKey ?? item.account_key ?? (index === 0 ? "company" : "dummdumm-log")),
        instagramUserId: String(item.instagramUserId ?? item.instagram_user_id ?? item.id ?? ""),
        displayName: item.displayName ?? item.display_name,
        accessToken: item.accessToken ?? item.access_token,
      }))
      .filter((item) => item.instagramUserId);
  }

  const accounts: InstagramAccountConfig[] = [];
  const companyId = Deno.env.get("INSTAGRAM_ACCOUNT_COMPANY_ID");
  const logId = Deno.env.get("INSTAGRAM_ACCOUNT_DUMMDUMM_LOG_ID");
  if (companyId) accounts.push({ accountKey: "company", instagramUserId: companyId, displayName: "Instagram 본계" });
  if (logId) accounts.push({ accountKey: "dummdumm-log", instagramUserId: logId, displayName: "Instagram 둠둠로그" });
  return accounts;
}

async function discoverAccounts(accessToken: string): Promise<InstagramAccountConfig[]> {
  const accounts: InstagramAccountConfig[] = [];
  let nextUrl = buildGraphUrl(
    "me/accounts",
    { fields: "name,access_token,instagram_business_account{id,username,name}", limit: 50 },
    accessToken,
  );

  while (nextUrl && accounts.length < 2) {
    const response = await graphGet<PageAccountsResponse>(nextUrl, accessToken);
    for (const page of response.data ?? []) {
      const ig = page.instagram_business_account;
      if (!ig?.id) continue;
      const index = accounts.length;
      accounts.push({
        accountKey: index === 0 ? "company" : "dummdumm-log",
        instagramUserId: ig.id,
        displayName: ig.username ? `Instagram @${ig.username}` : ig.name ?? page.name ?? `Instagram ${index + 1}`,
        accessToken: page.access_token ?? accessToken,
      });
      if (accounts.length >= 2) break;
    }
    nextUrl = response.paging?.next ?? "";
  }

  return accounts;
}

async function getInstagramAccounts(accessToken: string) {
  const configured = parseConfiguredAccounts();
  if (configured.length) {
    return configured.map((account) => ({ ...account, accessToken: account.accessToken ?? accessToken }));
  }

  const discovered = await discoverAccounts(accessToken);
  if (!discovered.length) {
    throw new Error("No Instagram business accounts found. Set INSTAGRAM_ACCOUNT_COMPANY_ID and INSTAGRAM_ACCOUNT_DUMMDUMM_LOG_ID if discovery is not available.");
  }
  return discovered;
}

function classifyFormat(media: InstagramMedia) {
  if (media.media_product_type === "REELS" || media.media_type === "VIDEO") return "reels";
  if (media.media_type === "CAROUSEL_ALBUM") return "carousel";
  return "feed";
}

function mediaTitle(media: InstagramMedia, profile: InstagramProfile) {
  const firstLine = (media.caption ?? "").split(/\r?\n/)[0]?.trim();
  if (firstLine) return firstLine.slice(0, 140);
  const date = media.timestamp ? dateKey(new Date(media.timestamp)) : dateKey(new Date());
  return `@${profile.username ?? profile.id} ${classifyFormat(media)} ${date}`;
}

async function fetchMedia(
  account: InstagramAccountConfig,
  profile: InstagramProfile,
  startDate: string,
  endDate: string,
  maxMedia: number,
  includeMediaBackfill: boolean,
) {
  const media: InstagramMedia[] = [];
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T23:59:59Z`).getTime();
  let nextUrl = buildGraphUrl(
    `${account.instagramUserId}/media`,
    {
      fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit: Math.min(50, maxMedia),
    },
    account.accessToken,
  );

  while (nextUrl && media.length < maxMedia) {
    const response = await graphGet<InstagramMediaResponse>(nextUrl, account.accessToken ?? "");
    for (const item of response.data ?? []) {
      const time = item.timestamp ? new Date(item.timestamp).getTime() : 0;
      const inRange = time >= startMs && time <= endMs;
      if (includeMediaBackfill || inRange) media.push(item);
      if (!includeMediaBackfill && time && time < startMs) {
        nextUrl = "";
        break;
      }
      if (media.length >= maxMedia) break;
    }
    if (!nextUrl || media.length >= maxMedia) break;
    nextUrl = response.paging?.next ?? "";
  }

  return media.map((item) => ({ ...item, title: mediaTitle(item, profile) }));
}

async function upsertChannelAccount(
  supabase: ReturnType<typeof createClient>,
  account: InstagramAccountConfig,
  profile: InstagramProfile,
  status: "complete" | "partial",
) {
  const displayName = account.displayName ?? (profile.username ? `Instagram @${profile.username}` : profile.name ?? "Instagram");
  const { data, error } = await supabase
    .from("channel_accounts")
    .upsert(
      {
        org_id: ORG_ID,
        channel: "instagram",
        account_key: account.accountKey,
        display_name: displayName,
        status,
        auth_provider: "meta",
        external_account_id: account.instagramUserId,
        scopes: INSTAGRAM_SCOPES,
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "org_id,channel,account_key" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    await verifyMarketingUser(authHeader, supabase);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unauthorized" }, 403);
  }

  let payload: SyncRequest = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const { periodMode, startDate, endDate, maxMedia, includeMediaBackfill } = parseRequestRange(payload);
  const masterToken = requireEnv("META_ACCESS_TOKEN");
  const accountConfigs = await getInstagramAccounts(masterToken);
  const results = [];
  const syncRunIds: string[] = [];
  let totalRowsRead = 0;
  let totalRowsWritten = 0;

  for (const accountConfig of accountConfigs) {
    const accessToken = accountConfig.accessToken ?? masterToken;
    let syncRunId = "";
    let accountId = "";
    const warnings: string[] = [];

    try {
      const profile = await graphGet<InstagramProfile>(accountConfig.instagramUserId, accessToken, {
        fields: "id,username,name,followers_count,media_count",
      });
      const accountInsights = await fetchAccountInsights(accountConfig.instagramUserId, accessToken, startDate, endDate);
      warnings.push(...accountInsights.warnings);

      const channelAccount = await upsertChannelAccount(
        supabase,
        accountConfig,
        profile,
        accountInsights.warnings.length ? "partial" : "complete",
      );
      accountId = channelAccount.id;

      const { data: syncRun, error: syncInsertError } = await supabase
        .from("sync_runs")
        .insert({
          org_id: ORG_ID,
          channel_account_id: accountId,
          job_type: "instagram_graph_sync",
          period_start: startDate,
          period_end: endDate,
          status: "partial",
        })
        .select("id")
        .single();
      if (syncInsertError) throw syncInsertError;
      syncRunId = (syncRun as { id: string }).id;
      syncRunIds.push(syncRunId);

      const media = await fetchMedia(accountConfig, profile, startDate, endDate, maxMedia, includeMediaBackfill);
      const mediaInsightsById = new Map<string, Record<string, number>>();
      let mediaWithInsights = 0;

      for (const item of media) {
        const result = await fetchMediaInsights(item.id, accessToken);
        if (Object.values(result.insights).some((value) => value > 0)) mediaWithInsights += 1;
        mediaInsightsById.set(item.id, result.insights);
        warnings.push(...result.warnings.slice(0, 2).map((warning) => `${item.id} ${warning}`));
      }

      const { data: posts, error: postsError } = media.length
        ? await supabase
            .from("published_posts")
            .upsert(
              media.map((item) => ({
                org_id: ORG_ID,
                channel_account_id: accountId,
                channel: "instagram",
                account_key: accountConfig.accountKey,
                format: classifyFormat(item),
                platform_post_id: item.id,
                title: (item as InstagramMedia & { title: string }).title,
                permalink: item.permalink ?? null,
                published_at: item.timestamp ?? new Date().toISOString(),
                raw_source: "api",
                raw_payload: {
                  media: item,
                  profile,
                  insights: mediaInsightsById.get(item.id) ?? {},
                },
              })),
              { onConflict: "org_id,channel,account_key,platform_post_id" },
            )
            .select("id,platform_post_id")
        : { data: [], error: null };
      if (postsError) throw postsError;

      const accountMetrics = {
        followers: numeric(profile.followers_count),
        followers_gained: numeric(accountInsights.totals.followers_gained),
        reach: numeric(accountInsights.totals.reach),
        views: numeric(accountInsights.totals.views),
        saves: numeric(accountInsights.totals.saves),
        shares: numeric(accountInsights.totals.shares),
        likes: numeric(accountInsights.totals.likes),
        comments: numeric(accountInsights.totals.comments),
        total_interactions: numeric(accountInsights.totals.total_interactions),
        profile_views: numeric(accountInsights.totals.profile_views),
        website_clicks: numeric(accountInsights.totals.website_clicks),
        media_count: numeric(profile.media_count),
        posts_synced: media.length,
      };

      const { error: snapshotError } = await supabase.from("metric_snapshots").upsert(
        {
          org_id: ORG_ID,
          owner_type: "channel",
          owner_id: accountId,
          channel: "instagram",
          account_key: accountConfig.accountKey,
          period_mode: periodMode,
          period_start: startDate,
          period_end: endDate,
          metrics: accountMetrics,
          status: warnings.length ? "partial" : "complete",
          source_ids: [syncRunId],
        },
        { onConflict: "org_id,owner_type,owner_id,period_mode,period_start,period_end" },
      );
      if (snapshotError) throw snapshotError;

      const seriesRows = accountInsights.series.map((point) => ({
        org_id: ORG_ID,
        owner_type: "channel",
        owner_id: accountId,
        channel: "instagram",
        account_key: accountConfig.accountKey,
        metric_key: point.metric,
        granularity: "day",
        point_date: point.date,
        value: point.value,
        status: "complete",
        source_ids: [syncRunId],
      }));
      if (seriesRows.length) {
        const { error: seriesError } = await supabase
          .from("metric_time_series")
          .upsert(seriesRows, { onConflict: "org_id,owner_type,owner_id,metric_key,granularity,point_date" });
        if (seriesError) throw seriesError;
      }

      const postByPlatformId = new Map(((posts ?? []) as Array<{ id: string; platform_post_id: string }>).map((post) => [post.platform_post_id, post.id]));
      const postSnapshotRows = media.flatMap((item) => {
        const postId = postByPlatformId.get(item.id);
        if (!postId) return [];
        const insights = mediaInsightsById.get(item.id) ?? {};
        return [
          {
            org_id: ORG_ID,
            owner_type: "post",
            owner_id: postId,
            channel: "instagram",
            account_key: accountConfig.accountKey,
            period_mode: periodMode,
            period_start: startDate,
            period_end: endDate,
            metrics: {
              reach: numeric(insights.reach),
              views: numeric(insights.views),
              saves: numeric(insights.saves),
              shares: numeric(insights.shares),
              likes: numeric(insights.likes) || numeric(item.like_count),
              comments: numeric(insights.comments) || numeric(item.comments_count),
              total_interactions: numeric(insights.total_interactions),
              format: classifyFormat(item),
            },
            status: Object.keys(insights).length ? "complete" : "partial",
            source_ids: [syncRunId],
          },
        ];
      });

      if (postSnapshotRows.length) {
        const { error: postSnapshotError } = await supabase
          .from("metric_snapshots")
          .upsert(postSnapshotRows, { onConflict: "org_id,owner_type,owner_id,period_mode,period_start,period_end" });
        if (postSnapshotError) throw postSnapshotError;
      }

      const rowsRead = 1 + media.length + accountInsights.series.length + mediaInsightsById.size;
      const rowsWritten = 1 + media.length + 1 + seriesRows.length + postSnapshotRows.length;
      totalRowsRead += rowsRead;
      totalRowsWritten += rowsWritten;

      const { error: syncUpdateError } = await supabase
        .from("sync_runs")
        .update({
          status: warnings.length ? "partial" : "complete",
          rows_read: rowsRead,
          rows_written: rowsWritten,
          error_message: warnings.length ? warnings.slice(0, 10).join(" | ") : null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", syncRunId);
      if (syncUpdateError) throw syncUpdateError;

      results.push({
        accountKey: accountConfig.accountKey,
        displayName: accountConfig.displayName ?? profile.username ?? profile.name ?? accountConfig.accountKey,
        instagramUserId: accountConfig.instagramUserId,
        mediaSynced: media.length,
        mediaWithInsights,
        dailyPoints: accountInsights.series.length,
        warnings: warnings.slice(0, 8),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Instagram sync failed";
      if (syncRunId) {
        await supabase
          .from("sync_runs")
          .update({ status: "error", error_message: message, finished_at: new Date().toISOString() })
          .eq("id", syncRunId);
      }
      results.push({
        accountKey: accountConfig.accountKey,
        displayName: accountConfig.displayName ?? accountConfig.accountKey,
        instagramUserId: accountConfig.instagramUserId,
        mediaSynced: 0,
        mediaWithInsights: 0,
        dailyPoints: 0,
        warnings: [message],
      });
    }
  }

  const hasSuccessfulAccount = results.some((result) => result.mediaSynced > 0 || result.dailyPoints > 0);
  const status = results.some((result) => result.warnings.length > 0) ? "partial" : "complete";
  if (!hasSuccessfulAccount) {
    return jsonResponse({ status: "error", error: results.flatMap((result) => result.warnings).join(" | ") }, 500);
  }

  return jsonResponse({
    status,
    message: `Instagram ${startDate}~${endDate} sync finished`,
    periodStart: startDate,
    periodEnd: endDate,
    rowsRead: totalRowsRead,
    rowsWritten: totalRowsWritten,
    accounts: results,
    syncRunIds,
  });
});

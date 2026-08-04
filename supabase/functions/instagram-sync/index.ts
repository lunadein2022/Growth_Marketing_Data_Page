// Supabase Edge Function: instagram-sync
// Instagram API with Instagram Login (graph.instagram.com).
// Tokens are stored per account in the channel_tokens table and auto-refreshed
// on every run, so they never need manual rotation. Pulls account + media
// insights into Postgres.
//
// Setup (once):
//   1) Generate an Instagram User token per account in the Graph API Explorer
//      ("Generate Instagram Access Token").
//   2) Save each into channel_tokens (see migration 0006 / setup SQL).
//
// Optional secrets:
//   INSTAGRAM_GRAPH_VERSION=v21.0
//   MARKETING_OWNER_EMAILS
//   CRON_SECRET  (allows scheduled runs without a user login; sent as x-cron-secret)

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const GRAPH_VERSION = Deno.env.get("INSTAGRAM_GRAPH_VERSION") ?? Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
const REFRESH_URL = "https://graph.instagram.com/refresh_access_token";
// Refresh when the token expires within this many days (Instagram tokens must be
// at least 24h old to refresh; a too-fresh refresh error is caught and ignored).
const REFRESH_WITHIN_DAYS = 20;
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
const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"];

type PeriodMode = "weekly" | "monthly";

type SyncRequest = {
  periodMode?: PeriodMode;
  startDate?: string;
  endDate?: string;
  maxMedia?: number;
  includeMediaBackfill?: boolean;
};

type InstagramAccountConfig = {
  tokenRowId: string;
  accountKey: string;
  instagramUserId: string; // resolved from /me; "me" until resolved
  displayName?: string;
  accessToken: string;
  tokenExpiresAt: string | null;
};

type InstagramProfile = {
  id: string;
  user_id?: string;
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

type ChannelTokenRow = {
  id: string;
  account_key: string;
  access_token: string;
  token_expires_at: string | null;
  external_user_id: string | null;
  display_name: string | null;
};

async function loadInstagramTokens(
  supabase: ReturnType<typeof createClient>,
): Promise<InstagramAccountConfig[]> {
  const { data, error } = await supabase
    .from("channel_tokens")
    .select("id, account_key, access_token, token_expires_at, external_user_id, display_name")
    .eq("org_id", ORG_ID)
    .eq("provider", "instagram")
    .order("account_key", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as ChannelTokenRow[];
  if (!rows.length) {
    throw new Error(
      "저장된 Instagram 토큰이 없습니다. channel_tokens에 계정별 Instagram 토큰을 넣어주세요 (provider='instagram').",
    );
  }

  return rows.map((row) => ({
    tokenRowId: row.id,
    accountKey: row.account_key,
    instagramUserId: row.external_user_id ?? "me",
    displayName: row.display_name ?? undefined,
    accessToken: row.access_token,
    tokenExpiresAt: row.token_expires_at,
  }));
}

// Exchange a long-lived Instagram token for a fresh one (adds ~60 days). Only
// runs when the token is close to expiry; a "too fresh to refresh" error is
// swallowed so the sync keeps using the current token.
async function refreshInstagramTokenIfNeeded(
  supabase: ReturnType<typeof createClient>,
  account: InstagramAccountConfig,
): Promise<{ accessToken: string; warning?: string }> {
  const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : 0;
  const soon = Date.now() + REFRESH_WITHIN_DAYS * 86400 * 1000;
  if (expiresAt && expiresAt > soon) return { accessToken: account.accessToken };

  try {
    const url = new URL(REFRESH_URL);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", account.accessToken);
    const response = await fetch(url.toString());
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok || !data.access_token) {
      const message = data?.error?.message ?? response.statusText;
      return { accessToken: account.accessToken, warning: `token refresh skipped: ${message}` };
    }

    const newExpiry = new Date(Date.now() + Number(data.expires_in ?? 5184000) * 1000).toISOString();
    await supabase
      .from("channel_tokens")
      .update({
        access_token: data.access_token,
        token_expires_at: newExpiry,
        last_refreshed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.tokenRowId);
    return { accessToken: data.access_token };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { accessToken: account.accessToken, warning: `token refresh error: ${message}` };
  }
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

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Scheduled (cron) runs authenticate with a shared secret; interactive runs
  // require a logged-in marketing user.
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

  const { periodMode, startDate, endDate, maxMedia, includeMediaBackfill } = parseRequestRange(payload);
  const accountConfigs = await loadInstagramTokens(supabase);
  const results = [];
  const syncRunIds: string[] = [];
  let totalRowsRead = 0;
  let totalRowsWritten = 0;

  for (const accountConfig of accountConfigs) {
    let syncRunId = "";
    let accountId = "";
    const warnings: string[] = [];

    try {
      const refreshed = await refreshInstagramTokenIfNeeded(supabase, accountConfig);
      const accessToken = refreshed.accessToken;
      accountConfig.accessToken = accessToken;
      if (refreshed.warning) warnings.push(refreshed.warning);

      const profile = await graphGet<InstagramProfile>("me", accessToken, {
        fields: "user_id,username,name,followers_count,media_count",
      });
      const resolvedUserId = profile.user_id ?? profile.id;
      accountConfig.instagramUserId = resolvedUserId;
      if (resolvedUserId && resolvedUserId !== "me") {
        await supabase
          .from("channel_tokens")
          .update({ external_user_id: resolvedUserId, updated_at: new Date().toISOString() })
          .eq("id", accountConfig.tokenRowId);
      }

      const accountInsights = await fetchAccountInsights(resolvedUserId, accessToken, startDate, endDate);
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

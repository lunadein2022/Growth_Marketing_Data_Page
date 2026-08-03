// Supabase Edge Function: youtube-sync
// Pulls YouTube channel, video metadata, and Analytics metrics into Postgres.
//
// Required secrets:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//
// Optional secrets:
//   YOUTUBE_CHANNEL_ID
//   MARKETING_OWNER_EMAILS

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_DATA_BASE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2/reports";
const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

type PeriodMode = "weekly" | "monthly";

type SyncRequest = {
  periodMode?: PeriodMode;
  startDate?: string;
  endDate?: string;
  maxVideos?: number;
  includeUploadBackfill?: boolean;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type YouTubeChannelResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string };
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
      hiddenSubscriberCount?: boolean;
    };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
};

type PlaylistItemsResponse = {
  nextPageToken?: string;
  items?: Array<{
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
    snippet?: { publishedAt?: string; resourceId?: { videoId?: string } };
  }>;
};

type VideoListResponse = {
  items?: YouTubeVideoResource[];
};

type YouTubeVideoResource = {
  id: string;
  snippet?: {
    title?: string;
    publishedAt?: string;
    channelId?: string;
  };
  contentDetails?: { duration?: string };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
};

type AnalyticsResponse = {
  columnHeaders?: Array<{ name: string }>;
  rows?: unknown[][];
};

type AnalyticsRow = Record<string, string | number | null>;

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
    maxVideos: Math.min(Math.max(Number(payload.maxVideos ?? 200), 1), 500),
    includeUploadBackfill: payload.includeUploadBackfill !== false,
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
    throw new Error("This account is not allowed to run YouTube sync");
  }
}

async function refreshGoogleAccessToken() {
  const body = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Google token refresh failed");
  }
  return data.access_token;
}

async function googleGet<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.error?.message ?? data?.error_description ?? response.statusText;
    throw new Error(message);
  }
  return data as T;
}

function buildUrl(base: string, params: Record<string, string | number | undefined>) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchChannel(accessToken: string) {
  const channelId = Deno.env.get("YOUTUBE_CHANNEL_ID");
  const data = await googleGet<YouTubeChannelResponse>(
    buildUrl(`${YOUTUBE_DATA_BASE}/channels`, {
      part: "snippet,statistics,contentDetails",
      id: channelId,
      mine: channelId ? undefined : "true",
      maxResults: 1,
    }),
    accessToken,
  );
  const channel = data.items?.[0];
  if (!channel?.id) throw new Error("No YouTube channel returned for the configured Google account");
  return channel;
}

async function fetchUploadVideoIds(
  accessToken: string,
  playlistId: string,
  maxVideos: number,
  bounds?: { startDate: string; endDate: string },
) {
  const ids: string[] = [];
  let pageToken = "";
  const startTime = bounds ? new Date(`${bounds.startDate}T00:00:00Z`).getTime() : null;
  const endTime = bounds ? new Date(`${bounds.endDate}T23:59:59Z`).getTime() : null;

  while (ids.length < maxVideos) {
    const data = await googleGet<PlaylistItemsResponse>(
      buildUrl(`${YOUTUBE_DATA_BASE}/playlistItems`, {
        part: "snippet,contentDetails",
        playlistId,
        maxResults: Math.min(50, maxVideos - ids.length),
        pageToken,
      }),
      accessToken,
    );

    for (const item of data.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt;
      const publishedTime = publishedAt ? new Date(publishedAt).getTime() : 0;
      const inBounds =
        startTime === null || endTime === null || (publishedTime >= startTime && publishedTime <= endTime);
      if (videoId && inBounds) ids.push(videoId);
    }

    if (!data.nextPageToken || ids.length >= maxVideos) break;
    pageToken = data.nextPageToken;
  }

  return ids.slice(0, maxVideos);
}

async function fetchVideos(accessToken: string, ids: string[]) {
  if (!ids.length) return [];
  const videos: YouTubeVideoResource[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50);
    const data = await googleGet<VideoListResponse>(
      buildUrl(`${YOUTUBE_DATA_BASE}/videos`, {
        part: "snippet,contentDetails,statistics",
        id: chunk.join(","),
        maxResults: chunk.length,
      }),
      accessToken,
    );
    videos.push(...(data.items ?? []));
  }
  return videos;
}

async function fetchAnalytics(accessToken: string, params: Record<string, string | number>) {
  const data = await googleGet<AnalyticsResponse>(buildUrl(YOUTUBE_ANALYTICS_BASE, params), accessToken);
  const headers = data.columnHeaders?.map((header) => header.name) ?? [];
  return (data.rows ?? []).map((row) => Object.fromEntries(headers.map((name, index) => [name, row[index] ?? null])) as AnalyticsRow);
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(rows: AnalyticsRow[], key: string) {
  return rows.reduce((total, row) => total + numeric(row[key]), 0);
}

function weightedAverage(rows: AnalyticsRow[], valueKey: string, weightKey: string) {
  const totalWeight = sum(rows, weightKey);
  if (!totalWeight) return 0;
  return rows.reduce((total, row) => total + numeric(row[valueKey]) * numeric(row[weightKey]), 0) / totalWeight;
}

function parseIsoDurationSeconds(value: string | undefined) {
  if (!value) return 0;
  const match = value.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function classifyFormat(video: YouTubeVideoResource) {
  const durationSeconds = parseIsoDurationSeconds(video.contentDetails?.duration);
  const title = video.snippet?.title ?? "";
  return durationSeconds <= 180 || /#shorts|shorts|쇼츠/i.test(title) ? "shorts" : "longform";
}

async function upsertChannelAccount(
  supabase: ReturnType<typeof createClient>,
  channel: Awaited<ReturnType<typeof fetchChannel>>,
) {
  const { data, error } = await supabase
    .from("channel_accounts")
    .upsert(
      {
        org_id: ORG_ID,
        channel: "youtube",
        account_key: "main",
        display_name: channel.snippet?.title ?? "YouTube",
        status: "complete",
        auth_provider: "google",
        external_account_id: channel.id,
        scopes: YOUTUBE_SCOPES,
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

  const { periodMode, startDate, endDate, maxVideos, includeUploadBackfill } = parseRequestRange(payload);
  let syncRunId = "";
  let accountId = "";

  try {
    const accessToken = await refreshGoogleAccessToken();
    const channel = await fetchChannel(accessToken);
    const account = await upsertChannelAccount(supabase, channel);
    accountId = account.id;

    const { data: syncRun, error: syncInsertError } = await supabase
      .from("sync_runs")
      .insert({
        org_id: ORG_ID,
        channel_account_id: accountId,
        job_type: "youtube_analytics_sync",
        period_start: startDate,
        period_end: endDate,
        status: "partial",
      })
      .select("id")
      .single();
    if (syncInsertError) throw syncInsertError;
    syncRunId = (syncRun as { id: string }).id;

    const analyticsIds = Deno.env.get("YOUTUBE_CHANNEL_ID") ? `channel==${channel.id}` : "channel==MINE";
    const dailyRows = await fetchAnalytics(accessToken, {
      ids: analyticsIds,
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained",
      dimensions: "day",
      sort: "day",
    });
    const videoAnalyticsRows = await fetchAnalytics(accessToken, {
      ids: analyticsIds,
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,averageViewDuration",
      dimensions: "video",
      sort: "-views",
      maxResults: maxVideos,
    });

    const analyticsVideoIds = videoAnalyticsRows.map((row) => String(row.video ?? "")).filter(Boolean);
    const uploadsPlaylist = channel.contentDetails?.relatedPlaylists?.uploads;
    const uploadVideoIds = uploadsPlaylist
      ? await fetchUploadVideoIds(
          accessToken,
          uploadsPlaylist,
          maxVideos,
          includeUploadBackfill ? undefined : { startDate, endDate },
        )
      : [];
    const videoIds = Array.from(new Set([...analyticsVideoIds, ...uploadVideoIds])).slice(0, maxVideos);
    const videos = await fetchVideos(accessToken, videoIds);
    const analyticsByVideo = new Map(videoAnalyticsRows.map((row) => [String(row.video ?? ""), row]));

    const { data: posts, error: postsError } = videos.length
      ? await supabase
          .from("published_posts")
          .upsert(
            videos.map((video) => {
              const format = classifyFormat(video);
              const permalink =
                format === "shorts"
                  ? `https://www.youtube.com/shorts/${video.id}`
                  : `https://www.youtube.com/watch?v=${video.id}`;
              return {
                org_id: ORG_ID,
                channel_account_id: accountId,
                channel: "youtube",
                account_key: "main",
                format,
                platform_post_id: video.id,
                title: video.snippet?.title ?? video.id,
                permalink,
                published_at: video.snippet?.publishedAt ?? new Date().toISOString(),
                raw_source: "api",
                raw_payload: {
                  video,
                  analytics: analyticsByVideo.get(video.id) ?? null,
                },
              };
            }),
            { onConflict: "org_id,channel,account_key,platform_post_id" },
          )
          .select("id,platform_post_id")
      : { data: [], error: null };
    if (postsError) throw postsError;

    const subscribers = numeric(channel.statistics?.subscriberCount);
    const channelMetrics = {
      subscribers,
      subscribers_gained: sum(dailyRows, "subscribersGained"),
      views: sum(dailyRows, "views"),
      watch_time_minutes: sum(dailyRows, "estimatedMinutesWatched"),
      average_view_seconds: Math.round(weightedAverage(dailyRows, "averageViewDuration", "views")),
      video_count: numeric(channel.statistics?.videoCount),
    };

    const { error: snapshotError } = await supabase.from("metric_snapshots").upsert(
      {
        org_id: ORG_ID,
        owner_type: "channel",
        owner_id: accountId,
        channel: "youtube",
        account_key: "main",
        period_mode: periodMode,
        period_start: startDate,
        period_end: endDate,
        metrics: channelMetrics,
        status: dailyRows.length ? "complete" : "partial",
        source_ids: [syncRunId],
      },
      { onConflict: "org_id,owner_type,owner_id,period_mode,period_start,period_end" },
    );
    if (snapshotError) throw snapshotError;

    const seriesRows = dailyRows.flatMap((row) => {
      const pointDate = String(row.day ?? "");
      if (!isDateKey(pointDate)) return [];
      return [
        { metric_key: "views", value: numeric(row.views) },
        { metric_key: "watch_time_minutes", value: numeric(row.estimatedMinutesWatched) },
        { metric_key: "average_view_seconds", value: numeric(row.averageViewDuration) },
        { metric_key: "subscribers_gained", value: numeric(row.subscribersGained) },
      ].map((metric) => ({
        org_id: ORG_ID,
        owner_type: "channel",
        owner_id: accountId,
        channel: "youtube",
        account_key: "main",
        metric_key: metric.metric_key,
        granularity: "day",
        point_date: pointDate,
        value: metric.value,
        status: "complete",
        source_ids: [syncRunId],
      }));
    });

    if (seriesRows.length) {
      const { error: seriesError } = await supabase
        .from("metric_time_series")
        .upsert(seriesRows, { onConflict: "org_id,owner_type,owner_id,metric_key,granularity,point_date" });
      if (seriesError) throw seriesError;
    }

    const postByPlatformId = new Map(((posts ?? []) as Array<{ id: string; platform_post_id: string }>).map((post) => [post.platform_post_id, post.id]));
    const postSnapshotRows = videos.flatMap((video) => {
      const postId = postByPlatformId.get(video.id);
      if (!postId) return [];
      const analytics = analyticsByVideo.get(video.id);
      if (!analytics) return [];
      const durationSeconds = parseIsoDurationSeconds(video.contentDetails?.duration);
      return [
        {
          org_id: ORG_ID,
          owner_type: "post",
          owner_id: postId,
          channel: "youtube",
          account_key: "main",
          period_mode: periodMode,
          period_start: startDate,
          period_end: endDate,
          metrics: {
            views: numeric(analytics?.views),
            watch_time_minutes: numeric(analytics?.estimatedMinutesWatched),
            average_view_seconds: numeric(analytics?.averageViewDuration),
            total_views: numeric(video.statistics?.viewCount),
            likes: numeric(video.statistics?.likeCount),
            comments: numeric(video.statistics?.commentCount),
            duration_seconds: durationSeconds,
            format: classifyFormat(video),
          },
          status: analytics ? "complete" : "partial",
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

    const rowsWritten = 1 + videos.length + 1 + seriesRows.length + postSnapshotRows.length;
    const rowsRead = dailyRows.length + videoAnalyticsRows.length + videos.length;
    const { error: syncUpdateError } = await supabase
      .from("sync_runs")
      .update({
        status: "complete",
        rows_read: rowsRead,
        rows_written: rowsWritten,
        finished_at: new Date().toISOString(),
      })
      .eq("id", syncRunId);
    if (syncUpdateError) throw syncUpdateError;

    return jsonResponse({
      status: "complete",
      message: `${channel.snippet?.title ?? "YouTube"} ${startDate}~${endDate} 동기화 완료`,
      channelTitle: channel.snippet?.title ?? "YouTube",
      periodStart: startDate,
      periodEnd: endDate,
      rowsRead,
      rowsWritten,
      videosSynced: videos.length,
      videosWithPeriodMetrics: videoAnalyticsRows.length,
      videoLimit: maxVideos,
      dailyPoints: dailyRows.length,
      syncRunId,
      metrics: channelMetrics,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube sync failed";
    if (syncRunId) {
      try {
        const { error: syncRunError } = await supabase
          .from("sync_runs")
          .update({ status: "error", error_message: message, finished_at: new Date().toISOString() })
          .eq("id", syncRunId);
        if (syncRunError) console.error("Failed to update YouTube sync run", syncRunError.message);
      } catch (syncRunError) {
        console.error("Failed to update YouTube sync run", syncRunError);
      }
    }
    return jsonResponse({ status: "error", error: message, channelAccountId: accountId || null }, 500);
  }
});

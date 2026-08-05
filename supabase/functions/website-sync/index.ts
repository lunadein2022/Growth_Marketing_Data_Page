// Supabase Edge Function: website-sync
// Pulls GA4 (Analytics Data API) + Search Console metrics for the KR/EN homepage
// properties into Postgres. Mirrors youtube-sync's shape.
//
// Required secrets:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   WEBSITE_GOOGLE_REFRESH_TOKEN   (falls back to GOOGLE_REFRESH_TOKEN)
//        → the refresh token MUST have been granted:
//          https://www.googleapis.com/auth/analytics.readonly
//          https://www.googleapis.com/auth/webmasters.readonly
//
// Per-account config (at least one GA4 property id required):
//   GA4_PROPERTY_ID_KR / GA4_PROPERTY_ID_EN            (numeric GA4 property id)
//   SEARCH_CONSOLE_SITE_KR / SEARCH_CONSOLE_SITE_EN    (e.g. "sc-domain:example.com" or "https://example.com/")
//   WEBSITE_BASE_URL_KR / WEBSITE_BASE_URL_EN          (optional, to build page permalinks)
//
// Optional secrets:
//   MARKETING_OWNER_EMAILS
//   CRON_SECRET  (allows scheduled runs without a user login; sent as x-cron-secret)

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GA4_BASE = "https://analyticsdata.googleapis.com/v1beta";
const SEARCH_CONSOLE_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const WEBSITE_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];
const TOP_PAGE_LIMIT = 20;
const TOP_QUERY_LIMIT = 20;

type PeriodMode = "weekly" | "monthly";

type SyncRequest = {
  periodMode?: PeriodMode;
  startDate?: string;
  endDate?: string;
  maxPages?: number;
};

type WebsiteAccountConfig = {
  accountKey: "kr" | "en";
  displayName: string;
  propertyId: string;
  searchConsoleSite: string | null;
  baseUrl: string | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type Ga4Row = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> };
type Ga4Report = { rows?: Ga4Row[]; metricHeaders?: Array<{ name?: string }>; dimensionHeaders?: Array<{ name?: string }> };
type SearchRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };
type SearchResponse = { rows?: SearchRow[] };

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
    maxPages: Math.min(Math.max(Number(payload.maxPages ?? TOP_PAGE_LIMIT), 1), 100),
  };
}

function loadAccountConfigs(): WebsiteAccountConfig[] {
  const configs: WebsiteAccountConfig[] = [];
  const definitions: Array<{ key: "kr" | "en"; label: string }> = [
    { key: "kr", label: "홈페이지 국문" },
    { key: "en", label: "홈페이지 영문" },
  ];
  for (const { key, label } of definitions) {
    const suffix = key.toUpperCase();
    const propertyId = Deno.env.get(`GA4_PROPERTY_ID_${suffix}`)?.trim();
    if (!propertyId) continue;
    configs.push({
      accountKey: key,
      displayName: label,
      propertyId: propertyId.replace(/^properties\//, ""),
      searchConsoleSite: Deno.env.get(`SEARCH_CONSOLE_SITE_${suffix}`)?.trim() || null,
      baseUrl: Deno.env.get(`WEBSITE_BASE_URL_${suffix}`)?.trim()?.replace(/\/$/, "") || null,
    });
  }
  return configs;
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
    throw new Error("This account is not allowed to run website sync");
  }
}

async function refreshGoogleAccessToken() {
  const refreshToken = Deno.env.get("WEBSITE_GOOGLE_REFRESH_TOKEN") ?? requireEnv("GOOGLE_REFRESH_TOKEN");
  const body = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: refreshToken,
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

async function googlePost<T>(url: string, accessToken: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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

// GA4 runReport → array of {dimensions[], metrics{name:value}} objects.
async function runGa4Report(
  accessToken: string,
  propertyId: string,
  body: Record<string, unknown>,
): Promise<Array<{ dims: string[]; metrics: Record<string, number> }>> {
  const report = await googlePost<Ga4Report>(`${GA4_BASE}/properties/${propertyId}:runReport`, accessToken, body);
  const headers = report.metricHeaders?.map((header) => header.name ?? "") ?? [];
  return (report.rows ?? []).map((row) => ({
    dims: (row.dimensionValues ?? []).map((value) => value.value ?? ""),
    metrics: Object.fromEntries(headers.map((name, index) => [name, numeric(row.metricValues?.[index]?.value)])),
  }));
}

async function querySearchConsole(
  accessToken: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<SearchRow[]> {
  const url = `${SEARCH_CONSOLE_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const data = await googlePost<SearchResponse>(url, accessToken, body);
  return data.rows ?? [];
}

async function upsertWebsiteAccount(
  supabase: ReturnType<typeof createClient>,
  config: WebsiteAccountConfig,
  status: "complete" | "partial",
) {
  const { data, error } = await supabase
    .from("channel_accounts")
    .upsert(
      {
        org_id: ORG_ID,
        channel: "website",
        account_key: config.accountKey,
        display_name: config.displayName,
        status,
        auth_provider: "google",
        external_account_id: config.propertyId,
        scopes: WEBSITE_SCOPES,
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "org_id,channel,account_key" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data as { id: string };
}

type AccountResult = {
  accountKey: string;
  displayName: string;
  propertyId: string;
  hasSearchConsole: boolean;
  pagesSynced: number;
  dailyPoints: number;
  rowsWritten: number;
  status: "complete" | "partial";
  metrics: Record<string, number>;
};

async function syncAccount(
  supabase: ReturnType<typeof createClient>,
  accessToken: string,
  config: WebsiteAccountConfig,
  range: { periodMode: PeriodMode; startDate: string; endDate: string; maxPages: number },
): Promise<AccountResult> {
  const { periodMode, startDate, endDate, maxPages } = range;
  const dateRanges = [{ startDate, endDate }];
  const warnings: string[] = [];

  // Channel totals.
  let totals: Record<string, number> = {};
  try {
    const rows = await runGa4Report(accessToken, config.propertyId, {
      dateRanges,
      metrics: [
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "engagementRate" },
        { name: "averageSessionDuration" },
        { name: "keyEvents" },
      ],
    });
    totals = rows[0]?.metrics ?? {};
  } catch (error) {
    warnings.push(`GA4 totals: ${error instanceof Error ? error.message : "failed"}`);
  }

  // Daily users/sessions series.
  let dailyRows: Array<{ dims: string[]; metrics: Record<string, number> }> = [];
  try {
    dailyRows = await runGa4Report(accessToken, config.propertyId, {
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    });
  } catch (error) {
    warnings.push(`GA4 daily: ${error instanceof Error ? error.message : "failed"}`);
  }

  // Top landing pages.
  let pageRows: Array<{ dims: string[]; metrics: Record<string, number> }> = [];
  try {
    pageRows = await runGa4Report(accessToken, config.propertyId, {
      dateRanges,
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }, { name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: maxPages,
    });
  } catch (error) {
    warnings.push(`GA4 pages: ${error instanceof Error ? error.message : "failed"}`);
  }

  // GA4 can return the same pagePath under several pageTitles (query params,
  // renamed pages, ...). Collapse to one row per path — summing metrics — so the
  // published_posts / snapshot upserts (keyed by pagePath) have no duplicate
  // rows in a single batch (which Postgres rejects with "ON CONFLICT ... cannot
  // affect row a second time").
  const pageByPath = new Map<string, { dims: string[]; metrics: Record<string, number> }>();
  for (const row of pageRows) {
    const path = row.dims[0] ?? "/";
    const existing = pageByPath.get(path);
    if (existing) {
      existing.metrics.screenPageViews = numeric(existing.metrics.screenPageViews) + numeric(row.metrics.screenPageViews);
      existing.metrics.sessions = numeric(existing.metrics.sessions) + numeric(row.metrics.sessions);
      existing.metrics.activeUsers = numeric(existing.metrics.activeUsers) + numeric(row.metrics.activeUsers);
    } else {
      pageByPath.set(path, { dims: [path, row.dims[1] ?? path], metrics: { ...row.metrics } });
    }
  }
  pageRows = Array.from(pageByPath.values());

  // Search Console totals + daily + top queries (optional).
  let searchTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  let searchDaily: SearchRow[] = [];
  let topQueries: Array<{ query: string; clicks: number; impressions: number }> = [];
  const hasSearchConsole = Boolean(config.searchConsoleSite);
  if (config.searchConsoleSite) {
    try {
      const totalsRows = await querySearchConsole(accessToken, config.searchConsoleSite, { startDate, endDate });
      const first = totalsRows[0];
      if (first) {
        searchTotals = {
          clicks: numeric(first.clicks),
          impressions: numeric(first.impressions),
          ctr: numeric(first.ctr),
          position: numeric(first.position),
        };
      }
      searchDaily = await querySearchConsole(accessToken, config.searchConsoleSite, {
        startDate,
        endDate,
        dimensions: ["date"],
        rowLimit: 1000,
      });
      const queryRows = await querySearchConsole(accessToken, config.searchConsoleSite, {
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit: TOP_QUERY_LIMIT,
      });
      topQueries = queryRows.map((row) => ({
        query: row.keys?.[0] ?? "",
        clicks: numeric(row.clicks),
        impressions: numeric(row.impressions),
      }));
    } catch (error) {
      warnings.push(`Search Console: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  const status: "complete" | "partial" = warnings.length ? "partial" : "complete";
  const account = await upsertWebsiteAccount(supabase, config, status);
  const accountId = account.id;

  const { data: syncRun, error: syncInsertError } = await supabase
    .from("sync_runs")
    .insert({
      org_id: ORG_ID,
      channel_account_id: accountId,
      job_type: "website_analytics_sync",
      period_start: startDate,
      period_end: endDate,
      status: "partial",
    })
    .select("id")
    .single();
  if (syncInsertError) throw syncInsertError;
  const syncRunId = (syncRun as { id: string }).id;

  const channelMetrics = {
    users: numeric(totals.activeUsers),
    new_users: numeric(totals.newUsers),
    sessions: numeric(totals.sessions),
    page_views: numeric(totals.screenPageViews),
    engagement_rate: numeric(totals.engagementRate),
    avg_session_seconds: Math.round(numeric(totals.averageSessionDuration)),
    conversions: numeric(totals.keyEvents),
    search_clicks: searchTotals.clicks,
    search_impressions: searchTotals.impressions,
    search_ctr: searchTotals.ctr,
    search_position: searchTotals.position,
    pages_synced: pageRows.length,
    top_queries: topQueries,
  };

  const { error: snapshotError } = await supabase.from("metric_snapshots").upsert(
    {
      org_id: ORG_ID,
      owner_type: "channel",
      owner_id: accountId,
      channel: "website",
      account_key: config.accountKey,
      period_mode: periodMode,
      period_start: startDate,
      period_end: endDate,
      metrics: channelMetrics,
      status,
      source_ids: [syncRunId],
    },
    { onConflict: "org_id,owner_type,owner_id,period_mode,period_start,period_end" },
  );
  if (snapshotError) throw snapshotError;

  // Daily time-series: GA4 users/sessions/page_views + Search Console clicks/impressions.
  const seriesByDate = new Map<string, Record<string, number>>();
  const ensureDate = (date: string) => {
    if (!seriesByDate.has(date)) seriesByDate.set(date, {});
    return seriesByDate.get(date)!;
  };
  for (const row of dailyRows) {
    const raw = row.dims[0] ?? "";
    const date = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    if (!isDateKey(date)) continue;
    const bucket = ensureDate(date);
    bucket.users = numeric(row.metrics.activeUsers);
    bucket.sessions = numeric(row.metrics.sessions);
    bucket.page_views = numeric(row.metrics.screenPageViews);
  }
  for (const row of searchDaily) {
    const date = row.keys?.[0] ?? "";
    if (!isDateKey(date)) continue;
    const bucket = ensureDate(date);
    bucket.search_clicks = numeric(row.clicks);
    bucket.search_impressions = numeric(row.impressions);
  }
  const seriesRows = Array.from(seriesByDate.entries()).flatMap(([date, metrics]) =>
    Object.entries(metrics).map(([metricKey, value]) => ({
      org_id: ORG_ID,
      owner_type: "channel",
      owner_id: accountId,
      channel: "website",
      account_key: config.accountKey,
      metric_key: metricKey,
      granularity: "day",
      point_date: date,
      value,
      status: "complete",
      source_ids: [syncRunId],
    })),
  );
  if (seriesRows.length) {
    const { error: seriesError } = await supabase
      .from("metric_time_series")
      .upsert(seriesRows, { onConflict: "org_id,owner_type,owner_id,metric_key,granularity,point_date" });
    if (seriesError) throw seriesError;
  }

  // Top landing pages → published_posts + per-page snapshots.
  let pagesWritten = 0;
  if (pageRows.length) {
    const { data: pages, error: pagesError } = await supabase
      .from("published_posts")
      .upsert(
        pageRows.map((row) => {
          const pagePath = row.dims[0] ?? "/";
          const pageTitle = row.dims[1] || pagePath;
          const permalink = config.baseUrl && pagePath.startsWith("/") ? `${config.baseUrl}${pagePath}` : null;
          return {
            org_id: ORG_ID,
            channel_account_id: accountId,
            channel: "website",
            account_key: config.accountKey,
            format: "page",
            platform_post_id: `${config.accountKey}:${pagePath}`,
            title: pageTitle.slice(0, 200),
            permalink,
            published_at: `${endDate}T00:00:00Z`,
            raw_source: "api",
            raw_payload: {
              page_path: pagePath,
              metrics: {
                page_views: numeric(row.metrics.screenPageViews),
                sessions: numeric(row.metrics.sessions),
                users: numeric(row.metrics.activeUsers),
              },
            },
          };
        }),
        { onConflict: "org_id,channel,account_key,platform_post_id" },
      )
      .select("id,platform_post_id");
    if (pagesError) throw pagesError;
    pagesWritten = (pages ?? []).length;

    const pageIdByPid = new Map(((pages ?? []) as Array<{ id: string; platform_post_id: string }>).map((row) => [row.platform_post_id, row.id]));
    const pageSnapshotRows = pageRows.flatMap((row) => {
      const pagePath = row.dims[0] ?? "/";
      const pageId = pageIdByPid.get(`${config.accountKey}:${pagePath}`);
      if (!pageId) return [];
      return [
        {
          org_id: ORG_ID,
          owner_type: "post",
          owner_id: pageId,
          channel: "website",
          account_key: config.accountKey,
          period_mode: periodMode,
          period_start: startDate,
          period_end: endDate,
          metrics: {
            page_views: numeric(row.metrics.screenPageViews),
            sessions: numeric(row.metrics.sessions),
            users: numeric(row.metrics.activeUsers),
          },
          status: "complete",
          source_ids: [syncRunId],
        },
      ];
    });
    if (pageSnapshotRows.length) {
      const { error: pageSnapshotError } = await supabase
        .from("metric_snapshots")
        .upsert(pageSnapshotRows, { onConflict: "org_id,owner_type,owner_id,period_mode,period_start,period_end" });
      if (pageSnapshotError) throw pageSnapshotError;
    }
  }

  const rowsWritten = 1 + seriesRows.length + pagesWritten;
  await supabase
    .from("sync_runs")
    .update({
      status,
      rows_read: dailyRows.length + pageRows.length + searchDaily.length,
      rows_written: rowsWritten,
      error_message: warnings.length ? warnings.join(" | ") : null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", syncRunId);

  return {
    accountKey: config.accountKey,
    displayName: config.displayName,
    propertyId: config.propertyId,
    hasSearchConsole,
    pagesSynced: pagesWritten,
    dailyPoints: seriesByDate.size,
    rowsWritten,
    status,
    metrics: channelMetrics,
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

  const range = parseRequestRange(payload);
  const configs = loadAccountConfigs();
  if (!configs.length) {
    return jsonResponse(
      { status: "error", error: "GA4 속성 ID가 설정되지 않았습니다. GA4_PROPERTY_ID_KR / GA4_PROPERTY_ID_EN 시크릿을 설정하세요." },
      400,
    );
  }

  try {
    const accessToken = await refreshGoogleAccessToken();
    const accounts: AccountResult[] = [];
    for (const config of configs) {
      accounts.push(await syncAccount(supabase, accessToken, config, range));
    }

    const rowsWritten = accounts.reduce((total, account) => total + account.rowsWritten, 0);
    const overallStatus = accounts.every((account) => account.status === "complete") ? "complete" : "partial";
    return jsonResponse({
      status: "complete",
      overallStatus,
      message: `홈페이지 ${range.startDate}~${range.endDate} 동기화 완료 · 속성 ${accounts.length}개`,
      periodStart: range.startDate,
      periodEnd: range.endDate,
      rowsWritten,
      accounts,
    });
  } catch (error) {
    // Supabase/PostgREST errors are plain objects with a `message` field, not
    // Error instances — surface their message instead of a generic fallback.
    const message =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "Website sync failed";
    return jsonResponse({ status: "error", error: message }, 500);
  }
});

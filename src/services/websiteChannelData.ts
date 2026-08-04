import type { ChannelMetric, ChannelView, ContentItem, ContentLabSnapshot, DataStatus, PeriodMode, TrendPoint } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const WEBSITE_ACCOUNT_ORDER = ["kr", "en"];

type ChannelAccountRow = {
  id: string;
  account_key: string | null;
  display_name: string | null;
  status: DataStatus | null;
  last_sync_at: string | null;
};

type MetricSnapshotRow = {
  owner_id: string;
  period_mode: PeriodMode;
  period_start: string;
  period_end: string;
  metrics: Record<string, unknown> | null;
  status: DataStatus;
  collected_at: string;
};

type MetricSeriesRow = {
  owner_id: string;
  metric_key: string;
  point_date: string;
  value: number | null;
};

type PublishedPostRow = {
  id: string;
  account_key: string | null;
  format: string | null;
  platform_post_id: string;
  title: string;
  permalink: string | null;
  published_at: string;
  raw_payload: Record<string, unknown> | null;
};

export function canLoadWebsiteChannelData() {
  return hasSupabaseConfig();
}

function numberFrom(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function formatPercent(fraction: number) {
  if (!Number.isFinite(fraction) || fraction <= 0) return "N/A";
  return `${(fraction * 100).toFixed(1)}%`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "N/A";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}분 ${secs}초` : `${secs}초`;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "동기화 기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function metric(label: string, value: string, status: DataStatus = "complete", delta = "실데이터", secondary?: string): ChannelMetric {
  return { label, value, delta, status, ...(secondary ? { secondary } : {}) };
}

function accountLabel(accountKey?: string | null) {
  if (accountKey === "kr") return "국문";
  if (accountKey === "en") return "영문";
  return "홈페이지";
}

function buildKpis(metrics: Record<string, unknown> | null, status: DataStatus): ChannelMetric[] {
  const users = numberFrom(metrics?.users);
  const sessions = numberFrom(metrics?.sessions);
  const engagement = numberFrom(metrics?.engagement_rate);
  const searchClicks = numberFrom(metrics?.search_clicks);
  const conversions = numberFrom(metrics?.conversions);

  return [
    metric("사용자", users ? formatCount(users) : "N/A", status),
    metric("세션", sessions ? formatCount(sessions) : "N/A", status),
    metric("참여율", formatPercent(engagement), engagement ? status : "partial"),
    metric("검색 클릭", searchClicks ? formatCount(searchClicks) : "N/A", searchClicks ? status : "partial"),
    metric("전환(문의)", conversions ? formatCount(conversions) : "N/A", conversions ? status : "partial"),
  ];
}

function buildContentItem(post: PublishedPostRow, snapshot?: MetricSnapshotRow): ContentItem {
  const rawMetrics = (post.raw_payload?.metrics as Record<string, unknown> | undefined) ?? {};
  const snapshotMetrics = snapshot?.metrics ?? {};
  const pageViews = numberFrom(snapshotMetrics.page_views ?? rawMetrics.page_views);
  const sessions = numberFrom(snapshotMetrics.sessions ?? rawMetrics.sessions);
  const users = numberFrom(snapshotMetrics.users ?? rawMetrics.users);
  const account = accountLabel(post.account_key);

  return {
    id: post.id,
    title: post.title,
    channel: "website",
    accountKey: post.account_key ?? undefined,
    type: `${account} 페이지`,
    status: "GA4 성과 연결",
    campaign: "GA4 랜딩 페이지",
    publishDate: formatShortDate(post.published_at),
    metricLabel: "페이지뷰",
    metricValue: pageViews ? formatCount(pageViews) : "N/A",
    performanceSource: snapshot ? `${snapshot.period_start}~${snapshot.period_end}` : "GA4",
    externalUrl: post.permalink ?? undefined,
    linkedPostId: post.id,
    linkedPostTitle: post.title,
    performance: {
      views: pageViews,
      visits: sessions,
      visitors: users,
    },
  };
}

function sumMetric(snapshots: MetricSnapshotRow[], key: string) {
  return snapshots.reduce((total, row) => total + numberFrom(row.metrics?.[key]), 0);
}

function weightedRate(snapshots: MetricSnapshotRow[], rateKey: string, weightKey: string) {
  const totalWeight = sumMetric(snapshots, weightKey);
  if (!totalWeight) return 0;
  return snapshots.reduce((total, row) => total + numberFrom(row.metrics?.[rateKey]) * numberFrom(row.metrics?.[weightKey]), 0) / totalWeight;
}

function buildTrend(points: MetricSeriesRow[], accountIds: Set<string>, metricKey: string): TrendPoint[] {
  const byDate = new Map<string, number>();
  points
    .filter((point) => accountIds.has(point.owner_id) && point.metric_key === metricKey && point.value !== null)
    .forEach((point) => byDate.set(point.point_date, (byDate.get(point.point_date) ?? 0) + Number(point.value ?? 0)));

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ label: formatShortDate(date), value: Math.round(value) }));
}

export async function loadWebsiteChannelPatch(periodMode: PeriodMode): Promise<Partial<ChannelView> | null> {
  if (!hasSupabaseConfig()) return null;

  const supabase = getSupabaseClient();
  const { data: accounts, error: accountError } = await supabase
    .from("channel_accounts")
    .select("id, account_key, display_name, status, last_sync_at")
    .eq("org_id", ORG_ID)
    .eq("channel", "website")
    .order("account_key", { ascending: true });
  if (accountError) throw new Error(accountError.message);

  const accountRows = ((accounts ?? []) as ChannelAccountRow[]).sort(
    (a, b) => WEBSITE_ACCOUNT_ORDER.indexOf(a.account_key ?? "") - WEBSITE_ACCOUNT_ORDER.indexOf(b.account_key ?? ""),
  );
  if (!accountRows.length) return null;

  const accountIds = accountRows.map((account) => account.id);
  const { data: channelSnapshots, error: channelSnapshotError } = await supabase
    .from("metric_snapshots")
    .select("owner_id, period_mode, period_start, period_end, metrics, status, collected_at")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("channel", "website")
    .eq("period_mode", periodMode)
    .in("owner_id", accountIds)
    .order("collected_at", { ascending: false });
  if (channelSnapshotError) throw new Error(channelSnapshotError.message);

  const latestByAccount = new Map<string, MetricSnapshotRow>();
  for (const snapshot of (channelSnapshots ?? []) as MetricSnapshotRow[]) {
    if (!latestByAccount.has(snapshot.owner_id)) latestByAccount.set(snapshot.owner_id, snapshot);
  }
  const latestSnapshots = accountIds.flatMap((id) => {
    const snapshot = latestByAccount.get(id);
    return snapshot ? [snapshot] : [];
  });
  if (!latestSnapshots.length) return null;

  const { data: posts, error: postsError } = await supabase
    .from("published_posts")
    .select("id, account_key, format, platform_post_id, title, permalink, published_at, raw_payload")
    .eq("org_id", ORG_ID)
    .eq("channel", "website")
    .order("published_at", { ascending: false })
    .limit(200);
  if (postsError) throw new Error(postsError.message);

  const postRows = (posts ?? []) as PublishedPostRow[];
  const postIds = postRows.map((post) => post.id);
  const postSnapshotById = new Map<string, MetricSnapshotRow>();
  if (postIds.length) {
    const { data: postSnapshots, error: postSnapshotError } = await supabase
      .from("metric_snapshots")
      .select("owner_id, period_mode, period_start, period_end, metrics, status, collected_at")
      .eq("org_id", ORG_ID)
      .eq("owner_type", "post")
      .eq("channel", "website")
      .eq("period_mode", periodMode)
      .in("owner_id", postIds)
      .order("collected_at", { ascending: false });
    if (postSnapshotError) throw new Error(postSnapshotError.message);
    for (const snapshot of (postSnapshots ?? []) as MetricSnapshotRow[]) {
      if (!postSnapshotById.has(snapshot.owner_id)) postSnapshotById.set(snapshot.owner_id, snapshot);
    }
  }

  const { data: series, error: seriesError } = await supabase
    .from("metric_time_series")
    .select("owner_id, metric_key, point_date, value")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("channel", "website")
    .in("owner_id", accountIds)
    .in("metric_key", ["users", "sessions", "page_views", "search_clicks", "search_impressions"])
    .order("point_date", { ascending: true });
  if (seriesError) throw new Error(seriesError.message);

  const items = postRows
    .map((post) => buildContentItem(post, postSnapshotById.get(post.id)))
    .sort((a, b) => (b.performance?.views ?? 0) - (a.performance?.views ?? 0));
  const status: DataStatus = latestSnapshots.some((snapshot) => snapshot.status === "partial") ? "partial" : "complete";
  const latestSync = latestSnapshots[0]?.collected_at ?? accountRows.find((account) => account.last_sync_at)?.last_sync_at;

  const combinedKpis: ChannelMetric[] = [
    metric("사용자", formatCount(sumMetric(latestSnapshots, "users")), status),
    metric("세션", formatCount(sumMetric(latestSnapshots, "sessions")), status),
    metric("참여율", formatPercent(weightedRate(latestSnapshots, "engagement_rate", "sessions")), status),
    metric("검색 클릭", (() => {
      const clicks = sumMetric(latestSnapshots, "search_clicks");
      return clicks ? formatCount(clicks) : "N/A";
    })(), sumMetric(latestSnapshots, "search_clicks") ? status : "partial"),
    metric("전환(문의)", (() => {
      const conversions = sumMetric(latestSnapshots, "conversions");
      return conversions ? formatCount(conversions) : "N/A";
    })(), sumMetric(latestSnapshots, "conversions") ? status : "partial"),
  ];

  const accountKpis = Object.fromEntries(
    accountRows.map((account) => {
      const snapshot = latestByAccount.get(account.id);
      return [account.account_key ?? account.id, buildKpis(snapshot?.metrics ?? null, snapshot?.status ?? "partial")];
    }),
  ) as ChannelView["accountKpis"];

  const seriesRows = (series ?? []) as MetricSeriesRow[];
  const allAccountIds = new Set(accountIds);
  const userTrend = buildTrend(seriesRows, allAccountIds, "users");
  const trendSeries = Object.fromEntries(
    [
      ["사용자", userTrend],
      ["세션", buildTrend(seriesRows, allAccountIds, "sessions")],
      ["페이지뷰", buildTrend(seriesRows, allAccountIds, "page_views")],
      ["검색 클릭", buildTrend(seriesRows, allAccountIds, "search_clicks")],
    ].filter(([, points]) => (points as TrendPoint[]).length > 0),
  ) as ChannelView["trendSeries"];

  const avgSessionSeconds = weightedRate(latestSnapshots, "avg_session_seconds", "sessions");
  const patch: Partial<ChannelView> = {
    name: "홈페이지",
    updatedAt: formatTimestamp(latestSync),
    source: "Supabase · GA4 + Search Console",
    kpis: combinedKpis,
    accountKpis,
    topContent: items,
    dataNote: `GA4/Search Console 기준입니다. 국문/영문 속성을 분리해 사용자·세션·검색 성과를 보여줍니다. 평균 세션 ${formatDuration(avgSessionSeconds)}, 페이지 ${items.length}개.`,
  };
  if (userTrend.length) patch.trend = userTrend;
  if (trendSeries && Object.keys(trendSeries).length) patch.trendSeries = trendSeries;

  return patch;
}

export function applyWebsiteChannelPatch(channels: ChannelView[], patch: Partial<ChannelView> | null): ChannelView[] {
  if (!patch) return channels;
  return channels.map((channel) => (channel.id === "website" ? { ...channel, ...patch } : channel));
}

function buildWebsiteArchiveItem(item: ContentItem): ContentItem {
  const sourceId = item.linkedPostId ?? item.id;
  return {
    ...item,
    id: `source-website-${sourceId}`,
    status: "Published - GA4",
    campaign: item.campaign ?? "GA4 랜딩 페이지",
    linkedPostId: sourceId,
    linkedPostTitle: item.title,
    performanceSource: item.performanceSource ? `${item.performanceSource} · GA4` : "GA4",
    decisionLogs: [`${item.publishDate} · GA4 랜딩 페이지 연결`, ...(item.decisionLogs ?? [])],
  };
}

export function applyWebsiteContentToContentLab(
  data: ContentLabSnapshot,
  patch: Partial<ChannelView> | null,
): ContentLabSnapshot {
  const items = patch?.topContent ?? [];
  if (!items.length) return data;

  const archiveItems = items.map(buildWebsiteArchiveItem);
  const sourceIds = new Set(archiveItems.map((item) => item.linkedPostId ?? item.id));
  const existingArchive = data.archive.filter((item) => {
    if (item.id.startsWith("source-website-")) return false;
    if (item.channel !== "website") return true;
    return !sourceIds.has(item.linkedPostId ?? item.id);
  });

  return {
    ...data,
    archive: [...archiveItems, ...existingArchive],
  };
}

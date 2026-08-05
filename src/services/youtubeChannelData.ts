import type { ChannelMetric, ChannelView, ContentItem, ContentLabSnapshot, DataStatus, PeriodMode, TrendPoint } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

type ChannelAccountRow = {
  id: string;
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
  metric_key: string;
  point_date: string;
  value: number | null;
};

type PublishedPostRow = {
  id: string;
  format: string | null;
  platform_post_id: string;
  title: string;
  permalink: string | null;
  published_at: string;
  raw_payload: Record<string, unknown> | null;
};

type VideoPayload = {
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
};

export function canLoadYoutubeChannelData() {
  return hasSupabaseConfig();
}

function numberFrom(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "N/A";
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatHours(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "N/A";
  return `${Math.round(minutes / 60).toLocaleString("ko-KR")}h`;
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
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${date.getFullYear()}.${month}.${day} ${hour}:${minute}`;
}

function metric(label: string, value: string, delta = "실데이터", status: DataStatus = "complete", secondary?: string): ChannelMetric {
  return {
    label,
    value,
    delta,
    status,
    ...(secondary ? { secondary } : {}),
  };
}

function getVideoPayload(post: PublishedPostRow): VideoPayload {
  const video = post.raw_payload?.video;
  return video && typeof video === "object" ? (video as VideoPayload) : {};
}

function getPostMetrics(post: PublishedPostRow, snapshot?: MetricSnapshotRow) {
  const periodMetrics = snapshot?.metrics ?? {};
  const video = getVideoPayload(post);
  const stats = video.statistics ?? {};
  const periodViews = numberFrom(periodMetrics.views);
  const totalViews = numberFrom(periodMetrics.total_views) || numberFrom(stats.viewCount);
  const views = periodViews || totalViews;
  const watchTimeMinutes = numberFrom(periodMetrics.watch_time_minutes);
  const avgWatchSeconds = numberFrom(periodMetrics.average_view_seconds);

  return {
    views,
    watchTimeMinutes,
    avgWatchSeconds,
    likes: numberFrom(periodMetrics.likes) || numberFrom(stats.likeCount),
    comments: numberFrom(periodMetrics.comments) || numberFrom(stats.commentCount),
    shares: numberFrom(periodMetrics.shares),
  };
}

function buildContentItem(post: PublishedPostRow, snapshot?: MetricSnapshotRow): ContentItem {
  const performance = getPostMetrics(post, snapshot);
  const format = post.format === "longform" ? "Long-form" : "Shorts";
  const hasPeriodMetrics = Boolean(snapshot);

  return {
    id: post.id,
    title: post.title,
    channel: "youtube",
    accountKey: "main",
    type: format,
    status: hasPeriodMetrics ? "기간 성과 연결" : "영상 메타데이터 저장",
    campaign: hasPeriodMetrics ? "YouTube Analytics" : "YouTube Data API",
    publishDate: formatShortDate(post.published_at),
    publishedAt: post.published_at.slice(0, 10),
    metricLabel: hasPeriodMetrics ? "기간 조회" : "누적 조회",
    metricValue: formatCount(performance.views),
    performanceSource: snapshot ? `${snapshot.period_start}~${snapshot.period_end}` : "최근 업로드 백필",
    externalUrl: post.permalink ?? `https://www.youtube.com/watch?v=${post.platform_post_id}`,
    performance,
  };
}

function buildTrend(points: MetricSeriesRow[], metricKey: string): TrendPoint[] {
  return points
    .filter((point) => point.metric_key === metricKey && point.value !== null)
    .sort((a, b) => a.point_date.localeCompare(b.point_date))
    .map((point) => ({
      label: formatShortDate(point.point_date),
      value: Math.round(Number(point.value ?? 0)),
    }));
}

function weightedAverage(items: ContentItem[]) {
  const totalViews = items.reduce((total, item) => total + (item.performance?.views ?? 0), 0);
  if (!totalViews) return 0;
  const weighted = items.reduce(
    (total, item) => total + (item.performance?.avgWatchSeconds ?? 0) * (item.performance?.views ?? 0),
    0,
  );
  return weighted / totalViews;
}

export function buildYoutubeKpisFromContent(
  base: ChannelView,
  items: ContentItem[],
  status: DataStatus = "complete",
): ChannelMetric[] {
  const subscribers = base.kpis.find((item) => item.label === "구독자");
  const views = items.reduce((total, item) => total + (item.performance?.views ?? 0), 0);
  const watchTimeMinutes = items.reduce((total, item) => total + (item.performance?.watchTimeMinutes ?? 0), 0);
  const avgWatchSeconds = weightedAverage(items);

  return [
    subscribers ?? metric("구독자", "N/A", "동기화 필요", "partial"),
    metric("조회수", views ? formatCount(views) : "N/A", "실데이터", status),
    metric("시청시간", watchTimeMinutes ? formatHours(watchTimeMinutes) : "N/A", "실데이터", status),
    metric("평균 시청", avgWatchSeconds ? formatDuration(avgWatchSeconds) : "N/A", "실데이터", status),
  ];
}

export async function loadYoutubeChannelPatch(periodMode: PeriodMode): Promise<Partial<ChannelView> | null> {
  if (!hasSupabaseConfig()) return null;

  const supabase = getSupabaseClient();
  const { data: accounts, error: accountError } = await supabase
    .from("channel_accounts")
    .select("id, display_name, status, last_sync_at")
    .eq("org_id", ORG_ID)
    .eq("channel", "youtube")
    .eq("account_key", "main")
    .limit(1);
  if (accountError) throw accountError;

  const account = (accounts?.[0] ?? null) as ChannelAccountRow | null;
  if (!account) return null;

  const { data: channelSnapshots, error: channelSnapshotError } = await supabase
    .from("metric_snapshots")
    .select("owner_id, period_mode, period_start, period_end, metrics, status, collected_at")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("owner_id", account.id)
    .eq("period_mode", periodMode)
    .order("collected_at", { ascending: false })
    .limit(1);
  if (channelSnapshotError) throw channelSnapshotError;

  const channelSnapshot = (channelSnapshots?.[0] ?? null) as MetricSnapshotRow | null;
  const { data: posts, error: postsError } = await supabase
    .from("published_posts")
    .select("id, format, platform_post_id, title, permalink, published_at, raw_payload")
    .eq("org_id", ORG_ID)
    .eq("channel", "youtube")
    .eq("account_key", "main")
    .order("published_at", { ascending: false })
    .limit(500);
  if (postsError) throw postsError;

  const postRows = (posts ?? []) as PublishedPostRow[];
  const postIds = postRows.map((post) => post.id);
  const postSnapshotsById = new Map<string, MetricSnapshotRow>();

  if (postIds.length) {
    const { data: postSnapshots, error: postSnapshotError } = await supabase
      .from("metric_snapshots")
      .select("owner_id, period_mode, period_start, period_end, metrics, status, collected_at")
      .eq("org_id", ORG_ID)
      .eq("owner_type", "post")
      .eq("channel", "youtube")
      .eq("account_key", "main")
      .eq("period_mode", periodMode)
      .in("owner_id", postIds)
      .order("collected_at", { ascending: false });
    if (postSnapshotError) throw postSnapshotError;

    for (const snapshot of (postSnapshots ?? []) as MetricSnapshotRow[]) {
      if (!postSnapshotsById.has(snapshot.owner_id)) postSnapshotsById.set(snapshot.owner_id, snapshot);
    }
  }

  const { data: series, error: seriesError } = await supabase
    .from("metric_time_series")
    .select("metric_key, point_date, value")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("owner_id", account.id)
    .in("metric_key", ["views", "watch_time_minutes", "average_view_seconds"])
    .order("point_date", { ascending: true });
  if (seriesError) throw seriesError;

  const items = postRows.map((post) => buildContentItem(post, postSnapshotsById.get(post.id)));
  const metrics = channelSnapshot?.metrics ?? {};
  const status = channelSnapshot?.status ?? account.status ?? "partial";
  const subscribers = numberFrom(metrics.subscribers);
  const subscribersGained = numberFrom(metrics.subscribers_gained);
  const views = numberFrom(metrics.views);
  const watchTimeMinutes = numberFrom(metrics.watch_time_minutes);
  const avgWatchSeconds = numberFrom(metrics.average_view_seconds);
  const fallbackKpis = buildYoutubeKpisFromContent(
    {
      id: "youtube",
      name: "YouTube",
      role: "",
      objective: "",
      color: "#ef4444",
      updatedAt: "",
      source: "",
      tabs: [],
      kpis: [],
      trend: [],
      topContent: items,
      dataNote: "",
    },
    items,
    status,
  );

  const kpis = channelSnapshot
    ? [
        metric(
          "구독자",
          subscribers ? `${formatCount(subscribers)}명` : "N/A",
          "실데이터",
          status,
          subscribersGained ? `+${formatCount(subscribersGained)}명` : undefined,
        ),
        metric("조회수", views ? formatCount(views) : "N/A", "실데이터", status),
        metric("시청시간", watchTimeMinutes ? formatHours(watchTimeMinutes) : "N/A", "실데이터", status),
        metric("평균 시청", avgWatchSeconds ? formatDuration(avgWatchSeconds) : "N/A", "실데이터", status),
      ]
    : fallbackKpis;

  const seriesRows = (series ?? []) as MetricSeriesRow[];
  const viewTrend = buildTrend(seriesRows, "views");
  const trendSeries = Object.fromEntries(
    [
      ["조회수", viewTrend],
      ["시청시간", buildTrend(seriesRows, "watch_time_minutes")],
      ["평균 시청", buildTrend(seriesRows, "average_view_seconds")],
    ].filter(([, points]) => (points as TrendPoint[]).length > 0),
  ) as ChannelView["trendSeries"];

  const patch: Partial<ChannelView> = {
    name: account.display_name ?? "YouTube",
    updatedAt: formatTimestamp(channelSnapshot?.collected_at ?? account.last_sync_at),
    source: "Supabase · YouTube Data API + Analytics API",
    kpis,
    topContent: items,
    dataNote: channelSnapshot
      ? `Supabase에 저장된 YouTube 실데이터 기준입니다. 성과 기간은 ${channelSnapshot.period_start}~${channelSnapshot.period_end}이고, 콘텐츠 리스트는 저장된 업로드 영상 ${items.length}개를 보여줍니다.`
      : `Supabase에 저장된 YouTube 업로드 영상 ${items.length}개 기준입니다. 선택 기간 성과 스냅샷이 없으면 누적 조회와 메타데이터를 먼저 표시합니다.`,
  };
  if (viewTrend.length) patch.trend = viewTrend;
  if (trendSeries && Object.keys(trendSeries).length) patch.trendSeries = trendSeries;

  return patch;
}

export function applyYoutubeChannelPatch(channels: ChannelView[], patch: Partial<ChannelView> | null): ChannelView[] {
  if (!patch) return channels;
  return channels.map((channel) => (channel.id === "youtube" ? { ...channel, ...patch } : channel));
}

function buildYoutubeArchiveItem(item: ContentItem): ContentItem {
  const sourcePostId = item.linkedPostId ?? item.id;

  return {
    ...item,
    id: `source-youtube-${sourcePostId}`,
    status: "Published - API",
    campaign: item.campaign ?? "YouTube API",
    linkedPostId: sourcePostId,
    linkedPostTitle: item.title,
    performanceSource: item.performanceSource
      ? `${item.performanceSource} - YouTube API`
      : "YouTube Data API + Analytics API",
    decisionLogs: [
      `${item.publishDate} - YouTube source post linked`,
      ...(item.decisionLogs ?? []),
    ],
  };
}

export function applyYoutubeContentToContentLab(
  data: ContentLabSnapshot,
  patch: Partial<ChannelView> | null,
): ContentLabSnapshot {
  const items = patch?.topContent ?? [];
  if (!items.length) return data;

  const archiveItems = items.map(buildYoutubeArchiveItem);
  const sourceIds = new Set(archiveItems.map((item) => item.linkedPostId ?? item.id));
  const existingArchive = data.archive.filter((item) => {
    if (item.id.startsWith("source-youtube-")) return false;
    if (item.channel !== "youtube") return true;
    return !sourceIds.has(item.linkedPostId ?? item.id);
  });

  return {
    ...data,
    archive: [...archiveItems, ...existingArchive],
  };
}

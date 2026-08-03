import type { ChannelMetric, ChannelView, ContentItem, ContentLabSnapshot, DataStatus, PeriodMode, TrendPoint } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const INSTAGRAM_ACCOUNT_ORDER = ["company", "dummdumm-log"];

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

export function canLoadInstagramChannelData() {
  return hasSupabaseConfig();
}

function numberFrom(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
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

function accountLabel(accountKey?: string | null) {
  if (accountKey === "dummdumm-log") return "둠둠로그";
  if (accountKey === "company") return "본계";
  return "Instagram";
}

function formatLabel(format?: string | null) {
  if (format === "reels") return "Reels";
  if (format === "carousel") return "Carousel";
  if (format === "feed") return "Feed";
  return format ?? "Post";
}

function buildPostMetrics(snapshot?: MetricSnapshotRow) {
  const metrics = snapshot?.metrics ?? {};
  return {
    reach: numberFrom(metrics.reach),
    views: numberFrom(metrics.views),
    likes: numberFrom(metrics.likes),
    comments: numberFrom(metrics.comments),
    shares: numberFrom(metrics.shares),
    saves: numberFrom(metrics.saves ?? metrics.saved),
  };
}

function buildContentItem(post: PublishedPostRow, snapshot?: MetricSnapshotRow): ContentItem {
  const performance = buildPostMetrics(snapshot);
  const format = formatLabel(post.format);
  const account = accountLabel(post.account_key);
  const primaryMetric = performance.reach || performance.views || performance.likes;
  const primaryLabel = performance.reach ? "도달" : performance.views ? "조회" : "좋아요";

  return {
    id: post.id,
    title: post.title,
    channel: "instagram",
    accountKey: post.account_key ?? undefined,
    type: `${account} ${format}`,
    status: snapshot ? "기간 성과 연결" : "게시물 메타데이터 저장",
    campaign: snapshot ? "Instagram Graph API" : "Instagram Media API",
    publishDate: formatShortDate(post.published_at),
    metricLabel: snapshot ? primaryLabel : "누적 지표",
    metricValue: primaryMetric ? formatCount(primaryMetric) : "N/A",
    performanceSource: snapshot ? `${snapshot.period_start}~${snapshot.period_end}` : "최근 업로드 백필",
    externalUrl: post.permalink ?? `https://www.instagram.com/p/${post.platform_post_id}/`,
    linkedPostId: post.id,
    linkedPostTitle: post.title,
    performance,
  };
}

function sumMetrics(rows: MetricSnapshotRow[], key: string) {
  return rows.reduce((total, row) => total + numberFrom(row.metrics?.[key]), 0);
}

function buildKpisFromSnapshots(accounts: ChannelAccountRow[], snapshots: MetricSnapshotRow[], status: DataStatus): ChannelMetric[] {
  const followers = sumMetrics(snapshots, "followers");
  const followersGained = sumMetrics(snapshots, "followers_gained");
  const reach = sumMetrics(snapshots, "reach");
  const views = sumMetrics(snapshots, "views");
  const saves = sumMetrics(snapshots, "saves");
  const shares = sumMetrics(snapshots, "shares");
  const accountStatus = snapshots.length === accounts.length && accounts.length > 0 ? status : "partial";

  return [
    metric("팔로워", followers ? `${formatCount(followers)}명` : "N/A", "실데이터", accountStatus, followersGained ? `+${formatCount(followersGained)}명` : undefined),
    metric("도달", reach ? formatCount(reach) : "N/A", "실데이터", reach ? status : "partial"),
    metric("조회", views ? formatCount(views) : "N/A", "실데이터", views ? status : "partial"),
    metric("저장", saves ? formatCount(saves) : "N/A", "실데이터", saves ? status : "partial"),
    metric("공유", shares ? formatCount(shares) : "N/A", "실데이터", shares ? status : "partial"),
  ];
}

function buildTrend(points: MetricSeriesRow[], accountIds: Set<string>, metricKey: string): TrendPoint[] {
  const byDate = new Map<string, number>();
  points
    .filter((point) => accountIds.has(point.owner_id) && point.metric_key === metricKey && point.value !== null)
    .forEach((point) => byDate.set(point.point_date, (byDate.get(point.point_date) ?? 0) + Number(point.value ?? 0)));

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      label: formatShortDate(date),
      value: Math.round(value),
    }));
}

function buildInstagramArchiveItem(item: ContentItem): ContentItem {
  const sourcePostId = item.linkedPostId ?? item.id;

  return {
    ...item,
    id: `source-instagram-${sourcePostId}`,
    status: "Published - API",
    campaign: item.campaign ?? "Instagram Graph API",
    linkedPostId: sourcePostId,
    linkedPostTitle: item.title,
    performanceSource: item.performanceSource
      ? `${item.performanceSource} - Instagram Graph API`
      : "Instagram Graph API",
    decisionLogs: [`${item.publishDate} - Instagram source post linked`, ...(item.decisionLogs ?? [])],
  };
}

export function buildInstagramKpisFromContent(
  base: ChannelView,
  items: ContentItem[],
  accountKey?: string,
): ChannelMetric[] {
  const scopedBase = accountKey ? base.accountKpis?.[accountKey] : base.kpis;
  const follower = scopedBase?.find((item) => item.label === "팔로워") ?? base.kpis.find((item) => item.label === "팔로워");
  const reach = items.reduce((total, item) => total + (item.performance?.reach ?? 0), 0);
  const views = items.reduce((total, item) => total + (item.performance?.views ?? 0), 0);
  const saves = items.reduce((total, item) => total + (item.performance?.saves ?? 0), 0);
  const shares = items.reduce((total, item) => total + (item.performance?.shares ?? 0), 0);

  return [
    follower ?? metric("팔로워", "N/A", "동기화 필요", "partial"),
    metric("도달", reach ? formatCount(reach) : "N/A", "게시물 합산", reach ? "complete" : "partial"),
    metric("조회", views ? formatCount(views) : "N/A", "게시물 합산", views ? "complete" : "partial"),
    metric("저장", saves ? formatCount(saves) : "N/A", "게시물 합산", saves ? "complete" : "partial"),
    metric("공유", shares ? formatCount(shares) : "N/A", "게시물 합산", shares ? "complete" : "partial"),
  ];
}

export async function loadInstagramChannelPatch(periodMode: PeriodMode): Promise<Partial<ChannelView> | null> {
  if (!hasSupabaseConfig()) return null;

  const supabase = getSupabaseClient();
  const { data: accounts, error: accountError } = await supabase
    .from("channel_accounts")
    .select("id, account_key, display_name, status, last_sync_at")
    .eq("org_id", ORG_ID)
    .eq("channel", "instagram")
    .order("account_key", { ascending: true });
  if (accountError) throw accountError;

  const accountRows = ((accounts ?? []) as ChannelAccountRow[]).sort(
    (a, b) => INSTAGRAM_ACCOUNT_ORDER.indexOf(a.account_key ?? "") - INSTAGRAM_ACCOUNT_ORDER.indexOf(b.account_key ?? ""),
  );
  if (!accountRows.length) return null;

  const accountIds = accountRows.map((account) => account.id);
  const { data: channelSnapshots, error: channelSnapshotError } = await supabase
    .from("metric_snapshots")
    .select("owner_id, period_mode, period_start, period_end, metrics, status, collected_at")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("channel", "instagram")
    .eq("period_mode", periodMode)
    .in("owner_id", accountIds)
    .order("collected_at", { ascending: false });
  if (channelSnapshotError) throw channelSnapshotError;

  const latestSnapshotByAccount = new Map<string, MetricSnapshotRow>();
  for (const snapshot of (channelSnapshots ?? []) as MetricSnapshotRow[]) {
    if (!latestSnapshotByAccount.has(snapshot.owner_id)) latestSnapshotByAccount.set(snapshot.owner_id, snapshot);
  }
  const latestSnapshots = accountIds.flatMap((id) => {
    const snapshot = latestSnapshotByAccount.get(id);
    return snapshot ? [snapshot] : [];
  });

  const { data: posts, error: postsError } = await supabase
    .from("published_posts")
    .select("id, account_key, format, platform_post_id, title, permalink, published_at, raw_payload")
    .eq("org_id", ORG_ID)
    .eq("channel", "instagram")
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
      .eq("channel", "instagram")
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
    .select("owner_id, metric_key, point_date, value")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("channel", "instagram")
    .in("owner_id", accountIds)
    .in("metric_key", ["followers", "followers_gained", "reach", "views", "saves", "shares"])
    .order("point_date", { ascending: true });
  if (seriesError) throw seriesError;

  const items = postRows.map((post) => buildContentItem(post, postSnapshotsById.get(post.id)));
  const status = latestSnapshots.some((snapshot) => snapshot.status === "partial") ? "partial" : "complete";
  const latestSync = latestSnapshots[0]?.collected_at ?? accountRows.find((account) => account.last_sync_at)?.last_sync_at;
  const allAccountIds = new Set(accountIds);
  const seriesRows = (series ?? []) as MetricSeriesRow[];
  const accountKpis = Object.fromEntries(
    accountRows.map((account) => [
      account.account_key ?? account.id,
      buildKpisFromSnapshots(accountRows.filter((row) => row.id === account.id), latestSnapshotByAccount.get(account.id) ? [latestSnapshotByAccount.get(account.id)!] : [], account.status ?? "partial"),
    ]),
  );
  const reachTrend = buildTrend(seriesRows, allAccountIds, "reach");
  const trendSeries = Object.fromEntries(
    [
      ["팔로워", buildTrend(seriesRows, allAccountIds, "followers_gained")],
      ["도달", reachTrend],
      ["조회", buildTrend(seriesRows, allAccountIds, "views")],
      ["저장", buildTrend(seriesRows, allAccountIds, "saves")],
      ["공유", buildTrend(seriesRows, allAccountIds, "shares")],
    ].filter(([, points]) => (points as TrendPoint[]).length > 0),
  ) as ChannelView["trendSeries"];

  const patch: Partial<ChannelView> = {
    name: "Instagram",
    updatedAt: formatTimestamp(latestSync),
    source: "Supabase - Instagram Graph API",
    kpis: buildKpisFromSnapshots(accountRows, latestSnapshots, status),
    trendSeries,
    topContent: items,
    accountKpis,
    dataNote: `Supabase에 저장된 Instagram Graph API 데이터 기준입니다. 계정 ${accountRows.length}개, 게시물 ${items.length}개를 계정/포맷별로 분리해 보여줍니다.`,
  };
  if (reachTrend.length) patch.trend = reachTrend;
  if (!Object.keys(trendSeries ?? {}).length) delete patch.trendSeries;

  return patch;
}

export function applyInstagramChannelPatch(channels: ChannelView[], patch: Partial<ChannelView> | null): ChannelView[] {
  if (!patch) return channels;
  return channels.map((channel) => (channel.id === "instagram" ? { ...channel, ...patch } : channel));
}

export function applyInstagramContentToContentLab(
  data: ContentLabSnapshot,
  patch: Partial<ChannelView> | null,
): ContentLabSnapshot {
  const items = patch?.topContent ?? [];
  if (!items.length) return data;

  const archiveItems = items.map(buildInstagramArchiveItem);
  const sourceIds = new Set(archiveItems.map((item) => item.linkedPostId ?? item.id));
  const existingArchive = data.archive.filter((item) => {
    if (item.id.startsWith("source-instagram-")) return false;
    if (item.channel !== "instagram") return true;
    return !sourceIds.has(item.linkedPostId ?? item.id);
  });

  return {
    ...data,
    archive: [...archiveItems, ...existingArchive],
  };
}

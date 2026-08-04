import type { ChannelMetric, ChannelView, ContentItem, ContentLabSnapshot, DataStatus, PeriodMode, TrendPoint } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";
import type { LinkedinReport } from "./linkedinParser";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

export type LinkedinPersistResult = { status: "saved" | "skipped" | "error"; message: string };

export function canLoadLinkedinChannelData() {
  return hasSupabaseConfig();
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function formatPercent(fraction: number) {
  if (!Number.isFinite(fraction) || fraction <= 0) return "N/A";
  return `${(fraction * 100).toFixed(1)}%`;
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(5, 10);
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

async function resolveLinkedinAccountId(supabase: ReturnType<typeof getSupabaseClient>): Promise<string | null> {
  const { data, error } = await supabase
    .from("channel_accounts")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("channel", "linkedin")
    .eq("account_key", "main")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Normalize an uploaded LinkedIn report into the DB (posts + metrics + series).
// ---------------------------------------------------------------------------
export async function persistLinkedinReport(report: LinkedinReport): Promise<LinkedinPersistResult> {
  if (!hasSupabaseConfig()) return { status: "skipped", message: "Supabase 미설정으로 LinkedIn 데이터를 저장하지 못했습니다." };

  const supabase = getSupabaseClient();
  const accountId = await resolveLinkedinAccountId(supabase);
  if (!accountId) return { status: "error", message: "LinkedIn 채널 계정이 없습니다 (channel_accounts 시드 필요)." };

  const postDates = report.posts.map((post) => post.publishedAt).filter(Boolean).sort();
  const periodStart = report.periodStart || postDates[0] || new Date().toISOString().slice(0, 10);
  const periodEnd = report.periodEnd || postDates[postDates.length - 1] || periodStart;
  const status: DataStatus = report.warnings.length ? "partial" : "complete";
  const importId = crypto.randomUUID();
  const base = { org_id: ORG_ID, channel: "linkedin", account_key: "main" };

  try {
    // Channel-level snapshot (whole export range).
    const { error: snapshotError } = await supabase.from("metric_snapshots").upsert(
      {
        ...base,
        owner_type: "channel",
        owner_id: accountId,
        period_mode: "monthly",
        period_start: periodStart,
        period_end: periodEnd,
        metrics: {
          impressions: report.totals.impressions,
          clicks: report.totals.clicks,
          reactions: report.totals.reactions,
          comments: report.totals.comments,
          shares: report.totals.shares,
          engagement_rate: report.totals.engagementRate,
          new_followers: report.totals.newFollowers,
          page_views: report.totals.pageViews,
          unique_visitors: report.totals.uniqueVisitors,
          posts_synced: report.posts.length,
        },
        status,
        source_ids: [importId],
      },
      { onConflict: "org_id,owner_type,owner_id,period_mode,period_start,period_end" },
    );
    if (snapshotError) throw new Error(snapshotError.message);

    // Daily time-series.
    const seriesRows = Object.entries(report.series).flatMap(([metricKey, points]) =>
      (points ?? []).map((point) => ({
        ...base,
        owner_type: "channel",
        owner_id: accountId,
        metric_key: metricKey,
        granularity: "day",
        point_date: point.date,
        value: point.value,
        status: "complete",
        source_ids: [importId],
      })),
    );
    if (seriesRows.length) {
      const { error: seriesError } = await supabase
        .from("metric_time_series")
        .upsert(seriesRows, { onConflict: "org_id,owner_type,owner_id,metric_key,granularity,point_date" });
      if (seriesError) throw new Error(seriesError.message);
    }

    // Posts + per-post snapshots.
    if (report.posts.length) {
      const { data: posts, error: postsError } = await supabase
        .from("published_posts")
        .upsert(
          report.posts.map((post) => ({
            ...base,
            channel_account_id: accountId,
            format: post.format,
            platform_post_id: post.postId,
            title: post.title,
            permalink: post.permalink || null,
            published_at: `${post.publishedAt}T00:00:00Z`,
            raw_source: "file",
            raw_payload: {
              metrics: {
                impressions: post.impressions,
                views: post.views,
                clicks: post.clicks,
                ctr: post.ctr,
                reactions: post.reactions,
                comments: post.comments,
                shares: post.shares,
                engagement_rate: post.engagementRate,
              },
            },
          })),
          { onConflict: "org_id,channel,account_key,platform_post_id" },
        )
        .select("id,platform_post_id");
      if (postsError) throw new Error(postsError.message);

      const postIdByPid = new Map(((posts ?? []) as Array<{ id: string; platform_post_id: string }>).map((row) => [row.platform_post_id, row.id]));
      const postSnapshotRows = report.posts.flatMap((post) => {
        const postId = postIdByPid.get(post.postId);
        if (!postId) return [];
        return [
          {
            ...base,
            owner_type: "post",
            owner_id: postId,
            period_mode: "monthly",
            period_start: periodStart,
            period_end: periodEnd,
            metrics: {
              impressions: post.impressions,
              clicks: post.clicks,
              reactions: post.reactions,
              comments: post.comments,
              shares: post.shares,
              engagement_rate: post.engagementRate,
            },
            status: "complete",
            source_ids: [importId],
          },
        ];
      });
      if (postSnapshotRows.length) {
        const { error: postSnapshotError } = await supabase
          .from("metric_snapshots")
          .upsert(postSnapshotRows, { onConflict: "org_id,owner_type,owner_id,period_mode,period_start,period_end" });
        if (postSnapshotError) throw new Error(postSnapshotError.message);
      }
    }

    return {
      status: "saved",
      message: `LinkedIn ${periodStart}~${periodEnd} 저장 · 게시물 ${report.posts.length}개 · 일별 ${seriesRows.length}행`,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "LinkedIn 저장 실패" };
  }
}

// ---------------------------------------------------------------------------
// Read stored LinkedIn data into a channel-view patch.
// ---------------------------------------------------------------------------
type SnapshotRow = { metrics: Record<string, unknown> | null; status: DataStatus; collected_at: string; period_start: string; period_end: string };
type SeriesRow = { metric_key: string; point_date: string; value: number | null };
type PostRow = { id: string; platform_post_id: string; title: string; permalink: string | null; published_at: string; raw_payload: Record<string, unknown> | null };

function num(metrics: Record<string, unknown> | null, key: string): number {
  const value = Number(metrics?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function buildTrend(rows: SeriesRow[], metricKey: string): TrendPoint[] {
  return rows
    .filter((row) => row.metric_key === metricKey && row.value !== null)
    .sort((a, b) => a.point_date.localeCompare(b.point_date))
    .map((row) => ({ label: shortDate(row.point_date), value: Math.round(Number(row.value ?? 0)) }));
}

export async function loadLinkedinChannelPatch(_periodMode: PeriodMode): Promise<Partial<ChannelView> | null> {
  if (!hasSupabaseConfig()) return null;
  const supabase = getSupabaseClient();
  const accountId = await resolveLinkedinAccountId(supabase);
  if (!accountId) return null;

  const { data: snapshots, error: snapshotError } = await supabase
    .from("metric_snapshots")
    .select("metrics, status, collected_at, period_start, period_end")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("owner_id", accountId)
    .eq("period_mode", "monthly")
    .order("collected_at", { ascending: false })
    .limit(1);
  if (snapshotError) throw new Error(snapshotError.message);
  const snapshot = (snapshots?.[0] ?? null) as SnapshotRow | null;
  if (!snapshot) return null;

  const { data: posts, error: postsError } = await supabase
    .from("published_posts")
    .select("id, platform_post_id, title, permalink, published_at, raw_payload")
    .eq("org_id", ORG_ID)
    .eq("channel", "linkedin")
    .eq("account_key", "main")
    .order("published_at", { ascending: false })
    .limit(200);
  if (postsError) throw new Error(postsError.message);

  const { data: series, error: seriesError } = await supabase
    .from("metric_time_series")
    .select("metric_key, point_date, value")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("owner_id", accountId)
    .in("metric_key", ["impressions", "clicks", "new_followers", "page_views", "unique_visitors"])
    .order("point_date", { ascending: true });
  if (seriesError) throw new Error(seriesError.message);

  const metrics = snapshot.metrics ?? {};
  const status = snapshot.status ?? "partial";
  const kpis: ChannelMetric[] = [
    metric("노출", num(metrics, "impressions") ? formatCount(num(metrics, "impressions")) : "N/A", status),
    metric("클릭", num(metrics, "clicks") ? formatCount(num(metrics, "clicks")) : "N/A", status),
    metric("참여율", formatPercent(num(metrics, "engagement_rate")), status),
    metric("신규 팔로워", num(metrics, "new_followers") ? formatCount(num(metrics, "new_followers")) : "N/A", status),
    metric("방문자", num(metrics, "unique_visitors") ? formatCount(num(metrics, "unique_visitors")) : "N/A", status),
  ];

  const seriesRows = (series ?? []) as SeriesRow[];
  const impressionTrend = buildTrend(seriesRows, "impressions");
  const trendSeries = Object.fromEntries(
    [
      ["노출", impressionTrend],
      ["클릭", buildTrend(seriesRows, "clicks")],
      ["신규 팔로워", buildTrend(seriesRows, "new_followers")],
      ["방문자", buildTrend(seriesRows, "page_views")],
    ].filter(([, points]) => (points as TrendPoint[]).length > 0),
  ) as ChannelView["trendSeries"];

  const postRows = (posts ?? []) as PostRow[];
  const topContent: ContentItem[] = postRows
    .map((row) => {
      const postMetrics = (row.raw_payload?.metrics as Record<string, unknown> | undefined) ?? {};
      const impressions = num(postMetrics, "impressions");
      return {
        id: row.id,
        title: row.title,
        channel: "linkedin" as const,
        accountKey: "main",
        type: "Post",
        status: "파일 성과 연결",
        campaign: "LinkedIn 업로드",
        publishDate: shortDate(row.published_at),
        metricLabel: "노출",
        metricValue: formatCount(impressions),
        performanceSource: `${snapshot.period_start}~${snapshot.period_end}`,
        externalUrl: row.permalink ?? undefined,
        performance: {
          impressions,
          clicks: num(postMetrics, "clicks"),
          likes: num(postMetrics, "reactions"),
          comments: num(postMetrics, "comments"),
          shares: num(postMetrics, "shares"),
        },
      };
    })
    .sort((a, b) => (b.performance?.impressions ?? 0) - (a.performance?.impressions ?? 0));

  const patch: Partial<ChannelView> = {
    name: "LinkedIn",
    updatedAt: formatTimestamp(snapshot.collected_at),
    source: "Supabase · LinkedIn 파일 업로드",
    kpis,
    topContent,
    dataNote: `LinkedIn 업로드 파일 기준입니다. 성과 기간은 ${snapshot.period_start}~${snapshot.period_end}, 게시물 ${postRows.length}개를 표시합니다.`,
  };
  if (impressionTrend.length) patch.trend = impressionTrend;
  if (trendSeries && Object.keys(trendSeries).length) patch.trendSeries = trendSeries;

  return patch;
}

export function applyLinkedinChannelPatch(channels: ChannelView[], patch: Partial<ChannelView> | null): ChannelView[] {
  if (!patch) return channels;
  return channels.map((channel) => (channel.id === "linkedin" ? { ...channel, ...patch } : channel));
}

function buildLinkedinArchiveItem(item: ContentItem): ContentItem {
  const sourcePostId = item.linkedPostId ?? item.id;
  return {
    ...item,
    id: `source-linkedin-${sourcePostId}`,
    status: "Published - 파일",
    campaign: item.campaign ?? "LinkedIn 업로드",
    linkedPostId: sourcePostId,
    linkedPostTitle: item.title,
    performanceSource: item.performanceSource
      ? `${item.performanceSource} · LinkedIn 파일`
      : "LinkedIn 파일",
    decisionLogs: [`${item.publishDate} · LinkedIn 게시물 연결`, ...(item.decisionLogs ?? [])],
  };
}

export function applyLinkedinContentToContentLab(
  data: ContentLabSnapshot,
  patch: Partial<ChannelView> | null,
): ContentLabSnapshot {
  const items = patch?.topContent ?? [];
  if (!items.length) return data;

  const archiveItems = items.map(buildLinkedinArchiveItem);
  const sourceIds = new Set(archiveItems.map((item) => item.linkedPostId ?? item.id));
  const existingArchive = data.archive.filter((item) => {
    if (item.id.startsWith("source-linkedin-")) return false;
    if (item.channel !== "linkedin") return true;
    return !sourceIds.has(item.linkedPostId ?? item.id);
  });

  return {
    ...data,
    archive: [...archiveItems, ...existingArchive],
  };
}

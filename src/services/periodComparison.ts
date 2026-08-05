import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";
import { channelMeta } from "../data/mockData";
import type { ChannelId, ChannelMetric, DataStatus, PeriodComparison, PeriodComparisonRow, TrendPoint } from "./adapters/types";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

export type DateRange = { start: string; end: string };

export function canComparePeriods() {
  return hasSupabaseConfig();
}

type MetricMeta = { label: string; agg: "sum" | "avg"; format: "count" | "percent" | "duration" };

// Known metric keys (Naver today; extend as other channels are ingested).
const METRIC_META: Record<string, MetricMeta> = {
  views: { label: "조회수", agg: "sum", format: "count" },
  uniqueVisitors: { label: "순방문자수", agg: "sum", format: "count" },
  visits: { label: "방문 횟수", agg: "sum", format: "count" },
  trafficSearchShare: { label: "검색 유입 비중", agg: "avg", format: "percent" },
  revisitRate: { label: "재방문율", agg: "avg", format: "percent" },
  avgDurationSeconds: { label: "평균 사용 시간", agg: "avg", format: "duration" },
};

const METRIC_ORDER = Object.keys(METRIC_META);

function metaFor(key: string): MetricMeta {
  return METRIC_META[key] ?? { label: key, agg: "sum", format: "count" };
}

function inRange(date: string, range: DateRange) {
  return date >= range.start && date <= range.end;
}

function aggregate(values: number[], agg: MetricMeta["agg"]): number | null {
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return agg === "avg" ? sum / values.length : sum;
}

function formatValue(value: number | null, format: MetricMeta["format"]): string {
  if (value === null) return "데이터 없음";
  if (format === "duration") {
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  if (format === "percent") return `${Math.round(value)}%`;
  return Math.round(value).toLocaleString("ko-KR");
}

function growthOf(previous: number | null, current: number | null): string {
  if (previous === null || current === null || previous === 0) return "N/A";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${Math.round(pct)}%`;
}

function statusOf(previous: number | null, current: number | null): DataStatus {
  if (previous === null && current === null) return "not_uploaded";
  if (previous === null || current === null) return "partial";
  return "complete";
}

type SeriesRow = { owner_id: string; channel: string; metric_key: string; point_date: string; value: number | null };

export async function computePeriodComparison(
  scope: ChannelId,
  current: DateRange,
  previous: DateRange,
): Promise<PeriodComparison> {
  const supabase = getSupabaseClient();

  let accountsQuery = supabase
    .from("channel_accounts")
    .select("id, channel")
    .eq("org_id", ORG_ID);
  if (scope !== "all") accountsQuery = accountsQuery.eq("channel", scope);

  const { data: accounts, error: accountsError } = await accountsQuery;
  if (accountsError) throw accountsError;

  const baseline = `${previous.start} ~ ${previous.end}`;
  const currentLabel = `${current.start} ~ ${current.end}`;
  const empty = (dataNote: string): PeriodComparison => ({
    scope,
    detail: currentLabel,
    baseline,
    currentLabel,
    summary: `선택한 기간에 대한 실데이터가 아직 없습니다.`,
    rows: [],
    dataNote,
  });

  const accountIds = (accounts ?? []).map((account: { id: string }) => account.id);
  if (!accountIds.length) {
    return empty("해당 범위의 채널 계정이 없습니다. (channel_accounts 시드 필요)");
  }

  const lo = [previous.start, current.start].sort()[0];
  const hi = [previous.end, current.end].sort().reverse()[0];

  const { data: series, error: seriesError } = await supabase
    .from("metric_time_series")
    .select("owner_id, channel, metric_key, point_date, value")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .in("owner_id", accountIds)
    .gte("point_date", lo)
    .lte("point_date", hi);
  if (seriesError) throw seriesError;

  const rows_data = (series ?? []) as SeriesRow[];

  const summaryBase = `선택 기간(${currentLabel}) vs 과거(${baseline}) · 실데이터(metric_time_series) 기준`;
  const dataNote = "값이 '데이터 없음'인 항목은 아직 해당 기간에 수집된 실데이터가 없습니다. 채널이 연결/업로드되면 자동으로 채워집니다.";

  if (scope === "all") {
    // One row per channel using its primary metric (prefers 조회수/views).
    const channels = [...new Set((accounts ?? []).map((a: { channel: string }) => a.channel))];
    const rows: PeriodComparisonRow[] = channels
      .map((channel) => {
        const channelRows = rows_data.filter((row) => row.channel === channel);
        const metricKey = pickPrimaryMetric(channelRows);
        if (!metricKey) {
          return {
            metric: channelLabel(channel),
            previous: "데이터 없음",
            current: "데이터 없음",
            growth: "N/A",
            status: "not_uploaded" as DataStatus,
          };
        }
        const meta = metaFor(metricKey);
        const prev = aggregate(valuesIn(channelRows, metricKey, previous), meta.agg);
        const cur = aggregate(valuesIn(channelRows, metricKey, current), meta.agg);
        return {
          metric: `${channelLabel(channel)} · ${meta.label}`,
          previous: formatValue(prev, meta.format),
          current: formatValue(cur, meta.format),
          growth: growthOf(prev, cur),
          status: statusOf(prev, cur),
        };
      });
    return { scope, detail: currentLabel, baseline, currentLabel, summary: summaryBase, rows, dataNote };
  }

  // Single channel: one row per metric_key.
  const metricKeys = [...new Set(rows_data.map((row) => row.metric_key))].sort(
    (a, b) => (METRIC_ORDER.indexOf(a) + 1 || 99) - (METRIC_ORDER.indexOf(b) + 1 || 99),
  );

  if (!metricKeys.length) {
    return empty(dataNote);
  }

  const rows: PeriodComparisonRow[] = metricKeys.map((metricKey) => {
    const meta = metaFor(metricKey);
    const prev = aggregate(valuesIn(rows_data, metricKey, previous), meta.agg);
    const cur = aggregate(valuesIn(rows_data, metricKey, current), meta.agg);
    return {
      metric: meta.label,
      previous: formatValue(prev, meta.format),
      current: formatValue(cur, meta.format),
      growth: growthOf(prev, cur),
      status: statusOf(prev, cur),
    };
  });

  return { scope, detail: currentLabel, baseline, currentLabel, summary: summaryBase, rows, dataNote };
}

function valuesIn(rows: SeriesRow[], metricKey: string, range: DateRange): number[] {
  return rows
    .filter((row) => row.metric_key === metricKey && row.value !== null && inRange(row.point_date, range))
    .map((row) => row.value as number);
}

function pickPrimaryMetric(rows: SeriesRow[]): string | null {
  if (!rows.length) return null;
  if (rows.some((row) => row.metric_key === "views")) return "views";
  // Otherwise the metric with the most data points.
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.metric_key, (counts.get(row.metric_key) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function channelLabel(channel: string): string {
  return channelMeta[channel as Exclude<ChannelId, "all">]?.label ?? channel;
}

// ---------------------------------------------------------------------------
// Channel-scoped period view: current-range KPIs (with % change vs the past
// range) + a current-range trend, all from metric_time_series. Powers the
// inline "과거 vs 현재" period picker in the channel view.
// ---------------------------------------------------------------------------
type ChannelMetricConfig = { key: string; label: string; agg: "sum" | "avg"; format: "count" | "percent" | "duration"; primary?: boolean };

const CHANNEL_METRICS: Record<string, ChannelMetricConfig[]> = {
  youtube: [
    { key: "views", label: "조회수", agg: "sum", format: "count", primary: true },
    { key: "watch_time_minutes", label: "시청시간(분)", agg: "sum", format: "count" },
    { key: "average_view_seconds", label: "평균 시청(초)", agg: "avg", format: "count" },
    { key: "subscribers_gained", label: "신규 구독", agg: "sum", format: "count" },
  ],
  instagram: [
    { key: "reach", label: "도달", agg: "sum", format: "count", primary: true },
    { key: "views", label: "조회", agg: "sum", format: "count" },
    { key: "saves", label: "저장", agg: "sum", format: "count" },
    { key: "shares", label: "공유", agg: "sum", format: "count" },
    { key: "followers_gained", label: "신규 팔로워", agg: "sum", format: "count" },
  ],
  linkedin: [
    { key: "impressions", label: "노출", agg: "sum", format: "count", primary: true },
    { key: "clicks", label: "클릭", agg: "sum", format: "count" },
    { key: "new_followers", label: "신규 팔로워", agg: "sum", format: "count" },
    { key: "page_views", label: "페이지뷰", agg: "sum", format: "count" },
  ],
  website: [
    { key: "users", label: "사용자", agg: "sum", format: "count", primary: true },
    { key: "sessions", label: "세션", agg: "sum", format: "count" },
    { key: "page_views", label: "페이지뷰", agg: "sum", format: "count" },
    { key: "search_clicks", label: "검색 클릭", agg: "sum", format: "count" },
  ],
  naver: [
    { key: "views", label: "조회수", agg: "sum", format: "count", primary: true },
    { key: "uniqueVisitors", label: "순방문자수", agg: "sum", format: "count" },
    { key: "visits", label: "방문 횟수", agg: "sum", format: "count" },
    { key: "revisitRate", label: "재방문율", agg: "avg", format: "percent" },
    { key: "avgDurationSeconds", label: "평균 사용 시간", agg: "avg", format: "duration" },
  ],
};

export type ChannelPeriodView = {
  kpis: ChannelMetric[];
  trend: TrendPoint[];
  currentLabel: string;
  baseline: string;
  dataNote: string;
  hasData: boolean;
};

function shortLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date.slice(5);
  return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`;
}

// Daily points → chart-friendly series. Long ranges (>31 days) aggregate to
// monthly buckets so the sparkline stays readable.
function windowTrendPoints(dailyPoints: Array<[string, number]>): TrendPoint[] {
  if (dailyPoints.length <= 31) {
    return dailyPoints.map(([date, value]) => ({ label: shortLabel(date), value: Math.round(value) }));
  }
  const byMonth = new Map<string, number>();
  for (const [date, value] of dailyPoints) {
    const key = date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + value);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, value]) => ({ label: `${Number(ym.slice(5, 7))}월`, value: Math.round(value) }));
}

export async function computeChannelPeriodView(
  channelId: Exclude<ChannelId, "all">,
  current: DateRange,
  previous: DateRange,
  accountKey?: string | null,
): Promise<ChannelPeriodView> {
  const supabase = getSupabaseClient();
  const configs = CHANNEL_METRICS[channelId] ?? [];
  const currentLabel = `${current.start} ~ ${current.end}`;
  const baseline = `${previous.start} ~ ${previous.end}`;
  const dataNote = `선택 기간(${currentLabel}) 실데이터 기준입니다. 증감(%)은 과거(${baseline}) 대비입니다.`;
  const emptyKpis: ChannelMetric[] = configs.map((config) => ({
    label: config.label,
    value: "데이터 없음",
    delta: "N/A",
    status: "not_uploaded",
  }));

  let accountsQuery = supabase
    .from("channel_accounts")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("channel", channelId);
  if (accountKey) accountsQuery = accountsQuery.eq("account_key", accountKey);
  const { data: accounts, error: accountsError } = await accountsQuery;
  if (accountsError) throw new Error(accountsError.message);
  const accountIds = (accounts ?? []).map((account: { id: string }) => account.id);

  if (!accountIds.length || !configs.length) {
    return { kpis: emptyKpis, trend: [], currentLabel, baseline, dataNote, hasData: false };
  }

  const lo = [previous.start, current.start].sort()[0];
  const hi = [previous.end, current.end].sort().reverse()[0];
  const { data: series, error: seriesError } = await supabase
    .from("metric_time_series")
    .select("owner_id, channel, metric_key, point_date, value")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("channel", channelId)
    .in("owner_id", accountIds)
    .gte("point_date", lo)
    .lte("point_date", hi);
  if (seriesError) throw new Error(seriesError.message);
  const rows = (series ?? []) as SeriesRow[];

  const kpis: ChannelMetric[] = configs.map((config) => {
    const cur = aggregate(valuesIn(rows, config.key, current), config.agg);
    const prev = aggregate(valuesIn(rows, config.key, previous), config.agg);
    return {
      label: config.label,
      value: formatValue(cur, config.format),
      delta: growthOf(prev, cur),
      status: statusOf(prev, cur),
    };
  });

  // Current-range trend for the primary metric (summed across the channel's accounts).
  const primary = configs.find((config) => config.primary) ?? configs[0];
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (row.metric_key !== primary.key || row.value === null || !inRange(row.point_date, current)) continue;
    byDate.set(row.point_date, (byDate.get(row.point_date) ?? 0) + Number(row.value));
  }
  const dailyPoints = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  const trend = windowTrendPoints(dailyPoints);

  const hasData = kpis.some((kpi) => kpi.value !== "데이터 없음");
  return { kpis, trend, currentLabel, baseline, dataNote, hasData };
}

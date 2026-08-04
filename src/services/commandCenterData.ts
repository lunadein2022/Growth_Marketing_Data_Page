import type { CommandCenterSnapshot, DataStatus, KpiCard, PeriodMode, TrendPoint } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";
import { channelMeta } from "../data/mockData";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

type AccountRow = {
  id: string;
  channel: string;
  account_key: string;
  display_name: string | null;
  status: DataStatus | null;
};

type SnapshotRow = {
  owner_id: string;
  channel: string;
  metrics: Record<string, unknown> | null;
  status: DataStatus;
  collected_at: string;
};

type SeriesRow = {
  owner_id: string;
  metric_key: string;
  point_date: string;
  value: number | null;
};

// Surgical patch: only the KPIs we can compute from real data are replaced (by
// label); the rest (검색 가시성, 발행 건강도) stay from the mock base until their
// sources are connected.
export type CommandCenterPatch = {
  kpiUpdates: Record<string, Pick<KpiCard, "value" | "delta" | "tone" | "status" | "source">>;
  channelHighlights?: CommandCenterSnapshot["channelHighlights"];
  trends?: TrendPoint[];
};

export function canLoadCommandCenterData() {
  return hasSupabaseConfig();
}

function num(metrics: Record<string, unknown> | null, key: string): number {
  const value = Number(metrics?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function shortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(5, 10);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function growthOf(points: TrendPoint[]): { delta: string; tone: KpiCard["tone"] } {
  if (points.length < 2) return { delta: "실데이터", tone: "neutral" };
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (!first) return { delta: "실데이터", tone: "neutral" };
  const pct = Math.round(((last - first) / first) * 100);
  return { delta: `${pct >= 0 ? "+" : ""}${pct}%`, tone: pct > 0 ? "up" : pct < 0 ? "down" : "neutral" };
}

export async function loadCommandCenterPatch(periodMode: PeriodMode): Promise<CommandCenterPatch | null> {
  if (!hasSupabaseConfig()) return null;
  const supabase = getSupabaseClient();

  const { data: accountsData, error: accountsError } = await supabase
    .from("channel_accounts")
    .select("id, channel, account_key, display_name, status")
    .eq("org_id", ORG_ID);
  if (accountsError) throw accountsError;
  const accounts = (accountsData ?? []) as AccountRow[];
  if (!accounts.length) return null;
  const accountIds = accounts.map((account) => account.id);

  const { data: snapshotData, error: snapshotError } = await supabase
    .from("metric_snapshots")
    .select("owner_id, channel, metrics, status, collected_at")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("period_mode", periodMode)
    .in("owner_id", accountIds)
    .order("collected_at", { ascending: false });
  if (snapshotError) throw snapshotError;

  // Keep the newest snapshot per account only.
  const latest = new Map<string, SnapshotRow>();
  for (const snapshot of (snapshotData ?? []) as SnapshotRow[]) {
    if (!latest.has(snapshot.owner_id)) latest.set(snapshot.owner_id, snapshot);
  }
  const snapshots = [...latest.values()];
  if (!snapshots.length) return null;

  const perChannel = new Map<string, { views: number; reach: number; status: DataStatus }>();
  let totalViews = 0;
  let totalReach = 0;
  let channelsWithViews = 0;

  for (const snapshot of snapshots) {
    const views = num(snapshot.metrics, "views");
    const reach = num(snapshot.metrics, "reach");
    totalViews += views;
    totalReach += reach;
    if (views > 0) channelsWithViews += 1;

    const current = perChannel.get(snapshot.channel) ?? { views: 0, reach: 0, status: snapshot.status };
    current.views += views;
    current.reach += reach;
    if (snapshot.status === "partial" || snapshot.status === "error") current.status = "partial";
    perChannel.set(snapshot.channel, current);
  }

  // Aggregate the views time-series across every channel account.
  const { data: seriesData, error: seriesError } = await supabase
    .from("metric_time_series")
    .select("owner_id, metric_key, point_date, value")
    .eq("org_id", ORG_ID)
    .eq("owner_type", "channel")
    .eq("metric_key", "views")
    .in("owner_id", accountIds)
    .order("point_date", { ascending: true });
  if (seriesError) throw seriesError;

  const byDate = new Map<string, number>();
  for (const point of (seriesData ?? []) as SeriesRow[]) {
    if (point.value === null) continue;
    byDate.set(point.point_date, (byDate.get(point.point_date) ?? 0) + Number(point.value));
  }
  const trends: TrendPoint[] = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ label: shortDate(date), value: Math.round(value) }));

  const viewsGrowth = growthOf(trends);
  const consumptionStatus: DataStatus = channelsWithViews >= snapshots.length ? "complete" : "partial";

  const kpiUpdates: CommandCenterPatch["kpiUpdates"] = {
    "콘텐츠 소비": {
      value: totalViews ? formatCount(totalViews) : "N/A",
      delta: viewsGrowth.delta,
      tone: viewsGrowth.tone,
      status: totalViews ? consumptionStatus : "not_uploaded",
      source: "채널 조회수 합계 · Supabase 실데이터",
    },
    "브랜드 노출": {
      value: totalReach ? formatCount(totalReach) : "N/A",
      delta: "실데이터",
      tone: "neutral",
      status: totalReach ? "partial" : "not_uploaded",
      source: "Instagram 도달 등 · Supabase 실데이터",
    },
  };

  const channelHighlights = [...perChannel.entries()].map(([channel, aggregate]) => {
    const label = channelMeta[channel as keyof typeof channelMeta]?.label ?? channel;
    const parts: string[] = [];
    if (aggregate.views) parts.push(`조회 ${formatCount(aggregate.views)}`);
    if (aggregate.reach) parts.push(`도달 ${formatCount(aggregate.reach)}`);
    return {
      channel: label,
      summary: parts.length ? parts.join(" · ") : "실데이터 집계",
      delta: "실데이터",
      status: aggregate.status,
    };
  });

  return {
    kpiUpdates,
    channelHighlights: channelHighlights.length ? channelHighlights : undefined,
    trends: trends.length ? trends : undefined,
  };
}

export function applyCommandCenterPatch(
  snapshot: CommandCenterSnapshot,
  patch: CommandCenterPatch | null,
): CommandCenterSnapshot {
  if (!patch) return snapshot;
  return {
    ...snapshot,
    kpis: snapshot.kpis.map((kpi) => {
      const update = patch.kpiUpdates[kpi.label];
      return update ? { ...kpi, ...update } : kpi;
    }),
    channelHighlights: patch.channelHighlights?.length ? patch.channelHighlights : snapshot.channelHighlights,
    trends: patch.trends?.length ? patch.trends : snapshot.trends,
  };
}

import type { DataCenterSnapshot, DataSourceState, DataStatus } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

type YoutubeAccountRow = {
  id: string;
  display_name: string | null;
  status: DataStatus | null;
  last_sync_at: string | null;
};

type YoutubeSyncRunRow = {
  status: DataStatus;
  period_start: string | null;
  period_end: string | null;
  rows_read: number | null;
  rows_written: number | null;
  error_message: string | null;
  finished_at: string | null;
  started_at: string | null;
};

type DataCenterSyncPatch = {
  youtube?: Partial<DataSourceState>;
  issues: DataCenterSnapshot["issues"];
};

export function canLoadDataCenterSyncStatus() {
  return hasSupabaseConfig();
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "동기화 기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}

function formatRange(start: string | null, end: string | null) {
  if (!start || !end) return "기간 미기록";
  return `${start}~${end}`;
}

function compactNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ko-KR");
}

export async function loadDataCenterSyncStatus(): Promise<DataCenterSyncPatch | null> {
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

  const account = (accounts?.[0] ?? null) as YoutubeAccountRow | null;
  if (!account) return null;

  const { data: syncRuns, error: syncError } = await supabase
    .from("sync_runs")
    .select("status, period_start, period_end, rows_read, rows_written, error_message, finished_at, started_at")
    .eq("org_id", ORG_ID)
    .eq("channel_account_id", account.id)
    .eq("job_type", "youtube_analytics_sync")
    .order("started_at", { ascending: false })
    .limit(1);
  if (syncError) throw syncError;

  const latestSync = (syncRuns?.[0] ?? null) as YoutubeSyncRunRow | null;
  const { count: postCount, error: postCountError } = await supabase
    .from("published_posts")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ORG_ID)
    .eq("channel", "youtube")
    .eq("account_key", "main");
  if (postCountError) throw postCountError;

  const status = latestSync?.status ?? account.status ?? "partial";
  const lastSync = formatTimestamp(latestSync?.finished_at ?? account.last_sync_at ?? latestSync?.started_at);
  const detail = latestSync
    ? `Supabase 저장 ${formatRange(latestSync.period_start, latestSync.period_end)} · 총 영상 ${compactNumber(postCount)}개 · 처리 ${compactNumber(
        latestSync.rows_written,
      )}행`
    : `${account.display_name ?? "YouTube"} API 연결됨 · 저장 영상 ${compactNumber(postCount)}개`;

  return {
    youtube: {
      status,
      lastSync,
      detail,
    },
    issues:
      latestSync?.status === "error"
        ? [
            {
              severity: "error",
              title: "YouTube 동기화 실패",
              detail: latestSync.error_message ?? "최근 YouTube 동기화가 실패했습니다. Supabase Function 로그를 확인하세요.",
            },
          ]
        : [],
  };
}

export function applyDataCenterSyncStatus(
  data: DataCenterSnapshot,
  patch: DataCenterSyncPatch | null,
): DataCenterSnapshot {
  if (!patch) return data;

  return {
    ...data,
    sources: data.sources.map((source) => (source.id === "google-youtube" ? { ...source, ...patch.youtube } : source)),
    issues: [...patch.issues, ...data.issues],
  };
}

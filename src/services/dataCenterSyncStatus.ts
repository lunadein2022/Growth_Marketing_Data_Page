import type { DataCenterSnapshot, DataSourceState, DataStatus } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

type ChannelAccountRow = {
  id: string;
  account_key?: string | null;
  display_name: string | null;
  status: DataStatus | null;
  last_sync_at: string | null;
};

type SyncRunRow = {
  channel_account_id?: string | null;
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
  instagram?: Partial<DataSourceState>;
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
  const issues: DataCenterSnapshot["issues"] = [];
  let youtube: Partial<DataSourceState> | undefined;

  const { data: accounts, error: accountError } = await supabase
    .from("channel_accounts")
    .select("id, display_name, status, last_sync_at")
    .eq("org_id", ORG_ID)
    .eq("channel", "youtube")
    .eq("account_key", "main")
    .limit(1);
  if (accountError) throw accountError;

  const account = (accounts?.[0] ?? null) as ChannelAccountRow | null;

  if (account) {
    const { data: syncRuns, error: syncError } = await supabase
      .from("sync_runs")
      .select("status, period_start, period_end, rows_read, rows_written, error_message, finished_at, started_at")
      .eq("org_id", ORG_ID)
      .eq("channel_account_id", account.id)
      .eq("job_type", "youtube_analytics_sync")
      .order("started_at", { ascending: false })
      .limit(1);
    if (syncError) throw syncError;

    const latestSync = (syncRuns?.[0] ?? null) as SyncRunRow | null;
    const { count: postCount, error: postCountError } = await supabase
      .from("published_posts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ORG_ID)
      .eq("channel", "youtube")
      .eq("account_key", "main");
    if (postCountError) throw postCountError;

    youtube = {
      status: latestSync?.status ?? account.status ?? "partial",
      lastSync: formatTimestamp(latestSync?.finished_at ?? account.last_sync_at ?? latestSync?.started_at),
      detail: latestSync
        ? `Supabase 저장 ${formatRange(latestSync.period_start, latestSync.period_end)} · 총 영상 ${compactNumber(
            postCount,
          )}개 · 처리 ${compactNumber(latestSync.rows_written)}행`
        : `${account.display_name ?? "YouTube"} API 연결됨 · 저장 영상 ${compactNumber(postCount)}개`,
    };

    if (latestSync?.status === "error") {
      issues.push({
        severity: "error",
        title: "YouTube 동기화 실패",
        detail: latestSync.error_message ?? "최근 YouTube 동기화가 실패했습니다. Supabase Function 로그를 확인하세요.",
      });
    }
  }

  const { data: instagramAccounts, error: instagramAccountError } = await supabase
    .from("channel_accounts")
    .select("id, account_key, display_name, status, last_sync_at")
    .eq("org_id", ORG_ID)
    .eq("channel", "instagram");
  if (instagramAccountError) throw instagramAccountError;

  const instagramRows = (instagramAccounts ?? []) as ChannelAccountRow[];
  const instagramIds = instagramRows.map((row) => row.id);
  let instagram: Partial<DataSourceState> | undefined;

  if (instagramIds.length) {
    const { data: instagramSyncRuns, error: instagramSyncError } = await supabase
      .from("sync_runs")
      .select("channel_account_id, status, period_start, period_end, rows_read, rows_written, error_message, finished_at, started_at")
      .eq("org_id", ORG_ID)
      .in("channel_account_id", instagramIds)
      .eq("job_type", "instagram_graph_sync")
      .order("started_at", { ascending: false })
      .limit(1);
    if (instagramSyncError) throw instagramSyncError;

    const instagramLatestSync = (instagramSyncRuns?.[0] ?? null) as SyncRunRow | null;
    const { count: instagramPostCount, error: instagramPostCountError } = await supabase
      .from("published_posts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ORG_ID)
      .eq("channel", "instagram");
    if (instagramPostCountError) throw instagramPostCountError;

    const hasError = instagramLatestSync?.status === "error";
    const hasPartial = instagramLatestSync?.status === "partial" || instagramRows.some((row) => row.status !== "complete");
    instagram = {
      status: hasError ? "error" : hasPartial ? "partial" : "complete",
      lastSync: formatTimestamp(
        instagramLatestSync?.finished_at ??
          instagramRows.find((row) => row.last_sync_at)?.last_sync_at ??
          instagramLatestSync?.started_at,
      ),
      detail: instagramLatestSync
        ? `Supabase 저장 ${formatRange(instagramLatestSync.period_start, instagramLatestSync.period_end)} · 계정 ${compactNumber(
            instagramRows.length,
          )}개 · 게시물 ${compactNumber(instagramPostCount)}개 · 처리 ${compactNumber(instagramLatestSync.rows_written)}행`
        : `Instagram Graph API 연결됨 · 계정 ${compactNumber(instagramRows.length)}개 · 저장 게시물 ${compactNumber(instagramPostCount)}개`,
    };

    if (hasError) {
      issues.push({
        severity: "error",
        title: "Instagram 동기화 실패",
        detail: instagramLatestSync?.error_message ?? "최근 Instagram 동기화가 실패했습니다. Supabase Function 로그를 확인하세요.",
      });
    }
  }

  return {
    youtube,
    instagram,
    issues,
  };
}

export function applyDataCenterSyncStatus(
  data: DataCenterSnapshot,
  patch: DataCenterSyncPatch | null,
): DataCenterSnapshot {
  if (!patch) return data;

  return {
    ...data,
    sources: data.sources.map((source) => {
      if (source.id === "google-youtube") return { ...source, ...patch.youtube };
      if (source.id === "meta-instagram") return { ...source, ...patch.instagram };
      return source;
    }),
    issues: [...patch.issues, ...data.issues],
  };
}

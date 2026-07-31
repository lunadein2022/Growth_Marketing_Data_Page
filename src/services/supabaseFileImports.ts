import type { ChannelId } from "./adapters/types";
import { getSupabaseClient, hasSupabaseConfig, type SupabaseDashboardUser } from "./supabaseClient";
import type { NaverMonthlyReport } from "./naverMonthlyParser";

export type SupabaseFileImportItem = {
  id: string;
  sourceFileName: string;
  channel: Exclude<ChannelId, "all">;
  title: string;
  type: string;
  metricLabel: string;
  metricValue: string;
};

export type SupabaseFileImportPayload = {
  importedAt: string;
  totalFiles: number;
  channelCounts: Partial<Record<Exclude<ChannelId, "all">, number>>;
  items: SupabaseFileImportItem[];
  naverMonthlyReport?: NaverMonthlyReport | null;
};

export type SupabaseImportPersistence =
  | { status: "saved"; importId: string; message: string }
  | { status: "skipped"; message: string }
  | { status: "error"; message: string };

// Fixed organization row seeded in supabase/migrations/0002_seed_org.sql.
// The two marketing owners pass RLS via is_marketing_owner(), so no per-user
// membership row is required for them to write imports.
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const STORAGE_BUCKET = "file-imports";

// Supabase Storage object keys allow only ASCII / URL-safe characters, so a
// Korean (non-ASCII) filename yields "Invalid key". Build an ASCII-safe key for
// the storage path; the original filename is preserved in raw_metadata.
function storageSafeName(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  const rawExt = dot > 0 ? fileName.slice(dot + 1) : "";
  const rawBase = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = rawExt.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const base =
    rawBase
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_.-]+|[_.-]+$/g, "") || "file";
  return ext ? `${base}.${ext}` : base;
}

export async function persistImportedFilesToSupabase(
  files: File[],
  payload: SupabaseFileImportPayload,
  user: SupabaseDashboardUser | null,
): Promise<SupabaseImportPersistence> {
  if (!hasSupabaseConfig()) {
    return { status: "skipped", message: "Supabase 환경변수가 없어 로컬 목업에만 반영했습니다." };
  }

  if (!user) {
    return { status: "skipped", message: "Google 로그인 후 Supabase Storage에 저장할 수 있습니다." };
  }

  try {
    const supabase = getSupabaseClient();
    const importId = crypto.randomUUID();
    const storagePrefix = `orgs/${ORG_ID}/fileImports/${importId}`;

    const uploadedFiles: Array<{ originalName: string; storagePath: string; size: number; contentType: string | null }> = [];
    for (const [index, file] of files.entries()) {
      const path = `${storagePrefix}/${index + 1}-${storageSafeName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) throw uploadError;
      uploadedFiles.push({
        originalName: file.name,
        storagePath: path,
        size: file.size,
        contentType: file.type || null,
      });
    }

    const naverReport = payload.naverMonthlyReport ?? null;
    const status = naverReport ? (naverReport.parseWarnings.length ? "partial" : "complete") : "partial";

    const { error: insertError } = await supabase.from("file_imports").insert({
      id: importId,
      org_id: ORG_ID,
      source_kind: "data-center",
      filename: files[0]?.name ?? `${payload.totalFiles} files`,
      status,
      row_count: payload.items.length,
      raw_metadata: {
        importedAtLabel: payload.importedAt,
        totalFiles: payload.totalFiles,
        channelCounts: payload.channelCounts,
        detectedRecords: payload.items,
        files: uploadedFiles,
        naverMonthlyReport: naverReport,
        createdByEmail: user.email,
      },
    });
    if (insertError) throw insertError;

    // Normalize the Naver monthly report into metric_snapshots / metric_time_series.
    // Only REAL values are persisted — the parser's synthetic weekly fallback
    // points (labels "1주".."4주") are skipped so no invented data lands in the DB.
    let normalizationNote = "";
    if (naverReport) {
      try {
        const accountId = await resolveChannelAccountId(supabase, "naver", "main");
        if (!accountId) {
          normalizationNote = " · 네이버 채널 계정이 없어 지표 정규화 건너뜀 (0003 시드 필요)";
        } else {
          const seriesCount = await normalizeNaverMetrics(supabase, accountId, importId, naverReport);
          normalizationNote = ` · 지표 정규화(스냅샷 1건, 시계열 ${seriesCount}개)`;
        }
      } catch (error) {
        normalizationNote = ` · 지표 정규화 실패: ${error instanceof Error ? error.message : "오류"}`;
      }
    }

    return {
      status: "saved",
      importId,
      message: naverReport
        ? `Supabase 저장 완료 · 네이버 ${naverReport.periodLabel} 파싱${normalizationNote} · importId ${importId}`
        : `Supabase Storage 저장 완료 · importId ${importId}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 Supabase 저장 오류";
    return { status: "error", message };
  }
}

type SupabaseServiceClient = ReturnType<typeof getSupabaseClient>;

async function resolveChannelAccountId(
  supabase: SupabaseServiceClient,
  channel: string,
  accountKey: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("channel_accounts")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("channel", channel)
    .eq("account_key", accountKey)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

function monthPeriodBounds(periodKey: string): { start: string; end: string } {
  const [year, month] = periodKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${periodKey}-01`, end: `${periodKey}-${String(lastDay).padStart(2, "0")}` };
}

// Persists the Naver monthly report as a channel-level snapshot plus real
// monthly time-series points. Returns the number of time-series rows written.
async function normalizeNaverMetrics(
  supabase: SupabaseServiceClient,
  accountId: string,
  importId: string,
  report: NaverMonthlyReport,
): Promise<number> {
  const { start, end } = monthPeriodBounds(report.periodKey);
  const status = report.parseWarnings.length ? "partial" : "complete";
  const base = {
    org_id: ORG_ID,
    owner_type: "channel",
    owner_id: accountId,
    channel: "naver",
    account_key: "main",
  };

  const { error: snapshotError } = await supabase.from("metric_snapshots").upsert(
    {
      ...base,
      period_mode: "monthly",
      period_start: start,
      period_end: end,
      metrics: report.metricSnapshot,
      status,
      source_ids: [importId],
    },
    { onConflict: "org_id,owner_type,owner_id,period_mode,period_start,period_end" },
  );
  if (snapshotError) throw snapshotError;

  // Real monthly points only: labels like "2024.05". Skip synthetic "N주" points.
  const monthLabel = /^(\d{4})\.(\d{2})$/;
  const seriesRows: Array<Record<string, unknown>> = [];
  for (const [metricKey, points] of Object.entries(report.metricTimeSeries)) {
    for (const point of points ?? []) {
      const matched = monthLabel.exec(point.label);
      if (!matched) continue;
      seriesRows.push({
        ...base,
        metric_key: metricKey,
        granularity: "month",
        point_date: `${matched[1]}-${matched[2]}-01`,
        value: point.value,
        status,
        source_ids: [importId],
      });
    }
  }

  if (seriesRows.length) {
    const { error: seriesError } = await supabase
      .from("metric_time_series")
      .upsert(seriesRows, { onConflict: "org_id,owner_type,owner_id,metric_key,granularity,point_date" });
    if (seriesError) throw seriesError;
  }

  return seriesRows.length;
}

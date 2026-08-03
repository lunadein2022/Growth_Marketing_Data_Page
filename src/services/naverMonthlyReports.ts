import type { NaverMonthlyReport } from "./naverMonthlyParser";
import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

const ORG_ID = "00000000-0000-0000-0000-000000000001";

type FileImportRow = {
  uploaded_at: string | null;
  raw_metadata: unknown;
};

type NaverImportMetadata = {
  naverMonthlyReport?: unknown;
  naverMonthlyReports?: unknown;
};

export function canLoadSavedNaverMonthlyReports() {
  return hasSupabaseConfig();
}

export async function loadSavedNaverMonthlyReports(limit = 30): Promise<NaverMonthlyReport[]> {
  if (!hasSupabaseConfig()) return [];

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("file_imports")
    .select("uploaded_at, raw_metadata")
    .eq("org_id", ORG_ID)
    .eq("source_kind", "data-center")
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const byPeriod = new Map<string, NaverMonthlyReport>();
  ((data ?? []) as FileImportRow[]).forEach((row) => {
    extractNaverReports(row.raw_metadata).forEach((report) => {
      // Rows are newest first. Keep the first report we see for each month.
      if (!byPeriod.has(report.periodKey)) byPeriod.set(report.periodKey, report);
    });
  });

  return Array.from(byPeriod.values()).sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

function extractNaverReports(metadata: unknown): NaverMonthlyReport[] {
  if (!metadata || typeof metadata !== "object") return [];

  const source = metadata as NaverImportMetadata;
  const reports = Array.isArray(source.naverMonthlyReports)
    ? source.naverMonthlyReports
    : source.naverMonthlyReport
      ? [source.naverMonthlyReport]
      : [];

  return reports.filter(isNaverMonthlyReport);
}

function isNaverMonthlyReport(value: unknown): value is NaverMonthlyReport {
  if (!value || typeof value !== "object") return false;

  const report = value as Partial<NaverMonthlyReport>;
  return (
    report.platform === "naver" &&
    typeof report.periodKey === "string" &&
    typeof report.periodLabel === "string" &&
    Array.isArray(report.requiredMetrics) &&
    Boolean(report.metricSnapshot) &&
    typeof report.metricSnapshot === "object"
  );
}

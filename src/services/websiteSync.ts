import type { PeriodMode } from "./adapters/types";
import { ensureFreshSession, getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

export type WebsiteSyncRequest = {
  periodMode: PeriodMode;
  startDate: string;
  endDate: string;
  maxPages?: number;
};

export type WebsiteSyncAccount = {
  accountKey: string;
  displayName: string;
  propertyId: string;
  hasSearchConsole: boolean;
  pagesSynced: number;
  dailyPoints: number;
  rowsWritten: number;
  status: "complete" | "partial";
  metrics: Record<string, number>;
};

export type WebsiteSyncResult = {
  status: "complete";
  overallStatus: "complete" | "partial";
  message: string;
  periodStart: string;
  periodEnd: string;
  rowsWritten: number;
  accounts: WebsiteSyncAccount[];
};

export type WebsiteSyncState =
  | WebsiteSyncResult
  | {
      status: "error";
      message: string;
    };

export function canSyncWebsiteAnalytics() {
  return hasSupabaseConfig();
}

export async function syncWebsiteAnalytics(request: WebsiteSyncRequest): Promise<WebsiteSyncResult> {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase 환경변수가 없어 홈페이지 API 동기화를 실행할 수 없습니다.");
  }

  await ensureFreshSession();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("website-sync", {
    body: request,
  });

  if (error) {
    let detail = error.message ?? "홈페이지 API 동기화 실패";
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      /* keep fallback */
    }
    throw new Error(detail);
  }

  if (!data || typeof data !== "object") {
    throw new Error("홈페이지 동기화 응답이 비어 있습니다.");
  }
  if ((data as { status?: string }).status === "error") {
    throw new Error((data as { error?: string }).error ?? "홈페이지 API 동기화 실패");
  }

  return data as WebsiteSyncResult;
}

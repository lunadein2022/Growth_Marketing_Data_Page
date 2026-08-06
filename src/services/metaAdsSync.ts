import { ensureFreshSession, getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

export type MetaAdsSyncResult = {
  status: "complete";
  rowsWritten: number;
  accounts: Array<{ accountKey: string; adAccountId: string; adsSynced: number; status: string }>;
};

export type MetaAdsSyncState = MetaAdsSyncResult | { status: "error"; message: string };

export function canSyncMetaAds() {
  return hasSupabaseConfig();
}

export async function syncMetaAds(request: { datePreset?: string; startDate?: string; endDate?: string } = {}): Promise<MetaAdsSyncResult> {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase 환경변수가 없어 Meta 광고 동기화를 실행할 수 없습니다.");
  }

  await ensureFreshSession();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("meta-ads-sync", { body: request });

  if (error) {
    let detail = error.message ?? "Meta 광고 동기화 실패";
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      /* keep fallback */
    }
    throw new Error(detail);
  }

  if (!data || typeof data !== "object") throw new Error("Meta 광고 동기화 응답이 비어 있습니다.");
  if ((data as { status?: string }).status === "error") {
    throw new Error((data as { error?: string }).error ?? "Meta 광고 동기화 실패");
  }
  return data as MetaAdsSyncResult;
}

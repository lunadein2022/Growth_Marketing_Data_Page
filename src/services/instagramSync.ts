import type { PeriodMode } from "./adapters/types";
import { ensureFreshSession, getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

export type InstagramSyncRequest = {
  periodMode: PeriodMode;
  startDate: string;
  endDate: string;
  maxMedia?: number;
  includeMediaBackfill?: boolean;
};

export type InstagramSyncAccountResult = {
  accountKey: string;
  displayName: string;
  instagramUserId: string;
  mediaSynced: number;
  mediaWithInsights: number;
  dailyPoints: number;
  warnings: string[];
};

export type InstagramSyncResult = {
  status: "complete" | "partial";
  message: string;
  periodStart: string;
  periodEnd: string;
  rowsRead: number;
  rowsWritten: number;
  accounts: InstagramSyncAccountResult[];
  syncRunIds: string[];
};

export type InstagramSyncState =
  | InstagramSyncResult
  | {
      status: "error";
      message: string;
    };

export function canSyncInstagramAnalytics() {
  return hasSupabaseConfig();
}

export async function syncInstagramAnalytics(request: InstagramSyncRequest): Promise<InstagramSyncResult> {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase config is missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  await ensureFreshSession();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("instagram-sync", {
    body: request,
  });

  if (error) {
    let detail = error.message ?? "Instagram Graph API sync failed.";
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      /* keep fallback */
    }
    throw new Error(detail);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Instagram sync returned an empty response.");
  }
  if ((data as { status?: string }).status === "error") {
    throw new Error((data as { error?: string }).error ?? "Instagram Graph API sync failed.");
  }

  return data as InstagramSyncResult;
}

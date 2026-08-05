import type { PeriodMode } from "./adapters/types";
import { ensureFreshSession, getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";

export type YoutubeSyncRequest = {
  periodMode: PeriodMode;
  startDate: string;
  endDate: string;
  maxVideos?: number;
  includeUploadBackfill?: boolean;
};

export type YoutubeSyncResult = {
  status: "complete";
  message: string;
  channelTitle: string;
  periodStart: string;
  periodEnd: string;
  rowsRead: number;
  rowsWritten: number;
  videosSynced: number;
  videosWithPeriodMetrics?: number;
  videoLimit?: number;
  dailyPoints: number;
  syncRunId: string;
  metrics: {
    subscribers?: number;
    subscribers_gained?: number;
    views?: number;
    watch_time_minutes?: number;
    average_view_seconds?: number;
    video_count?: number;
  };
};

export type YoutubeSyncState =
  | YoutubeSyncResult
  | {
      status: "error";
      message: string;
    };

export function canSyncYoutubeAnalytics() {
  return hasSupabaseConfig();
}

export async function syncYoutubeAnalytics(request: YoutubeSyncRequest): Promise<YoutubeSyncResult> {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase 환경변수가 없어 YouTube API 동기화를 실행할 수 없습니다.");
  }

  await ensureFreshSession();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("youtube-sync", {
    body: request,
  });

  if (error) {
    let detail = error.message ?? "YouTube API 동기화 실패";
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      /* keep fallback */
    }
    throw new Error(detail);
  }

  if (!data || typeof data !== "object") {
    throw new Error("YouTube 동기화 응답이 비어 있습니다.");
  }
  if ((data as { status?: string }).status === "error") {
    throw new Error((data as { error?: string }).error ?? "YouTube API 동기화 실패");
  }

  return data as YoutubeSyncResult;
}

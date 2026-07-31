import { getSupabaseClient, hasSupabaseConfig } from "./supabaseClient";
import type { AiBriefing, BriefingRequest } from "./adapters/types";

// Screen-aggregated context sent to the Edge Function. The model is instructed
// to use ONLY the numbers present here — it never invents metrics.
export type BriefingContext = {
  periodLabel?: string;
  dataSources?: string[];
  dataWarnings?: string[];
  figures?: Record<string, unknown>;
};

export function canUseEdgeBriefings() {
  return hasSupabaseConfig();
}

export async function generateBriefingViaEdge(
  request: BriefingRequest,
  context: BriefingContext,
): Promise<AiBriefing> {
  const supabase = getSupabaseClient();

  // functions.invoke attaches the current session's JWT and targets the
  // project's Edge Function endpoint automatically.
  const { data, error } = await supabase.functions.invoke("ai-briefings", {
    body: { request, context },
  });

  if (error) {
    // Edge Function error responses carry a JSON body with { error }.
    let detail = error.message ?? "Edge Function 호출 실패";
    try {
      const body = await (error as { context?: Response }).context?.json?.();
      if (body?.error) detail = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(detail);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Edge Function 응답이 비어 있습니다.");
  }
  if ((data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }

  return data as AiBriefing;
}

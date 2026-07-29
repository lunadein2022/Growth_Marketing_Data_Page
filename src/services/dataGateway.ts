import { MockBrandDataProvider } from "./adapters/mockAdapter";
import type { AdContent, BrandDataProvider, ContentItem, PeriodMode } from "./adapters/types";

class ApiBackedProvider extends MockBrandDataProvider {
  constructor(private readonly apiBaseUrl: string) {
    super();
  }

  async getCommandCenterSnapshot(periodMode: PeriodMode) {
    return this.requestJson(`/dashboard/command-center?period=${periodMode}`);
  }

  async getChannels(periodMode: PeriodMode) {
    return this.requestJson(`/dashboard/channels?period=${periodMode}`);
  }

  async getContentLabSnapshot(periodMode: PeriodMode) {
    return this.requestJson(`/content-lab?period=${periodMode}`);
  }

  async getDataCenterSnapshot(periodMode: PeriodMode) {
    return this.requestJson(`/data-center?period=${periodMode}`);
  }

  async getPeriodComparison(
    scope: Parameters<BrandDataProvider["getPeriodComparison"]>[0],
    detail: Parameters<BrandDataProvider["getPeriodComparison"]>[1],
    granularity: Parameters<BrandDataProvider["getPeriodComparison"]>[2],
    baseline: Parameters<BrandDataProvider["getPeriodComparison"]>[3],
  ) {
    const params = new URLSearchParams({ scope, detail, granularity, baseline });
    return this.requestJson(`/analytics/period-comparison?${params.toString()}`);
  }

  async generateBriefing(request: Parameters<BrandDataProvider["generateBriefing"]>[0]) {
    return this.requestJson("/ai/briefings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  async upsertContentCard(card: ContentItem, periodMode: PeriodMode) {
    return this.requestJson(`/content-lab/pipeline/${encodeURIComponent(card.id)}?period=${periodMode}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
  }

  async moveContentCard(contentId: string, status: string, periodMode: PeriodMode) {
    return this.requestJson(`/content-lab/pipeline/${encodeURIComponent(contentId)}/status?period=${periodMode}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async deleteContentCard(contentId: string, periodMode: PeriodMode) {
    return this.requestJson(`/content-lab/pipeline/${encodeURIComponent(contentId)}?period=${periodMode}`, {
      method: "DELETE",
    });
  }

  async createCampaignFromContent(sourceContentId: string | undefined, periodMode: PeriodMode) {
    return this.requestJson(`/content-lab/campaigns/generate?period=${periodMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceContentId }),
    });
  }

  async upsertAd(ad: AdContent, periodMode: PeriodMode) {
    return this.requestJson(`/content-lab/ads/${encodeURIComponent(ad.id)}?period=${periodMode}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ad),
    });
  }

  async deleteAd(adId: string, periodMode: PeriodMode) {
    return this.requestJson(`/content-lab/ads/${encodeURIComponent(adId)}?period=${periodMode}`, {
      method: "DELETE",
    });
  }

  private async requestJson(path: string, init?: RequestInit) {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      credentials: "include",
      ...init,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    return response.json();
  }
}

export function createBrandDataProvider(): BrandDataProvider {
  const dataMode = import.meta.env.VITE_DATA_MODE ?? "mock";
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_FIREBASE_FUNCTIONS_BASE_URL ?? "http://localhost:8787";

  if (dataMode === "api") {
    return new ApiBackedProvider(apiBaseUrl);
  }

  return new MockBrandDataProvider();
}

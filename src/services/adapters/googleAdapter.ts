import type { BrandDataProvider } from "./types";

export class GoogleAdapter {
  constructor(private readonly apiBaseUrl: string) {}

  async connectYouTube() {
    return this.getJson("/integrations/google/youtube/connect");
  }

  async syncYouTubeAnalytics() {
    return this.getJson("/sync/google/youtube-analytics");
  }

  async syncGa4AndSearchConsole() {
    return this.getJson("/sync/google/website");
  }

  private async getJson(path: string) {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Google adapter request failed: ${response.status}`);
    }

    return response.json();
  }
}

export type GoogleBackedProvider = Pick<
  BrandDataProvider,
  "getCommandCenterSnapshot" | "getChannels" | "getPeriodComparison"
>;

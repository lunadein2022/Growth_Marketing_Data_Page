export class MetaAdapter {
  constructor(private readonly apiBaseUrl: string) {}

  async connectInstagram(accountKey: "corporate" | "dummdumm_log") {
    const response = await fetch(`${this.apiBaseUrl}/integrations/meta/instagram/connect`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountKey }),
    });

    if (!response.ok) {
      throw new Error(`Meta adapter request failed: ${response.status}`);
    }

    return response.json();
  }

  async syncInstagramInsights() {
    const response = await fetch(`${this.apiBaseUrl}/sync/meta/instagram`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Meta sync failed: ${response.status}`);
    }

    return response.json();
  }
}

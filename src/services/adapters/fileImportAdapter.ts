export class FileImportAdapter {
  constructor(private readonly apiBaseUrl: string) {}

  async uploadFiles(files: File[]) {
    const payload = new FormData();
    files.forEach((file) => payload.append("files", file));

    const response = await fetch(`${this.apiBaseUrl}/imports`, {
      method: "POST",
      credentials: "include",
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`File import failed: ${response.status}`);
    }

    return response.json();
  }
}

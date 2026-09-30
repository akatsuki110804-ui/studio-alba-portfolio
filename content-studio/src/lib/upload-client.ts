// Client-side upload helper for /api/uploads with progress reporting.
export type UploadResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

export function uploadFile(
  fields: Record<string, string>,
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as UploadResult | null;
      if (body && typeof body === "object" && "ok" in body) resolve(body);
      else resolve({ ok: false, error: `アップロードに失敗しました（${xhr.status}）。` });
    };
    xhr.onerror = () => resolve({ ok: false, error: "ネットワークエラーでアップロードできませんでした。" });
    xhr.send(form);
  });
}

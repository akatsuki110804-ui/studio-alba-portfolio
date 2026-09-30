// Client-side upload helpers with progress reporting.
import { registerUploadedAsset } from "@/app/actions/assets";
import { safeFileName } from "@/lib/files";

export type UploadResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

export type UploadTarget = {
  mode: "direct" | "server";
  /** Storage prefix for this user's project (direct mode only). */
  prefix: string;
  maxBytes: number;
};

/** Multipart upload through /api/uploads (local disk / S3, and bible images). */
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
      else if (xhr.status === 413) resolve({ ok: false, error: "ファイルが大きすぎます（参考画像は4MB以下にしてください）。" });
      else resolve({ ok: false, error: `アップロードに失敗しました（${xhr.status}）。` });
    };
    xhr.onerror = () => resolve({ ok: false, error: "ネットワークエラーでアップロードできませんでした。" });
    xhr.send(form);
  });
}

/** Uploads a shot asset, directly to storage when available (large videos on Vercel). */
export async function uploadShotAsset(
  target: UploadTarget,
  shotId: string,
  assetId: string | null,
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<UploadResult> {
  if (file.size > target.maxBytes) {
    return { ok: false, error: `ファイルサイズが上限（${Math.round(target.maxBytes / 1024 / 1024)}MB）を超えています。` };
  }
  if (target.mode === "server") {
    return uploadFile({ purpose: "asset", shotId, ...(assetId ? { assetId } : {}) }, file, onProgress);
  }

  try {
    const { upload } = await import("@vercel/blob/client");
    const key = `${target.prefix}${crypto.randomUUID()}/${safeFileName(file.name)}`;
    await upload(key, file, {
      access: "private",
      handleUploadUrl: "/api/uploads/blob",
      clientPayload: JSON.stringify({ shotId }),
      contentType: file.type || undefined,
      multipart: file.size > 20 * 1024 * 1024,
      onUploadProgress: (e) => onProgress?.(e.percentage / 100),
    });
    const res = await registerUploadedAsset(shotId, { key, fileName: file.name, assetId: assetId ?? undefined });
    return res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/content type/i.test(message)) return { ok: false, error: "この形式のファイルはアップロードできません。" };
    if (/too large|size/i.test(message)) return { ok: false, error: "ファイルサイズが上限を超えています。" };
    return { ok: false, error: "アップロードに失敗しました。通信環境を確認して再度お試しください。" };
  }
}

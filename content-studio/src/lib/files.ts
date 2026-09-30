// Client-safe file helpers (shared by the browser and the server).

/** URL the browser uses to fetch a stored file (authorized by /api/files). */
export function fileUrl(key: string | null | undefined) {
  if (!key) return null;
  return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function storagePrefix(userId: string, projectId: string) {
  return `u/${userId}/p/${projectId}/`;
}

export function safeFileName(fileName: string) {
  return fileName.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-100) || "file";
}

// Types accepted for shot assets. SVG / HTML are excluded: served from our origin they could run script.
export const ALLOWED_ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/*",
  "audio/*",
  "application/pdf",
];

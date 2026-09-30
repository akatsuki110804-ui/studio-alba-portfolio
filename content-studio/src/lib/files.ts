// Client-safe helper: URL the browser uses to fetch a stored file (authorized by /api/files).
export function fileUrl(key: string | null | undefined) {
  if (!key) return null;
  return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

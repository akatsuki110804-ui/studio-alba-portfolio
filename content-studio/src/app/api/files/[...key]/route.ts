import { getCurrentUser } from "@/lib/auth/session";
import { getStorage, keyBelongsToUser } from "@/lib/storage";

// Serves stored files to their owner only. Supports byte ranges for video scrubbing.
export async function GET(request: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  if (!keyBelongsToUser(key, user.id)) return new Response("Not found", { status: 404 });

  const rangeHeader = request.headers.get("range");
  const match = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/);
  const range = match ? { start: Number(match[1]), end: match[2] ? Number(match[2]) : undefined } : undefined;

  let object;
  try {
    object = await getStorage().get(key, range);
  } catch (error) {
    console.error("[files] storage error", error);
    return new Response("Storage error", { status: 500 });
  }
  if (!object) return new Response("Not found", { status: 404 });

  // Only media is rendered inline; anything else is forced to download.
  const inline = /^(image\/(?!svg)|video\/|audio\/|application\/pdf)/.test(object.contentType);
  const headers = new Headers({
    "Content-Type": inline ? object.contentType : "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  if (!inline) headers.set("Content-Disposition", "attachment");

  if (object.range) {
    headers.set("Content-Range", `bytes ${object.range.start}-${object.range.end}/${object.size}`);
    headers.set("Content-Length", String(object.range.end - object.range.start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  if (object.size) headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

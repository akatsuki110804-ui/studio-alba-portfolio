import "server-only";
import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { ByteRange, StorageDriver } from "./types";

/**
 * Vercel Blob (private store). Objects are never publicly reachable; the app
 * streams them through /api/files after checking ownership.
 * Uses BLOB_READ_WRITE_TOKEN, which Vercel injects when a Blob store is connected.
 */
export class VercelBlobStorageDriver implements StorageDriver {
  async put(key: string, data: Uint8Array, contentType: string) {
    await put(key, Buffer.from(data), { access: "private", contentType, addRandomSuffix: false });
  }

  async get(key: string, range?: ByteRange) {
    const res = await get(key, {
      access: "private",
      headers: range ? { Range: `bytes=${range.start}-${range.end ?? ""}` } : undefined,
    });
    if (!res || res.statusCode !== 200) return null;
    const contentType = res.blob.contentType || "application/octet-stream";
    // Content-Range: bytes start-end/total (present when the range request was honored)
    const m = res.headers.get("content-range")?.match(/bytes (\d+)-(\d+)\/(\d+)/);
    if (range && m) {
      return { body: res.stream, contentType, size: Number(m[3]), range: { start: Number(m[1]), end: Number(m[2]) } };
    }
    return { body: res.stream, contentType, size: res.blob.size };
  }

  async head(key: string) {
    try {
      const info = await head(key);
      return { contentType: info.contentType || "application/octet-stream", size: info.size };
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }

  async delete(key: string) {
    await del(key);
  }
}

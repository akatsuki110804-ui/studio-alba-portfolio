import "server-only";
import { randomUUID } from "node:crypto";
import { safeFileName, storagePrefix } from "@/lib/files";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";
import type { StorageDriver } from "./types";
import { VercelBlobStorageDriver } from "./vercel-blob";

export type StorageDriverName = "local" | "s3" | "vercel-blob";

/** STORAGE_DRIVER wins; otherwise a connected Vercel Blob store is used automatically. */
export function storageDriverName(): StorageDriverName {
  const configured = process.env.STORAGE_DRIVER;
  if (configured === "s3" || configured === "local" || configured === "vercel-blob") return configured;
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local";
}

/**
 * "direct": the browser uploads straight to storage (needed on Vercel, whose
 * functions reject request bodies over 4.5MB). "server": multipart via /api/uploads.
 */
export function uploadMode(): "direct" | "server" {
  return storageDriverName() === "vercel-blob" ? "direct" : "server";
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const name = storageDriverName();
  if (name === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
    driver = new S3StorageDriver(bucket);
  } else if (name === "vercel-blob") {
    driver = new VercelBlobStorageDriver();
  } else {
    driver = new LocalStorageDriver(process.env.STORAGE_LOCAL_DIR || "./storage");
  }
  return driver;
}

export function maxUploadBytes() {
  const mb = Number(process.env.UPLOAD_MAX_MB || 200);
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

/**
 * Keys are namespaced by owner so the file route can authorize by prefix:
 *   u/{userId}/p/{projectId}/{uuid}/{safeName}
 */
export function buildStorageKey(userId: string, projectId: string, fileName: string) {
  return `${storagePrefix(userId, projectId)}${randomUUID()}/${safeFileName(fileName)}`;
}

export function keyBelongsToUser(key: string, userId: string) {
  return key.startsWith(`u/${userId}/`) && !key.includes("..");
}

/** A key that a client uploaded directly must sit under this user's project prefix. */
export function isValidProjectKey(key: string, userId: string, projectId: string) {
  const prefix = storagePrefix(userId, projectId);
  if (!key.startsWith(prefix) || key.includes("..")) return false;
  // {uuid}/{safeName}
  return /^[0-9a-f-]{36}\/[^/]+$/i.test(key.slice(prefix.length));
}

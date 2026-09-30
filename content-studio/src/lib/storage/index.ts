import "server-only";
import { randomUUID } from "node:crypto";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";
import type { StorageDriver } from "./types";

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  if (process.env.STORAGE_DRIVER === "s3") {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
    driver = new S3StorageDriver(bucket);
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
  const safe = fileName.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-100) || "file";
  return `u/${userId}/p/${projectId}/${randomUUID()}/${safe}`;
}

export function keyBelongsToUser(key: string, userId: string) {
  return key.startsWith(`u/${userId}/`) && !key.includes("..");
}


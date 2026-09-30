import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NoSuchKey, NotFound, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ByteRange, StorageDriver } from "./types";

/** AWS S3 / Cloudflare R2 / MinIO. Files are proxied through the app so access stays authorized. */
export class S3StorageDriver implements StorageDriver {
  private client: S3Client;

  constructor(private bucket: string) {
    this.client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }

  async get(key: string, range?: ByteRange) {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
        }),
      );
      if (!res.Body) return null;
      const body = res.Body.transformToWebStream() as ReadableStream<Uint8Array>;
      const contentType = res.ContentType ?? "application/octet-stream";
      // Content-Range: bytes start-end/total
      const m = res.ContentRange?.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (range && m) {
        return { body, contentType, size: Number(m[3]), range: { start: Number(m[1]), end: Number(m[2]) } };
      }
      return { body, contentType, size: res.ContentLength ?? 0 };
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async head(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentType: res.ContentType ?? "application/octet-stream", size: res.ContentLength ?? 0 };
    } catch (error) {
      if (error instanceof NotFound || error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

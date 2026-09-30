import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ByteRange, StorageDriver } from "./types";

/** Stores files on the local disk. Good for development and single-server self-hosting. */
export class LocalStorageDriver implements StorageDriver {
  private root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
  }

  async get(key: string, range?: ByteRange) {
    const file = this.resolve(key);
    try {
      const info = await stat(file);
      let contentType = "application/octet-stream";
      try {
        contentType = JSON.parse(await readFile(`${file}.meta.json`, "utf8")).contentType ?? contentType;
      } catch {
        // metadata missing — keep default
      }
      if (range) {
        const end = Math.min(range.end ?? info.size - 1, info.size - 1);
        const body = Readable.toWeb(createReadStream(file, { start: range.start, end })) as ReadableStream<Uint8Array>;
        return { body, contentType, size: info.size, range: { start: range.start, end } };
      }
      const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
      return { body, contentType, size: info.size };
    } catch {
      return null;
    }
  }

  async head(key: string) {
    const file = this.resolve(key);
    try {
      const info = await stat(file);
      let contentType = "application/octet-stream";
      try {
        contentType = JSON.parse(await readFile(`${file}.meta.json`, "utf8")).contentType ?? contentType;
      } catch {
        // metadata missing — keep default
      }
      return { contentType, size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }
}

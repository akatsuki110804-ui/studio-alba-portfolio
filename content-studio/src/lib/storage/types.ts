export type ByteRange = { start: number; end?: number };

export type StoredObject = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  /** Total size of the object in bytes. */
  size: number;
  /** Present when a range was served. */
  range?: { start: number; end: number };
};

export interface StorageDriver {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string, range?: ByteRange): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

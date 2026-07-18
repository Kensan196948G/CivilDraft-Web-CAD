/**
 * R2ContentStore — Cloudflare R2 backing store for revision content blobs.
 *
 * Stores/retrieves serialized revision content (JSON blobs) keyed by revision ID
 * under the `contents/` prefix.  Each blob carries Content-Type metadata so the
 * API layer can reconstruct `ContentRecord` without an extra DB round-trip.
 */
import type { ContentRecord } from './apiStore'

/** Minimal subset of the Cloudflare R2 bucket binding needed by this store. */
export interface R2BucketBinding {
  put(
    key: string,
    value: string | ReadableStream<Uint8Array> | ArrayBuffer,
    options?: R2PutOptions,
  ): Promise<R2Object | null>
  get(key: string): Promise<R2ObjectBody | null>
  delete(key: string): Promise<void>
}

export interface R2PutOptions {
  readonly httpMetadata?: R2HttpMetadata
  readonly customMetadata?: Record<string, string>
}

export interface R2HttpMetadata {
  readonly contentType?: string
  readonly contentDisposition?: string
  readonly contentEncoding?: string
  readonly contentLanguage?: string
  readonly cacheControl?: string
  readonly cacheExpiry?: Date
}

export interface R2Object {
  readonly key: string
  readonly version: string
  readonly size: number
  readonly etag: string
  readonly httpEtag: string
  readonly uploaded: Date
  readonly httpMetadata?: R2HttpMetadata
  readonly customMetadata?: Record<string, string>
}

export interface R2ObjectBody extends R2Object {
  readonly body: ReadableStream<Uint8Array>
  readonly bodyUsed: boolean
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T>(): Promise<T>
}

const CONTENT_PREFIX = 'contents/'
const MIME_JSON = 'application/json'

/** Every content object we store carries this custom metadata. */
interface ContentMetadata {
  readonly revisionId: string
  readonly contentChecksum: string
  readonly schemaVersion: string
  readonly contentVersion: string
  readonly updatedAt: string
  readonly byteSize: string
}

export class R2ContentStore {
  readonly #bucket: R2BucketBinding

  constructor(bucket: R2BucketBinding) {
    this.#bucket = bucket
  }

  /** Serialise a ContentRecord and store it in R2. */
  async putContent(record: ContentRecord): Promise<void> {
    const serialized = JSON.stringify(record.content)
    const key = this.#contentKey(record.revisionId)
    await this.#bucket.put(key, serialized, {
      httpMetadata: { contentType: MIME_JSON },
      customMetadata: {
        revisionId: record.revisionId,
        contentChecksum: record.contentChecksum,
        schemaVersion: String(record.schemaVersion),
        contentVersion: String(record.contentVersion),
        updatedAt: record.updatedAt,
        byteSize: String(record.byteSize),
      } satisfies ContentMetadata,
    })
  }

  /** Fetch a ContentRecord from R2. Returns `undefined` if not found. */
  async getContent(revisionId: string): Promise<ContentRecord | undefined> {
    const key = this.#contentKey(revisionId)
    const obj = await this.#bucket.get(key)
    if (!obj) return undefined
    const content = await obj.json<unknown>()
    const meta = obj.customMetadata
    return {
      revisionId: meta?.revisionId ?? revisionId,
      content,
      byteSize: obj.size,
      contentChecksum: meta?.contentChecksum ?? '',
      mimeType: (obj.httpMetadata?.contentType as typeof MIME_JSON) ?? MIME_JSON,
      schemaVersion: Number(meta?.schemaVersion ?? 1),
      contentVersion: Number(meta?.contentVersion ?? 1),
      updatedAt: meta?.updatedAt ?? new Date().toISOString(),
    }
  }

  /** Delete a content blob from R2. No-op if the key does not exist. */
  async deleteContent(revisionId: string): Promise<void> {
    const key = this.#contentKey(revisionId)
    await this.#bucket.delete(key)
  }

  #contentKey(revisionId: string): string {
    return `${CONTENT_PREFIX}${revisionId}`
  }
}

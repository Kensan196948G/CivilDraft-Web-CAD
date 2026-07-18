import { describe, expect, it } from 'vitest'
import { R2ContentStore } from '@/workers/r2ContentStore'
import type { ContentRecord, R2BucketBinding, R2ObjectBody } from '@/workers/r2ContentStore'

function makeContent(overrides: Partial<ContentRecord> = {}): ContentRecord {
  return {
    revisionId: 'rev-001',
    content: { geometries: [{ id: 'g-1', type: 'line' }] },
    byteSize: 42,
    contentChecksum: 'sha256:abc123',
    mimeType: 'application/json',
    schemaVersion: 1,
    contentVersion: 3,
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  }
}

function makeMockBucket(): R2BucketBinding {
  const store = new Map<string, { value: string; metadata: Record<string, string>; contentType: string }>()

  return {
    async put(key, value, options) {
      const body = typeof value === 'string' ? value : '[binary]'
      store.set(key, {
        value: body,
        metadata: options?.customMetadata ?? {},
        contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
      })
      return {
        key,
        version: '1',
        size: body.length,
        etag: 'etag-1',
        httpEtag: 'http-etag-1',
        uploaded: new Date(),
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      }
    },
    async get(key) {
      const entry = store.get(key)
      if (!entry) return null
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(entry.value))
          controller.close()
        },
      })
      return {
        key,
        version: '1',
        size: entry.value.length,
        etag: 'etag-1',
        httpEtag: 'http-etag-1',
        uploaded: new Date(),
        httpMetadata: { contentType: entry.contentType },
        customMetadata: entry.metadata,
        body,
        bodyUsed: false,
        arrayBuffer: async () => new TextEncoder().encode(entry.value).buffer as ArrayBuffer,
        text: async () => entry.value,
        json: async <T>() => JSON.parse(entry.value) as T,
      } satisfies R2ObjectBody
    },
    async delete(key) {
      store.delete(key)
    },
  }
}

describe('R2ContentStore', () => {
  it('putContent stores a content record and getContent retrieves it', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)
    const record = makeContent()

    await store.putContent(record)
    const retrieved = await store.getContent(record.revisionId)

    expect(retrieved).toBeDefined()
    expect(retrieved?.revisionId).toBe(record.revisionId)
    expect(retrieved?.content).toEqual(record.content)
    expect(retrieved?.contentChecksum).toBe(record.contentChecksum)
    expect(retrieved?.contentVersion).toBe(record.contentVersion)
    expect(retrieved?.schemaVersion).toBe(record.schemaVersion)
    expect(retrieved?.mimeType).toBe('application/json')
  })

  it('getContent returns undefined for a non-existent revision', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)

    const retrieved = await store.getContent('nonexistent-rev')

    expect(retrieved).toBeUndefined()
  })

  it('deleteContent removes a stored content record', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)
    const record = makeContent()

    await store.putContent(record)
    await store.deleteContent(record.revisionId)
    const retrieved = await store.getContent(record.revisionId)

    expect(retrieved).toBeUndefined()
  })

  it('putContent overwrites existing content for the same revision', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)
    const original = makeContent({ contentVersion: 1, content: { v: 1 } })
    const updated = makeContent({ contentVersion: 2, content: { v: 2 } })

    await store.putContent(original)
    await store.putContent(updated)
    const retrieved = await store.getContent(original.revisionId)

    expect(retrieved?.contentVersion).toBe(2)
    expect(retrieved?.content).toEqual({ v: 2 })
  })

  it('stores content with correct MIME type metadata', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)
    const record = makeContent()

    await store.putContent(record)
    const obj = await bucket.get(`contents/${record.revisionId}`)

    expect(obj?.httpMetadata?.contentType).toBe('application/json')
  })

  it('handles multiple independent revisions', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)
    const rev1 = makeContent({ revisionId: 'rev-001', content: { id: 1 } })
    const rev2 = makeContent({ revisionId: 'rev-002', content: { id: 2 } })

    await store.putContent(rev1)
    await store.putContent(rev2)

    const r1 = await store.getContent('rev-001')
    const r2 = await store.getContent('rev-002')

    expect(r1?.content).toEqual({ id: 1 })
    expect(r2?.content).toEqual({ id: 2 })
  })

  it('deleteContent is idempotent — no error on non-existent key', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)

    await expect(store.deleteContent('nonexistent')).resolves.toBeUndefined()
  })

  it('getContent returns correct byteSize from R2 object metadata', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)
    const record = makeContent({ content: { data: 'hello world' } })

    await store.putContent(record)
    const retrieved = await store.getContent(record.revisionId)

    expect(retrieved?.byteSize).toBeGreaterThan(0)
  })

  it('getContent falls back to defaults when customMetadata is missing', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)
    // Store content with minimal metadata
    await bucket.put('contents/rev-minimal', JSON.stringify({ foo: 'bar' }), {
      httpMetadata: { contentType: 'application/json' },
    })

    const retrieved = await store.getContent('rev-minimal')

    expect(retrieved).toBeDefined()
    expect(retrieved?.revisionId).toBe('rev-minimal')
    expect(retrieved?.content).toEqual({ foo: 'bar' })
    expect(retrieved?.mimeType).toBe('application/json')
    expect(retrieved?.schemaVersion).toBe(1)
    expect(retrieved?.contentVersion).toBe(1)
  })

  it('stores large content payloads correctly', async () => {
    const bucket = makeMockBucket()
    const store = new R2ContentStore(bucket)
    const largeContent = { geometries: Array.from({ length: 1000 }, (_, i) => ({ id: `g-${i}`, type: 'line' })) }
    const record = makeContent({ content: largeContent })

    await store.putContent(record)
    const retrieved = await store.getContent(record.revisionId)

    expect(retrieved?.content).toEqual(largeContent)
    expect(retrieved?.byteSize).toBeGreaterThan(1000)
  })
})
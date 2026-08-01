import { describe, expect, it } from 'vitest'
import {
  canonicalAuditPayload,
  computeEntryHash,
  stableStringify,
  verifyAuditChain,
  type AuditChainRecord,
} from '@/workers/auditChain'

function baseRecord(overrides: Partial<AuditChainRecord> = {}): AuditChainRecord {
  return {
    id: 'audit-1',
    occurredAt: '2026-08-01T00:00:00.000Z',
    eventName: 'drawing.created',
    actorId: 'user@example.test',
    projectId: 'project_1',
    entityType: 'drawing',
    entityId: 'drawing_1',
    result: 'success',
    correlationId: 'cid_1',
    detail: { revisionId: 'revision_1' },
    ...overrides,
  }
}

describe('stableStringify / canonicalAuditPayload', () => {
  it('オブジェクトのキー順に依存せず同一の文字列になる（jsonb正規化と無関係）', () => {
    const a = stableStringify({ b: 1, a: { d: 2, c: [1, { f: 3, e: 4 }] } })
    const b = stableStringify({ a: { c: [1, { e: 4, f: 3 }], d: 2 }, b: 1 })
    expect(a).toBe(b)
    expect(a).toContain('"a"')
  })

  it('canonical payload は欠損フィールドを null に正規化する', () => {
    const withDetail = canonicalAuditPayload(baseRecord())
    const withoutDetail = canonicalAuditPayload(baseRecord({ detail: undefined }))
    expect(withDetail).not.toBe(withoutDetail)
    expect(withoutDetail).toContain('"detail":null')
  })
})

describe('computeEntryHash', () => {
  it('previous_hash の違いで entry_hash が変わる（連結性）', async () => {
    const record = baseRecord()
    const hashA = await computeEntryHash(undefined, record)
    const hashB = await computeEntryHash('x'.repeat(64), record)
    expect(hashA).toMatch(/^[0-9a-f]{64}$/)
    expect(hashB).toMatch(/^[0-9a-f]{64}$/)
    expect(hashA).not.toBe(hashB)
  })
})

describe('verifyAuditChain', () => {
  it('正しく連結されたチェーンを valid として検証する', async () => {
    const first = baseRecord()
    const firstHash = await computeEntryHash(undefined, first)
    const second = baseRecord({ id: 'audit-2', eventName: 'revision.approved', entityId: 'revision_2', correlationId: 'cid_2' })
    const secondHash = await computeEntryHash(firstHash, second)
    const result = await verifyAuditChain([
      { ...first, entryHash: firstHash },
      { ...second, previousHash: firstHash, entryHash: secondHash },
    ])
    expect(result.valid).toBe(true)
    expect(result.checkedCount).toBe(2)
    expect(result.hashedCount).toBe(2)
    expect(result.legacyCount).toBe(0)
    expect(result.tailHash).toBe(secondHash)
  })

  it('レコード改ざん（detail変更）を brokenAt で検出する', async () => {
    const first = baseRecord()
    const firstHash = await computeEntryHash(undefined, first)
    const second = baseRecord({ id: 'audit-2', entityId: 'revision_2', correlationId: 'cid_2' })
    const secondHash = await computeEntryHash(firstHash, second)
    const tampered = { ...second, detail: { revisionId: 'revision_FAKE' } }
    const result = await verifyAuditChain([
      { ...first, entryHash: firstHash },
      { ...tampered, previousHash: firstHash, entryHash: secondHash },
    ])
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(1)
  })

  it('previous_hash の改ざん（チェーン断絶）を検出する', async () => {
    const first = baseRecord()
    const firstHash = await computeEntryHash(undefined, first)
    const second = baseRecord({ id: 'audit-2', correlationId: 'cid_2' })
    const secondHash = await computeEntryHash(firstHash, second)
    const result = await verifyAuditChain([
      { ...first, entryHash: firstHash },
      { ...second, previousHash: 'y'.repeat(64), entryHash: secondHash },
    ])
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(1)
  })

  it('hash 無しのみのレガシーデータは valid=true（検証対象外）として扱う', async () => {
    const result = await verifyAuditChain([baseRecord(), baseRecord({ id: 'audit-2' })])
    expect(result.valid).toBe(true)
    expect(result.hashedCount).toBe(0)
    expect(result.legacyCount).toBe(2)
  })

  it('レガシー→hash 開始の遷移（空起点で再開）を valid として検証する', async () => {
    const legacy = baseRecord()
    const hashed = baseRecord({ id: 'audit-2', correlationId: 'cid_2' })
    const hash = await computeEntryHash(undefined, hashed)
    const result = await verifyAuditChain([
      legacy,
      { ...hashed, previousHash: undefined, entryHash: hash },
    ])
    expect(result.valid).toBe(true)
    expect(result.hashedCount).toBe(1)
    expect(result.legacyCount).toBe(1)
  })
})

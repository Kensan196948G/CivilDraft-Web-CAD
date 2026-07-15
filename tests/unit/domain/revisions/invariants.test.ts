import { describe, expect, it } from 'vitest'
import {
  assertContentMutable,
  assertRevisionNumberIncreases,
  canModifyRevisionContent,
  compareRevisionNumber,
  validateHistoryEntry,
} from '@/domain/revisions/invariants'
import type { RevisionHistoryEntry } from '@/domain/revisions'

describe('canModifyRevisionContent / assertContentMutable — 承認済み上書き防止（§19.2）', () => {
  it('draft / inReview / returned / pendingApproval は内容変更可', () => {
    expect(canModifyRevisionContent('draft')).toBe(true)
    expect(canModifyRevisionContent('inReview')).toBe(true)
    expect(canModifyRevisionContent('returned')).toBe(true)
    expect(canModifyRevisionContent('pendingApproval')).toBe(true)
  })

  it('approved は内容変更不可', () => {
    expect(canModifyRevisionContent('approved')).toBe(false)
    const issue = assertContentMutable('approved')
    expect(issue?.code).toBe('REVISION_CONTENT_IMMUTABLE')
    expect(issue?.message).toContain('承認済み')
  })

  it('obsolete も内容変更不可', () => {
    expect(canModifyRevisionContent('obsolete')).toBe(false)
    expect(assertContentMutable('obsolete')?.code).toBe('REVISION_CONTENT_IMMUTABLE')
  })

  it('変更可能な状態では null（問題なし）', () => {
    expect(assertContentMutable('draft')).toBeNull()
  })
})

describe('compareRevisionNumber — 改訂番号比較', () => {
  it('数値式は整数として比較する（"10" > "9"）', () => {
    expect(compareRevisionNumber('10', '9')).toBeGreaterThan(0)
    expect(compareRevisionNumber('1', '2')).toBeLessThan(0)
    expect(compareRevisionNumber('3', '3')).toBe(0)
  })

  it('英字式は桁数優先で比較する（"AA" > "Z"）', () => {
    expect(compareRevisionNumber('AA', 'Z')).toBeGreaterThan(0)
    expect(compareRevisionNumber('A', 'B')).toBeLessThan(0)
  })
})

describe('assertRevisionNumberIncreases — 改訂番号の単調増加（§19.2）', () => {
  it('増加していれば null', () => {
    expect(assertRevisionNumberIncreases('1', '2')).toBeNull()
    expect(assertRevisionNumberIncreases('A', 'B')).toBeNull()
  })

  it('同値・減少なら error', () => {
    expect(assertRevisionNumberIncreases('2', '2')?.code).toBe('REVISION_NUMBER_NOT_INCREASING')
    expect(assertRevisionNumberIncreases('3', '2')?.code).toBe('REVISION_NUMBER_NOT_INCREASING')
  })
})

describe('validateHistoryEntry — 履歴記録（§19.2）', () => {
  const base: RevisionHistoryEntry = {
    action: 'approve',
    fromStatus: 'pendingApproval',
    toStatus: 'approved',
    actorId: 'user-1',
    actorRole: 'approver',
    timestamp: '2026-07-15T10:00:00.000Z',
  }

  it('必須項目が揃っていれば null', () => {
    expect(validateHistoryEntry(base)).toBeNull()
  })

  it('actorId 空は error', () => {
    expect(validateHistoryEntry({ ...base, actorId: '' })?.code).toBe('REVISION_HISTORY_ACTOR_REQUIRED')
  })

  it('timestamp 空は error', () => {
    expect(validateHistoryEntry({ ...base, timestamp: '' })?.code).toBe('REVISION_HISTORY_TIMESTAMP_REQUIRED')
  })

  it('差戻し（return）はコメント必須', () => {
    const entry: RevisionHistoryEntry = {
      ...base,
      action: 'return',
      fromStatus: 'inReview',
      toStatus: 'returned',
      actorRole: 'reviewer',
    }
    expect(validateHistoryEntry(entry)?.code).toBe('REVISION_HISTORY_COMMENT_REQUIRED')
    expect(validateHistoryEntry({ ...entry, comment: '不備あり' })).toBeNull()
  })
})

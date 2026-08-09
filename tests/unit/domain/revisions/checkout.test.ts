import { describe, expect, it } from 'vitest'
import { acquireCheckout, releaseCheckout, type DrawingCheckout } from '@/domain/revisions/checkout'
import type { DrawingId, RevisionId } from '@/shared/types'

const drawingId = 'd-1' as DrawingId
const revisionId = 'r-1' as RevisionId

const held: DrawingCheckout = {
  drawingId,
  revisionId,
  checkedOutBy: 'user-a',
  checkedOutAt: '2026-08-09T00:00:00.000Z',
  status: 'checkedOut',
}

describe('checkout / チェックイン・アウト', () => {
  it('draft 改訂をチェックアウトできる', () => {
    const result = acquireCheckout(null, {
      drawingId,
      revisionId,
      actorId: 'user-a',
      revisionStatus: 'draft',
      now: '2026-08-09T01:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('checkedOut')
      expect(result.value.checkedOutBy).toBe('user-a')
    }
  })

  it('他ユーザー保有中は取得できない', () => {
    const result = acquireCheckout(held, {
      drawingId,
      revisionId,
      actorId: 'user-b',
      revisionStatus: 'draft',
      now: '2026-08-09T01:00:00.000Z',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CD_CHECKOUT_ALREADY_HELD')
  })

  it('同一利用者による再取得は日時更新で許容する', () => {
    const result = acquireCheckout(held, {
      drawingId,
      revisionId,
      actorId: 'user-a',
      revisionStatus: 'returned',
      now: '2026-08-09T02:00:00.000Z',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.checkedOutAt).toBe('2026-08-09T02:00:00.000Z')
  })

  it('approved 改訂はチェックアウトできない（承認後改変防止）', () => {
    const result = acquireCheckout(null, {
      drawingId,
      revisionId,
      actorId: 'user-a',
      revisionStatus: 'approved',
      now: '2026-08-09T01:00:00.000Z',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CD_CHECKOUT_NOT_EDITABLE')
  })

  it('保有者のみチェックインでき、他ユーザー・未保有はエラー', () => {
    const other = releaseCheckout(held, { actorId: 'user-b', now: '2026-08-09T03:00:00.000Z' })
    expect(other.ok).toBe(false)
    const result = releaseCheckout(held, { actorId: 'user-a', now: '2026-08-09T03:00:00.000Z' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('checkedIn')
      expect(result.value.checkedInAt).toBe('2026-08-09T03:00:00.000Z')
    }
    expect(releaseCheckout(null, { actorId: 'user-a', now: 'x' }).ok).toBe(false)
  })
})

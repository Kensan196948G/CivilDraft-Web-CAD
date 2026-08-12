import { describe, expect, it, vi } from 'vitest'
import {
  fetchFieldRevisionStatus,
  mapRevisionStatusToField,
} from '@/app/pages/fieldRevisionStatus'

describe('mapRevisionStatusToField', () => {
  it.each([
    ['draft', 'draft'],
    ['inReview', 'inReview'],
    ['pendingApproval', 'pendingApproval'],
    ['approved', 'approved'],
    ['returned', 'returned'],
    ['obsolete', 'obsolete'],
  ] as const)('既知 status %s を FieldRevisionStatus %s へ写像する', (input, expected) => {
    expect(mapRevisionStatusToField(input)).toBe(expected)
  })

  it('未知 status は unknown を返す（捏造しない）', () => {
    expect(mapRevisionStatusToField('deleted')).toBe('unknown')
    expect(mapRevisionStatusToField('')).toBe('unknown')
  })
})

describe('fetchFieldRevisionStatus', () => {
  it('取得成功時は status を写像して返す', async () => {
    const getRevision = vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 'rev-1',
        drawingId: 'd-1',
        revisionNumber: 'R1',
        status: 'approved',
        contentVersion: 1,
        contentChecksum: 'sha256:x',
      },
    }))
    await expect(fetchFieldRevisionStatus('rev-1', getRevision)).resolves.toBe('approved')
    expect(getRevision).toHaveBeenCalledWith('rev-1')
  })

  it('取得失敗（error Result）は unknown を返す', async () => {
    const getRevision = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'CD-AUTH-001', severity: 'error' as const, message: '認証情報がありません' },
    }))
    await expect(fetchFieldRevisionStatus('rev-1', getRevision)).resolves.toBe('unknown')
  })

  it('例外が発生しても unknown を返す', async () => {
    const getRevision = vi.fn(async () => {
      throw new Error('network error')
    })
    await expect(fetchFieldRevisionStatus('rev-1', getRevision)).resolves.toBe('unknown')
  })

  it('API が未知 status を返した場合は unknown を返す', async () => {
    const getRevision = vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 'rev-1',
        drawingId: 'd-1',
        revisionNumber: 'R1',
        status: 'unknown-state',
        contentVersion: 1,
        contentChecksum: 'sha256:x',
      },
    }))
    await expect(fetchFieldRevisionStatus('rev-1', getRevision)).resolves.toBe('unknown')
  })
})

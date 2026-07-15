import { describe, expect, it } from 'vitest'
import { defaultCreationContext } from '@/domain/geometry/geometryFactory'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type { GeometryId } from '@/shared/types'

describe('defaultCreationContext', () => {
  it('newIdはUUID v4形式の一意なIDを発番する', () => {
    const a = defaultCreationContext.newId()
    const b = defaultCreationContext.newId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })

  it('nowはISO 8601形式のタイムスタンプを返す', () => {
    const ts = defaultCreationContext.now()
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(ts).getTime()).not.toBeNaN()
  })

  it('テスト用に決定的なコンテキストを注入できる（インターフェース検証）', () => {
    let seq = 0
    const deterministic: GeometryCreationContext = {
      newId: () => `test-${++seq}` as GeometryId,
      now: () => '2026-07-15T00:00:00.000Z',
    }
    expect(deterministic.newId()).toBe('test-1')
    expect(deterministic.newId()).toBe('test-2')
    expect(deterministic.now()).toBe('2026-07-15T00:00:00.000Z')
  })
})

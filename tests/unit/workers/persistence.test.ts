import { describe, expect, it } from 'vitest'
import {
  inspectProductionPersistenceReadiness,
  resolvePersistenceMode,
} from '@/workers/persistence'

describe('Workers persistence readiness', () => {
  it('明示指定のみ受け付け、未設定・不正値は undefined を返す（fail-closed）', () => {
    expect(resolvePersistenceMode(undefined)).toBeUndefined()
    expect(resolvePersistenceMode('memory')).toBe('memory')
    expect(resolvePersistenceMode('neon-r2')).toBe('neon-r2')
    expect(resolvePersistenceMode('production')).toBeUndefined()
    expect(resolvePersistenceMode('Neon-R2')).toBeUndefined()
    expect(resolvePersistenceMode('neon_r2')).toBeUndefined()
  })

  it('neon-r2 本番接続に必要なbinding不足を列挙する（R2は対象外）', () => {
    expect(inspectProductionPersistenceReadiness({})).toEqual({
      ready: false,
      missingBindings: ['CIVILDRAFT_NEON_CONNECTION'],
    })
  })

  it('必要bindingが揃っていればreadyを返す', () => {
    expect(
      inspectProductionPersistenceReadiness({
        CIVILDRAFT_NEON_CONNECTION: {},
        CIVILDRAFT_R2_BUCKET: {},
      }),
    ).toEqual({ ready: true, missingBindings: [] })
  })

  it('R2 bindingがなくてもNeon接続さえあればreadyを返す（R2は任意・共有ストレージ用途のみ）', () => {
    expect(
      inspectProductionPersistenceReadiness({
        CIVILDRAFT_NEON_CONNECTION: {},
      }),
    ).toEqual({ ready: true, missingBindings: [] })
  })
})

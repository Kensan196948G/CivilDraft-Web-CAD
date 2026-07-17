import { describe, expect, it } from 'vitest'
import {
  inspectProductionPersistenceReadiness,
  resolvePersistenceMode,
} from '@/workers/persistence'

describe('Workers persistence readiness', () => {
  it('未知の値は安全に memory モードへ正規化する', () => {
    expect(resolvePersistenceMode(undefined)).toBe('memory')
    expect(resolvePersistenceMode('memory')).toBe('memory')
    expect(resolvePersistenceMode('neon-r2')).toBe('neon-r2')
    expect(resolvePersistenceMode('production')).toBe('memory')
  })

  it('neon-r2 本番接続に必要なbinding不足を列挙する', () => {
    expect(inspectProductionPersistenceReadiness({})).toEqual({
      ready: false,
      missingBindings: ['CIVILDRAFT_NEON_CONNECTION', 'CIVILDRAFT_R2_BUCKET'],
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
})

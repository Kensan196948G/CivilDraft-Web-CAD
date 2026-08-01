import { describe, expect, it, vi } from 'vitest'
import { runHealthCheck, validateSmokeResults } from '../../../scripts/health-check.mjs'

function okResults() {
  return {
    checkedAt: '2026-08-01T00:00:00.000Z',
    baseUrl: 'https://example.test',
    spa: { status: 200, headers: { 'x-content-type-options': 'nosniff' } },
    api: { status: 401, errorCode: 'CD-AUTH-001' },
  }
}

describe('health-check.mjs（本番合成監視 / SLO草案）', () => {
  it('正常なスモーク結果は問題なしと判定する', () => {
    expect(validateSmokeResults(okResults())).toEqual([])
  })

  it('SPA ステータス・ヘッダー・API fail-closed の各異常を検出する', () => {
    const base = okResults()
    expect(validateSmokeResults({ ...base, spa: { ...base.spa, status: 503 } })).toHaveLength(1)
    expect(
      validateSmokeResults({ ...base, spa: { ...base.spa, headers: {} } }),
    ).toHaveLength(1)
    expect(validateSmokeResults({ ...base, api: { ...base.api, status: 200 } })).toHaveLength(1)
    expect(
      validateSmokeResults({ ...base, api: { ...base.api, errorCode: 'CD-SYS-002' } }),
    ).toHaveLength(1)
    expect(
      validateSmokeResults({ ...base, api: { ...base.api, status: 500, errorCode: undefined } }),
    ).toHaveLength(2)
  })

  it('runHealthCheck は fetch の応答から SPA/API 結果を組み立てる', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/')) {
        return new Response(
          JSON.stringify({ error: { code: 'CD-AUTH-001', message: '認証情報がありません' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('<!doctype html>', {
        status: 200,
        headers: { 'x-content-type-options': 'nosniff' },
      })
    })
    const { results, issues } = await runHealthCheck({ baseUrl: 'https://example.test', fetchImpl: fetchMock })
    expect(issues).toEqual([])
    expect(results.spa.status).toBe(200)
    expect(results.api.status).toBe(401)
    expect(results.api.errorCode).toBe('CD-AUTH-001')
  })
})

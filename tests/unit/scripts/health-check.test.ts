import { describe, expect, it, vi } from 'vitest'
import { runHealthCheck, validateSmokeResults } from '../../../scripts/health-check.mjs'

function okResults() {
  return {
    checkedAt: '2026-08-01T00:00:00.000Z',
    baseUrl: 'https://example.test',
    workersDevUrl: 'https://example.workers.dev',
    access: {
      status: 302,
      location: 'https://winter-lake-f4c9.cloudflareaccess.com/cdn-cgi/access/login/example.test',
    },
    spa: { status: 200, headers: { 'x-content-type-options': 'nosniff' } },
    api: { status: 401, errorCode: 'CD-AUTH-001' },
  }
}

describe('health-check.mjs（本番合成監視 / SLO草案）', () => {
  it('正常なスモーク結果は問題なしと判定する', () => {
    expect(validateSmokeResults(okResults())).toEqual([])
  })

  it('Access・SPA・API の各異常を検出する', () => {
    const base = okResults()
    expect(validateSmokeResults({ ...base, access: { status: 503, location: undefined } })).toHaveLength(1)
    expect(
      validateSmokeResults({
        ...base,
        access: { status: 302, location: 'https://example.com/other' },
      }),
    ).toHaveLength(1)
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
      if (url.includes('cloudflareaccess.com')) return new Response()
      if (url.includes('/api/')) {
        return new Response(
          JSON.stringify({ error: { code: 'CD-AUTH-001', message: '認証情報がありません' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url === 'https://example.test/?hc=0' || url.startsWith('https://example.test/?hc=')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://winter-lake-f4c9.cloudflareaccess.com/cdn-cgi/access/login/example.test' },
        })
      }
      return new Response('<!doctype html>', {
        status: 200,
        headers: { 'x-content-type-options': 'nosniff' },
      })
    })
    const { results, issues } = await runHealthCheck({
      baseUrl: 'https://example.test',
      workersDevUrl: 'https://example.workers.dev',
      fetchImpl: fetchMock,
    })
    expect(issues).toEqual([])
    expect(results.access.status).toBe(302)
    expect(results.access.location).toContain('cloudflareaccess.com')
    expect(results.spa.status).toBe(200)
    expect(results.api.status).toBe(401)
    expect(results.api.errorCode).toBe('CD-AUTH-001')
  })
})

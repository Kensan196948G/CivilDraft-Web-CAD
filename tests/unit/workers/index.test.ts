import { describe, expect, it } from 'vitest'
import worker, {
  API_ROUTES,
  handleRequest,
  matchRoute,
  type ExecutionContext,
  type WorkerEnv,
} from '@/workers/index'

const AUTH_HEADER = 'Cf-Access-Jwt-Assertion'
const CORRELATION_HEADER = 'X-Correlation-Id'

/** {param} を具体値に置換した実パスを作る。 */
function concretePath(template: string): string {
  return template.replace(/\{[^}]+\}/g, 'sample-id')
}

function authedRequest(method: string, path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.example.com${path}`, {
    method,
    headers: { [AUTH_HEADER]: 'jwt-token', ...headers },
  })
}

interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string }
  readonly correlationId: string
}

const noopCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
}
const emptyEnv: WorkerEnv = {}

describe('matchRoute', () => {
  it('パラメータ付き経路に一致する', () => {
    const matched = matchRoute('GET', '/api/v1/projects/abc-123')
    expect(matched?.template).toBe('/api/v1/projects/{projectId}')
  })

  it('メソッド不一致は一致しない', () => {
    expect(matchRoute('DELETE', '/api/v1/projects')).toBeUndefined()
  })

  it('未知パスは一致しない', () => {
    expect(matchRoute('GET', '/api/v1/unknown')).toBeUndefined()
  })
})

describe('§25.1 共通ヘッダー検証', () => {
  it('Cf-Access-Jwt-Assertion が無いと 401 CD-AUTH-001', async () => {
    const req = new Request('https://api.example.com/api/v1/projects', { method: 'GET' })
    const res = await handleRequest(req)
    expect(res.status).toBe(401)
    const body = (await res.json()) as ApiErrorBody
    expect(body.error.code).toBe('CD-AUTH-001')
    expect(typeof body.correlationId).toBe('string')
    expect(body.correlationId.length).toBeGreaterThan(0)
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  it('X-Correlation-Id を指定するとそのまま応答へ伝播する', async () => {
    const res = await handleRequest(
      authedRequest('GET', '/api/v1/projects', { [CORRELATION_HEADER]: 'corr-fixed-1' }),
    )
    expect(res.headers.get(CORRELATION_HEADER)).toBe('corr-fixed-1')
    const body = (await res.json()) as ApiErrorBody
    expect(body.correlationId).toBe('corr-fixed-1')
  })
})

describe('§25.2 ルーティング（スケルトンは全て 501）', () => {
  it('エンドポイント一覧が仕様の18経路を網羅する', () => {
    expect(API_ROUTES).toHaveLength(18)
  })

  it.each(API_ROUTES.map((r) => [r.method, r.template] as const))(
    '%s %s は 501 Not Implemented を返す',
    async (method, template) => {
      const res = await handleRequest(authedRequest(method, concretePath(template)))
      expect(res.status).toBe(501)
      const body = (await res.json()) as ApiErrorBody
      expect(body.error.code).toBe('CD-SYS-001')
      expect(body.error.message).toContain('未実装')
      expect(typeof body.correlationId).toBe('string')
      expect(body.correlationId.length).toBeGreaterThan(0)
    },
  )
})

describe('未知エンドポイント', () => {
  it('一致しない経路は 404 を返す', async () => {
    const res = await handleRequest(authedRequest('GET', '/api/v1/does-not-exist'))
    expect(res.status).toBe(404)
    const body = (await res.json()) as ApiErrorBody
    expect(body.error.code).toBe('CD-SYS-001')
  })
})

describe('default export (module worker)', () => {
  it('fetch(request, env, ctx) が handleRequest と同じ 501 を返す', async () => {
    const res = await worker.fetch(authedRequest('GET', '/api/v1/projects'), emptyEnv, noopCtx)
    expect(res.status).toBe(501)
  })
})

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
    await expect(res.json()).resolves.toBeDefined()
  })
})

describe('§25.2 ルーティング', () => {
  it('エンドポイント一覧が仕様の18経路を網羅する', () => {
    expect(API_ROUTES).toHaveLength(18)
  })

  it.each(API_ROUTES.map((r) => [r.method, r.template] as const))(
    '%s %s は認証済みリクエストにJSON応答を返す',
    async (method, template) => {
      const path = concretePath(template)
      const request =
        method === 'POST' || method === 'PATCH' || method === 'PUT'
          ? new Request(`https://api.example.com${path}`, {
              method,
              headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
              body: JSON.stringify(bodyFor(template)),
            })
          : authedRequest(method, path)
      const res = await handleRequest(request)
      expect(res.headers.get('Content-Type')).toContain('application/json')
      expect(res.status).not.toBe(501)
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
  it('fetch(request, env, ctx) が handleRequest と同じJSONを返す', async () => {
    const res = await worker.fetch(authedRequest('GET', '/api/v1/projects'), emptyEnv, noopCtx)
    expect(res.status).toBe(200)
  })
})

describe('API動作', () => {
  it('案件作成→図面作成→内容更新→ワークフロー→出力→監査検索が動く', async () => {
    const projectRes = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectNumber: 'PRJ-T', name: 'テスト案件', clientName: 'テスト発注者' }),
      }),
    )
    expect(projectRes.status).toBe(201)
    const projectBody = (await projectRes.json()) as { project: { id: string } }

    const drawingRes = await handleRequest(
      new Request(`https://api.example.com/api/v1/projects/${projectBody.project.id}/drawings`, {
        method: 'POST',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ drawingNumber: 'DWG-T', name: 'テスト図面' }),
      }),
    )
    expect(drawingRes.status).toBe(201)
    const drawingBody = (await drawingRes.json()) as { drawing: { id: string }; revision: { id: string } }

    const contentRes = await handleRequest(
      new Request(`https://api.example.com/api/v1/revisions/${drawingBody.revision.id}/content`, {
        method: 'PUT',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, geometries: [], layers: [] }),
      }),
    )
    expect(contentRes.status).toBe(200)

    const workflowRes = await handleRequest(
      new Request(`https://api.example.com/api/v1/revisions/${drawingBody.revision.id}/workflow-actions`, {
        method: 'POST',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submitReview' }),
      }),
    )
    expect(workflowRes.status).toBe(200)

    const exportRes = await handleRequest(
      new Request(`https://api.example.com/api/v1/revisions/${drawingBody.revision.id}/exports`, {
        method: 'POST',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'pdf' }),
      }),
    )
    expect(exportRes.status).toBe(201)

    const auditRes = await handleRequest(authedRequest('GET', '/api/v1/audit-logs'))
    expect(auditRes.status).toBe(200)
    const auditBody = (await auditRes.json()) as { auditLogs: unknown[] }
    expect(auditBody.auditLogs.length).toBeGreaterThan(0)
  })
})

describe('API障害系・例外処理', () => {
  it('JSONが壊れているPOSTは未捕捉例外にせず 400 CD-REQ-001 を返す', async () => {
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json', [CORRELATION_HEADER]: 'bad-json-1' },
        body: '{"projectNumber":',
      }),
    )
    expect(res.status).toBe(400)
    expect(res.headers.get(CORRELATION_HEADER)).toBe('bad-json-1')
    const body = (await res.json()) as ApiErrorBody
    expect(body.error.code).toBe('CD-REQ-001')
    expect(body.error.message).toContain('JSON')
  })

  it('承認済み改訂の内容更新は 409 CD-SYS-002 として拒否する', async () => {
    const projectRes = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectNumber: 'PRJ-CONFLICT', name: '競合案件' }),
      }),
    )
    const projectBody = (await projectRes.json()) as { project: { id: string } }
    const drawingRes = await handleRequest(
      new Request(`https://api.example.com/api/v1/projects/${projectBody.project.id}/drawings`, {
        method: 'POST',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ drawingNumber: 'DWG-CONFLICT', name: '競合図面' }),
      }),
    )
    const drawingBody = (await drawingRes.json()) as { revision: { id: string } }
    const revisionId = drawingBody.revision.id

    for (const action of ['submitReview', 'completeReview', 'approve']) {
      const workflowRes = await handleRequest(
        new Request(`https://api.example.com/api/v1/revisions/${revisionId}/workflow-actions`, {
          method: 'POST',
          headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }),
      )
      expect(workflowRes.status).toBe(200)
    }

    const res = await handleRequest(
      new Request(`https://api.example.com/api/v1/revisions/${revisionId}/content`, {
        method: 'PUT',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, geometries: [{ id: 'should-not-write' }], layers: [] }),
      }),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as ApiErrorBody
    expect(body.error.code).toBe('CD-SYS-002')
  })

  it('未知の出力形式は 400 CD-REQ-001 を返し、出力ジョブを作らない', async () => {
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/revisions/revision-demo-1/exports', {
        method: 'POST',
        headers: { [AUTH_HEADER]: 'jwt-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'xlsx' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiErrorBody
    expect(body.error.code).toBe('CD-REQ-001')
    expect(body.error.message).toContain('pdf/dxf/csv')
  })
})

function bodyFor(template: string): Record<string, unknown> {
  if (template === '/api/v1/projects') return { projectNumber: 'PRJ-API', name: 'API案件' }
  if (template.endsWith('/drawings')) return { drawingNumber: 'DWG-API', name: 'API図面' }
  if (template.endsWith('/content')) return { schemaVersion: 1, geometries: [], layers: [] }
  if (template.endsWith('/quantities')) return { quantities: [] }
  if (template.endsWith('/workflow-actions')) return { action: 'submitReview' }
  if (template.endsWith('/exports')) return { format: 'pdf' }
  return { name: '更新済み' }
}

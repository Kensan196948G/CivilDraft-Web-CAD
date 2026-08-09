import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimitState } from '@/workers/rateLimit'
import worker, {
  API_ROUTES,
  createMemoryStore,
  handleRequest,
  matchRoute,
  type ExecutionContext,
  type WorkerEnv,
} from '@/workers/index'

const AUTH_HEADER = 'Cf-Access-Jwt-Assertion'
const USER_HEADER = 'Cf-Access-Authenticated-User-Email'
const CORRELATION_HEADER = 'X-Correlation-Id'

function concretePath(template: string): string {
  return template.replace(/\{[^}]+\}/g, 'sample-id')
}

function authedRequest(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://api.example.com${path}`, {
    method,
    headers: {
      [AUTH_HEADER]: 'jwt-token',
      [USER_HEADER]: 'engineer@example.test',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function authedRequestAs(user: string, method: string, path: string, body?: unknown): Request {
  return authedRequest(method, path, body, { [USER_HEADER]: user })
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string }
  readonly correlationId: string
}

interface ProjectBody {
  readonly project: {
    readonly id: string
    readonly projectNumber: string
    readonly name: string
    readonly clientName?: string
    readonly status: string
    readonly createdBy: string
    readonly updatedBy: string
    readonly version: number
  }
}

interface DrawingBody {
  readonly drawing: {
    readonly id: string
    readonly projectId: string
    readonly drawingNumber: string
    readonly name: string
    readonly drawingType: string
    readonly settings: unknown
    readonly status: string
    readonly version: number
  }
}

interface RevisionBody {
  readonly revision: { readonly id: string; readonly drawingId: string; readonly contentVersion: number }
}

interface ContentBody {
  readonly content: {
    readonly revisionId: string
    readonly content: unknown
    readonly contentVersion: number
    readonly contentChecksum: string
  }
}

interface QuantitiesBody {
  readonly quantities: {
    readonly revisionId: string
    readonly quantityVersion: number
    readonly items: readonly { readonly id: string; readonly status: string }[]
  }
}

interface WorkflowActionBody {
  readonly revision: { readonly id: string; readonly status: string; readonly contentChecksum: string }
  readonly workflowAction: { readonly action: string; readonly fromStatus: string; readonly toStatus: string }
}

interface ExportJobBody {
  readonly exportJob: {
    readonly id: string
    readonly revisionId: string
    readonly format: string
    readonly status: string
    readonly objectProvider: string
    readonly objectKey?: string
    readonly contentChecksum?: string
  }
}

interface AuditLogsBody {
  readonly auditLogs: readonly { readonly eventName: string; readonly entityId?: string }[]
}

const noopCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
}

function testEnv(): WorkerEnv {
  return { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
}

beforeEach(() => {
  resetRateLimitState()
})

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
    const res = await handleRequest(req, testEnv())
    expect(res.status).toBe(401)
    const body = await json<ApiErrorBody>(res)
    expect(body.error.code).toBe('CD-AUTH-001')
    expect(typeof body.correlationId).toBe('string')
    expect(body.correlationId.length).toBeGreaterThan(0)
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  it('X-Correlation-Id を指定するとそのまま応答へ伝播する', async () => {
    const res = await handleRequest(
      authedRequest('GET', '/api/v1/projects', undefined, {
        [CORRELATION_HEADER]: 'corr-fixed-1',
      }),
      testEnv(),
    )
    expect(res.headers.get(CORRELATION_HEADER)).toBe('corr-fixed-1')
    const body = await json<{ readonly correlationId?: string; readonly projects: unknown[] }>(res)
    expect(body.projects).toEqual([])
  })

  it('neon-r2 モードで永続化アダプタ未接続ならインメモリにフォールバックせず 503 を返す', async () => {
    const res = await handleRequest(authedRequest('GET', '/api/v1/projects'), {
      CIVILDRAFT_API_MODE: 'neon-r2',
    })
    expect(res.status).toBe(503)
    const body = await json<ApiErrorBody>(res)
    expect(body.error.code).toBe('CD-SYS-002')
    expect(body.error.message).toContain('共有保存サービス')
    expect(body.error.message).not.toMatch(/CIVILDRAFT_|NEON|binding/i)
  })

  it('CIVILDRAFT_API_MODE 未設定・タイポ時はインメモリへ無警告フォールバックせず 503 で停止する', async () => {
    for (const env of [{}, { CIVILDRAFT_API_MODE: 'Neon-R2' }, { CIVILDRAFT_API_MODE: 'prod' }]) {
      const res = await handleRequest(authedRequest('GET', '/api/v1/projects'), env)
      expect(res.status).toBe(503)
      const body = await json<ApiErrorBody>(res)
      expect(body.error.code).toBe('CD-SYS-002')
      expect(body.error.message).toContain('共有保存サービス')
      expect(body.error.message).not.toMatch(/CIVILDRAFT_|NEON|binding/i)
    }
  })

  it('neon-r2 モードで全ルート（読み書き）が接続不能時に 503 fail-closed（#66 配線後も無言フォールバックしない）', async () => {
    // #66 で書き込み系の一時停止ゲート（isPersistedWriteRoute）は撤去済み。
    // 撤去後も「アダプタ未接続で成功を偽装しない」性質は維持されることを、
    // 23 経路全数で確認する（『一時停止』応答が残っていないことも見る）。
    // ※19経路目は GET /api/v1/audit-logs/verify（Issue #61 監査チェーン検証）。
    //   #119 でメンバー管理 4 経路を追加（計 23 経路）。
    expect(API_ROUTES).toHaveLength(25)

    for (const r of API_ROUTES) {
      const res = await handleRequest(
        authedRequest(r.method, concretePath(r.template), r.method === 'GET' ? undefined : {
          schemaVersion: 1,
          content: {},
          items: [],
          action: 'submitReview',
          format: 'pdf',
        }),
        {
          CIVILDRAFT_API_MODE: 'neon-r2',
          CIVILDRAFT_NEON_CONNECTION: 'test-neon-connection-placeholder',
        },
      )
      expect(res.status, `${r.method} ${r.template}`).toBe(503)
      const body = await json<ApiErrorBody>(res)
      expect(body.error.code).toBe('CD-SYS-002')
      expect(body.error.message).not.toContain('一時停止')
    }
  })
})

describe('§25.2 ルーティング', () => {
  it('エンドポイント一覧が仕様の22経路+監査チェーン検証（計23経路）を網羅する', () => {
    expect(API_ROUTES).toHaveLength(25)
    expect(API_ROUTES.some((r) => r.template === '/api/v1/audit-logs/verify')).toBe(true)
    expect(API_ROUTES.some((r) => r.template === '/api/v1/projects/{projectId}/members')).toBe(true)
    expect(API_ROUTES.some((r) => r.template === '/api/v1/projects/{projectId}/members/{userId}')).toBe(true)
  })

  it('P0縦線: Project作成 → Drawing作成 → Revision作成 → Content/数量保存 → 承認 → Export → Audit記録', async () => {
    const env = testEnv()

    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', {
        projectNumber: 'P-2026-001',
        name: '国道245号 道路拡幅工事',
        clientName: 'Mirai建設',
      }),
      env,
    )
    expect(projectRes.status).toBe(201)
    const projectBody = await json<ProjectBody>(projectRes)
    expect(projectBody.project.projectNumber).toBe('P-2026-001')
    expect(projectBody.project.createdBy).toBe('engineer@example.test')

    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'DWG-001',
        name: '仮設計画平面図',
        drawingType: 'temporary-yard-plan',
        settings: { unit: 'mm', paper: 'A3' },
      }),
      env,
    )
    expect(drawingRes.status).toBe(201)
    const drawingBody = await json<DrawingBody>(drawingRes)
    expect(drawingBody.drawing.projectId).toBe(projectBody.project.id)

    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingBody.drawing.id}/revisions`, {
        revisionNumber: '1',
        changeSummary: '初版作成',
      }),
      env,
    )
    expect(revisionRes.status).toBe(201)
    const revisionBody = await json<RevisionBody>(revisionRes)
    expect(revisionBody.revision.drawingId).toBe(drawingBody.drawing.id)

    const content = {
      geometries: [{ id: 'g-1', type: 'line', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } }],
      layers: [{ id: 'layer-main', name: '主線' }],
    }
    const putContentRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        content,
      }),
      env,
    )
    expect(putContentRes.status).toBe(200)
    const putContentBody = await json<ContentBody>(putContentRes)
    expect(putContentBody.content.contentVersion).toBe(1)
    expect(putContentBody.content.contentChecksum).toMatch(/^sha256:/)

    const getContentRes = await handleRequest(
      authedRequest('GET', `/api/v1/revisions/${revisionBody.revision.id}/content`),
      env,
    )
    expect(getContentRes.status).toBe(200)
    const getContentBody = await json<ContentBody>(getContentRes)
    expect(getContentBody.content.content).toEqual(content)

    const quantityItem = {
      id: 'qty-1',
      groupKey: 'earthwork|m3',
      method: 'volume',
      unit: 'm3',
      rawValue: 12.345,
      roundedValue: 12.35,
      status: 'valid',
      sources: [{ geometryId: 'g-1', contributionRaw: 12.345 }],
    }
    const putQuantitiesRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/quantities`, {
        items: [quantityItem],
      }),
      env,
    )
    expect(putQuantitiesRes.status).toBe(200)
    const putQuantitiesBody = await json<QuantitiesBody>(putQuantitiesRes)
    expect(putQuantitiesBody.quantities.quantityVersion).toBe(1)
    expect(putQuantitiesBody.quantities.items[0]?.id).toBe('qty-1')

    const submitRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/workflow-actions`, {
        action: 'submitReview',
        mandatoryChecksPassed: true,
      }),
      env,
    )
    expect(submitRes.status).toBe(200)
    expect((await json<WorkflowActionBody>(submitRes)).revision.status).toBe('inReview')

    const completeReviewRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/workflow-actions`, {
        action: 'completeReview',
        reviewResultRecorded: true,
      }),
      env,
    )
    expect(completeReviewRes.status).toBe(200)
    expect((await json<WorkflowActionBody>(completeReviewRes)).revision.status).toBe('pendingApproval')

    const approveRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/workflow-actions`, {
        action: 'approve',
        contentChecksum: getContentBody.content.contentChecksum,
      }),
      env,
    )
    expect(approveRes.status).toBe(200)
    const approveBody = await json<WorkflowActionBody>(approveRes)
    expect(approveBody.workflowAction).toMatchObject({
      action: 'approve',
      fromStatus: 'pendingApproval',
      toStatus: 'approved',
    })

    const exportRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/exports`, {
        format: 'pdf',
      }),
      env,
    )
    expect(exportRes.status).toBe(201)
    const exportBody = await json<ExportJobBody>(exportRes)
    expect(exportBody.exportJob).toMatchObject({
      revisionId: revisionBody.revision.id,
      format: 'pdf',
      status: 'completed',
      objectProvider: 'unassigned',
      contentChecksum: getContentBody.content.contentChecksum,
    })
    expect(exportBody.exportJob.objectKey).toMatch(/\.pdf$/)

    const getExportRes = await handleRequest(
      authedRequest('GET', `/api/v1/exports/${exportBody.exportJob.id}`),
      env,
    )
    expect(getExportRes.status).toBe(200)
    expect((await json<ExportJobBody>(getExportRes)).exportJob.id).toBe(exportBody.exportJob.id)

    const auditRes = await handleRequest(
      authedRequest('GET', `/api/v1/audit-logs?projectId=${projectBody.project.id}`),
      env,
    )
    expect(auditRes.status).toBe(200)
    const auditBody = await json<AuditLogsBody>(auditRes)
    expect(auditBody.auditLogs.map((entry) => entry.eventName)).toEqual([
      'project.created',
      'drawing.created',
      'revision.created',
      'revision.content.updated',
      'revision.quantities.updated',
      'workflow.submitReview',
      'workflow.completeReview',
      'workflow.approve',
      'export.created',
    ])
  })

  it('案件一覧は自分がメンバーの案件だけを返し、非メンバーの参照は 403', async () => {
    const env = testEnv()
    const projectRes = await handleRequest(
      authedRequestAs('owner@example.test', 'POST', '/api/v1/projects', {
        projectNumber: 'P-PRIVATE',
        name: '非公開案件',
      }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)

    const outsiderListRes = await handleRequest(
      authedRequestAs('outsider@example.test', 'GET', '/api/v1/projects'),
      env,
    )
    expect(outsiderListRes.status).toBe(200)
    expect(await json<{ readonly projects: unknown[] }>(outsiderListRes)).toEqual({
      projects: [],
      pagination: { limit: 50, offset: 0, total: 0 },
    })

    const outsiderGetRes = await handleRequest(
      authedRequestAs('outsider@example.test', 'GET', `/api/v1/projects/${projectBody.project.id}`),
      env,
    )
    expect(outsiderGetRes.status).toBe(403)
    const errorBody = await json<ApiErrorBody>(outsiderGetRes)
    expect(errorBody.error.code).toBe('CD-AUTH-002')
  })

  it('案件更新は manager 権限と expectedVersion を要求し、重複番号を拒否する', async () => {
    const env = testEnv()
    const projectRes = await handleRequest(
      authedRequestAs('owner@example.test', 'POST', '/api/v1/projects', {
        projectNumber: 'P-PATCH-1',
        name: '更新前案件',
      }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)
    await handleRequest(
      authedRequestAs('other@example.test', 'POST', '/api/v1/projects', {
        projectNumber: 'P-PATCH-OTHER',
        name: '別案件',
      }),
      env,
    )

    const noVersionRes = await handleRequest(
      authedRequestAs('owner@example.test', 'PATCH', `/api/v1/projects/${projectBody.project.id}`, {
        name: '更新後案件',
      }),
      env,
    )
    expect(noVersionRes.status).toBe(428)

    const staleVersionRes = await handleRequest(
      authedRequestAs('owner@example.test', 'PATCH', `/api/v1/projects/${projectBody.project.id}`, {
        expectedVersion: 99,
        name: '更新後案件',
      }),
      env,
    )
    expect(staleVersionRes.status).toBe(409)

    const duplicateNumberRes = await handleRequest(
      authedRequestAs('owner@example.test', 'PATCH', `/api/v1/projects/${projectBody.project.id}`, {
        expectedVersion: 1,
        projectNumber: 'P-PATCH-OTHER',
      }),
      env,
    )
    expect(duplicateNumberRes.status).toBe(409)

    const updateRes = await handleRequest(
      authedRequestAs('owner@example.test', 'PATCH', `/api/v1/projects/${projectBody.project.id}`, {
        expectedVersion: 1,
        projectNumber: 'P-PATCH-UPDATED',
        name: '更新後案件',
        clientName: '更新後発注者',
        status: 'archived',
      }),
      env,
    )
    expect(updateRes.status).toBe(200)
    const updatedBody = await json<ProjectBody>(updateRes)
    expect(updatedBody.project).toMatchObject({
      projectNumber: 'P-PATCH-UPDATED',
      name: '更新後案件',
      clientName: '更新後発注者',
      status: 'archived',
      updatedBy: 'owner@example.test',
      version: 2,
    })

    const auditRes = await handleRequest(
      authedRequestAs('owner@example.test', 'GET', `/api/v1/audit-logs?projectId=${projectBody.project.id}`),
      env,
    )
    expect((await json<AuditLogsBody>(auditRes)).auditLogs.map((entry) => entry.eventName)).toContain(
      'project.updated',
    )
  })

  it('図面メタデータ更新は expectedVersion とプロジェクト内番号重複を検査する', async () => {
    const env = testEnv()
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-DRAW-PATCH', name: '図面更新案件' }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'D-PATCH-1',
        name: '更新前図面',
      }),
      env,
    )
    const drawingBody = await json<DrawingBody>(drawingRes)
    await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'D-PATCH-OTHER',
        name: '別図面',
      }),
      env,
    )

    const noVersionRes = await handleRequest(
      authedRequest('PATCH', `/api/v1/drawings/${drawingBody.drawing.id}`, {
        name: '更新後図面',
      }),
      env,
    )
    expect(noVersionRes.status).toBe(428)

    const duplicateNumberRes = await handleRequest(
      authedRequest('PATCH', `/api/v1/drawings/${drawingBody.drawing.id}`, {
        expectedVersion: 1,
        drawingNumber: 'D-PATCH-OTHER',
      }),
      env,
    )
    expect(duplicateNumberRes.status).toBe(409)

    const updateRes = await handleRequest(
      authedRequest('PATCH', `/api/v1/drawings/${drawingBody.drawing.id}?expectedVersion=1`, {
        drawingNumber: 'D-PATCH-UPDATED',
        name: '更新後図面',
        drawingType: 'cross-section',
        settings: { unit: 'mm', paper: 'A1' },
        status: 'archived',
      }),
      env,
    )
    expect(updateRes.status).toBe(200)
    const updatedBody = await json<DrawingBody>(updateRes)
    expect(updatedBody.drawing).toMatchObject({
      drawingNumber: 'D-PATCH-UPDATED',
      name: '更新後図面',
      drawingType: 'cross-section',
      settings: { unit: 'mm', paper: 'A1' },
      status: 'archived',
      version: 2,
    })
  })

  it('既存内容の再更新には expectedContentVersion が必要で、不一致なら 409', async () => {
    const env = testEnv()
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-LOCK', name: '競合試験' }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'D-LOCK',
        name: '競合図面',
      }),
      env,
    )
    const drawingBody = await json<DrawingBody>(drawingRes)
    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingBody.drawing.id}/revisions`, {
        revisionNumber: '1',
        changeSummary: '初版',
      }),
      env,
    )
    const revisionBody = await json<RevisionBody>(revisionRes)

    const firstPutRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        content: { geometries: [] },
      }),
      env,
    )
    expect(firstPutRes.status).toBe(200)

    const missingVersionRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        content: { geometries: [{ id: 'new' }] },
      }),
      env,
    )
    expect(missingVersionRes.status).toBe(428)
    expect((await json<ApiErrorBody>(missingVersionRes)).error.code).toBe('CD-CONFLICT-002')

    const staleVersionRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        expectedContentVersion: 99,
        content: { geometries: [{ id: 'stale' }] },
      }),
      env,
    )
    expect(staleVersionRes.status).toBe(409)

    const secondPutRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        expectedContentVersion: 1,
        content: { geometries: [{ id: 'ok' }] },
      }),
      env,
    )
    expect(secondPutRes.status).toBe(200)
    expect((await json<ContentBody>(secondPutRes)).content.contentVersion).toBe(2)
  })

  it('同一 expectedContentVersion の同時PUTは片方だけ成功する（TOCTOU回帰・#50）', async () => {
    const env = testEnv()
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-RACE', name: '同時更新試験' }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'D-RACE',
        name: '同時更新図面',
      }),
      env,
    )
    const drawingBody = await json<DrawingBody>(drawingRes)
    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingBody.drawing.id}/revisions`, {
        revisionNumber: '1',
        changeSummary: '初版',
      }),
      env,
    )
    const revisionBody = await json<RevisionBody>(revisionRes)
    const firstPutRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        content: { geometries: [] },
      }),
      env,
    )
    expect(firstPutRes.status).toBe(200)

    // checksum計算のawaitがisolateを譲るため、修正前は両方の検査が書き込み前に
    // 通過して二重に成功していた（contentChecksum省略でawait経路を強制する）
    const concurrent = await Promise.all(
      ['a', 'b'].map((marker) =>
        handleRequest(
          authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
            schemaVersion: 1,
            expectedContentVersion: 1,
            content: { geometries: [{ id: marker }] },
          }),
          env,
        ),
      ),
    )
    const statuses = concurrent.map((res) => res.status).sort()
    expect(statuses).toEqual([200, 409])

    const finalContentRes = await handleRequest(
      authedRequest('GET', `/api/v1/revisions/${revisionBody.revision.id}/content`),
      env,
    )
    expect((await json<ContentBody>(finalContentRes)).content.contentVersion).toBe(2)
  })

  it('数量スナップショットの再更新には expectedQuantityVersion が必要で、不一致なら 409', async () => {
    const env = testEnv()
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-QTY', name: '数量試験' }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'D-QTY',
        name: '数量図面',
      }),
      env,
    )
    const drawingBody = await json<DrawingBody>(drawingRes)
    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingBody.drawing.id}/revisions`, {
        revisionNumber: '1',
        changeSummary: '初版',
      }),
      env,
    )
    const revisionBody = await json<RevisionBody>(revisionRes)
    const item = {
      id: 'qty-1',
      groupKey: 'length|m',
      method: 'length',
      unit: 'm',
      rawValue: 10,
      roundedValue: 10,
      status: 'valid',
      sources: [{ geometryId: 'g-1', contributionRaw: 10 }],
    }

    const firstPutRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/quantities`, {
        items: [item],
      }),
      env,
    )
    expect(firstPutRes.status).toBe(200)

    const missingVersionRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/quantities`, {
        items: [item],
      }),
      env,
    )
    expect(missingVersionRes.status).toBe(428)

    const staleVersionRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/quantities`, {
        expectedQuantityVersion: 99,
        items: [item],
      }),
      env,
    )
    expect(staleVersionRes.status).toBe(409)

    const secondPutRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/quantities`, {
        expectedQuantityVersion: 1,
        items: [{ ...item, roundedValue: 11 }],
      }),
      env,
    )
    expect(secondPutRes.status).toBe(200)
    expect((await json<QuantitiesBody>(secondPutRes)).quantities.quantityVersion).toBe(2)
  })

  it('承認は contentChecksum 不一致なら 409 で、承認済み改訂の内容更新は拒否される', async () => {
    const env = testEnv()
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-APPROVE', name: '承認試験' }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'D-APPROVE',
        name: '承認図面',
      }),
      env,
    )
    const drawingBody = await json<DrawingBody>(drawingRes)
    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingBody.drawing.id}/revisions`, {
        revisionNumber: '1',
        changeSummary: '初版',
      }),
      env,
    )
    const revisionBody = await json<RevisionBody>(revisionRes)
    const putContentRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        content: { geometries: [] },
      }),
      env,
    )
    const checksum = (await json<ContentBody>(putContentRes)).content.contentChecksum
    await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/workflow-actions`, {
        action: 'submitReview',
        mandatoryChecksPassed: true,
      }),
      env,
    )
    await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/workflow-actions`, {
        action: 'completeReview',
        reviewResultRecorded: true,
      }),
      env,
    )

    const mismatchRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/workflow-actions`, {
        action: 'approve',
        contentChecksum: 'sha256:stale',
      }),
      env,
    )
    expect(mismatchRes.status).toBe(409)

    const approveRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/workflow-actions`, {
        action: 'approve',
        contentChecksum: checksum,
      }),
      env,
    )
    expect(approveRes.status).toBe(200)

    const updateAfterApproveRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        expectedContentVersion: 1,
        content: { geometries: [{ id: 'late' }] },
      }),
      env,
    )
    expect(updateAfterApproveRes.status).toBe(409)
  })

  it('出力作成は保存済みcontentが必須で、CSVは数量スナップショットも必須', async () => {
    const env = testEnv()
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-EXPORT', name: '出力試験' }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'D-EXPORT',
        name: '出力図面',
      }),
      env,
    )
    const drawingBody = await json<DrawingBody>(drawingRes)
    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingBody.drawing.id}/revisions`, {
        revisionNumber: '1',
        changeSummary: '初版',
      }),
      env,
    )
    const revisionBody = await json<RevisionBody>(revisionRes)

    const noContentRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/exports`, { format: 'pdf' }),
      env,
    )
    expect(noContentRes.status).toBe(409)

    await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        content: { geometries: [] },
      }),
      env,
    )
    const noQuantitiesRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/exports`, { format: 'csv' }),
      env,
    )
    expect(noQuantitiesRes.status).toBe(409)

    const jsonExportRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/exports`, { format: 'json' }),
      env,
    )
    expect(jsonExportRes.status).toBe(201)
    expect((await json<ExportJobBody>(jsonExportRes)).exportJob.format).toBe('json')
  })

  it('ルーティング表の全経路が 501 ではなく業務応答または入力/認可エラーを返す', async () => {
    for (const route of API_ROUTES) {
      const body =
        route.method === 'GET'
          ? undefined
          : {
              expectedVersion: 1,
              schemaVersion: 1,
              items: [],
              action: 'submitReview',
              format: 'json',
            }
      const res = await handleRequest(
        authedRequest(route.method, concretePath(route.template), body),
        testEnv(),
      )
      expect(res.status).not.toBe(501)
    }
  })
})

describe('レート制限（Issue #115）', () => {
  it('書き込み上限超過で 429 CD-RATE-LIMITED と Retry-After を返す（読み取りは独立）', async () => {
    const env = testEnv()
    for (let i = 0; i < 30; i += 1) {
      const res = await handleRequest(
        authedRequest('POST', '/api/v1/projects', {
          projectNumber: `P-RATELIMIT-${i}`,
          name: 'レート制限試験',
        }),
        env,
      )
      expect(res.status).toBe(201)
    }

    // 書き込み 30 回の後でも読み取りバケットは独立して許可される
    const readRes = await handleRequest(authedRequest('GET', '/api/v1/projects'), env)
    expect(readRes.status).toBe(200)

    const limitedRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', {
        projectNumber: 'P-RATELIMIT-OVER',
        name: 'レート制限超過',
      }),
      env,
    )
    expect(limitedRes.status).toBe(429)
    const body = await json<ApiErrorBody>(limitedRes)
    expect(body.error.code).toBe('CD-RATE-LIMITED')
    expect(Number(limitedRes.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
  })
})

describe('API障害系・例外処理', () => {
  it('JSONが壊れているPOSTは未捕捉例外にせず 400 CD-REQ-001 を返す', async () => {
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: {
          [AUTH_HEADER]: 'jwt-token',
          [USER_HEADER]: 'engineer@example.test',
          'Content-Type': 'application/json',
        },
        body: '{broken json',
      }),
      testEnv(),
    )
    expect(res.status).toBe(400)
    const body = await json<ApiErrorBody>(res)
    expect(body.error.code).toBe('CD-REQ-001')
  })

  it('未知の出力形式は 400 CD-REQ-001 を返し、出力ジョブを作らない', async () => {
    const store = createMemoryStore()
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: store }
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-BADFMT', name: '出力形式試験' }),
      env,
    )
    const projectBody = await json<ProjectBody>(projectRes)
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'D-BADFMT',
        name: '出力形式図面',
      }),
      env,
    )
    const drawingBody = await json<DrawingBody>(drawingRes)
    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingBody.drawing.id}/revisions`, {
        revisionNumber: '1',
        changeSummary: '初版',
      }),
      env,
    )
    const revisionBody = await json<RevisionBody>(revisionRes)
    await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionBody.revision.id}/content`, {
        schemaVersion: 1,
        content: { geometries: [] },
      }),
      env,
    )

    const badFormatRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionBody.revision.id}/exports`, { format: 'xlsx' }),
      env,
    )
    expect(badFormatRes.status).toBe(400)
    expect((await json<ApiErrorBody>(badFormatRes)).error.code).toBe('CD-REQ-001')
    expect(store.exportJobs.size).toBe(0)
  })

  it('Content-Length が上限 (64 MiB) を超える POST は 413 を返す', async () => {
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: {
          [AUTH_HEADER]: 'jwt-token',
          [USER_HEADER]: 'engineer@example.test',
          'Content-Type': 'application/json',
          'Content-Length': String(64 * 1024 * 1024 + 1),
        },
        body: '{}',
      }),
      testEnv(),
    )
    expect(res.status).toBe(413)
    expect((await json<ApiErrorBody>(res)).error.code).toBe('CD-REQ-001')
  })

  it('Content-Length なしでも実測サイズが上限超過なら 413 を返す（偽装・欠落対策）', async () => {
    // Content-Length 偽装（小さい申告 + 大きい実体）を代表ケースとして、
    // 実測バイト数検査の経路を検証する。
    const bigBody = '{"name":"' + 'a'.repeat(64 * 1024 * 1024) + '"}'
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: {
          [AUTH_HEADER]: 'jwt-token',
          [USER_HEADER]: 'engineer@example.test',
          'Content-Type': 'application/json',
        },
        body: bigBody,
      }),
      testEnv(),
    )
    expect(res.status).toBe(413)
    expect((await json<ApiErrorBody>(res)).error.code).toBe('CD-REQ-001')
  })

  it('多バイト UTF-8 で文字数が上限以下でもバイト数が上限超過なら 413 を返す', async () => {
    // 「あ」は UTF-8 で 3 バイト。文字数 (UTF-16 単位) は 64 MiB 上限の約 1/3 の
    // 約 22.4M に留まるが、バイト数は約 67 MB で上限を超える。文字数ベースの
    // 検査（旧実装）ではすり抜けるケースを検出する回帰テスト。
    const multibyte = 'あ'.repeat(Math.floor((64 * 1024 * 1024) / 3) + 1024)
    const bigBody = '{"name":"' + multibyte + '"}'
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: {
          [AUTH_HEADER]: 'jwt-token',
          [USER_HEADER]: 'engineer@example.test',
          'Content-Type': 'application/json',
        },
        body: bigBody,
      }),
      testEnv(),
    )
    expect(res.status).toBe(413)
    expect((await json<ApiErrorBody>(res)).error.code).toBe('CD-REQ-001')
  })
})

describe('未知エンドポイント', () => {
  it('一致しない経路は 404 を返す', async () => {
    const res = await handleRequest(authedRequest('GET', '/api/v1/does-not-exist'), testEnv())
    expect(res.status).toBe(404)
    const body = await json<ApiErrorBody>(res)
    expect(body.error.code).toBe('CD-SYS-001')
  })
})

describe('default export (module worker)', () => {
  it('fetch(request, env, ctx) が handleRequest と同じストアを使う', async () => {
    const env = testEnv()
    const res = await worker.fetch(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-1', name: '案件1' }),
      env,
      noopCtx,
    )
    expect(res.status).toBe(201)
    expect(env.CIVILDRAFT_DEV_STORE?.projects.size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// #66 persistX 配線: 永続化フック付き store で全書き込みハンドラがフックを
// 経由すること（Map 直接更新へ迂回しないこと）を検証する。
// ---------------------------------------------------------------------------
describe('#66 永続化フック配線（persistX wiring）', () => {
  type HookedStore = ReturnType<typeof createHookedStore>

  /**
   * NeonApiStore と同じ契約（永続化成功 → キャッシュ更新）を持つテストダブル。
   * 各フックは vi.fn で呼び出しを記録しつつ、成功時に Map/配列を更新する。
   */
  function createHookedStore() {
    const base = createMemoryStore()
    const store = Object.assign(base, {
      persistProject: vi.fn(async (p: (typeof base.projects extends Map<string, infer V> ? V : never)) => {
        base.projects.set(p.id, p)
      }),
      persistProjectMember: vi.fn(async (m: { projectId: string; userId: string }) => {
        base.projectMembers.set(`${m.projectId}:${m.userId}`, m as never)
      }),
      persistDrawing: vi.fn(async (d: { id: string }) => {
        base.drawings.set(d.id, d as never)
      }),
      persistRevision: vi.fn(async (r: { id: string }) => {
        base.revisions.set(r.id, r as never)
      }),
      persistContent: vi.fn(async (c: { revisionId: string }) => {
        base.contents.set(c.revisionId, c as never)
      }),
      persistQuantities: vi.fn(async (s: { revisionId: string }) => {
        base.quantities.set(s.revisionId, s as never)
      }),
      persistWorkflowAction: vi.fn(async (a: unknown) => {
        base.workflowActions.push(a as never)
      }),
      persistExportJob: vi.fn(async (j: { id: string }) => {
        base.exportJobs.set(j.id, j as never)
      }),
      persistAuditLog: vi.fn(async (l: unknown) => {
        base.auditLogs.push(l as never)
      }),
      // -- 複合永続化フック（#68）: NeonApiStore の単一トランザクション契約を模倣 --
      persistProjectWithMember: vi.fn(
        async (
          p: (typeof base.projects extends Map<string, infer V> ? V : never),
          m: { projectId: string; userId: string },
        ) => {
          base.projects.set(p.id, p)
          base.projectMembers.set(`${m.projectId}:${m.userId}`, m as never)
        },
      ),
      persistRevisionWithDrawing: vi.fn(async (r: { id: string }, d: { id: string }) => {
        base.revisions.set(r.id, r as never)
        base.drawings.set(d.id, d as never)
      }),
      persistContentWithRevision: vi.fn(async (c: { revisionId: string }, r: { id: string }) => {
        base.contents.set(c.revisionId, c as never)
        base.revisions.set(r.id, r as never)
      }),
      persistQuantitiesWithRevision: vi.fn(async (s: { revisionId: string }, r: { id: string }) => {
        base.quantities.set(s.revisionId, s as never)
        base.revisions.set(r.id, r as never)
      }),
      persistWorkflowActionWithRevision: vi.fn(async (a: unknown, r: { id: string }) => {
        base.workflowActions.push(a as never)
        base.revisions.set(r.id, r as never)
      }),
    })
    return store
  }

  function hookedEnv(store: HookedStore): WorkerEnv {
    return { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: store }
  }

  it('P0縦線の全書き込みが対応する persistX フックを経由する', async () => {
    const store = createHookedStore()
    const env = hookedEnv(store)

    // Project 作成: persistProjectWithMember（project + manager 自動付与を単一トランザクションで永続化・#68）
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-66', name: '配線検証案件' }),
      env,
    )
    expect(projectRes.status).toBe(201)
    expect(store.persistProjectWithMember).toHaveBeenCalledTimes(1)
    const projectId = (await json<ProjectBody>(projectRes)).project.id

    // Project 更新: 単体レコードのため persistProject（#66 個別フック）を引き続き使用
    const patchRes = await handleRequest(
      authedRequest('PATCH', `/api/v1/projects/${projectId}`, { expectedVersion: 1, name: '改名' }),
      env,
    )
    expect(patchRes.status).toBe(200)
    expect(store.persistProject).toHaveBeenCalledTimes(1)

    // Drawing 作成: persistDrawing
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectId}/drawings`, {
        drawingNumber: 'DWG-66',
        name: '平面図',
      }),
      env,
    )
    expect(drawingRes.status).toBe(201)
    expect(store.persistDrawing).toHaveBeenCalledTimes(1)
    const drawingId = (await json<DrawingBody>(drawingRes)).drawing.id

    // Revision 作成: persistRevisionWithDrawing（revision + drawing の activeRevisionId 更新を単一トランザクションで永続化・#68）
    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingId}/revisions`, {
        revisionNumber: 'A',
        changeSummary: '初版',
      }),
      env,
    )
    expect(revisionRes.status).toBe(201)
    expect(store.persistRevisionWithDrawing).toHaveBeenCalledTimes(1)
    expect(store.persistDrawing).toHaveBeenCalledTimes(1)
    const revisionId = (await json<RevisionBody>(revisionRes)).revision.id

    // Content 保存: persistContentWithRevision（content + revision の checksum/contentVersion 反映を単一トランザクションで永続化・#68）
    const contentRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionId}/content`, {
        schemaVersion: 1,
        content: { geometries: [{ kind: 'line' }] },
      }),
      env,
    )
    expect(contentRes.status).toBe(200)
    expect(store.persistContentWithRevision).toHaveBeenCalledTimes(1)

    // 数量保存: persistQuantitiesWithRevision（snapshot + revision の updatedAt 反映を単一トランザクションで永続化・#68）
    const quantitiesRes = await handleRequest(
      authedRequest('PUT', `/api/v1/revisions/${revisionId}/quantities`, { items: [] }),
      env,
    )
    expect(quantitiesRes.status).toBe(200)
    expect(store.persistQuantitiesWithRevision).toHaveBeenCalledTimes(1)

    // Workflow: persistWorkflowActionWithRevision（workflowAction + revision の status 遷移を単一トランザクションで永続化・#68）
    const workflowRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionId}/workflow-actions`, {
        action: 'submitReview',
        mandatoryChecksPassed: true,
      }),
      env,
    )
    expect(workflowRes.status).toBe(200)
    expect(store.persistWorkflowActionWithRevision).toHaveBeenCalledTimes(1)

    // Export: persistExportJob
    const exportRes = await handleRequest(
      authedRequest('POST', `/api/v1/revisions/${revisionId}/exports`, { format: 'pdf' }),
      env,
    )
    expect(exportRes.status).toBe(201)
    expect(store.persistExportJob).toHaveBeenCalledTimes(1)

    // 監査ログ: 各成功イベントが persistAuditLog 経由で flush されている
    expect(store.persistAuditLog).toHaveBeenCalled()
    const auditEvents = store.auditLogs.map((l) => l.eventName)
    expect(auditEvents).toContain('project.created')
    expect(auditEvents).toContain('revision.content.updated')
    expect(auditEvents).toContain('export.created')

    // 契約（#68）: 複合フックを持つ経路は、対応する個別フックを経由しない（部分永続化の回避）
    expect(store.persistProjectMember).not.toHaveBeenCalled()
    expect(store.persistRevision).not.toHaveBeenCalled()
    expect(store.persistContent).not.toHaveBeenCalled()
    expect(store.persistQuantities).not.toHaveBeenCalled()
    expect(store.persistWorkflowAction).not.toHaveBeenCalled()
  })

  it('persistX フックの失敗は 500 CD-SYS-003 になり、成功を偽装しない', async () => {
    const store = createHookedStore()
    store.persistProjectWithMember.mockRejectedValueOnce(new Error('neon write failed'))
    const res = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-ERR', name: '失敗案件' }),
      hookedEnv(store),
    )
    expect(res.status).toBe(500)
    expect((await json<ApiErrorBody>(res)).error.code).toBe('CD-SYS-003')
    // 契約: 永続化失敗時にローカルキャッシュを更新しない
    expect(store.projects.size).toBe(0)
  })

  it('監査ログ flush の失敗は成功応答を 500 で置き換える（fail-visible / ADR-0009）', async () => {
    const store = createHookedStore()
    store.persistAuditLog.mockRejectedValue(new Error('audit insert failed'))
    const res = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-AUD', name: '監査失敗案件' }),
      hookedEnv(store),
    )
    expect(res.status).toBe(500)
    const body = await json<ApiErrorBody>(res)
    expect(body.error.code).toBe('CD-SYS-003')
    expect(body.error.message).toContain('監査ログ')
    // 本体の書き込み自体は完了している（部分永続化はログで突合する運用）
    expect(store.projects.size).toBe(1)
  })

  it('認可拒否の監査ログも persistAuditLog 経由で永続化される', async () => {
    const store = createHookedStore()
    const env = hookedEnv(store)
    const created = await handleRequest(
      authedRequest('POST', '/api/v1/projects', { projectNumber: 'P-DENY', name: '拒否検証' }),
      env,
    )
    const projectId = (await json<ProjectBody>(created)).project.id
    store.persistAuditLog.mockClear()

    const denied = await handleRequest(
      authedRequestAs('outsider@example.test', 'GET', `/api/v1/projects/${projectId}`),
      env,
    )
    expect(denied.status).toBe(403)
    expect(store.persistAuditLog).toHaveBeenCalledTimes(1)
    expect(store.auditLogs.at(-1)?.eventName).toBe('authorization.view.denied')
  })

  it('監査チェーン検証エンドポイントがチェーン状態を返す（Issue #61）', async () => {
    const res = await handleRequest(
      authedRequest('GET', '/api/v1/audit-logs/verify'),
      testEnv(),
    )
    expect(res.status).toBe(200)
    const body = await json<{
      auditChain: { valid: boolean; checkedCount: number; legacyCount: number }
    }>(res)
    expect(body.auditChain.valid).toBe(true)
    expect(body.auditChain.checkedCount).toBe(0)
    expect(body.auditChain.legacyCount).toBe(0)
  })

  describe('プロジェクトメンバー管理 API（Issue #119）', () => {
    interface MemberBody {
      readonly member: { readonly userId: string; readonly role: string }
    }

    async function createProjectWithManager(
      env: WorkerEnv,
      manager = 'owner@example.test',
    ): Promise<string> {
      const res = await handleRequest(
        authedRequestAs(manager, 'POST', '/api/v1/projects', {
          projectNumber: 'P-MEMBERS',
          name: 'メンバー管理テスト案件',
        }),
        env,
      )
      const body = await json<ProjectBody>(res)
      return body.project.id
    }

    it('manager がメンバーを追加・一覧取得・ロール変更・削除できる', async () => {
      const env = testEnv()
      const projectId = await createProjectWithManager(env)

      // 追加
      const addRes = await handleRequest(
        authedRequestAs('owner@example.test', 'POST', `/api/v1/projects/${projectId}/members`, {
          userId: 'editor@example.test',
          role: 'editor',
        }),
        env,
      )
      expect(addRes.status).toBe(201)
      const addBody = await json<MemberBody>(addRes)
      expect(addBody.member.role).toBe('editor')

      // 一覧
      const listRes = await handleRequest(
        authedRequestAs('owner@example.test', 'GET', `/api/v1/projects/${projectId}/members`),
        env,
      )
      expect(listRes.status).toBe(200)
      const listBody = await json<{ readonly members: readonly { readonly userId: string }[] }>(listRes)
      expect(listBody.members.map((m) => m.userId)).toEqual([
        'owner@example.test',
        'editor@example.test',
      ])

      // ロール変更
      const patchRes = await handleRequest(
        authedRequestAs('owner@example.test', 'PATCH', `/api/v1/projects/${projectId}/members/editor@example.test`, {
          role: 'reviewer',
        }),
        env,
      )
      expect(patchRes.status).toBe(200)
      const patchBody = await json<MemberBody>(patchRes)
      expect(patchBody.member.role).toBe('reviewer')

      // 削除
      const deleteRes = await handleRequest(
        authedRequestAs('owner@example.test', 'DELETE', `/api/v1/projects/${projectId}/members/editor@example.test`),
        env,
      )
      expect(deleteRes.status).toBe(200)
      const deleteBody = await json<{ readonly removed: boolean }>(deleteRes)
      expect(deleteBody.removed).toBe(true)
    })

    it('manager 以外のメンバー操作は 403 で拒否される', async () => {
      const env = testEnv()
      const projectId = await createProjectWithManager(env)
      const addRes = await handleRequest(
        authedRequestAs('viewer@example.test', 'POST', `/api/v1/projects/${projectId}/members`, {
          userId: 'someone@example.test',
          role: 'viewer',
        }),
        env,
      )
      expect(addRes.status).toBe(403)
    })

    it('最後の manager のロール変更・削除は 409 で拒否される', async () => {
      const env = testEnv()
      const projectId = await createProjectWithManager(env)

      const patchRes = await handleRequest(
        authedRequestAs('owner@example.test', 'PATCH', `/api/v1/projects/${projectId}/members/owner@example.test`, {
          role: 'viewer',
        }),
        env,
      )
      expect(patchRes.status).toBe(409)

      const deleteRes = await handleRequest(
        authedRequestAs('owner@example.test', 'DELETE', `/api/v1/projects/${projectId}/members/owner@example.test`),
        env,
      )
      expect(deleteRes.status).toBe(409)
    })

    it('存在しないメンバーへの更新・削除は 404', async () => {
      const env = testEnv()
      const projectId = await createProjectWithManager(env)
      const patchRes = await handleRequest(
        authedRequestAs('owner@example.test', 'PATCH', `/api/v1/projects/${projectId}/members/nobody@example.test`, {
          role: 'viewer',
        }),
        env,
      )
      expect(patchRes.status).toBe(404)
    })
  })
})

describe('チェックイン/アウト API（migration 0007）', () => {
  interface Seed {
    readonly projectId: string
    readonly drawingId: string
    readonly revisionId: string
  }

  async function seed(env: WorkerEnv): Promise<Seed> {
    const projectRes = await handleRequest(
      authedRequest('POST', '/api/v1/projects', {
        projectNumber: 'P-CHECKOUT-001',
        name: 'チェックアウト検証工事',
      }),
      env,
    )
    expect(projectRes.status).toBe(201)
    const projectBody = await json<{ project: { id: string } }>(projectRes)
    const drawingRes = await handleRequest(
      authedRequest('POST', `/api/v1/projects/${projectBody.project.id}/drawings`, {
        drawingNumber: 'DWG-001',
        name: '施工ヤード図',
        drawingType: 'temporary-yard-plan',
        settings: {},
      }),
      env,
    )
    expect(drawingRes.status).toBe(201)
    const drawingBody = await json<{ drawing: { id: string } }>(drawingRes)
    const revisionRes = await handleRequest(
      authedRequest('POST', `/api/v1/drawings/${drawingBody.drawing.id}/revisions`, {
        revisionNumber: '1',
        changeSummary: '初版',
      }),
      env,
    )
    expect(revisionRes.status).toBe(201)
    const revisionBody = await json<{ revision: { id: string } }>(revisionRes)
    return {
      projectId: projectBody.project.id,
      drawingId: drawingBody.drawing.id,
      revisionId: revisionBody.revision.id,
    }
  }

  it('draft 改訂をチェックアウト→チェックインでき、監査ログに記録される', async () => {
    const env = testEnv()
    const { projectId, drawingId, revisionId } = await seed(env)

    const checkoutRes = await handleRequest(
      authedRequest('PUT', `/api/v1/drawings/${drawingId}/checkout`, { revisionId }),
      env,
    )
    expect(checkoutRes.status).toBe(200)
    const checkoutBody = await json<{ checkout: { status: string; checkedOutBy: string } }>(checkoutRes)
    expect(checkoutBody.checkout.status).toBe('checkedOut')
    expect(checkoutBody.checkout.checkedOutBy).toBe('engineer@example.test')

    const reacquireRes = await handleRequest(
      authedRequest('PUT', `/api/v1/drawings/${drawingId}/checkout`, { revisionId }),
      env,
    )
    expect(reacquireRes.status).toBe(200)

    const checkinRes = await handleRequest(
      authedRequest('DELETE', `/api/v1/drawings/${drawingId}/checkout`),
      env,
    )
    expect(checkinRes.status).toBe(200)
    const checkinBody = await json<{ checkout: { status: string; checkedInAt?: string } }>(checkinRes)
    expect(checkinBody.checkout.status).toBe('checkedIn')
    expect(checkinBody.checkout.checkedInAt).toBeTruthy()

    const auditRes = await handleRequest(
      authedRequest('GET', `/api/v1/audit-logs?projectId=${projectId}`),
      env,
    )
    const auditBody = await json<AuditLogsBody>(auditRes)
    const eventNames = auditBody.auditLogs.map((log) => log.eventName)
    expect(eventNames).toContain('drawing.checkout')
    expect(eventNames).toContain('drawing.checkin')
  })

  it('他ユーザー保有中のチェックアウトは 409、保有者以外のチェックインも 409', async () => {
    const env = testEnv()
    const { projectId, drawingId, revisionId } = await seed(env)
    for (const userId of ['user-a@example.test', 'user-b@example.test']) {
      const memberRes = await handleRequest(
        authedRequest('POST', `/api/v1/projects/${projectId}/members`, { userId, role: 'editor' }),
        env,
      )
      expect(memberRes.status).toBe(201)
    }

    const checkoutRes = await handleRequest(
      authedRequestAs('user-a@example.test', 'PUT', `/api/v1/drawings/${drawingId}/checkout`, { revisionId }),
      env,
    )
    expect(checkoutRes.status).toBe(200)

    const conflictRes = await handleRequest(
      authedRequestAs('user-b@example.test', 'PUT', `/api/v1/drawings/${drawingId}/checkout`, { revisionId }),
      env,
    )
    expect(conflictRes.status).toBe(409)
    const conflictBody = await json<ApiErrorBody>(conflictRes)
    expect(conflictBody.error.code).toBe('CD-CONFLICT-001')

    const wrongCheckinRes = await handleRequest(
      authedRequestAs('user-b@example.test', 'DELETE', `/api/v1/drawings/${drawingId}/checkout`),
      env,
    )
    expect(wrongCheckinRes.status).toBe(409)
  })

  it('approved 改訂はチェックアウトできない（承認後改変防止）', async () => {
    const env = testEnv()
    const { drawingId, revisionId } = await seed(env)
    // 承認フローは内容チェックサム等の前提があるため、ハンドラのゲート検証は
    // ストア状態を approved へ直接遷移させて行う（ユニットテストの責務）。
    const store = env.CIVILDRAFT_DEV_STORE
    expect(store).toBeDefined()
    const revision = store?.revisions.get(revisionId)
    expect(revision).toBeDefined()
    if (store && revision) {
      store.revisions.set(revisionId, { ...revision, status: 'approved' })
    }

    const checkoutRes = await handleRequest(
      authedRequest('PUT', `/api/v1/drawings/${drawingId}/checkout`, { revisionId }),
      env,
    )
    expect(checkoutRes.status).toBe(422)
    const body = await json<ApiErrorBody>(checkoutRes)
    expect(body.error.message).toContain('承認後改変防止')
  })
})

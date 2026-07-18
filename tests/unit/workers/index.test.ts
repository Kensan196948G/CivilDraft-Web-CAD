import { describe, expect, it } from 'vitest'
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
    expect(body.error.message).toContain('binding')
  })

  it('CIVILDRAFT_API_MODE 未設定・タイポ時はインメモリへ無警告フォールバックせず 503 で停止する', async () => {
    for (const env of [{}, { CIVILDRAFT_API_MODE: 'Neon-R2' }, { CIVILDRAFT_API_MODE: 'prod' }]) {
      const res = await handleRequest(authedRequest('GET', '/api/v1/projects'), env)
      expect(res.status).toBe(503)
      const body = await json<ApiErrorBody>(res)
      expect(body.error.code).toBe('CD-SYS-002')
      expect(body.error.message).toContain('CIVILDRAFT_API_MODE')
    }
  })

  it('neon-r2 モードの共有保存PUTは一時停止し、成功したように見せない', async () => {
    for (const path of [
      '/api/v1/revisions/rev-1/content',
      '/api/v1/revisions/rev-1/quantities',
    ]) {
      const res = await handleRequest(
        authedRequest('PUT', path, { schemaVersion: 1, content: {}, items: [] }),
        {
          CIVILDRAFT_API_MODE: 'neon-r2',
          CIVILDRAFT_NEON_CONNECTION: 'test-neon-connection-placeholder',
        },
      )
      expect(res.status).toBe(503)
      const body = await json<ApiErrorBody>(res)
      expect(body.error.code).toBe('CD-SYS-002')
      expect(body.error.message).toContain('共有保存')
      expect(body.error.message).toContain('一時停止')
    }
  })
})

describe('§25.2 ルーティング', () => {
  it('エンドポイント一覧が仕様の18経路を網羅する', () => {
    expect(API_ROUTES).toHaveLength(18)
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
    expect(await json<{ readonly projects: unknown[] }>(outsiderListRes)).toEqual({ projects: [] })

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

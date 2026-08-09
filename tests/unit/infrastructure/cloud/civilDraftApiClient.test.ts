import { beforeEach, describe, expect, it } from 'vitest'
import {
  CivilDraftApiClient,
  type CloudApiClientOptions,
} from '@/infrastructure/cloud/civilDraftApiClient'
import { createMemoryStore, handleRequest, type WorkerEnv } from '@/workers/index'
import { resetRateLimitState } from '@/workers/rateLimit'
import type { CivilDraftDocument } from '@/infrastructure/files'
import type { DrawingLayer, Geometry, GeometryStyle, LayerId } from '@/shared/types'

const AUTH_HEADER = 'Cf-Access-Jwt-Assertion'
const USER_HEADER = 'Cf-Access-Authenticated-User-Email'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const layer: DrawingLayer = {
  id: 'layer-main' as LayerId,
  name: '主線',
  order: 0,
  visible: true,
  locked: false,
  printable: true,
  defaultStyle: style,
}

function makeDocument(): CivilDraftDocument {
  const line: Geometry = {
    id: 'g-1' as Geometry['id'],
    type: 'line',
    layerId: layer.id,
    style,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    start: { x: 0, y: 0 },
    end: { x: 1200, y: 0 },
  }
  return { geometries: [line], layers: [layer] }
}

function makeClient(env: WorkerEnv): CivilDraftApiClient {
  const fetchImpl: CloudApiClientOptions['fetch'] = async (input, init) => {
    const headers = new Headers(init?.headers)
    return handleRequest(
      new Request(input, {
        method: init?.method,
        headers,
        body: init?.body,
      }),
      env,
    )
  }
  return new CivilDraftApiClient({
    baseUrl: 'https://api.example.test',
    fetch: fetchImpl,
    headers: {
      [AUTH_HEADER]: 'jwt-token',
      [USER_HEADER]: 'engineer@example.test',
    },
    correlationId: () => 'corr-client-test',
  })
}

beforeEach(() => {
  resetRateLimitState()
})

describe('CivilDraftApiClient', () => {
  it('listProjects は参加案件一覧を返す', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
    const client = makeClient(env)
    const created = await client.createProject({ projectNumber: 'P-100', name: '一覧検証工事' })
    expect(created.ok).toBe(true)

    const listed = await client.listProjects()
    expect(listed.ok).toBe(true)
    if (listed.ok) {
      expect(listed.value.length).toBe(1)
      expect(listed.value[0]?.name).toBe('一覧検証工事')
    }
  })

  it('Workers API P0縦線をブラウザ側クライアントから保存・再読込・Export作成できる', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
    const client = makeClient(env)
    const document = makeDocument()

    const saved = await client.saveDraft({
      project: {
        projectNumber: 'P-CLIENT-001',
        name: 'クライアント連携テスト',
        clientName: 'Mirai建設',
      },
      drawing: {
        drawingNumber: 'DWG-CLIENT-001',
        name: '仮設計画平面図',
        drawingType: 'temporary-yard-plan',
        settings: { unit: 'mm', paper: 'A3' },
      },
      revision: {
        revisionNumber: '1',
        changeSummary: 'ブラウザクライアントから初版保存',
      },
      document,
      exportFormat: 'json',
    })

    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.project.projectNumber).toBe('P-CLIENT-001')
    expect(saved.value.content.content).toEqual(document)
    expect(saved.value.content.contentChecksum).toMatch(/^sha256:/)
    expect(saved.value.exportJob?.status).toBe('completed')

    const loaded = await client.getRevisionContent(saved.value.revision.id)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.value.content).toEqual(document)
    expect(loaded.value.contentVersion).toBe(1)
  })

  it('Workers APIの業務エラーをValidationIssueとして返し、例外で握り潰さない', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'neon-r2' }
    const client = makeClient(env)

    const result = await client.createProject({
      projectNumber: 'P-FAIL-001',
      name: '永続化未接続',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CLOUD_API_HTTP')
    // #66 で isPersistedWriteRoute の一時停止ゲートは撤去済み。neon-r2 モードで
    // binding 未設定の場合は readiness 検査（persistence.ts）の 503 が返る。
    // Workers 側のエラーメッセージがそのまま ValidationIssue へ透過することを確認する。
    expect(result.error.message).toContain('共有保存サービス')
    expect(result.error.message).not.toMatch(/CIVILDRAFT_NEON_CONNECTION|binding/i)
  })

  it('409/428 の API エラーコードを apiErrorCode として透過する（#114 楽観ロック競合UX用）', async () => {
    const client = new CivilDraftApiClient({
      baseUrl: 'https://api.example.test',
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'CD-CONFLICT-001',
              message: 'project.version が一致しません（expected=1, current=2）',
            },
            correlationId: 'corr-conflict',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
    })

    const result = await client.createProject({ projectNumber: 'P-CONFLICT', name: '競合テスト' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CLOUD_API_HTTP')
    expect(result.error.apiErrorCode).toBe('CD-CONFLICT-001')
    expect(result.error.message).toContain('一致しません')
  })

  it('listAuditLogs で監査ログ一覧を取得できる（Issue #61）', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
    const client = makeClient(env)

    const created = await client.createProject({
      projectNumber: 'P-AUDIT-CLIENT',
      name: '監査一覧クライアントテスト',
    })
    expect(created.ok).toBe(true)

    const result = await client.listAuditLogs({ limit: 100 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.auditLogs.length).toBeGreaterThan(0)
    expect(result.value.auditLogs.some((log) => log.eventName === 'project.created')).toBe(true)
    expect(result.value.auditLogs[0]?.actorId).toBe('engineer@example.test')
    expect(result.value.total).toBeGreaterThan(0)
  })

  it('listAuditLogs はフィルタとカーソルページングに対応する（Issue #85）', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
    const client = makeClient(env)
    await client.createProject({ projectNumber: 'P-AUDIT-1', name: '監査ページング1' })
    await client.createProject({ projectNumber: 'P-AUDIT-2', name: '監査ページング2' })

    const first = await client.listAuditLogs({ eventName: 'project.created', limit: 1 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.total).toBe(2)
    expect(first.value.auditLogs).toHaveLength(1)
    expect(first.value.nextCursor).toBeDefined()

    const second = await client.listAuditLogs({
      eventName: 'project.created',
      limit: 1,
      cursor: first.value.nextCursor,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.auditLogs).toHaveLength(1)
    expect(second.value.nextCursor).toBeUndefined()
  })

  it('verifyAuditChain でチェーン検証結果を取得できる（Issue #61）', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
    const client = makeClient(env)

    const result = await client.verifyAuditChain()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // メモリストアは hash 無し（レガシー）のため valid=true で検証対象外として扱う
    expect(result.value.valid).toBe(true)
    expect(result.value.hashedCount).toBe(0)
    expect(result.value.checkedCount).toBe(0)
  })

  it('getProject / listProjectDrawings / listProjectMembers / updateProject で実案件詳細を取得・更新できる（Issue #62）', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
    const client = makeClient(env)

    const created = await client.createProject({
      projectNumber: 'P-DETAIL-001',
      name: '詳細表示検証工事',
      clientName: 'テスト発注者',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const projectId = created.value.id

    const drawingCreated = await client.createDrawing(projectId, {
      drawingNumber: 'DWG-001',
      name: '施工ヤード計画図',
      drawingType: 'temporary-yard-plan',
    })
    expect(drawingCreated.ok).toBe(true)
    if (!drawingCreated.ok) return

    const projectResult = await client.getProject(projectId)
    expect(projectResult.ok).toBe(true)
    if (!projectResult.ok) return
    expect(projectResult.value.name).toBe('詳細表示検証工事')
    expect(projectResult.value.clientName).toBe('テスト発注者')

    const drawings = await client.listProjectDrawings(projectId)
    expect(drawings.ok).toBe(true)
    if (!drawings.ok) return
    expect(drawings.value).toHaveLength(1)
    expect(drawings.value[0]?.drawingType).toBe('temporary-yard-plan')

    const members = await client.listProjectMembers(projectId)
    expect(members.ok).toBe(true)
    if (!members.ok) return
    expect(members.value.some((m) => m.role === 'manager')).toBe(true)

    const updated = await client.updateProject(projectId, {
      name: '詳細表示検証工事（改名）',
      clientName: '更新発注者',
      expectedVersion: created.value.version,
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value.name).toBe('詳細表示検証工事（改名）')
    expect(updated.value.clientName).toBe('更新発注者')
    expect(updated.value.version).toBe(created.value.version + 1)
  })

  it('getRevision で改訂メタデータを取得できる（Issue #62）', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
    const client = makeClient(env)
    const document = makeDocument()

    const saved = await client.saveDraft({
      project: { projectNumber: 'P-REV-001', name: '改訂取得検証工事' },
      drawing: { drawingNumber: 'DWG-001', name: '改訂取得図面' },
      revision: { revisionNumber: '1', changeSummary: '初版' },
      document,
    })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const revision = await client.getRevision(saved.value.revision.id)
    expect(revision.ok).toBe(true)
    if (!revision.ok) return
    expect(revision.value.revisionNumber).toBe('1')
    expect(revision.value.status).toBe('draft')
  })
})

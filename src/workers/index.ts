/**
 * CivilDraft Workers API（詳細設計仕様書 §25）。
 *
 * 本番DB/Storage接続は人間決裁が必要なため、このWorkerはリリース前検証用の
 * インメモリ実装としてAPI契約・認証ヘッダー・相関ID・監査イベントを動作させる。
 * Neon/Object Storage接続時もレスポンス形状を変えず、永続化層だけ差し替える。
 */
import { applyRevisionAction } from '@/domain/revisions'
import type { RevisionAction, RevisionStatus, WorkflowActor } from '@/domain/revisions'

export interface WorkerEnv {
  readonly [key: string]: unknown
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion'
const CORRELATION_ID_HEADER = 'X-Correlation-Id'

const ERROR_CODES = {
  badRequest: 'CD-REQ-001',
  unauthenticated: 'CD-AUTH-001',
  forbidden: 'CD-AUTH-002',
  notFound: 'CD-SYS-001',
  conflict: 'CD-SYS-002',
  internal: 'CD-SYS-999',
} as const

interface ApiRoute {
  readonly method: string
  readonly template: string
  readonly summary: string
  readonly pattern: RegExp
  readonly paramNames: readonly string[]
}

interface ProjectRecord {
  readonly id: string
  readonly projectNumber: string
  readonly name: string
  readonly clientName: string
  readonly status: 'active' | 'archived'
  readonly updatedAt: string
}

interface DrawingRecord {
  readonly id: string
  readonly projectId: string
  readonly drawingNumber: string
  readonly name: string
  readonly drawingType: string
  readonly status: 'active' | 'archived'
  readonly activeRevisionId: string
  readonly settings: Record<string, unknown>
}

interface RevisionRecord {
  readonly id: string
  readonly drawingId: string
  readonly revisionNumber: string
  readonly status: RevisionStatus
  readonly changeSummary: string
  readonly contentVersion: number
  readonly contentChecksum: string
  readonly updatedAt: string
}

interface ExportJobRecord {
  readonly id: string
  readonly revisionId: string
  readonly format: 'pdf' | 'dxf' | 'csv'
  readonly status: 'completed'
  readonly objectKey: string
  readonly createdAt: string
}

interface AuditLogRecord {
  readonly id: string
  readonly occurredAt: string
  readonly eventName: string
  readonly actorId: string
  readonly entityType: string
  readonly entityId: string
  readonly result: 'success' | 'failure'
  readonly correlationId: string
  readonly detail: Record<string, unknown>
}

function compileTemplate(template: string): { readonly pattern: RegExp; readonly paramNames: readonly string[] } {
  const paramNames: string[] = []
  const escaped = template
    .split('/')
    .map((segment) => {
      if (segment.startsWith('{') && segment.endsWith('}')) {
        paramNames.push(segment.slice(1, -1))
        return '([^/]+)'
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { pattern: new RegExp(`^${escaped}$`), paramNames }
}

function route(method: string, template: string, summary: string): ApiRoute {
  const compiled = compileTemplate(template)
  return { method, template, summary, pattern: compiled.pattern, paramNames: compiled.paramNames }
}

export const API_ROUTES: readonly ApiRoute[] = [
  route('GET', '/api/v1/projects', '参加案件一覧'),
  route('POST', '/api/v1/projects', '案件作成'),
  route('GET', '/api/v1/projects/{projectId}', '案件取得'),
  route('PATCH', '/api/v1/projects/{projectId}', '案件更新'),
  route('GET', '/api/v1/projects/{projectId}/drawings', '図面一覧'),
  route('POST', '/api/v1/projects/{projectId}/drawings', '図面作成'),
  route('GET', '/api/v1/drawings/{drawingId}', '図面取得'),
  route('PATCH', '/api/v1/drawings/{drawingId}', '図面メタデータ更新'),
  route('POST', '/api/v1/drawings/{drawingId}/revisions', '新規改訂'),
  route('GET', '/api/v1/revisions/{revisionId}', '改訂メタデータ取得'),
  route('GET', '/api/v1/revisions/{revisionId}/content', '内容取得'),
  route('PUT', '/api/v1/revisions/{revisionId}/content', 'draft内容更新'),
  route('GET', '/api/v1/revisions/{revisionId}/quantities', '数量取得'),
  route('PUT', '/api/v1/revisions/{revisionId}/quantities', '数量スナップショット更新'),
  route('POST', '/api/v1/revisions/{revisionId}/workflow-actions', '提出・照査・承認等'),
  route('POST', '/api/v1/revisions/{revisionId}/exports', '出力作成'),
  route('GET', '/api/v1/exports/{exportId}', '出力状態・取得情報'),
  route('GET', '/api/v1/audit-logs', '監査検索'),
]

const projects = new Map<string, ProjectRecord>()
const drawings = new Map<string, DrawingRecord>()
const revisions = new Map<string, RevisionRecord>()
const revisionContents = new Map<string, Record<string, unknown>>()
const revisionQuantities = new Map<string, readonly Record<string, unknown>[]>()
const exportJobs = new Map<string, ExportJobRecord>()
const auditLogs: AuditLogRecord[] = []

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`}`
}

function seedData(): void {
  if (projects.size > 0) return
  const project: ProjectRecord = {
    id: 'project-demo-1',
    projectNumber: 'PRJ-245-2026',
    name: '国道245号 道路拡幅工事',
    clientName: '○○県土木部',
    status: 'active',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
  const drawing: DrawingRecord = {
    id: 'drawing-demo-1',
    projectId: project.id,
    drawingNumber: 'DWG-014',
    name: '施工ヤード計画図',
    drawingType: '施工ヤード図',
    status: 'active',
    activeRevisionId: 'revision-demo-1',
    settings: { paperSize: 'A1 landscape', scale: '1:500', unit: 'm' },
  }
  const revision: RevisionRecord = {
    id: drawing.activeRevisionId,
    drawingId: drawing.id,
    revisionNumber: '3',
    status: 'draft',
    changeSummary: '施工ヤード計画図 Rev.3',
    contentVersion: 1,
    contentChecksum: 'demo-checksum-rev3',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
  projects.set(project.id, project)
  drawings.set(drawing.id, drawing)
  revisions.set(revision.id, revision)
  revisionContents.set(revision.id, {
    schemaVersion: 1,
    geometries: [],
    layers: [],
  })
  revisionQuantities.set(revision.id, [
    { name: '掘削', unit: 'm3', quantity: 1250.5, status: 'unconfirmed' },
    { name: '仮設材', unit: '式', quantity: 1, status: 'confirmed' },
  ])
  auditLogs.push({
    id: 'audit-demo-1',
    occurredAt: '2026-07-16T10:42:00.000Z',
    eventName: 'drawing.saved',
    actorId: 'taro.yamada@example.jp',
    entityType: 'drawing',
    entityId: drawing.id,
    result: 'success',
    correlationId: 'seed',
    detail: { drawingNumber: drawing.drawingNumber },
  })
}

function resolveCorrelationId(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER)
  if (provided && provided.trim() !== '') return provided
  return globalThis.crypto?.randomUUID?.() ?? `cid-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

function jsonResponse(value: unknown, correlationId: string, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: correlationId,
    },
  })
}

function errorResponse(status: number, code: string, message: string, correlationId: string): Response {
  return jsonResponse({ error: { code, message }, correlationId }, correlationId, status)
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.body === null) return {}
  const value = (await request.json()) as unknown
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function matchRoute(method: string, pathname: string): ApiRoute | undefined {
  return API_ROUTES.find((entry) => entry.method === method && entry.pattern.test(pathname))
}

function paramsOf(routeMatch: ApiRoute, pathname: string): Record<string, string> {
  const match = routeMatch.pattern.exec(pathname)
  const params: Record<string, string> = {}
  routeMatch.paramNames.forEach((name, index) => {
    params[name] = decodeURIComponent(match?.[index + 1] ?? '')
  })
  return params
}

function actorFromRequest(request: Request): { readonly id: string; readonly actor: WorkflowActor } {
  const role = request.headers.get('X-CivilDraft-Role') ?? 'supervisor'
  return {
    id: request.headers.get('X-CivilDraft-User') ?? 'demo.user@example.jp',
    actor: {
      canEdit: role === 'engineer' || role === 'supervisor',
      canApprove: role === 'supervisor',
    },
  }
}

function recordAudit(eventName: string, actorId: string, entityType: string, entityId: string, correlationId: string, detail: Record<string, unknown> = {}): void {
  auditLogs.unshift({
    id: newId('audit'),
    occurredAt: nowIso(),
    eventName,
    actorId,
    entityType,
    entityId,
    result: 'success',
    correlationId,
    detail,
  })
}

async function handleMatched(request: Request, routeMatch: ApiRoute, correlationId: string): Promise<Response> {
  const url = new URL(request.url)
  const params = paramsOf(routeMatch, url.pathname)
  const actor = actorFromRequest(request)

  if (routeMatch.method === 'GET' && routeMatch.template === '/api/v1/projects') {
    return jsonResponse({ projects: [...projects.values()] }, correlationId)
  }
  if (routeMatch.method === 'POST' && routeMatch.template === '/api/v1/projects') {
    const body = await readJson(request)
    const project: ProjectRecord = {
      id: newId('project'),
      projectNumber: String(body.projectNumber ?? `PRJ-${projects.size + 1}`),
      name: String(body.name ?? '新規案件'),
      clientName: String(body.clientName ?? ''),
      status: 'active',
      updatedAt: nowIso(),
    }
    projects.set(project.id, project)
    recordAudit('project.created', actor.id, 'project', project.id, correlationId)
    return jsonResponse({ project }, correlationId, 201)
  }
  if (routeMatch.template === '/api/v1/projects/{projectId}') {
    const project = projects.get(params.projectId ?? '')
    if (!project) return errorResponse(404, ERROR_CODES.notFound, '案件が見つかりません', correlationId)
    if (routeMatch.method === 'GET') return jsonResponse({ project }, correlationId)
    const body = await readJson(request)
    const updated: ProjectRecord = { ...project, name: String(body.name ?? project.name), clientName: String(body.clientName ?? project.clientName), updatedAt: nowIso() }
    projects.set(updated.id, updated)
    recordAudit('project.updated', actor.id, 'project', updated.id, correlationId)
    return jsonResponse({ project: updated }, correlationId)
  }
  if (routeMatch.template === '/api/v1/projects/{projectId}/drawings') {
    const projectId = params.projectId ?? ''
    if (!projects.has(projectId)) return errorResponse(404, ERROR_CODES.notFound, '案件が見つかりません', correlationId)
    if (routeMatch.method === 'GET') {
      return jsonResponse({ drawings: [...drawings.values()].filter((drawing) => drawing.projectId === projectId) }, correlationId)
    }
    const body = await readJson(request)
    const revisionId = newId('revision')
    const drawing: DrawingRecord = {
      id: newId('drawing'),
      projectId,
      drawingNumber: String(body.drawingNumber ?? `DWG-${drawings.size + 1}`),
      name: String(body.name ?? '新規図面'),
      drawingType: String(body.drawingType ?? '施工ヤード図'),
      status: 'active',
      activeRevisionId: revisionId,
      settings: {},
    }
    const revision: RevisionRecord = {
      id: revisionId,
      drawingId: drawing.id,
      revisionNumber: '1',
      status: 'draft',
      changeSummary: '初版',
      contentVersion: 1,
      contentChecksum: 'empty',
      updatedAt: nowIso(),
    }
    drawings.set(drawing.id, drawing)
    revisions.set(revision.id, revision)
    revisionContents.set(revision.id, { schemaVersion: 1, geometries: [], layers: [] })
    recordAudit('drawing.created', actor.id, 'drawing', drawing.id, correlationId)
    return jsonResponse({ drawing, revision }, correlationId, 201)
  }
  if (routeMatch.template === '/api/v1/drawings/{drawingId}') {
    const drawing = drawings.get(params.drawingId ?? '')
    if (!drawing) return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', correlationId)
    if (routeMatch.method === 'GET') return jsonResponse({ drawing }, correlationId)
    const body = await readJson(request)
    const updated: DrawingRecord = { ...drawing, name: String(body.name ?? drawing.name), drawingType: String(body.drawingType ?? drawing.drawingType) }
    drawings.set(updated.id, updated)
    recordAudit('drawing.updated', actor.id, 'drawing', updated.id, correlationId)
    return jsonResponse({ drawing: updated }, correlationId)
  }
  if (routeMatch.method === 'POST' && routeMatch.template === '/api/v1/drawings/{drawingId}/revisions') {
    const drawing = drawings.get(params.drawingId ?? '')
    if (!drawing) return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', correlationId)
    const current = revisions.get(drawing.activeRevisionId)
    const nextNumber = String(Number(current?.revisionNumber ?? '0') + 1)
    const revision: RevisionRecord = {
      id: newId('revision'),
      drawingId: drawing.id,
      revisionNumber: nextNumber,
      status: 'draft',
      changeSummary: '新規改訂',
      contentVersion: 1,
      contentChecksum: current?.contentChecksum ?? 'empty',
      updatedAt: nowIso(),
    }
    revisions.set(revision.id, revision)
    drawings.set(drawing.id, { ...drawing, activeRevisionId: revision.id })
    revisionContents.set(revision.id, revisionContents.get(drawing.activeRevisionId) ?? {})
    recordAudit('revision.created', actor.id, 'revision', revision.id, correlationId)
    return jsonResponse({ revision }, correlationId, 201)
  }
  if (routeMatch.template.startsWith('/api/v1/revisions/{revisionId}')) {
    const revision = revisions.get(params.revisionId ?? '')
    if (!revision) return errorResponse(404, ERROR_CODES.notFound, '改訂が見つかりません', correlationId)
    if (routeMatch.method === 'GET' && routeMatch.template === '/api/v1/revisions/{revisionId}') return jsonResponse({ revision }, correlationId)
    if (routeMatch.method === 'GET' && routeMatch.template === '/api/v1/revisions/{revisionId}/content') return jsonResponse({ content: revisionContents.get(revision.id) ?? {} }, correlationId)
    if (routeMatch.method === 'PUT' && routeMatch.template === '/api/v1/revisions/{revisionId}/content') {
      if (revision.status !== 'draft') return errorResponse(409, ERROR_CODES.conflict, 'draft以外の内容は更新できません', correlationId)
      const body = await readJson(request)
      revisionContents.set(revision.id, body)
      const updated = { ...revision, contentVersion: revision.contentVersion + 1, contentChecksum: `checksum-${revision.contentVersion + 1}`, updatedAt: nowIso() }
      revisions.set(revision.id, updated)
      recordAudit('revision.content.updated', actor.id, 'revision', revision.id, correlationId)
      return jsonResponse({ revision: updated, content: body }, correlationId)
    }
    if (routeMatch.method === 'GET' && routeMatch.template === '/api/v1/revisions/{revisionId}/quantities') return jsonResponse({ quantities: revisionQuantities.get(revision.id) ?? [] }, correlationId)
    if (routeMatch.method === 'PUT' && routeMatch.template === '/api/v1/revisions/{revisionId}/quantities') {
      const body = await readJson(request)
      const quantities = Array.isArray(body.quantities) ? body.quantities.filter((item) => item !== null && typeof item === 'object') as readonly Record<string, unknown>[] : []
      revisionQuantities.set(revision.id, quantities)
      recordAudit('revision.quantities.updated', actor.id, 'revision', revision.id, correlationId)
      return jsonResponse({ quantities }, correlationId)
    }
    if (routeMatch.method === 'POST' && routeMatch.template === '/api/v1/revisions/{revisionId}/workflow-actions') {
      const body = await readJson(request)
      const action = String(body.action ?? '') as RevisionAction
      const result = applyRevisionAction({
        current: revision.status,
        action,
        actor: actor.actor,
        actorId: actor.id,
        timestamp: nowIso(),
        context: {
          mandatoryChecksPassed: true,
          hasStaleQuantities: false,
          reviewResultRecorded: true,
          checksumMatches: true,
          comment: typeof body.comment === 'string' ? body.comment : undefined,
          obsoleteReason: typeof body.comment === 'string' ? body.comment : undefined,
          returnReason: typeof body.comment === 'string' ? body.comment : undefined,
          currentRevisionNumber: revision.revisionNumber,
          newRevisionNumber: String(Number(revision.revisionNumber) + 1),
        },
      })
      if (!result.ok) return errorResponse(400, ERROR_CODES.badRequest, result.error.message, correlationId)
      const updated = { ...revision, status: result.value.nextStatus, updatedAt: nowIso() }
      revisions.set(revision.id, updated)
      recordAudit('revision.workflow', actor.id, 'revision', revision.id, correlationId, { action })
      return jsonResponse({ revision: updated, history: result.value.history }, correlationId)
    }
    if (routeMatch.method === 'POST' && routeMatch.template === '/api/v1/revisions/{revisionId}/exports') {
      const body = await readJson(request)
      const format = String(body.format ?? 'pdf') as ExportJobRecord['format']
      if (!['pdf', 'dxf', 'csv'].includes(format)) return errorResponse(400, ERROR_CODES.badRequest, 'formatはpdf/dxf/csvのいずれかです', correlationId)
      const job: ExportJobRecord = { id: newId('export'), revisionId: revision.id, format, status: 'completed', objectKey: `exports/${revision.id}.${format}`, createdAt: nowIso() }
      exportJobs.set(job.id, job)
      recordAudit('export.created', actor.id, 'export', job.id, correlationId, { format })
      return jsonResponse({ export: job }, correlationId, 201)
    }
  }
  if (routeMatch.method === 'GET' && routeMatch.template === '/api/v1/exports/{exportId}') {
    const job = exportJobs.get(params.exportId ?? '')
    if (!job) return errorResponse(404, ERROR_CODES.notFound, '出力ジョブが見つかりません', correlationId)
    return jsonResponse({ export: job, downloadUrl: `/api/v1/exports/${job.id}/download` }, correlationId)
  }
  if (routeMatch.method === 'GET' && routeMatch.template === '/api/v1/audit-logs') {
    return jsonResponse({ auditLogs }, correlationId)
  }
  return errorResponse(404, ERROR_CODES.notFound, '該当するエンドポイントがありません', correlationId)
}

export async function handleRequest(request: Request): Promise<Response> {
  seedData()
  const correlationId = resolveCorrelationId(request)
  const url = new URL(request.url)

  const accessJwt = request.headers.get(ACCESS_JWT_HEADER)
  if (!accessJwt || accessJwt.trim() === '') {
    return errorResponse(401, ERROR_CODES.unauthenticated, '認証情報（Cf-Access-Jwt-Assertion）がありません', correlationId)
  }

  const matched = matchRoute(request.method, url.pathname)
  if (!matched) return errorResponse(404, ERROR_CODES.notFound, '該当するエンドポイントがありません', correlationId)
  try {
    return await handleMatched(request, matched, correlationId)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return errorResponse(400, ERROR_CODES.badRequest, 'JSON形式が不正です', correlationId)
    }
    return errorResponse(500, ERROR_CODES.internal, 'サーバー内部で処理に失敗しました', correlationId)
  }
}

export default {
  fetch(request: Request, _env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request)
  },
}

/**
 * CivilDraft Workers API (詳細設計仕様書 §25).
 *
 * 現在の到達点:
 * - §25.2 の18エンドポイントをルーティング表として維持する。
 * - P0縦線として Project作成 → Drawing作成 → Revision作成 → Content/数量保存 →
 *   照査/承認 → Export作成 → Audit検索を実装する。
 * - 共有CADの最低限の契約として、案件メンバー認可とメタデータ/内容/数量更新の楽観ロックを検査する。
 * - 本番Neon/R2接続は秘密情報と人間承認を要するため、このファイルではストレージ境界と
 *   開発/テスト用インメモリ実装に留める。
 */

import { createMemoryStore } from './apiStore'
import { inspectProductionPersistenceReadiness, resolvePersistenceMode } from './persistence'
import type {
  ApiStore,
  AuditLogRecord,
  ContentRecord,
  DrawingRecord,
  ExportFormat,
  ExportJobRecord,
  ProjectRecord,
  ProjectRole,
  QuantityItemRecord,
  QuantityMethod,
  QuantitySnapshotRecord,
  QuantitySourceRecord,
  QuantityStatus,
  QuantityUnit,
  RevisionRecord,
  WorkflowAction,
  WorkflowActionRecord,
} from './apiStore'

export { createMemoryStore } from './apiStore'

export interface WorkerEnv {
  CIVILDRAFT_DEV_STORE?: ApiStore
  CIVILDRAFT_API_MODE?: 'memory' | 'neon-r2'
  [key: string]: unknown
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion'
const ACCESS_USER_HEADER = 'Cf-Access-Authenticated-User-Email'
const CORRELATION_ID_HEADER = 'X-Correlation-Id'

const ERROR_CODES = {
  unauthenticated: 'CD-AUTH-001',
  forbidden: 'CD-AUTH-002',
  invalidRequest: 'CD-REQ-001',
  notFound: 'CD-SYS-001',
  conflict: 'CD-CONFLICT-001',
  preconditionRequired: 'CD-CONFLICT-002',
  persistenceUnavailable: 'CD-SYS-002',
  notImplemented: 'CD-SYS-001',
  internal: 'CD-SYS-003',
} as const

interface ApiRoute {
  readonly method: string
  readonly template: string
  readonly summary: string
  readonly pattern: RegExp
}

interface RouteMatch {
  readonly route: ApiRoute
  readonly params: Readonly<Record<string, string>>
}

interface RequestContext {
  readonly actorId: string
  readonly correlationId: string
  readonly url: URL
}

interface CreateProjectBody {
  readonly projectNumber?: unknown
  readonly name?: unknown
  readonly clientName?: unknown
}

interface UpdateProjectBody {
  readonly expectedVersion?: unknown
  readonly projectNumber?: unknown
  readonly name?: unknown
  readonly clientName?: unknown
  readonly status?: unknown
}

interface CreateDrawingBody {
  readonly drawingNumber?: unknown
  readonly name?: unknown
  readonly drawingType?: unknown
  readonly settings?: unknown
}

interface UpdateDrawingBody {
  readonly expectedVersion?: unknown
  readonly drawingNumber?: unknown
  readonly name?: unknown
  readonly drawingType?: unknown
  readonly settings?: unknown
  readonly status?: unknown
}

interface CreateRevisionBody {
  readonly revisionNumber?: unknown
  readonly changeSummary?: unknown
  readonly basedOnRevisionId?: unknown
  readonly contentChecksum?: unknown
}

interface PutContentBody {
  readonly content?: unknown
  readonly schemaVersion?: unknown
  readonly contentChecksum?: unknown
  readonly expectedContentVersion?: unknown
}

interface PutQuantitiesBody {
  readonly items?: unknown
  readonly expectedQuantityVersion?: unknown
}

interface WorkflowActionBody {
  readonly action?: unknown
  readonly comment?: unknown
  readonly returnReason?: unknown
  readonly obsoleteReason?: unknown
  readonly mandatoryChecksPassed?: unknown
  readonly reviewResultRecorded?: unknown
  readonly contentChecksum?: unknown
}

interface CreateExportBody {
  readonly format?: unknown
}

function compileTemplate(template: string): RegExp {
  const escaped = template
    .split('/')
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}')
        ? `(?<${segment.slice(1, -1)}>[^/]+)`
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/')
  return new RegExp(`^${escaped}$`)
}

function route(method: string, template: string, summary: string): ApiRoute {
  return { method, template, summary, pattern: compileTemplate(template) }
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

const moduleStore = createMemoryStore()

function resolveStore(env: WorkerEnv): ApiStore | undefined {
  if (env.CIVILDRAFT_DEV_STORE) {
    return env.CIVILDRAFT_DEV_STORE
  }
  // Fail closed: the in-process store serves requests only when 'memory' is
  // explicitly configured. Unset or unrecognized modes are treated as
  // unconfigured persistence and rejected with 503 (never a silent fallback).
  if (resolvePersistenceMode(env.CIVILDRAFT_API_MODE) === 'memory') {
    return moduleStore
  }
  return undefined
}

function persistenceUnavailableResponse(env: WorkerEnv, correlationId: string): Response {
  if (resolvePersistenceMode(env.CIVILDRAFT_API_MODE) === undefined) {
    return errorResponse(
      503,
      ERROR_CODES.persistenceUnavailable,
      "CIVILDRAFT_API_MODE が未設定または不正です（'memory' または 'neon-r2' を明示設定してください）",
      correlationId,
    )
  }
  const readiness = inspectProductionPersistenceReadiness(env)
  return errorResponse(
    503,
    ERROR_CODES.persistenceUnavailable,
    readiness.ready
      ? 'Neon/R2永続化アダプタは未接続です'
      : `Neon/R2永続化に必要なbindingが未設定です: ${readiness.missingBindings.join(', ')}`,
    correlationId,
  )
}

function resolveCorrelationId(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER)
  if (provided && provided.trim() !== '') {
    return provided
  }
  return createId('cid')
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) {
    return `${prefix}_${uuid}`
  }
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function jsonResponse(status: number, body: unknown, correlationId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: correlationId,
    },
  })
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
): Response {
  return jsonResponse(status, { error: { code, message }, correlationId }, correlationId)
}

export function matchRoute(method: string, pathname: string): ApiRoute | undefined {
  return API_ROUTES.find((entry) => entry.method === method && entry.pattern.test(pathname))
}

function matchRouteWithParams(method: string, pathname: string): RouteMatch | undefined {
  for (const entry of API_ROUTES) {
    if (entry.method !== method) continue
    const matched = entry.pattern.exec(pathname)
    if (matched) {
      return { route: entry, params: matched.groups ?? {} }
    }
  }
  return undefined
}

/**
 * リクエスト内容起因の既知エラー。catch側でこれ以外の例外（実装バグ等）と区別し、
 * 前者のみクライアントへ詳細メッセージを返す（後者は500+ログに丸める）。
 */
class ValidationError extends Error {}

function requireParam(params: Readonly<Record<string, string>>, name: string): string {
  const value = params[name]
  if (!value) {
    throw new ValidationError(`Route parameter '${name}' is missing`)
  }
  return value
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
  if (!isRecord(parsed)) {
    throw new ValidationError('JSON object body is required')
  }
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value)
  if (!parsed) {
    throw new ValidationError(`${field} is required`)
  }
  return parsed
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer`)
  }
  return value
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`)
  }
  return parsed
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return requiredPositiveInteger(parsed, field)
  }
  return requiredPositiveInteger(value, field)
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function findProjectByNumber(store: ApiStore, projectNumber: string): ProjectRecord | undefined {
  return [...store.projects.values()].find((p) => p.projectNumber === projectNumber)
}

function findDrawingByNumber(
  store: ApiStore,
  projectId: string,
  drawingNumber: string,
): DrawingRecord | undefined {
  return [...store.drawings.values()].find(
    (d) => d.projectId === projectId && d.drawingNumber === drawingNumber,
  )
}

function findRevisionByNumber(
  store: ApiStore,
  drawingId: string,
  revisionNumber: string,
): RevisionRecord | undefined {
  return [...store.revisions.values()].find(
    (r) => r.drawingId === drawingId && r.revisionNumber === revisionNumber,
  )
}

function appendAudit(
  store: ApiStore,
  ctx: RequestContext,
  input: Omit<AuditLogRecord, 'id' | 'occurredAt' | 'actorId' | 'correlationId'>,
): AuditLogRecord {
  const audit: AuditLogRecord = {
    id: createId('audit'),
    occurredAt: nowIso(),
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    ...input,
  }
  store.auditLogs.push(audit)
  return audit
}

function memberKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`
}

function roleCanView(role: ProjectRole): boolean {
  return ['viewer', 'editor', 'reviewer', 'approver', 'manager'].includes(role)
}

function roleCanEdit(role: ProjectRole): boolean {
  return ['editor', 'approver', 'manager'].includes(role)
}

function roleCanReview(role: ProjectRole): boolean {
  return ['reviewer', 'approver', 'manager'].includes(role)
}

function roleCanApprove(role: ProjectRole): boolean {
  return ['approver', 'manager'].includes(role)
}

function roleCanManage(role: ProjectRole): boolean {
  return role === 'manager'
}

function getProjectRole(
  store: ApiStore,
  projectId: string,
  actorId: string,
): ProjectRole | undefined {
  return store.projectMembers.get(memberKey(projectId, actorId))?.role
}

function authorizeProject(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  action: 'view' | 'edit' | 'manage',
): Response | undefined {
  const role = getProjectRole(store, projectId, ctx.actorId)
  const allowed =
    role !== undefined &&
    (action === 'view'
      ? roleCanView(role)
      : action === 'edit'
        ? roleCanEdit(role)
        : roleCanManage(role))

  if (allowed) {
    return undefined
  }

  appendAudit(store, ctx, {
    eventName: `authorization.${action}.denied`,
    projectId,
    entityType: 'project',
    entityId: projectId,
    result: 'failure',
    detail: { action },
  })
  return errorResponse(403, ERROR_CODES.forbidden, 'この案件への権限がありません', ctx.correlationId)
}

function getRevisionWithDrawing(
  store: ApiStore,
  ctx: RequestContext,
  revisionId: string,
  action: 'view' | 'edit',
): { revision: RevisionRecord; drawing: DrawingRecord } | Response {
  const revision = store.revisions.get(revisionId)
  if (!revision) {
    return errorResponse(404, ERROR_CODES.notFound, '改訂が見つかりません', ctx.correlationId)
  }
  const drawing = store.drawings.get(revision.drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, drawing.projectId, action)
  if (denied) return denied
  return { revision, drawing }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response
}

function parseQuantityItem(value: unknown, revisionId: string, index: number): QuantityItemRecord {
  if (!isRecord(value)) {
    throw new ValidationError(`items[${index}] must be an object`)
  }
  const id = requiredString(value.id, `items[${index}].id`)
  const groupKey = requiredString(value.groupKey, `items[${index}].groupKey`)
  const method = requiredString(value.method, `items[${index}].method`) as QuantityMethod
  if (!['length', 'area', 'perimeter', 'count', 'volume', 'manual'].includes(method)) {
    throw new ValidationError(`items[${index}].method is invalid`)
  }
  const unit = requiredString(value.unit, `items[${index}].unit`) as QuantityUnit
  if (!['m', 'm2', 'm3', 'count', 'set', 'custom'].includes(unit)) {
    throw new ValidationError(`items[${index}].unit is invalid`)
  }
  const status = requiredString(value.status, `items[${index}].status`) as QuantityStatus
  if (!['valid', 'stale', 'invalid', 'manuallyAdjusted'].includes(status)) {
    throw new ValidationError(`items[${index}].status is invalid`)
  }
  const rawValue = Number(value.rawValue)
  const roundedValue = Number(value.roundedValue)
  if (!Number.isFinite(rawValue) || !Number.isFinite(roundedValue)) {
    throw new ValidationError(`items[${index}].rawValue and roundedValue must be finite numbers`)
  }
  const sourcesValue = Array.isArray(value.sources) ? value.sources : []
  const sources = sourcesValue.map((source, sourceIndex): QuantitySourceRecord => {
    if (!isRecord(source)) {
      throw new ValidationError(`items[${index}].sources[${sourceIndex}] must be an object`)
    }
    const contributionRaw = Number(source.contributionRaw)
    if (!Number.isFinite(contributionRaw)) {
      throw new ValidationError(`items[${index}].sources[${sourceIndex}].contributionRaw must be a finite number`)
    }
    return {
      geometryId: requiredString(source.geometryId, `items[${index}].sources[${sourceIndex}].geometryId`),
      contributionRaw,
    }
  })
  return {
    id,
    revisionId,
    groupKey,
    workType: optionalString(value.workType),
    specification: optionalString(value.specification),
    method,
    unit,
    rawValue,
    roundedValue,
    sources,
    status,
  }
}

function parseWorkflowAction(value: unknown): WorkflowAction {
  const action = requiredString(value, 'action') as WorkflowAction
  if (!['submitReview', 'resumeEditing', 'return', 'completeReview', 'approve', 'obsolete'].includes(action)) {
    throw new ValidationError('action is invalid')
  }
  return action
}

function parseExportFormat(value: unknown): ExportFormat {
  const format = requiredString(value, 'format') as ExportFormat
  if (!['pdf', 'dxf', 'csv', 'json'].includes(format)) {
    throw new ValidationError('format must be one of pdf, dxf, csv, json')
  }
  return format
}

function parseLifecycleStatus(value: unknown, field: string): 'active' | 'archived' | undefined {
  if (value === undefined || value === null) return undefined
  const status = requiredString(value, field) as 'active' | 'archived'
  if (!['active', 'archived'].includes(status)) {
    throw new ValidationError(`${field} must be active or archived`)
  }
  return status
}

function workflowTargetStatus(
  current: RevisionRecord['status'],
  action: WorkflowAction,
): RevisionRecord['status'] | undefined {
  if (current === 'draft' && action === 'submitReview') return 'inReview'
  if (current === 'returned' && action === 'resumeEditing') return 'draft'
  if (current === 'inReview' && action === 'return') return 'returned'
  if (current === 'inReview' && action === 'completeReview') return 'pendingApproval'
  if (current === 'pendingApproval' && action === 'return') return 'returned'
  if (current === 'pendingApproval' && action === 'approve') return 'approved'
  if (current === 'approved' && action === 'obsolete') return 'obsolete'
  return undefined
}

function authorizeWorkflowAction(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  action: WorkflowAction,
): Response | undefined {
  const role = getProjectRole(store, projectId, ctx.actorId)
  const allowed =
    role !== undefined &&
    (action === 'submitReview' || action === 'resumeEditing'
      ? roleCanEdit(role)
      : action === 'completeReview' || action === 'return'
        ? roleCanReview(role)
        : roleCanApprove(role))
  if (allowed) return undefined
  appendAudit(store, ctx, {
    eventName: `workflow.${action}.denied`,
    projectId,
    entityType: 'revision',
    result: 'failure',
    detail: { action },
  })
  return errorResponse(403, ERROR_CODES.forbidden, 'このワークフロー操作を実行する権限がありません', ctx.correlationId)
}

async function createProject(
  store: ApiStore,
  ctx: RequestContext,
  body: CreateProjectBody,
): Promise<Response> {
  const projectNumber = requiredString(body.projectNumber, 'projectNumber')
  if (findProjectByNumber(store, projectNumber)) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `projectNumber '${projectNumber}' already exists`,
      ctx.correlationId,
    )
  }

  const createdAt = nowIso()
  const project: ProjectRecord = {
    id: createId('project'),
    projectNumber,
    name: requiredString(body.name, 'name'),
    clientName: optionalString(body.clientName),
    status: 'active',
    createdAt,
    createdBy: ctx.actorId,
    updatedAt: createdAt,
    updatedBy: ctx.actorId,
    version: 1,
  }
  store.projects.set(project.id, project)
  store.projectMembers.set(memberKey(project.id, ctx.actorId), {
    projectId: project.id,
    userId: ctx.actorId,
    role: 'manager',
    createdAt,
    updatedAt: createdAt,
  })
  appendAudit(store, ctx, {
    eventName: 'project.created',
    projectId: project.id,
    entityType: 'project',
    entityId: project.id,
    result: 'success',
    detail: { projectNumber: project.projectNumber },
  })
  return jsonResponse(201, { project }, ctx.correlationId)
}

function listProjects(store: ApiStore, ctx: RequestContext): Response {
  const projectIds = new Set(
    [...store.projectMembers.values()]
      .filter((member) => member.userId === ctx.actorId && roleCanView(member.role))
      .map((member) => member.projectId),
  )
  const projects = [...store.projects.values()].filter((project) => projectIds.has(project.id))
  return jsonResponse(200, { projects }, ctx.correlationId)
}

function getProject(store: ApiStore, ctx: RequestContext, projectId: string): Response {
  const project = store.projects.get(projectId)
  if (!project) {
    return errorResponse(404, ERROR_CODES.notFound, '案件が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, projectId, 'view')
  if (denied) return denied
  return jsonResponse(200, { project }, ctx.correlationId)
}

function updateProject(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  body: UpdateProjectBody,
): Response {
  const project = store.projects.get(projectId)
  if (!project) {
    return errorResponse(404, ERROR_CODES.notFound, '案件が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, projectId, 'manage')
  if (denied) return denied

  const expectedVersion =
    optionalPositiveInteger(body.expectedVersion, 'expectedVersion') ??
    optionalPositiveInteger(ctx.url.searchParams.get('expectedVersion'), 'expectedVersion')
  if (expectedVersion === undefined) {
    return errorResponse(
      428,
      ERROR_CODES.preconditionRequired,
      '案件更新には expectedVersion が必要です',
      ctx.correlationId,
    )
  }
  if (expectedVersion !== project.version) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `project.version が一致しません（expected=${expectedVersion}, current=${project.version}）`,
      ctx.correlationId,
    )
  }

  const projectNumber = optionalString(body.projectNumber)
  if (projectNumber) {
    const duplicated = findProjectByNumber(store, projectNumber)
    if (duplicated && duplicated.id !== project.id) {
      return errorResponse(
        409,
        ERROR_CODES.conflict,
        `projectNumber '${projectNumber}' already exists`,
        ctx.correlationId,
      )
    }
  }

  const updatedAt = nowIso()
  const updatedProject: ProjectRecord = {
    ...project,
    projectNumber: projectNumber ?? project.projectNumber,
    name: optionalString(body.name) ?? project.name,
    clientName: optionalString(body.clientName) ?? project.clientName,
    status: parseLifecycleStatus(body.status, 'status') ?? project.status,
    updatedAt,
    updatedBy: ctx.actorId,
    version: project.version + 1,
  }
  store.projects.set(projectId, updatedProject)
  appendAudit(store, ctx, {
    eventName: 'project.updated',
    projectId,
    entityType: 'project',
    entityId: projectId,
    result: 'success',
    detail: {
      expectedVersion,
      version: updatedProject.version,
      changedFields: Object.keys(body).filter((key) => key !== 'expectedVersion'),
    },
  })
  return jsonResponse(200, { project: updatedProject }, ctx.correlationId)
}

async function createDrawing(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  body: CreateDrawingBody,
): Promise<Response> {
  const project = store.projects.get(projectId)
  if (!project) {
    return errorResponse(404, ERROR_CODES.notFound, '案件が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, projectId, 'edit')
  if (denied) return denied
  const drawingNumber = requiredString(body.drawingNumber, 'drawingNumber')
  if (findDrawingByNumber(store, projectId, drawingNumber)) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `drawingNumber '${drawingNumber}' already exists in project`,
      ctx.correlationId,
    )
  }

  const createdAt = nowIso()
  const drawing: DrawingRecord = {
    id: createId('drawing'),
    projectId,
    drawingNumber,
    name: requiredString(body.name, 'name'),
    drawingType: optionalString(body.drawingType) ?? 'general',
    settings: body.settings ?? {},
    status: 'active',
    createdAt,
    createdBy: ctx.actorId,
    updatedAt: createdAt,
    updatedBy: ctx.actorId,
    version: 1,
  }
  store.drawings.set(drawing.id, drawing)
  appendAudit(store, ctx, {
    eventName: 'drawing.created',
    projectId,
    entityType: 'drawing',
    entityId: drawing.id,
    result: 'success',
    detail: { drawingNumber: drawing.drawingNumber },
  })
  return jsonResponse(201, { drawing }, ctx.correlationId)
}

function listDrawings(store: ApiStore, ctx: RequestContext, projectId: string): Response {
  if (!store.projects.has(projectId)) {
    return errorResponse(404, ERROR_CODES.notFound, '案件が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, projectId, 'view')
  if (denied) return denied
  const drawings = [...store.drawings.values()].filter((d) => d.projectId === projectId)
  return jsonResponse(200, { drawings }, ctx.correlationId)
}

function getDrawing(store: ApiStore, ctx: RequestContext, drawingId: string): Response {
  const drawing = store.drawings.get(drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, drawing.projectId, 'view')
  if (denied) return denied
  return jsonResponse(200, { drawing }, ctx.correlationId)
}

function updateDrawing(
  store: ApiStore,
  ctx: RequestContext,
  drawingId: string,
  body: UpdateDrawingBody,
): Response {
  const drawing = store.drawings.get(drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, drawing.projectId, 'edit')
  if (denied) return denied

  const expectedVersion =
    optionalPositiveInteger(body.expectedVersion, 'expectedVersion') ??
    optionalPositiveInteger(ctx.url.searchParams.get('expectedVersion'), 'expectedVersion')
  if (expectedVersion === undefined) {
    return errorResponse(
      428,
      ERROR_CODES.preconditionRequired,
      '図面更新には expectedVersion が必要です',
      ctx.correlationId,
    )
  }
  if (expectedVersion !== drawing.version) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `drawing.version が一致しません（expected=${expectedVersion}, current=${drawing.version}）`,
      ctx.correlationId,
    )
  }

  const drawingNumber = optionalString(body.drawingNumber)
  if (drawingNumber) {
    const duplicated = findDrawingByNumber(store, drawing.projectId, drawingNumber)
    if (duplicated && duplicated.id !== drawing.id) {
      return errorResponse(
        409,
        ERROR_CODES.conflict,
        `drawingNumber '${drawingNumber}' already exists in project`,
        ctx.correlationId,
      )
    }
  }

  const updatedAt = nowIso()
  const updatedDrawing: DrawingRecord = {
    ...drawing,
    drawingNumber: drawingNumber ?? drawing.drawingNumber,
    name: optionalString(body.name) ?? drawing.name,
    drawingType: optionalString(body.drawingType) ?? drawing.drawingType,
    settings: body.settings === undefined ? drawing.settings : body.settings,
    status: parseLifecycleStatus(body.status, 'status') ?? drawing.status,
    updatedAt,
    updatedBy: ctx.actorId,
    version: drawing.version + 1,
  }
  store.drawings.set(drawingId, updatedDrawing)
  appendAudit(store, ctx, {
    eventName: 'drawing.updated',
    projectId: drawing.projectId,
    entityType: 'drawing',
    entityId: drawingId,
    result: 'success',
    detail: {
      expectedVersion,
      version: updatedDrawing.version,
      changedFields: Object.keys(body).filter((key) => key !== 'expectedVersion'),
    },
  })
  return jsonResponse(200, { drawing: updatedDrawing }, ctx.correlationId)
}

async function createRevision(
  store: ApiStore,
  ctx: RequestContext,
  drawingId: string,
  body: CreateRevisionBody,
): Promise<Response> {
  const drawing = store.drawings.get(drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, drawing.projectId, 'edit')
  if (denied) return denied
  const revisionNumber = requiredString(body.revisionNumber, 'revisionNumber')
  if (findRevisionByNumber(store, drawingId, revisionNumber)) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `revisionNumber '${revisionNumber}' already exists in drawing`,
      ctx.correlationId,
    )
  }

  const createdAt = nowIso()
  const revision: RevisionRecord = {
    id: createId('revision'),
    drawingId,
    revisionNumber,
    status: 'draft',
    changeSummary: requiredString(body.changeSummary, 'changeSummary'),
    basedOnRevisionId: optionalString(body.basedOnRevisionId),
    contentVersion: 1,
    contentChecksum: optionalString(body.contentChecksum) ?? 'sha256:empty',
    createdAt,
    createdBy: ctx.actorId,
    updatedAt: createdAt,
    updatedBy: ctx.actorId,
  }
  store.revisions.set(revision.id, revision)
  store.drawings.set(drawing.id, { ...drawing, activeRevisionId: revision.id })
  appendAudit(store, ctx, {
    eventName: 'revision.created',
    projectId: drawing.projectId,
    entityType: 'revision',
    entityId: revision.id,
    result: 'success',
    detail: { revisionNumber: revision.revisionNumber },
  })
  return jsonResponse(201, { revision }, ctx.correlationId)
}

function getRevision(store: ApiStore, ctx: RequestContext, revisionId: string): Response {
  const revision = store.revisions.get(revisionId)
  if (!revision) {
    return errorResponse(404, ERROR_CODES.notFound, '改訂が見つかりません', ctx.correlationId)
  }
  const drawing = store.drawings.get(revision.drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, drawing.projectId, 'view')
  if (denied) return denied
  return jsonResponse(200, { revision }, ctx.correlationId)
}

async function putRevisionContent(
  store: ApiStore,
  ctx: RequestContext,
  revisionId: string,
  body: PutContentBody,
): Promise<Response> {
  const revision = store.revisions.get(revisionId)
  if (!revision) {
    return errorResponse(404, ERROR_CODES.notFound, '改訂が見つかりません', ctx.correlationId)
  }
  const drawing = store.drawings.get(revision.drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, drawing.projectId, 'edit')
  if (denied) return denied
  if (revision.status !== 'draft') {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      'draft以外の改訂内容は更新できません。新しい改訂を作成してください',
      ctx.correlationId,
    )
  }
  const schemaVersion = requiredPositiveInteger(body.schemaVersion, 'schemaVersion')
  const previous = store.contents.get(revisionId)
  const expectedContentVersion =
    optionalPositiveInteger(body.expectedContentVersion, 'expectedContentVersion') ??
    optionalPositiveInteger(ctx.url.searchParams.get('expectedContentVersion'), 'expectedContentVersion')
  if (previous && expectedContentVersion === undefined) {
    return errorResponse(
      428,
      ERROR_CODES.preconditionRequired,
      '既存内容の更新には expectedContentVersion が必要です',
      ctx.correlationId,
    )
  }
  if (previous && expectedContentVersion !== previous.contentVersion) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `contentVersion が一致しません（expected=${expectedContentVersion}, current=${previous.contentVersion}）`,
      ctx.correlationId,
    )
  }
  const serialized = JSON.stringify(body.content ?? null)
  const checksum = optionalString(body.contentChecksum) ?? `sha256:${await sha256Hex(serialized)}`
  const content: ContentRecord = {
    revisionId,
    content: body.content ?? null,
    byteSize: new TextEncoder().encode(serialized).byteLength,
    contentChecksum: checksum,
    mimeType: 'application/json',
    schemaVersion,
    contentVersion: (previous?.contentVersion ?? 0) + 1,
    updatedAt: nowIso(),
  }
  store.contents.set(revisionId, content)
  store.revisions.set(revisionId, {
    ...revision,
    contentChecksum: checksum,
    contentVersion: content.contentVersion,
    updatedAt: content.updatedAt,
    updatedBy: ctx.actorId,
  })
  appendAudit(store, ctx, {
    eventName: 'revision.content.updated',
    projectId: drawing.projectId,
    entityType: 'revision',
    entityId: revisionId,
    result: 'success',
    detail: { contentVersion: content.contentVersion, byteSize: content.byteSize },
  })
  return jsonResponse(200, { content }, ctx.correlationId)
}

function getRevisionContent(store: ApiStore, ctx: RequestContext, revisionId: string): Response {
  const revision = store.revisions.get(revisionId)
  if (!revision) {
    return errorResponse(404, ERROR_CODES.notFound, '改訂が見つかりません', ctx.correlationId)
  }
  const drawing = store.drawings.get(revision.drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, drawing.projectId, 'view')
  if (denied) return denied
  const content = store.contents.get(revisionId)
  if (!content) {
    return errorResponse(404, ERROR_CODES.notFound, '図面内容が見つかりません', ctx.correlationId)
  }
  return jsonResponse(200, { content }, ctx.correlationId)
}

function getRevisionQuantities(store: ApiStore, ctx: RequestContext, revisionId: string): Response {
  const resolved = getRevisionWithDrawing(store, ctx, revisionId, 'view')
  if (isResponse(resolved)) return resolved
  const snapshot = store.quantities.get(revisionId) ?? {
    revisionId,
    items: [],
    quantityVersion: 0,
    updatedAt: resolved.revision.updatedAt,
    updatedBy: resolved.revision.updatedBy,
  }
  return jsonResponse(200, { quantities: snapshot }, ctx.correlationId)
}

async function putRevisionQuantities(
  store: ApiStore,
  ctx: RequestContext,
  revisionId: string,
  body: PutQuantitiesBody,
): Promise<Response> {
  const resolved = getRevisionWithDrawing(store, ctx, revisionId, 'edit')
  if (isResponse(resolved)) return resolved
  const { revision, drawing } = resolved
  if (!['draft', 'returned'].includes(revision.status)) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      '数量スナップショットはdraft/returnedの改訂だけ更新できます',
      ctx.correlationId,
    )
  }
  if (!Array.isArray(body.items)) {
    throw new ValidationError('items must be an array')
  }
  const previous = store.quantities.get(revisionId)
  const expectedQuantityVersion =
    optionalNonNegativeInteger(body.expectedQuantityVersion, 'expectedQuantityVersion') ??
    optionalNonNegativeInteger(ctx.url.searchParams.get('expectedQuantityVersion'), 'expectedQuantityVersion')
  if (previous && expectedQuantityVersion === undefined) {
    return errorResponse(
      428,
      ERROR_CODES.preconditionRequired,
      '既存数量の更新には expectedQuantityVersion が必要です',
      ctx.correlationId,
    )
  }
  if (previous && expectedQuantityVersion !== previous.quantityVersion) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `quantityVersion が一致しません（expected=${expectedQuantityVersion}, current=${previous.quantityVersion}）`,
      ctx.correlationId,
    )
  }
  const items = body.items.map((item, index) => parseQuantityItem(item, revisionId, index))
  const updatedAt = nowIso()
  const snapshot: QuantitySnapshotRecord = {
    revisionId,
    items,
    quantityVersion: (previous?.quantityVersion ?? 0) + 1,
    updatedAt,
    updatedBy: ctx.actorId,
  }
  store.quantities.set(revisionId, snapshot)
  store.revisions.set(revisionId, {
    ...revision,
    updatedAt,
    updatedBy: ctx.actorId,
  })
  appendAudit(store, ctx, {
    eventName: 'revision.quantities.updated',
    projectId: drawing.projectId,
    entityType: 'revision',
    entityId: revisionId,
    result: 'success',
    detail: { quantityVersion: snapshot.quantityVersion, itemCount: items.length },
  })
  return jsonResponse(200, { quantities: snapshot }, ctx.correlationId)
}

async function postWorkflowAction(
  store: ApiStore,
  ctx: RequestContext,
  revisionId: string,
  body: WorkflowActionBody,
): Promise<Response> {
  const resolved = getRevisionWithDrawing(store, ctx, revisionId, 'view')
  if (isResponse(resolved)) return resolved
  const { revision, drawing } = resolved
  const action = parseWorkflowAction(body.action)
  const denied = authorizeWorkflowAction(store, ctx, drawing.projectId, action)
  if (denied) return denied

  const nextStatus = workflowTargetStatus(revision.status, action)
  if (!nextStatus) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `状態 ${revision.status} では ${action} を実行できません`,
      ctx.correlationId,
    )
  }
  const quantities = store.quantities.get(revisionId)
  if (action === 'submitReview') {
    if (body.mandatoryChecksPassed !== true) {
      return errorResponse(400, ERROR_CODES.invalidRequest, '必須検査に合格していません', ctx.correlationId)
    }
    if (quantities?.items.some((item) => item.status === 'stale' || item.status === 'invalid')) {
      return errorResponse(
        409,
        ERROR_CODES.conflict,
        '古い数量または無効な数量が残っているため照査へ提出できません',
        ctx.correlationId,
      )
    }
  }
  if (action === 'return') {
    requiredString(body.comment, 'comment')
  }
  if (action === 'resumeEditing') {
    requiredString(body.returnReason, 'returnReason')
  }
  if (action === 'completeReview' && body.reviewResultRecorded !== true) {
    return errorResponse(400, ERROR_CODES.invalidRequest, '照査結果が記録されていません', ctx.correlationId)
  }
  if (action === 'approve') {
    const contentChecksum = requiredString(body.contentChecksum, 'contentChecksum')
    if (contentChecksum !== revision.contentChecksum) {
      return errorResponse(
        409,
        ERROR_CODES.conflict,
        '内容 Checksum が一致しません（表示内容が変更された可能性）',
        ctx.correlationId,
      )
    }
  }
  if (action === 'obsolete') {
    requiredString(body.obsoleteReason, 'obsoleteReason')
  }

  const occurredAt = nowIso()
  const workflowAction: WorkflowActionRecord = {
    id: createId('workflow'),
    revisionId,
    action,
    fromStatus: revision.status,
    toStatus: nextStatus,
    actorId: ctx.actorId,
    comment: optionalString(body.comment) ?? optionalString(body.returnReason) ?? optionalString(body.obsoleteReason),
    occurredAt,
  }
  store.workflowActions.push(workflowAction)
  const updatedRevision: RevisionRecord = {
    ...revision,
    status: nextStatus,
    updatedAt: occurredAt,
    updatedBy: ctx.actorId,
  }
  store.revisions.set(revisionId, updatedRevision)
  appendAudit(store, ctx, {
    eventName: `workflow.${action}`,
    projectId: drawing.projectId,
    entityType: 'revision',
    entityId: revisionId,
    result: 'success',
    detail: { fromStatus: revision.status, toStatus: nextStatus },
  })
  return jsonResponse(200, { revision: updatedRevision, workflowAction }, ctx.correlationId)
}

async function createExportJob(
  store: ApiStore,
  ctx: RequestContext,
  revisionId: string,
  body: CreateExportBody,
): Promise<Response> {
  const resolved = getRevisionWithDrawing(store, ctx, revisionId, 'view')
  if (isResponse(resolved)) return resolved
  const { revision, drawing } = resolved
  const format = parseExportFormat(body.format)
  const content = store.contents.get(revisionId)
  if (!content) {
    return errorResponse(409, ERROR_CODES.conflict, '出力対象の図面内容が保存されていません', ctx.correlationId)
  }
  if (format === 'csv' && !store.quantities.has(revisionId)) {
    return errorResponse(409, ERROR_CODES.conflict, 'CSV出力には数量スナップショットが必要です', ctx.correlationId)
  }

  const createdAt = nowIso()
  const objectKey = [
    'exports',
    drawing.projectId,
    drawing.id,
    revision.id,
    `${createdAt.replace(/[:.]/g, '-')}.${format}`,
  ].join('/')
  const exportJob: ExportJobRecord = {
    id: createId('export'),
    revisionId,
    format,
    status: 'completed',
    objectKey,
    byteSize: content.byteSize,
    contentChecksum: content.contentChecksum,
    createdAt,
    createdBy: ctx.actorId,
    completedAt: createdAt,
  }
  store.exportJobs.set(exportJob.id, exportJob)
  appendAudit(store, ctx, {
    eventName: 'export.created',
    projectId: drawing.projectId,
    entityType: 'export',
    entityId: exportJob.id,
    result: 'success',
    detail: {
      revisionId,
      format,
      status: exportJob.status,
      objectKey,
      note: 'R2本番接続前のAPI契約。署名付きURLは未発行',
    },
  })
  return jsonResponse(201, { exportJob }, ctx.correlationId)
}

function getExportJob(store: ApiStore, ctx: RequestContext, exportId: string): Response {
  const exportJob = store.exportJobs.get(exportId)
  if (!exportJob) {
    return errorResponse(404, ERROR_CODES.notFound, '出力ジョブが見つかりません', ctx.correlationId)
  }
  const resolved = getRevisionWithDrawing(store, ctx, exportJob.revisionId, 'view')
  if (isResponse(resolved)) return resolved
  return jsonResponse(200, { exportJob }, ctx.correlationId)
}

function listAuditLogs(store: ApiStore, ctx: RequestContext): Response {
  const projectId = ctx.url.searchParams.get('projectId') ?? undefined
  const limit = Number(ctx.url.searchParams.get('limit') ?? '100')
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 500) : 100

  if (projectId) {
    const denied = authorizeProject(store, ctx, projectId, 'view')
    if (denied) return denied
    const auditLogs = store.auditLogs.filter((entry) => entry.projectId === projectId).slice(-safeLimit)
    return jsonResponse(200, { auditLogs }, ctx.correlationId)
  }

  // projectId省略時は listProjects と同じ基準（閲覧可能ロールを持つメンバーシップ）で
  // 自身が参照可能な案件の監査ログのみに限定し、テナント越境閲覧を防ぐ。
  const viewableProjectIds = new Set(
    [...store.projectMembers.values()]
      .filter((member) => member.userId === ctx.actorId && roleCanView(member.role))
      .map((member) => member.projectId),
  )
  const auditLogs = store.auditLogs
    .filter((entry) => entry.projectId !== undefined && viewableProjectIds.has(entry.projectId))
    .slice(-safeLimit)
  return jsonResponse(200, { auditLogs }, ctx.correlationId)
}

export async function handleRequest(request: Request, env: WorkerEnv = {}): Promise<Response> {
  const correlationId = resolveCorrelationId(request)
  const url = new URL(request.url)
  const accessJwt = request.headers.get(ACCESS_JWT_HEADER)
  if (!accessJwt || accessJwt.trim() === '') {
    return errorResponse(
      401,
      ERROR_CODES.unauthenticated,
      '認証情報（Cf-Access-Jwt-Assertion）がありません',
      correlationId,
    )
  }

  const matched = matchRouteWithParams(request.method, url.pathname)
  if (!matched) {
    return errorResponse(404, ERROR_CODES.notFound, '該当するエンドポイントがありません', correlationId)
  }

  const ctx: RequestContext = {
    actorId: request.headers.get(ACCESS_USER_HEADER) ?? 'unknown-access-user',
    correlationId,
    url,
  }
  const store = resolveStore(env)
  if (!store) {
    return persistenceUnavailableResponse(env, correlationId)
  }

  try {
    switch (`${matched.route.method} ${matched.route.template}`) {
      case 'GET /api/v1/projects':
        return listProjects(store, ctx)
      case 'POST /api/v1/projects':
        return await createProject(store, ctx, await readJsonObject(request))
      case 'GET /api/v1/projects/{projectId}':
        return getProject(store, ctx, requireParam(matched.params, 'projectId'))
      case 'PATCH /api/v1/projects/{projectId}':
        return updateProject(
          store,
          ctx,
          requireParam(matched.params, 'projectId'),
          await readJsonObject(request),
        )
      case 'GET /api/v1/projects/{projectId}/drawings':
        return listDrawings(store, ctx, requireParam(matched.params, 'projectId'))
      case 'POST /api/v1/projects/{projectId}/drawings':
        return await createDrawing(
          store,
          ctx,
          requireParam(matched.params, 'projectId'),
          await readJsonObject(request),
        )
      case 'GET /api/v1/drawings/{drawingId}':
        return getDrawing(store, ctx, requireParam(matched.params, 'drawingId'))
      case 'PATCH /api/v1/drawings/{drawingId}':
        return updateDrawing(
          store,
          ctx,
          requireParam(matched.params, 'drawingId'),
          await readJsonObject(request),
        )
      case 'POST /api/v1/drawings/{drawingId}/revisions':
        return await createRevision(
          store,
          ctx,
          requireParam(matched.params, 'drawingId'),
          await readJsonObject(request),
        )
      case 'GET /api/v1/revisions/{revisionId}':
        return getRevision(store, ctx, requireParam(matched.params, 'revisionId'))
      case 'GET /api/v1/revisions/{revisionId}/content':
        return getRevisionContent(store, ctx, requireParam(matched.params, 'revisionId'))
      case 'PUT /api/v1/revisions/{revisionId}/content':
        return await putRevisionContent(
          store,
          ctx,
          requireParam(matched.params, 'revisionId'),
          await readJsonObject(request),
        )
      case 'GET /api/v1/revisions/{revisionId}/quantities':
        return getRevisionQuantities(store, ctx, requireParam(matched.params, 'revisionId'))
      case 'PUT /api/v1/revisions/{revisionId}/quantities':
        return await putRevisionQuantities(
          store,
          ctx,
          requireParam(matched.params, 'revisionId'),
          await readJsonObject(request),
        )
      case 'POST /api/v1/revisions/{revisionId}/workflow-actions':
        return await postWorkflowAction(
          store,
          ctx,
          requireParam(matched.params, 'revisionId'),
          await readJsonObject(request),
        )
      case 'POST /api/v1/revisions/{revisionId}/exports':
        return await createExportJob(
          store,
          ctx,
          requireParam(matched.params, 'revisionId'),
          await readJsonObject(request),
        )
      case 'GET /api/v1/exports/{exportId}':
        return getExportJob(store, ctx, requireParam(matched.params, 'exportId'))
      case 'GET /api/v1/audit-logs':
        return listAuditLogs(store, ctx)
      default:
        return errorResponse(
          501,
          ERROR_CODES.notImplemented,
          `${matched.route.method} ${matched.route.template}（${matched.route.summary}）は未実装です`,
          correlationId,
        )
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(400, ERROR_CODES.invalidRequest, err.message, correlationId)
    }
    // 既知のバリデーション以外（実装バグ等）は詳細をクライアントへ漏らさず、
    // 監査・調査のためログにだけ残す（§CD-SYS-003）。
    console.error(`[CivilDraft API] unhandled error (correlationId=${correlationId})`, err)
    return errorResponse(500, ERROR_CODES.internal, '内部エラーが発生しました', correlationId)
  }
}

export default {
  fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env)
  },
}

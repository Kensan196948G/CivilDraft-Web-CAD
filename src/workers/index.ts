/**
 * CivilDraft Workers API (詳細設計仕様書 §25).
 *
 * 現在の到達点:
 * - §25.2 の18エンドポイントをルーティング表として維持する。
 * - P0縦線として Project作成 → Drawing作成 → Revision作成 → Content/数量保存 →
 *   照査/承認 → Export作成 → Audit検索を実装する。
 * - 共有CADの最低限の契約として、案件メンバー認可とメタデータ/内容/数量更新の楽観ロックを検査する。
 * - memory モードは開発/テスト用のインメモリ実装。
 * - neon-r2 モードは本番永続化として Neon PostgreSQL + R2 バケットを使用する
 *   （#36 で実装）。
 */

import { revisionTransitionTarget } from '../domain/revisions'
import { resolveAccessJwtConfig, verifyAccessJwt } from './accessJwt'
import { verifyAuditChain } from './auditChain'
import { createMemoryStore } from './apiStore'
import {
  createNeonApiStore,
  inspectProductionPersistenceReadiness,
  resolvePersistenceMode,
} from './persistence'
import { VersionConflictError } from './neonApiStore'
import type { NeonStoreScope } from './neonApiStore'
import type { R2BucketBinding } from './r2ContentStore'
import type {
  ApiStore,
  AuditLogRecord,
  ContentRecord,
  DrawingRecord,
  ExportFormat,
  ExportJobRecord,
  ProjectMemberRecord,
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
export { NeonApiStore } from './neonApiStore'
export { R2ContentStore } from './r2ContentStore'

export interface WorkerEnv {
  CIVILDRAFT_DEV_STORE?: ApiStore
  CIVILDRAFT_API_MODE?: 'memory' | 'neon-r2'
  /** Access team domain (https://<team>.cloudflareaccess.com). With AUD set, JWT検証が有効になる。 */
  CIVILDRAFT_ACCESS_TEAM_DOMAIN?: string
  /** Access application AUD tag. */
  CIVILDRAFT_ACCESS_AUD?: string
  /** テスト・オフライン検証用のJWKS注入（本番はcertsエンドポイントから取得）。 */
  CIVILDRAFT_ACCESS_JWKS?: unknown
  /** Neon 接続文字列（neon-r2 モード必須）。 */
  CIVILDRAFT_NEON_CONNECTION?: string
  /** R2 バケット binding（任意。図面内容は Neon 直接格納のため共有ストレージ用途でのみ使用）。 */
  CIVILDRAFT_R2_BUCKET?: R2BucketBinding
  /** Static Assets binding（run_worker_first 時に SPA 配信を worker 経由で行う）。 */
  ASSETS?: AssetFetcher
  [key: string]: unknown
}

/** Workers Static Assets binding の最小インターフェース。 */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion'
const ACCESS_USER_HEADER = 'Cf-Access-Authenticated-User-Email'
const CORRELATION_ID_HEADER = 'X-Correlation-Id'

// 全レスポンス（API・SPA配信とも）に付与するセキュリティヘッダー（2026-08-01 監査）。
// Content-Security-Policy は zone レベル（Cloudflare Transform Rules）で導入予定のため
// ここでは最小限のハードニングに留める（docs/operations/production-deployment.md 参照）。
const SECURITY_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000',
}

/** 既存ヘッダーを上書きせずセキュリティヘッダーを付与した Response を返す。 */
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    if (!headers.has(name)) {
      headers.set(name, value)
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const ERROR_CODES = {
  unauthenticated: 'CD-AUTH-001',
  forbidden: 'CD-AUTH-002',
  invalidRequest: 'CD-REQ-001',
  notFound: 'CD-SYS-001',
  conflict: 'CD-CONFLICT-001',
  preconditionRequired: 'CD-CONFLICT-002',
  persistenceUnavailable: 'CD-SYS-002',
  notImplemented: 'CD-SYS-004',
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
  /**
   * 永続化フック付き store（NeonApiStore）でリクエスト中に発生した監査ログ。
   * ハンドラ完了後に flushPendingAuditLogs が一括で Neon へ書き込む（#66）。
   * フックを持たない store では使用しない（appendAudit が直接 push する）。
   */
  readonly pendingAudits: AuditLogRecord[]
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

interface AddProjectMemberBody {
  readonly userId?: unknown
  readonly role?: unknown
}

interface UpdateProjectMemberBody {
  readonly role?: unknown
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
  route('GET', '/api/v1/projects/{projectId}/members', 'メンバー一覧'),
  route('POST', '/api/v1/projects/{projectId}/members', 'メンバー招待・追加'),
  route('PATCH', '/api/v1/projects/{projectId}/members/{userId}', 'メンバーロール変更'),
  route('DELETE', '/api/v1/projects/{projectId}/members/{userId}', 'メンバー削除'),
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
  route('GET', '/api/v1/audit-logs/verify', '監査ハッシュチェーン検証'),
]

const moduleStore = createMemoryStore()

/**
 * リクエスト経路から NeonApiStore のロードスコープを解決する
 * （Issue #114 Phase 1: リクエスト毎の全件ロード廃止）。
 * 未知の経路は undefined（呼び出し側は 404 済みのため到達しない想定）。
 */
function resolveStoreScope(matched: RouteMatch): NeonStoreScope | undefined {
  switch (matched.route.template) {
    case '/api/v1/projects':
      return { kind: 'projects' }
    case '/api/v1/projects/{projectId}':
      return { kind: 'project', projectId: requireParam(matched.params, 'projectId') }
    case '/api/v1/projects/{projectId}/members':
      return { kind: 'projectMembers', projectId: requireParam(matched.params, 'projectId') }
    case '/api/v1/projects/{projectId}/members/{userId}':
      return { kind: 'projectMembers', projectId: requireParam(matched.params, 'projectId') }
    case '/api/v1/projects/{projectId}/drawings':
      return { kind: 'projectDrawings', projectId: requireParam(matched.params, 'projectId') }
    case '/api/v1/drawings/{drawingId}':
    case '/api/v1/drawings/{drawingId}/revisions':
      return { kind: 'drawing', drawingId: requireParam(matched.params, 'drawingId') }
    case '/api/v1/revisions/{revisionId}':
    case '/api/v1/revisions/{revisionId}/content':
    case '/api/v1/revisions/{revisionId}/quantities':
      // SQL-first 読み取り経路（#114 Phase 2）: GET は queryX で個別取得するため
      // Map への事前ロードを省略（revisionRead スコープ）。
      return matched.route.method === 'GET'
        ? { kind: 'revisionRead', revisionId: requireParam(matched.params, 'revisionId') }
        : { kind: 'revision', revisionId: requireParam(matched.params, 'revisionId') }
    case '/api/v1/revisions/{revisionId}/workflow-actions':
    case '/api/v1/revisions/{revisionId}/exports':
      return { kind: 'revision', revisionId: requireParam(matched.params, 'revisionId') }
    case '/api/v1/exports/{exportId}':
      return { kind: 'export', exportId: requireParam(matched.params, 'exportId') }
    case '/api/v1/audit-logs':
      return { kind: 'audit' }
    case '/api/v1/audit-logs/verify':
      return { kind: 'auditVerify' }
    default:
      return undefined
  }
}

async function resolveStore(env: WorkerEnv, scope?: NeonStoreScope): Promise<ApiStore | undefined> {
  if (env.CIVILDRAFT_DEV_STORE) {
    return env.CIVILDRAFT_DEV_STORE
  }
  // Fail closed: the in-process store serves requests only when 'memory' is
  // explicitly configured. Unset or unrecognized modes are treated as
  // unconfigured persistence and rejected with 503 (never a silent fallback).
  if (resolvePersistenceMode(env.CIVILDRAFT_API_MODE) === 'memory') {
    return moduleStore
  }
  // neon-r2: create a NeonApiStore backed by Neon PostgreSQL + R2.
  // The factory loads all data from Neon into Maps so the rest of the
  // handler code can use the store synchronously.
  if (resolvePersistenceMode(env.CIVILDRAFT_API_MODE) === 'neon-r2') {
    const readiness = inspectProductionPersistenceReadiness(env)
    if (!readiness.ready) {
      return undefined // caller will return 503
    }
    const neonConnection = env.CIVILDRAFT_NEON_CONNECTION as string
    if (!neonConnection) {
      return undefined
    }
    try {
      // env をそのまま渡すことで、テスト・オフライン検証用の sqlFactory 注入が
      // 機能する（persistence.ts の JSDoc どおりの契約）。
      const { apiStore } = await createNeonApiStore(
        { ...env, CIVILDRAFT_NEON_CONNECTION: neonConnection },
        scope,
      )
      return apiStore
    } catch (err) {
      console.error('[CivilDraft API] failed to initialize NeonApiStore', err)
      return undefined
    }
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
      ? 'Neon永続化アダプタは未接続です'
      : `Neon永続化に必要なbindingが未設定です: ${readiness.missingBindings.join(', ')}`,
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
  const headers = new Headers({
    'Content-Type': 'application/json',
    [CORRELATION_ID_HEADER]: correlationId,
  })
  for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
    headers.set(name, value)
  }
  return new Response(JSON.stringify(body), {
    status,
    headers,
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

/**
 * リクエストボディが上限を超過した場合の既知エラー（413 に写像）。
 * クライアント側の .civil ファイル上限（CIVIL_FILE_LIMITS.maxFileBytes = 64 MiB）と
 * 整合させる。サーバー側で無制限に受理すると、editor ロール 1 人で
 * drawing_contents.content jsonb / Worker isolate メモリを枯渇させられる。
 */
const MAX_JSON_BODY_BYTES = 64 * 1024 * 1024

class PayloadTooLargeError extends Error {}

function requireParam(params: Readonly<Record<string, string>>, name: string): string {
  const value = params[name]
  if (!value) {
    throw new ValidationError(`Route parameter '${name}' is missing`)
  }
  return value
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  // Content-Length が付いていれば本文を読む前に安価に拒否する。
  const declaredLength = Number(request.headers.get('Content-Length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new PayloadTooLargeError(
      `Request body exceeds the ${MAX_JSON_BODY_BYTES} byte limit`,
    )
  }
  // Content-Length は欠落・偽装し得るため実測でも検査する。UTF-16 コード単位数
  // (text.length) ではなく実バイト数 (byteLength) で判定する — 多バイト文字を
  // 含む本文は文字数が上限以下でもバイト数が上限を超え得るため。
  let bytes: ArrayBuffer
  try {
    bytes = await request.arrayBuffer()
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
  if (bytes.byteLength > MAX_JSON_BODY_BYTES) {
    throw new PayloadTooLargeError(
      `Request body exceeds the ${MAX_JSON_BODY_BYTES} byte limit`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
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

/** 一覧系ページネーション（Issue #114）: limit 既定・最大値を抑止しつつ解釈する。 */
function parsePagination(
  searchParams: URLSearchParams,
  defaultLimit: number,
  maxLimit: number,
): { readonly limit: number; readonly offset: number } {
  const limit = Math.min(
    optionalPositiveInteger(searchParams.get('limit'), 'limit') ?? defaultLimit,
    maxLimit,
  )
  const offset = optionalNonNegativeInteger(searchParams.get('offset'), 'offset') ?? 0
  return { limit, offset }
}

function parseProjectRole(value: unknown): ProjectRole {
  const role = requiredString(value, 'role') as ProjectRole
  if (!['viewer', 'editor', 'reviewer', 'approver', 'manager'].includes(role)) {
    throw new ValidationError('role must be one of viewer, editor, reviewer, approver, manager')
  }
  return role
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
  if (store.persistAuditLog) {
    // 認可拒否など同期パスからも呼ばれるため、ここでは await しない。
    // リクエスト末尾の flushPendingAuditLogs が SQL 書き込みとキャッシュ反映
    // （persistAuditLog 内で push）をまとめて行う。
    ctx.pendingAudits.push(audit)
  } else {
    store.auditLogs.push(audit)
  }
  return audit
}

/**
 * リクエスト中に蓄積した監査ログを永続化する（#66 / ADR-0009 fail-visible）。
 * 監査証跡の欠落を無言で許さないため、flush 失敗時は本来の応答を 500 で
 * 置き換える。本体の変更が既に永続化済みの可能性は correlationId 付きで
 * ログへ残し、運用が突合できるようにする。
 */
async function flushPendingAuditLogs(
  store: ApiStore,
  ctx: RequestContext,
): Promise<Response | undefined> {
  if (!store.persistAuditLog || ctx.pendingAudits.length === 0) {
    return undefined
  }
  try {
    for (const audit of ctx.pendingAudits) {
      await store.persistAuditLog(audit)
    }
    return undefined
  } catch (err) {
    console.error(
      `[CivilDraft API] audit log persistence failed (correlationId=${ctx.correlationId})`,
      err,
    )
    return errorResponse(
      500,
      ERROR_CODES.internal,
      '監査ログの永続化に失敗しました',
      ctx.correlationId,
    )
  }
}

// ---------------------------------------------------------------------------
// Persistence commit helpers（#66 / #68）
// Map 更新（インメモリ）と Neon 永続化（persistX フック）の単一の入口。
// フックを持つ store では「SQL 書き込み → 成功後にキャッシュ更新」を
// persistX 側が保証する。フックを持たない store（memory/dev）は従来どおり
// Map/配列を同期更新する（この場合 await は即時解決で、検証→書き込みの
// 同期性は保たれる）。フックの reject は handleRequest の catch で 500 になる。
// 2 レコードを不可分に書くハンドラは commitXWithY（#68）を使う。
// NeonApiStore はバックエンドの単一トランザクション内で両方を書き込み、
// 途中失敗時はどちらも永続化しない（部分永続化を防ぐ）。
// ---------------------------------------------------------------------------

async function commitProject(
  store: ApiStore,
  project: ProjectRecord,
  expectedVersion?: number,
): Promise<void> {
  if (store.persistProject) {
    await store.persistProject(project, expectedVersion)
  } else {
    store.projects.set(project.id, project)
  }
}

async function commitDrawing(
  store: ApiStore,
  drawing: DrawingRecord,
  expectedVersion?: number,
): Promise<void> {
  if (store.persistDrawing) {
    await store.persistDrawing(drawing, expectedVersion)
  } else {
    store.drawings.set(drawing.id, drawing)
  }
}

async function commitProjectMember(store: ApiStore, member: ProjectMemberRecord): Promise<void> {
  if (store.persistProjectMember) {
    await store.persistProjectMember(member)
  } else {
    store.projectMembers.set(memberKey(member.projectId, member.userId), member)
  }
}

async function commitRemoveProjectMember(
  store: ApiStore,
  projectId: string,
  userId: string,
): Promise<void> {
  if (store.removeProjectMember) {
    await store.removeProjectMember(projectId, userId)
  } else {
    store.projectMembers.delete(memberKey(projectId, userId))
  }
}

async function commitExportJob(store: ApiStore, job: ExportJobRecord): Promise<void> {
  if (store.persistExportJob) {
    await store.persistExportJob(job)
  } else {
    store.exportJobs.set(job.id, job)
  }
}

async function commitProjectWithMember(
  store: ApiStore,
  project: ProjectRecord,
  member: ProjectMemberRecord,
): Promise<void> {
  if (store.persistProjectWithMember) {
    await store.persistProjectWithMember(project, member)
  } else {
    store.projects.set(project.id, project)
    store.projectMembers.set(memberKey(member.projectId, member.userId), member)
  }
}

async function commitRevisionWithDrawing(
  store: ApiStore,
  revision: RevisionRecord,
  drawing: DrawingRecord,
): Promise<void> {
  if (store.persistRevisionWithDrawing) {
    await store.persistRevisionWithDrawing(revision, drawing)
  } else {
    store.revisions.set(revision.id, revision)
    store.drawings.set(drawing.id, drawing)
  }
}

async function commitContentWithRevision(
  store: ApiStore,
  content: ContentRecord,
  revision: RevisionRecord,
  expectedContentVersion?: number,
): Promise<void> {
  if (store.persistContentWithRevision) {
    await store.persistContentWithRevision(content, revision, expectedContentVersion)
  } else {
    store.contents.set(content.revisionId, content)
    store.revisions.set(revision.id, revision)
  }
}

async function commitQuantitiesWithRevision(
  store: ApiStore,
  snapshot: QuantitySnapshotRecord,
  revision: RevisionRecord,
  expectedQuantityVersion?: number,
): Promise<void> {
  if (store.persistQuantitiesWithRevision) {
    await store.persistQuantitiesWithRevision(snapshot, revision, expectedQuantityVersion)
  } else {
    store.quantities.set(snapshot.revisionId, snapshot)
    store.revisions.set(revision.id, revision)
  }
}

async function commitWorkflowActionWithRevision(
  store: ApiStore,
  action: WorkflowActionRecord,
  revision: RevisionRecord,
): Promise<void> {
  if (store.persistWorkflowActionWithRevision) {
    await store.persistWorkflowActionWithRevision(action, revision)
  } else {
    store.workflowActions.push(action)
    store.revisions.set(revision.id, revision)
  }
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

/**
 * SQL-first 読み取り経路用の認可（#114 Phase 2）。
 * queryProjectMembers フックがあればメンバーを SQL で取得し、無ければ
 * 従来の Map（memory/dev）で判定する。
 */
async function authorizeProjectAsync(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  action: 'view' | 'edit' | 'manage',
): Promise<Response | undefined> {
  if (store.queryProjectMembers) {
    const members = await store.queryProjectMembers(projectId)
    const role = members.find((member) => member.userId === ctx.actorId)?.role
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
  return authorizeProject(store, ctx, projectId, action)
}

/**
 * SQL-first 読み取り経路用の改訂+図面解決（#114 Phase 2）。
 * queryRevision/queryDrawing フックがあれば SQL で取得し、無ければ Map へ
 * フォールバックする。
 */
async function getRevisionWithDrawingAsync(
  store: ApiStore,
  ctx: RequestContext,
  revisionId: string,
  action: 'view' | 'edit',
): Promise<{ revision: RevisionRecord; drawing: DrawingRecord } | Response> {
  const revision = (await store.queryRevision?.(revisionId)) ?? store.revisions.get(revisionId)
  if (!revision) {
    return errorResponse(404, ERROR_CODES.notFound, '改訂が見つかりません', ctx.correlationId)
  }
  const drawing = (await store.queryDrawing?.(revision.drawingId)) ?? store.drawings.get(revision.drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = await authorizeProjectAsync(store, ctx, drawing.projectId, action)
  if (denied) return denied
  return { revision, drawing }
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

// 状態遷移グラフの唯一の定義は domain/revisions の TRANSITIONS 表。
// Worker は認可（authorizeWorkflowAction）と前提検査・HTTP 応答を担い、
// 「どの状態でどの操作が次のどの状態へ進むか」は domain に委譲する（§16 単一の真実）。
// WorkflowAction（6種）は RevisionAction（createRevision を含む7種）の部分集合。
function workflowTargetStatus(
  current: RevisionRecord['status'],
  action: WorkflowAction,
): RevisionRecord['status'] | undefined {
  return revisionTransitionTarget(current, action)
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
  // project と member は単一トランザクションとして永続化する（#68）。
  await commitProjectWithMember(store, project, {
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
  const { limit, offset } = parsePagination(ctx.url.searchParams, 50, 200)
  const page = projects.slice(offset, offset + limit)
  return jsonResponse(
    200,
    { projects: page, pagination: { limit, offset, total: projects.length } },
    ctx.correlationId,
  )
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

async function updateProject(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  body: UpdateProjectBody,
): Promise<Response> {
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
  await commitProject(store, updatedProject, expectedVersion)
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
  await commitDrawing(store, drawing)
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
  const { limit, offset } = parsePagination(ctx.url.searchParams, 100, 500)
  const page = drawings.slice(offset, offset + limit)
  return jsonResponse(
    200,
    { drawings: page, pagination: { limit, offset, total: drawings.length } },
    ctx.correlationId,
  )
}

// ---------------------------------------------------------------------------
// Project members（Issue #119）
// ---------------------------------------------------------------------------

function listProjectMembers(store: ApiStore, ctx: RequestContext, projectId: string): Response {
  if (!store.projects.has(projectId)) {
    return errorResponse(404, ERROR_CODES.notFound, '案件が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, projectId, 'view')
  if (denied) return denied
  const members = [...store.projectMembers.values()].filter((m) => m.projectId === projectId)
  return jsonResponse(200, { members }, ctx.correlationId)
}

async function addProjectMember(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  body: AddProjectMemberBody,
): Promise<Response> {
  if (!store.projects.has(projectId)) {
    return errorResponse(404, ERROR_CODES.notFound, '案件が見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, projectId, 'manage')
  if (denied) return denied
  const userId = requiredString(body.userId, 'userId')
  const role = parseProjectRole(body.role)
  if (store.projectMembers.has(memberKey(projectId, userId))) {
    return errorResponse(409, ERROR_CODES.conflict, 'このユーザーは既にメンバーです', ctx.correlationId)
  }
  const timestamp = nowIso()
  const member: ProjectMemberRecord = { projectId, userId, role, createdAt: timestamp, updatedAt: timestamp }
  await commitProjectMember(store, member)
  appendAudit(store, ctx, {
    eventName: 'project.member.added',
    projectId,
    entityType: 'project_member',
    entityId: `${projectId}:${userId}`,
    result: 'success',
    detail: { userId, role },
  })
  return jsonResponse(201, { member }, ctx.correlationId)
}

async function updateProjectMember(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  userId: string,
  body: UpdateProjectMemberBody,
): Promise<Response> {
  const member = store.projectMembers.get(memberKey(projectId, userId))
  if (!member) {
    return errorResponse(404, ERROR_CODES.notFound, 'メンバーが見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, projectId, 'manage')
  if (denied) return denied
  const role = parseProjectRole(body.role)
  if (role === member.role) {
    return jsonResponse(200, { member }, ctx.correlationId)
  }
  if (member.role === 'manager' && role !== 'manager' && !hasAnotherManager(store, projectId, userId)) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      '最後の管理者（manager）のロールは変更できません',
      ctx.correlationId,
    )
  }
  const updated: ProjectMemberRecord = { ...member, role, updatedAt: nowIso() }
  await commitProjectMember(store, updated)
  appendAudit(store, ctx, {
    eventName: 'project.member.roleChanged',
    projectId,
    entityType: 'project_member',
    entityId: `${projectId}:${userId}`,
    result: 'success',
    detail: { userId, fromRole: member.role, toRole: role },
  })
  return jsonResponse(200, { member: updated }, ctx.correlationId)
}

async function deleteProjectMember(
  store: ApiStore,
  ctx: RequestContext,
  projectId: string,
  userId: string,
): Promise<Response> {
  const member = store.projectMembers.get(memberKey(projectId, userId))
  if (!member) {
    return errorResponse(404, ERROR_CODES.notFound, 'メンバーが見つかりません', ctx.correlationId)
  }
  const denied = authorizeProject(store, ctx, projectId, 'manage')
  if (denied) return denied
  if (member.role === 'manager' && !hasAnotherManager(store, projectId, userId)) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      '最後の管理者（manager）は削除できません',
      ctx.correlationId,
    )
  }
  await commitRemoveProjectMember(store, projectId, userId)
  appendAudit(store, ctx, {
    eventName: 'project.member.removed',
    projectId,
    entityType: 'project_member',
    entityId: `${projectId}:${userId}`,
    result: 'success',
    detail: { userId, role: member.role },
  })
  return jsonResponse(200, { removed: true, userId }, ctx.correlationId)
}

function hasAnotherManager(
  store: ApiStore,
  projectId: string,
  exceptUserId: string,
): boolean {
  return [...store.projectMembers.values()].some(
    (m) => m.projectId === projectId && m.role === 'manager' && m.userId !== exceptUserId,
  )
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

async function updateDrawing(
  store: ApiStore,
  ctx: RequestContext,
  drawingId: string,
  body: UpdateDrawingBody,
): Promise<Response> {
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
  await commitDrawing(store, updatedDrawing, expectedVersion)
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
  // revision と drawing（activeRevisionId 更新）は単一トランザクションとして永続化する（#68）。
  await commitRevisionWithDrawing(store, revision, { ...drawing, activeRevisionId: revision.id })
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

async function getRevision(store: ApiStore, ctx: RequestContext, revisionId: string): Promise<Response> {
  const revision = (await store.queryRevision?.(revisionId)) ?? store.revisions.get(revisionId)
  if (!revision) {
    return errorResponse(404, ERROR_CODES.notFound, '改訂が見つかりません', ctx.correlationId)
  }
  const drawing = (await store.queryDrawing?.(revision.drawingId)) ?? store.drawings.get(revision.drawingId)
  if (!drawing) {
    return errorResponse(404, ERROR_CODES.notFound, '図面が見つかりません', ctx.correlationId)
  }
  const denied = await authorizeProjectAsync(store, ctx, drawing.projectId, 'view')
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
  // The checksum await above yields the isolate, so a concurrent request may
  // have committed meanwhile. Re-validate and write in one synchronous block
  // so the version check and the mutation are inseparable (TOCTOU guard).
  const latestRevision = store.revisions.get(revisionId)
  const latestContent = store.contents.get(revisionId)
  if (!latestRevision || latestRevision.status !== 'draft') {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      'draft以外の改訂内容は更新できません。新しい改訂を作成してください',
      ctx.correlationId,
    )
  }
  if (latestContent?.contentVersion !== previous?.contentVersion) {
    return errorResponse(
      409,
      ERROR_CODES.conflict,
      `contentVersion が一致しません（expected=${expectedContentVersion ?? '初回'}, current=${latestContent?.contentVersion ?? 0}）`,
      ctx.correlationId,
    )
  }
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
  // content と revision（contentVersion/checksum 更新）は単一トランザクションとして永続化する（#68）。
  await commitContentWithRevision(
    store,
    content,
    {
      ...latestRevision,
      contentChecksum: checksum,
      contentVersion: content.contentVersion,
      updatedAt: content.updatedAt,
      updatedBy: ctx.actorId,
    },
    previous?.contentVersion,
  )
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

async function getRevisionContent(
  store: ApiStore,
  ctx: RequestContext,
  revisionId: string,
): Promise<Response> {
  const resolved = await getRevisionWithDrawingAsync(store, ctx, revisionId, 'view')
  if (isResponse(resolved)) return resolved
  const content = (await store.queryContent?.(revisionId)) ?? store.contents.get(revisionId)
  if (!content) {
    return errorResponse(404, ERROR_CODES.notFound, '図面内容が見つかりません', ctx.correlationId)
  }
  return jsonResponse(200, { content }, ctx.correlationId)
}

async function getRevisionQuantities(
  store: ApiStore,
  ctx: RequestContext,
  revisionId: string,
): Promise<Response> {
  const resolved = await getRevisionWithDrawingAsync(store, ctx, revisionId, 'view')
  if (isResponse(resolved)) return resolved
  const snapshot = (await store.queryQuantities?.(revisionId)) ?? store.quantities.get(revisionId) ?? {
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
  // snapshot と revision（updatedAt 更新）は単一トランザクションとして永続化する（#68）。
  await commitQuantitiesWithRevision(
    store,
    snapshot,
    {
      ...revision,
      updatedAt,
      updatedBy: ctx.actorId,
    },
    previous?.quantityVersion,
  )
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
  const updatedRevision: RevisionRecord = {
    ...revision,
    status: nextStatus,
    updatedAt: occurredAt,
    updatedBy: ctx.actorId,
  }
  // workflowAction と revision（status 遷移）は単一トランザクションとして永続化する（#68）。
  await commitWorkflowActionWithRevision(store, workflowAction, updatedRevision)
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
    // 出力成果物はブラウザ側で生成され、サーバはメタデータのみ保持する。
    // 実体はどのストレージにも保存されていないため 'unassigned'（実体未割当）とする（Issue #74）。
    objectProvider: 'unassigned',
    objectKey,
    byteSize: content.byteSize,
    contentChecksum: content.contentChecksum,
    createdAt,
    createdBy: ctx.actorId,
    completedAt: createdAt,
  }
  await commitExportJob(store, exportJob)
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
      note: '成果物はクライアント生成・実体は未保存（objectProvider=unassigned）。メタデータのみNeonに格納（ADR-0014）',
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
  // Issue #85: 期間・イベント種別・actor フィルタと cursor ページング
  const from = ctx.url.searchParams.get('from') ?? undefined
  const to = ctx.url.searchParams.get('to') ?? undefined
  const eventName = ctx.url.searchParams.get('eventName') ?? undefined
  const actorId = ctx.url.searchParams.get('actorId') ?? undefined
  const cursor = ctx.url.searchParams.get('cursor') ?? undefined

  let filtered: readonly AuditLogRecord[]
  if (projectId) {
    const denied = authorizeProject(store, ctx, projectId, 'view')
    if (denied) return denied
    filtered = store.auditLogs.filter((entry) => entry.projectId === projectId)
  } else {
    // projectId省略時は listProjects と同じ基準（閲覧可能ロールを持つメンバーシップ）で
    // 自身が参照可能な案件の監査ログのみに限定し、テナント越境閲覧を防ぐ。
    const viewableProjectIds = new Set(
      [...store.projectMembers.values()]
        .filter((member) => member.userId === ctx.actorId && roleCanView(member.role))
        .map((member) => member.projectId),
    )
    filtered = store.auditLogs.filter(
      (entry) => entry.projectId !== undefined && viewableProjectIds.has(entry.projectId),
    )
  }

  if (from !== undefined) filtered = filtered.filter((entry) => entry.occurredAt >= from)
  if (to !== undefined) filtered = filtered.filter((entry) => entry.occurredAt <= to)
  if (eventName !== undefined) filtered = filtered.filter((entry) => entry.eventName === eventName)
  if (actorId !== undefined) filtered = filtered.filter((entry) => entry.actorId === actorId)

  const total = filtered.length
  let page = filtered
  if (cursor !== undefined) {
    const cursorIndex = filtered.findIndex((entry) => `${entry.occurredAt}|${entry.id}` === cursor)
    page = cursorIndex >= 0 ? filtered.slice(cursorIndex + 1) : []
  }
  const auditLogs = page.slice(0, safeLimit)
  const hasMore = page.length > safeLimit
  const last = auditLogs[auditLogs.length - 1]
  const nextCursor = hasMore && last !== undefined ? `${last.occurredAt}|${last.id}` : undefined
  return jsonResponse(200, { auditLogs, total, nextCursor }, ctx.correlationId)
}

/**
 * 監査ハッシュチェーンの完全性検証（Issue #61 / ADR-0009）。
 * ログ本文は返さず、チェーン全体の妥当性・件数・末尾ハッシュのみを返す。
 * 認証済み利用者であれば誰でも確認できる（改ざん検知は閲覧権限と独立した監査機能）。
 */
async function verifyAuditLogs(store: ApiStore, ctx: RequestContext): Promise<Response> {
  const verification = await verifyAuditChain(store.auditLogs)
  return jsonResponse(200, { auditChain: verification }, ctx.correlationId)
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

  // 二次防御（#36）: Access設定があればJWT署名・iss/aud/expを検証する。
  // 検証失敗の詳細はログのみに残し、クライアントへは理由を漏らさない。
  const accessConfig = resolveAccessJwtConfig(env)
  // JWT 検証済みペイロードの email（署名検証済みのため信頼できる）。
  // Cf-Access-Authenticated-User-Email ヘッダーは Access プロキシが付与するが、
  // workers.dev 等への直接到達時に任意値で偽装できるため、Access 設定ありの本番
  // モードでは必ず JWT 内の identity を actorId として採用する（2026-08-01 監査）。
  let verifiedIdentityEmail: string | undefined
  if (accessConfig) {
    // Defense in depth: verifyAccessJwt is written to fail closed, but wrap it
    // so any unexpected throw still becomes a clean 401 (never a bare 500 that
    // would bypass the audit/correlation path).
    let verificationReason = 'verification-error'
    let verified = false
    let verification: Awaited<ReturnType<typeof verifyAccessJwt>> | undefined
    try {
      verification = await verifyAccessJwt(accessJwt, accessConfig, {
        injectedJwks: env.CIVILDRAFT_ACCESS_JWKS,
      })
      verified = verification.ok
      verificationReason = verification.reason
    } catch (err) {
      console.error(
        `[CivilDraft API] access jwt verification threw (correlationId=${correlationId})`,
        err,
      )
    }
    if (!verified) {
      console.warn(
        `[CivilDraft API] access jwt rejected (reason=${verificationReason}, correlationId=${correlationId})`,
      )
      return errorResponse(
        401,
        ERROR_CODES.unauthenticated,
        '認証トークンの検証に失敗しました',
        correlationId,
      )
    }
    if (verification?.ok) {
      const payloadEmail = verification.payload?.['email']
      if (typeof payloadEmail === 'string' && payloadEmail.trim() !== '') {
        verifiedIdentityEmail = payloadEmail.trim()
      } else {
        // Access の service token JWT は email を持たず common_name を持つ。
        // ここでヘッダーへフォールバックすると、有効な service token 保持者が
        // Cf-Access-Authenticated-User-Email を任意値にして他ユーザーへ
        // なりすませるため、検証済みクレームのみから identity を導出する。
        const commonName = verification.payload?.['common_name']
        const sub = verification.payload?.['sub']
        if (typeof commonName === 'string' && commonName.trim() !== '') {
          verifiedIdentityEmail = `service-token:${commonName.trim()}`
        } else if (typeof sub === 'string' && sub.trim() !== '') {
          verifiedIdentityEmail = `subject:${sub.trim()}`
        } else {
          verifiedIdentityEmail = 'verified-unknown-identity'
        }
      }
    }
  }

  const matched = matchRouteWithParams(request.method, url.pathname)
  if (!matched) {
    return errorResponse(404, ERROR_CODES.notFound, '該当するエンドポイントがありません', correlationId)
  }

  const ctx: RequestContext = {
    // Access 検証構成あり: 検証済み JWT クレーム由来の identity のみを採用する
    // （ヘッダーはクライアント偽装可能なため決して参照しない）。
    // Access 検証構成なし（memory モード等の開発時のみ）: 従来どおりヘッダーを許容。
    actorId: accessConfig
      ? (verifiedIdentityEmail ?? 'verified-unknown-identity')
      : (request.headers.get(ACCESS_USER_HEADER)?.trim() || 'unknown-access-user'),
    correlationId,
    url,
    pendingAudits: [],
  }
  const store = await resolveStore(env, resolveStoreScope(matched))
  if (!store) {
    return persistenceUnavailableResponse(env, correlationId)
  }
  // Fail closed（#36/#48と同方針）: 本番永続化モードではAccess JWT検証設定を必須にする。
  // ヘッダー存在確認だけの一次防御で本番データへ到達させない。
  if (!accessConfig && resolvePersistenceMode(env.CIVILDRAFT_API_MODE) === 'neon-r2') {
    console.warn(
      `[CivilDraft API] access verification not configured in neon-r2 mode (correlationId=${correlationId})`,
    )
    return errorResponse(
      503,
      ERROR_CODES.persistenceUnavailable,
      'Cloudflare Access検証が未構成のため、本番モードでは応答しません',
      correlationId,
    )
  }

  let response: Response
  try {
    response = await dispatchApiRoute(store, ctx, matched, request)
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      response = errorResponse(413, ERROR_CODES.invalidRequest, err.message, correlationId)
    } else if (err instanceof ValidationError) {
      response = errorResponse(400, ERROR_CODES.invalidRequest, err.message, correlationId)
    } else if (err instanceof VersionConflictError) {
      // DB 側で検出した楽観ロック競合（Issue #114 Phase 3）。アプリ層チェックを
      // 通過しても DB 上で version 不一致の場合は 409 を返す（TOCTOU 解消）。
      response = errorResponse(409, ERROR_CODES.conflict, err.message, correlationId)
    } else {
      // 既知のバリデーション以外（実装バグ等）は詳細をクライアントへ漏らさず、
      // 監査・調査のためログにだけ残す（§CD-SYS-003）。
      console.error(`[CivilDraft API] unhandled error (correlationId=${correlationId})`, err)
      response = errorResponse(500, ERROR_CODES.internal, '内部エラーが発生しました', correlationId)
    }
  }
  // 成功・失敗いずれの経路でも、蓄積した監査ログ（認可拒否を含む）を
  // 応答確定前に永続化する。flush 失敗時は監査証跡を欠いたまま成功を
  // 返さない（fail-visible）。
  const auditFlushFailure = await flushPendingAuditLogs(store, ctx)
  return auditFlushFailure ?? response
}

async function dispatchApiRoute(
  store: ApiStore,
  ctx: RequestContext,
  matched: RouteMatch,
  request: Request,
): Promise<Response> {
  const { correlationId } = ctx
  switch (`${matched.route.method} ${matched.route.template}`) {
    case 'GET /api/v1/projects':
      return listProjects(store, ctx)
    case 'POST /api/v1/projects':
      return await createProject(store, ctx, await readJsonObject(request))
    case 'GET /api/v1/projects/{projectId}':
      return getProject(store, ctx, requireParam(matched.params, 'projectId'))
    case 'PATCH /api/v1/projects/{projectId}':
      return await updateProject(
        store,
        ctx,
        requireParam(matched.params, 'projectId'),
        await readJsonObject(request),
      )
    case 'GET /api/v1/projects/{projectId}/members':
      return listProjectMembers(store, ctx, requireParam(matched.params, 'projectId'))
    case 'POST /api/v1/projects/{projectId}/members':
      return await addProjectMember(
        store,
        ctx,
        requireParam(matched.params, 'projectId'),
        await readJsonObject(request),
      )
    case 'PATCH /api/v1/projects/{projectId}/members/{userId}':
      return await updateProjectMember(
        store,
        ctx,
        requireParam(matched.params, 'projectId'),
        requireParam(matched.params, 'userId'),
        await readJsonObject(request),
      )
    case 'DELETE /api/v1/projects/{projectId}/members/{userId}':
      return await deleteProjectMember(
        store,
        ctx,
        requireParam(matched.params, 'projectId'),
        requireParam(matched.params, 'userId'),
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
      return await updateDrawing(
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
    case 'GET /api/v1/audit-logs/verify':
      return await verifyAuditLogs(store, ctx)
    default:
      return errorResponse(
        501,
        ERROR_CODES.notImplemented,
        `${matched.route.method} ${matched.route.template}（${matched.route.summary}）は未実装です`,
        correlationId,
      )
  }
}

export default {
  fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    // run_worker_first（assets.run_worker_first=true）時は全リクエストがここへ到達する。
    // API 以外（SPA・静的アセット・404 フォールバック）は ASSETS binding へ転送し、
    // セキュリティヘッダーを付与して返す。認証チェックは API 経路のみに適用する。
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) {
        return env.ASSETS.fetch(request).then(withSecurityHeaders)
      }
      return Promise.resolve(
        new Response('Not Found', { status: 404, headers: SECURITY_RESPONSE_HEADERS }),
      )
    }
    return handleRequest(request, env)
  },
}

/**
 * Browser-side client for CivilDraft Workers API.
 *
 * This module intentionally contains no secret handling. Authentication is expected to be
 * provided by Cloudflare Access in front of the same origin; tests can inject headers/fetch.
 */
import type { CivilDraftDocument } from '@/infrastructure/files'
import { computeDocumentChecksum } from '@/infrastructure/files/checksum'
import type { Result, ValidationIssue } from '@/shared/types'

export type CloudExportFormat = 'pdf' | 'dxf' | 'csv' | 'json'

export interface CloudApiClientOptions {
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly correlationId?: () => string
}

export interface CloudProjectInput {
  readonly projectNumber: string
  readonly name: string
  readonly clientName?: string
}

export interface CloudDrawingInput {
  readonly drawingNumber: string
  readonly name: string
  readonly drawingType?: string
  readonly settings?: unknown
}

export interface CloudRevisionInput {
  readonly revisionNumber: string
  readonly changeSummary: string
  readonly basedOnRevisionId?: string
}

export interface CloudSaveDraftInput {
  readonly project: CloudProjectInput
  readonly drawing: CloudDrawingInput
  readonly revision: CloudRevisionInput
  readonly document: CivilDraftDocument
  readonly exportFormat?: CloudExportFormat
}

export interface CloudProject {
  readonly id: string
  readonly projectNumber: string
  readonly name: string
  readonly clientName?: string
  readonly status?: 'active' | 'archived'
  readonly version: number
}

export interface CloudDrawing {
  readonly id: string
  readonly projectId: string
  readonly drawingNumber: string
  readonly name: string
  readonly version: number
}

export interface CloudRevision {
  readonly id: string
  readonly drawingId: string
  readonly revisionNumber: string
  readonly status: string
  readonly contentVersion: number
  readonly contentChecksum: string
}

/** 図面チェックイン/アウト状態（migration 0007）。 */
export interface CloudDrawingCheckout {
  readonly drawingId: string
  readonly revisionId: string
  readonly checkedOutBy: string
  readonly checkedOutAt: string
  readonly status: 'checkedOut' | 'checkedIn'
  readonly checkedInAt?: string
}

export interface CloudContent {
  readonly revisionId: string
  readonly content: unknown
  readonly contentVersion: number
  readonly contentChecksum: string
}

export interface CloudExportJob {
  readonly id: string
  readonly revisionId: string
  readonly format: CloudExportFormat
  readonly status: string
  readonly objectProvider?: string
  readonly objectKey?: string
  readonly contentChecksum?: string
}

export interface CloudAuditLog {
  readonly id: string
  readonly occurredAt: string
  readonly eventName: string
  readonly actorId: string
  readonly projectId?: string
  readonly entityType?: string
  readonly entityId?: string
  readonly result: 'success' | 'failure'
  readonly correlationId: string
  readonly detail?: unknown
}

export interface CloudAuditChainVerification {
  readonly valid: boolean
  readonly checkedCount: number
  readonly hashedCount: number
  readonly legacyCount: number
  readonly tailHash?: string
}

/** 監査ログ一覧の1ページ分（Issue #85）。 */
export interface CloudAuditLogPage {
  readonly auditLogs: readonly CloudAuditLog[]
  /** フィルタ適用後の総件数（ページング前）。 */
  readonly total: number
  /** 次ページ取得用カーソル。最終ページでは undefined。 */
  readonly nextCursor?: string
}

export interface CloudSaveDraftResult {
  readonly project: CloudProject
  readonly drawing: CloudDrawing
  readonly revision: CloudRevision
  readonly content: CloudContent
  readonly exportJob?: CloudExportJob
}

interface ApiErrorBody {
  readonly error?: {
    readonly code?: unknown
    readonly message?: unknown
  }
  readonly correlationId?: unknown
}

interface RequestOptions {
  readonly method?: string
  readonly body?: unknown
}

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
} as const

function ok<T>(value: T): Result<T, ValidationIssue> {
  return { ok: true, value }
}

function fail<T>(code: string, message: string, field?: string): Result<T, ValidationIssue> {
  return {
    ok: false,
    error: {
      code,
      severity: 'error',
      message,
      ...(field === undefined ? {} : { field }),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown, field: string): Result<Record<string, unknown>, ValidationIssue> {
  return isRecord(value) ? ok(value) : fail('CLOUD_API_SCHEMA', `${field} がオブジェクトではありません`, field)
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl || baseUrl.trim() === '') return ''
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

function defaultCorrelationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `web_${uuid}` : `web_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (!isRecord(body)) return fallback
  const apiBody = body as ApiErrorBody
  const message = apiBody.error?.message
  return typeof message === 'string' && message.trim() !== '' ? message : fallback
}

export class CivilDraftApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly extraHeaders: Readonly<Record<string, string>>
  private readonly newCorrelationId: () => string

  constructor(options: CloudApiClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.extraHeaders = options.headers ?? {}
    this.newCorrelationId = options.correlationId ?? defaultCorrelationId
  }

  async createProject(input: CloudProjectInput): Promise<Result<CloudProject, ValidationIssue>> {
    const response = await this.request('/api/v1/projects', { method: 'POST', body: input })
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    return asRecord(body.value.project, 'project') as Result<CloudProject, ValidationIssue>
  }

  /** 参加案件一覧を取得する（GET /api/v1/projects）。 */
  async listProjects(): Promise<Result<readonly CloudProject[], ValidationIssue>> {
    const response = await this.request('/api/v1/projects')
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    const projects = body.value.projects
    return Array.isArray(projects)
      ? ok(projects as readonly CloudProject[])
      : fail('CLOUD_API_SCHEMA', 'projects が配列ではありません')
  }

  async createDrawing(
    projectId: string,
    input: CloudDrawingInput,
  ): Promise<Result<CloudDrawing, ValidationIssue>> {
    const response = await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/drawings`, {
      method: 'POST',
      body: input,
    })
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    return asRecord(body.value.drawing, 'drawing') as Result<CloudDrawing, ValidationIssue>
  }

  async createRevision(
    drawingId: string,
    input: CloudRevisionInput,
  ): Promise<Result<CloudRevision, ValidationIssue>> {
    const response = await this.request(`/api/v1/drawings/${encodeURIComponent(drawingId)}/revisions`, {
      method: 'POST',
      body: input,
    })
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    return asRecord(body.value.revision, 'revision') as Result<CloudRevision, ValidationIssue>
  }

  async putRevisionContent(
    revisionId: string,
    document: CivilDraftDocument,
    expectedContentVersion?: number,
  ): Promise<Result<CloudContent, ValidationIssue>> {
    const body = {
      schemaVersion: 1,
      content: document,
      contentChecksum: `sha256:${computeDocumentChecksum(document)}`,
      ...(expectedContentVersion === undefined ? {} : { expectedContentVersion }),
    }
    const response = await this.request(`/api/v1/revisions/${encodeURIComponent(revisionId)}/content`, {
      method: 'PUT',
      body,
    })
    if (!response.ok) return response
    const responseBody = asRecord(response.value, 'response')
    if (!responseBody.ok) return responseBody
    return asRecord(responseBody.value.content, 'content') as Result<CloudContent, ValidationIssue>
  }

  async getRevisionContent(revisionId: string): Promise<Result<CloudContent, ValidationIssue>> {
    const response = await this.request(`/api/v1/revisions/${encodeURIComponent(revisionId)}/content`)
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    return asRecord(body.value.content, 'content') as Result<CloudContent, ValidationIssue>
  }

  /**
   * 図面チェックイン/アウト（migration 0007 の Worker API クライアント）。
   * action='checkout' は PUT /drawings/:id/checkout、'checkin' は DELETE。
   */
  async updateCheckout(
    drawingId: string,
    action: 'checkout' | 'checkin',
    revisionId?: string,
  ): Promise<Result<CloudDrawingCheckout, ValidationIssue>> {
    const response =
      action === 'checkout'
        ? await this.request(`/api/v1/drawings/${encodeURIComponent(drawingId)}/checkout`, {
            method: 'PUT',
            body: { revisionId },
          })
        : await this.request(`/api/v1/drawings/${encodeURIComponent(drawingId)}/checkout`, {
            method: 'DELETE',
          })
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    return asRecord(body.value.checkout, 'checkout') as Result<CloudDrawingCheckout, ValidationIssue>
  }

  async createExportJob(
    revisionId: string,
    format: CloudExportFormat,
  ): Promise<Result<CloudExportJob, ValidationIssue>> {
    const response = await this.request(`/api/v1/revisions/${encodeURIComponent(revisionId)}/exports`, {
      method: 'POST',
      body: { format },
    })
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    return asRecord(body.value.exportJob, 'exportJob') as Result<CloudExportJob, ValidationIssue>
  }

  /** 監査ログ一覧を取得する（Issue #61 / #85: フィルタ+カーソルページング）。 */
  async listAuditLogs(
    params: {
      readonly projectId?: string
      readonly limit?: number
      readonly from?: string
      readonly to?: string
      readonly eventName?: string
      readonly actorId?: string
      readonly cursor?: string
    } = {},
  ): Promise<Result<CloudAuditLogPage, ValidationIssue>> {
    const search = new URLSearchParams()
    if (params.projectId !== undefined) search.set('projectId', params.projectId)
    if (params.limit !== undefined) search.set('limit', String(Math.min(Math.max(Math.trunc(params.limit), 1), 500)))
    if (params.from !== undefined) search.set('from', params.from)
    if (params.to !== undefined) search.set('to', params.to)
    if (params.eventName !== undefined) search.set('eventName', params.eventName)
    if (params.actorId !== undefined) search.set('actorId', params.actorId)
    if (params.cursor !== undefined) search.set('cursor', params.cursor)
    const query = search.toString()
    const response = await this.request(`/api/v1/audit-logs${query === '' ? '' : `?${query}`}`)
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    const logs = (body.value as Record<string, unknown>).auditLogs
    if (!Array.isArray(logs)) {
      return fail('CLOUD_API_SCHEMA', 'auditLogs が配列ではありません', 'auditLogs')
    }
    const totalValue = (body.value as Record<string, unknown>).total
    const nextCursorValue = (body.value as Record<string, unknown>).nextCursor
    const total = typeof totalValue === 'number' && Number.isFinite(totalValue) ? totalValue : 0
    const nextCursor = typeof nextCursorValue === 'string' ? nextCursorValue : undefined
    return ok({
      auditLogs: logs as CloudAuditLog[],
      total,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    })
  }

  /** 監査ハッシュチェーンの完全性を検証する（Issue #61）。 */
  async verifyAuditChain(): Promise<Result<CloudAuditChainVerification, ValidationIssue>> {
    const response = await this.request('/api/v1/audit-logs/verify')
    if (!response.ok) return response
    const body = asRecord(response.value, 'response')
    if (!body.ok) return body
    const chain = (body.value as Record<string, unknown>).auditChain
    if (!isRecord(chain)) {
      return fail('CLOUD_API_SCHEMA', 'auditChain がオブジェクトではありません', 'auditChain')
    }
    return ok(chain as unknown as CloudAuditChainVerification)
  }

  async saveDraft(input: CloudSaveDraftInput): Promise<Result<CloudSaveDraftResult, ValidationIssue>> {
    const project = await this.createProject(input.project)
    if (!project.ok) return project

    const drawing = await this.createDrawing(project.value.id, input.drawing)
    if (!drawing.ok) return drawing

    const revision = await this.createRevision(drawing.value.id, input.revision)
    if (!revision.ok) return revision

    const content = await this.putRevisionContent(revision.value.id, input.document)
    if (!content.ok) return content

    if (input.exportFormat === undefined) {
      return ok({ project: project.value, drawing: drawing.value, revision: revision.value, content: content.value })
    }

    const exportJob = await this.createExportJob(revision.value.id, input.exportFormat)
    if (!exportJob.ok) return exportJob
    return ok({
      project: project.value,
      drawing: drawing.value,
      revision: revision.value,
      content: content.value,
      exportJob: exportJob.value,
    })
  }

  private async request(path: string, options: RequestOptions = {}): Promise<Result<unknown, ValidationIssue>> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...JSON_HEADERS,
        ...this.extraHeaders,
        'X-Correlation-Id': this.newCorrelationId(),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    let body: unknown
    try {
      body = await res.json()
    } catch {
      body = undefined
    }

    if (!res.ok) {
      const apiErrorCode =
        isRecord(body) && isRecord((body as ApiErrorBody).error)
          ? (body as ApiErrorBody).error?.code
          : undefined
      return {
        ok: false,
        error: {
          code: 'CLOUD_API_HTTP',
          severity: 'error',
          message: errorMessageFromBody(body, `Workers API が HTTP ${res.status} を返しました`),
          ...(typeof apiErrorCode === 'string' ? { apiErrorCode } : {}),
        },
      }
    }
    return ok(body)
  }
}

export function createCivilDraftApiClient(options?: CloudApiClientOptions): CivilDraftApiClient {
  return new CivilDraftApiClient(options)
}

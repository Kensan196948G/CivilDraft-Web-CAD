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
  readonly objectKey?: string
  readonly contentChecksum?: string
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
      return fail('CLOUD_API_HTTP', errorMessageFromBody(body, `Workers API が HTTP ${res.status} を返しました`))
    }
    return ok(body)
  }
}

export function createCivilDraftApiClient(options?: CloudApiClientOptions): CivilDraftApiClient {
  return new CivilDraftApiClient(options)
}

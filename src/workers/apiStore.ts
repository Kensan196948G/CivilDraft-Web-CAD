export interface ProjectRecord {
  readonly id: string
  readonly projectNumber: string
  readonly name: string
  readonly clientName?: string
  readonly status: 'active' | 'archived'
  readonly createdAt: string
  readonly createdBy: string
  readonly updatedAt: string
  readonly updatedBy: string
  readonly version: number
}

export type ProjectRole = 'viewer' | 'editor' | 'reviewer' | 'approver' | 'manager'

export interface ProjectMemberRecord {
  readonly projectId: string
  readonly userId: string
  readonly role: ProjectRole
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DrawingRecord {
  readonly id: string
  readonly projectId: string
  readonly drawingNumber: string
  readonly name: string
  readonly drawingType: string
  readonly settings: unknown
  readonly status: 'active' | 'archived'
  readonly activeRevisionId?: string
  readonly createdAt: string
  readonly createdBy: string
  readonly updatedAt: string
  readonly updatedBy: string
  readonly version: number
}

export interface RevisionRecord {
  readonly id: string
  readonly drawingId: string
  readonly revisionNumber: string
  readonly status: 'draft' | 'inReview' | 'returned' | 'pendingApproval' | 'approved' | 'obsolete'
  readonly changeSummary: string
  readonly basedOnRevisionId?: string
  readonly contentVersion: number
  readonly contentChecksum: string
  readonly createdAt: string
  readonly createdBy: string
  readonly updatedAt: string
  readonly updatedBy: string
}

export interface ContentRecord {
  readonly revisionId: string
  readonly content: unknown
  readonly byteSize: number
  readonly contentChecksum: string
  readonly mimeType: 'application/json'
  readonly schemaVersion: number
  readonly contentVersion: number
  readonly updatedAt: string
}

export type QuantityMethod = 'length' | 'area' | 'perimeter' | 'count' | 'volume' | 'manual'
export type QuantityUnit = 'm' | 'm2' | 'm3' | 'count' | 'set' | 'custom'
export type QuantityStatus = 'valid' | 'stale' | 'invalid' | 'manuallyAdjusted'

export interface QuantitySourceRecord {
  readonly geometryId: string
  readonly contributionRaw: number
}

export interface QuantityItemRecord {
  readonly id: string
  readonly revisionId: string
  readonly groupKey: string
  readonly workType?: string
  readonly specification?: string
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
  readonly rawValue: number
  readonly roundedValue: number
  readonly sources: readonly QuantitySourceRecord[]
  readonly status: QuantityStatus
}

export interface QuantitySnapshotRecord {
  readonly revisionId: string
  readonly items: readonly QuantityItemRecord[]
  readonly quantityVersion: number
  readonly updatedAt: string
  readonly updatedBy: string
}

export type WorkflowAction =
  | 'submitReview'
  | 'resumeEditing'
  | 'return'
  | 'completeReview'
  | 'approve'
  | 'obsolete'

export interface WorkflowActionRecord {
  readonly id: string
  readonly revisionId: string
  readonly action: WorkflowAction
  readonly fromStatus: RevisionRecord['status']
  readonly toStatus: RevisionRecord['status']
  readonly actorId: string
  readonly comment?: string
  readonly occurredAt: string
}

export type ExportFormat = 'pdf' | 'dxf' | 'csv' | 'json'
export type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed'

// 出力成果物の永続化先。現状の export 実装は成果物をサーバ側で保持せず
// （ブラウザ側生成・メタデータのみ Neon）、R2 は実在しないため、
// 正式値は 'unassigned'（実体未割当）とする（ADR-0014 / Issue #74）。
// 実体格納を導入した時点で 'neon' / 'r2' へ切り替える。
export type ExportObjectProvider = 'unassigned' | 'neon' | 'r2'

export interface ExportJobRecord {
  readonly id: string
  readonly revisionId: string
  readonly format: ExportFormat
  readonly status: ExportStatus
  readonly objectProvider: ExportObjectProvider
  readonly objectKey?: string
  readonly byteSize?: number
  readonly contentChecksum?: string
  readonly errorCode?: string
  readonly createdAt: string
  readonly createdBy: string
  readonly completedAt?: string
}

export interface AuditLogRecord {
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
  /** hash chain（ADR-0009 / Issue #61）: 直前レコードの entryHash。 */
  readonly previousHash?: string
  /** hash chain: SHA-256(previousHash | canonical payload)。 */
  readonly entryHash?: string
}

export interface ApiStore {
  readonly projects: Map<string, ProjectRecord>
  readonly projectMembers: Map<string, ProjectMemberRecord>
  readonly drawings: Map<string, DrawingRecord>
  readonly revisions: Map<string, RevisionRecord>
  readonly contents: Map<string, ContentRecord>
  readonly quantities: Map<string, QuantitySnapshotRecord>
  readonly workflowActions: WorkflowActionRecord[]
  readonly exportJobs: Map<string, ExportJobRecord>
  readonly auditLogs: AuditLogRecord[]

  // -- 任意の永続化フック（#66） --
  // NeonApiStore のような永続化バックエンド付き実装は、これらのフックで
  // 「バックエンドへ書き込み → 成功後にローカル Map/配列を更新」を行う。
  // フックを持たない store（memory/dev）ではハンドラが Map を直接更新する。
  // 契約: フックが reject した場合、ローカルキャッシュは変更しないこと
  // （呼び出し側はエラーを 500 として伝播し、書き込み成功を偽装しない）。
  persistProject?(project: ProjectRecord): Promise<void>
  persistProjectMember?(member: ProjectMemberRecord): Promise<void>
  persistDrawing?(drawing: DrawingRecord): Promise<void>
  persistRevision?(revision: RevisionRecord): Promise<void>
  persistContent?(content: ContentRecord): Promise<void>
  persistQuantities?(snapshot: QuantitySnapshotRecord): Promise<void>
  persistWorkflowAction?(action: WorkflowActionRecord): Promise<void>
  persistExportJob?(job: ExportJobRecord): Promise<void>
  persistAuditLog?(log: AuditLogRecord): Promise<void>

  // -- 複合永続化フック（#68） --
  // 2 レコードの書き込みが 1 つの操作として不可分であるべきハンドラ用。
  // NeonApiStore 実装はバックエンドの単一トランザクション内で両方を書き込み、
  // 途中失敗時はどちらも永続化しない（部分永続化を防ぐ）。
  // フックを持たない store では、各レコードを Map へ直接（順次）設定してよい
  // （メモリ内更新は同期的でアトミックなため、疑似的な原子性が成立する）。
  persistProjectWithMember?(project: ProjectRecord, member: ProjectMemberRecord): Promise<void>
  persistRevisionWithDrawing?(revision: RevisionRecord, drawing: DrawingRecord): Promise<void>
  persistContentWithRevision?(content: ContentRecord, revision: RevisionRecord): Promise<void>
  persistQuantitiesWithRevision?(
    snapshot: QuantitySnapshotRecord,
    revision: RevisionRecord,
  ): Promise<void>
  persistWorkflowActionWithRevision?(
    action: WorkflowActionRecord,
    revision: RevisionRecord,
  ): Promise<void>

  // -- SQL-first read hooks（#114 Phase 2） --
  // NeonApiStore はリクエストに必要なレコードを述語付き SQL で直接取得する。
  // ハンドラはフックがあればそれを使い、無ければ従来の Map 参照へフォールバックする
  // （memory/dev モードは Map 契約を維持）。
  queryRevision?(revisionId: string): Promise<RevisionRecord | undefined>
  queryDrawing?(drawingId: string): Promise<DrawingRecord | undefined>
  queryProjectMembers?(projectId: string): Promise<readonly ProjectMemberRecord[]>
  queryContent?(revisionId: string): Promise<ContentRecord | undefined>
  queryQuantities?(revisionId: string): Promise<QuantitySnapshotRecord | undefined>
}

export function createMemoryStore(): ApiStore {
  return {
    projects: new Map(),
    projectMembers: new Map(),
    drawings: new Map(),
    revisions: new Map(),
    contents: new Map(),
    quantities: new Map(),
    workflowActions: [],
    exportJobs: new Map(),
    auditLogs: [],
  }
}

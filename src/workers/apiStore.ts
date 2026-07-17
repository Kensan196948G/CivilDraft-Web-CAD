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

export interface ExportJobRecord {
  readonly id: string
  readonly revisionId: string
  readonly format: ExportFormat
  readonly status: ExportStatus
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

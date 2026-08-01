/**
 * NeonApiStore — Production ApiStore backed by Neon PostgreSQL.
 *
 * Uses @neondatabase/serverless for the SQL driver.  The store implements the
 * `ApiStore` interface (Map-based) via a write-through cache: all data is
 * loaded from Neon into Maps on initialization, and every mutation is persisted
 * to Neon before updating the local cache.
 *
 * The caller is responsible for calling `initialize()` before any Map
 * operations are performed.  Factory `createNeonApiStore(env)` in persistence.ts
 * handles this.
 */
import type { neon, NeonQueryFunctionInTransaction, NeonQueryInTransaction } from '@neondatabase/serverless'
import type {
  ApiStore,
  AuditLogRecord,
  ContentRecord,
  DrawingRecord,
  ExportJobRecord,
  ExportObjectProvider,
  ProjectMemberRecord,
  ProjectRecord,
  QuantityItemRecord,
  QuantitySnapshotRecord,
  RevisionRecord,
  WorkflowActionRecord,
} from './apiStore'
import { computeEntryHash } from './auditChain'

// ---------------------------------------------------------------------------
// SQL client type — compatible with `neon()` return
// ---------------------------------------------------------------------------

/** Subset of the `@neondatabase/serverless` SQL function we actually use. */
export type SqlClient = ReturnType<typeof neon>

// ---------------------------------------------------------------------------
// Row types (what comes back from SELECT)
// ---------------------------------------------------------------------------

// 注意（#66）: @neondatabase/serverless は pg-types 既定に従い、
// bigint/numeric を文字列、timestamptz を Date で返し得る。ここでは
// 実際に返り得る型を正直に宣言し、rowToX 側で toNumber()/toIsoString()
// により API 契約（number / ISO 8601 文字列）へ正規化する。
type NumericLike = number | string
type TimestampLike = string | Date

interface ProjectRow extends Record<string, unknown> {
  id: string
  project_number: string
  name: string
  client_name: string | null
  status: string
  created_at: TimestampLike
  created_by: string
  updated_at: TimestampLike
  updated_by: string
  version: NumericLike
}

interface ProjectMemberRow extends Record<string, unknown> {
  project_id: string
  user_id: string
  role: string
  created_at: TimestampLike
  updated_at: TimestampLike
}

interface DrawingRow extends Record<string, unknown> {
  id: string
  project_id: string
  drawing_number: string
  name: string
  drawing_type: string
  settings: unknown
  status: string
  active_revision_id: string | null
  created_at: TimestampLike
  created_by: string
  updated_at: TimestampLike
  updated_by: string
  version: NumericLike
}

interface RevisionRow extends Record<string, unknown> {
  id: string
  drawing_id: string
  revision_number: string
  status: string
  change_summary: string
  based_on_revision_id: string | null
  content_version: NumericLike
  content_checksum: string
  created_at: TimestampLike
  created_by: string
  updated_at: TimestampLike
  updated_by: string
}

interface ContentRow extends Record<string, unknown> {
  revision_id: string
  content: unknown
  byte_size: NumericLike
  content_checksum: string
  mime_type: string
  schema_version: NumericLike
  content_version: NumericLike
  storage_provider: string
  updated_at: TimestampLike
}

interface QuantitySnapshotRow extends Record<string, unknown> {
  revision_id: string
  quantity_version: NumericLike
  updated_at: TimestampLike
  updated_by: string
}

interface QuantityItemRow extends Record<string, unknown> {
  id: string
  revision_id: string
  group_key: string
  work_type: string | null
  specification: string | null
  method: string
  unit: string
  raw_value: NumericLike
  rounded_value: NumericLike
  item_status: string
  quantity_version: NumericLike
}

interface QuantitySourceRow extends Record<string, unknown> {
  quantity_item_id: string
  geometry_id: string
  contribution_raw: NumericLike
}

interface WorkflowActionRow extends Record<string, unknown> {
  id: string
  revision_id: string
  action: string
  from_status: string
  to_status: string
  actor_id: string
  comment: string | null
  occurred_at: TimestampLike
}

interface ExportJobRow extends Record<string, unknown> {
  id: string
  revision_id: string
  format: string
  status: string
  object_provider: string
  object_key: string | null
  byte_size: NumericLike | null
  content_checksum: string | null
  error_code: string | null
  created_at: TimestampLike
  created_by: string
  completed_at: TimestampLike | null
}

interface AuditLogRow extends Record<string, unknown> {
  id: string
  occurred_at: TimestampLike
  event_name: string
  actor_id: string
  project_id: string | null
  entity_type: string | null
  entity_id: string | null
  result: string
  correlation_id: string
  detail: unknown
  previous_hash: string | null
  entry_hash: string | null
  hash_algorithm: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** bigint/numeric 列は driver が文字列で返すため number へ正規化する。 */
function toNumber(value: NumericLike): number {
  return typeof value === 'number' ? value : Number(value)
}

/**
 * timestamptz 列を ISO 8601 文字列へ正規化する。driver 設定によって
 * Date / ISO 文字列 / Postgres 形式文字列のいずれでも返り得るため、
 * API 契約（ISO 文字列）へ一本化する。解釈不能な値はそのまま返す
 * （失われるより残る方が調査可能）。
 */
function toIsoString(value: TimestampLike): string {
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    projectNumber: row.project_number,
    name: row.name,
    clientName: row.client_name ?? undefined,
    status: row.status as 'active' | 'archived',
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by,
    version: toNumber(row.version),
  }
}

function rowToProjectMember(row: ProjectMemberRow): ProjectMemberRecord {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role as ProjectMemberRecord['role'],
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

function memberMapKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`
}

function rowToDrawing(row: DrawingRow): DrawingRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    drawingNumber: row.drawing_number,
    name: row.name,
    drawingType: row.drawing_type,
    settings: row.settings ?? {},
    status: row.status as 'active' | 'archived',
    activeRevisionId: row.active_revision_id ?? undefined,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by,
    version: toNumber(row.version),
  }
}

function rowToRevision(row: RevisionRow): RevisionRecord {
  return {
    id: row.id,
    drawingId: row.drawing_id,
    revisionNumber: row.revision_number,
    status: row.status as RevisionRecord['status'],
    changeSummary: row.change_summary,
    basedOnRevisionId: row.based_on_revision_id ?? undefined,
    contentVersion: toNumber(row.content_version),
    contentChecksum: row.content_checksum,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by,
    updatedAt: toIsoString(row.updated_at),
    updatedBy: row.updated_by,
  }
}

function rowToContent(row: ContentRow): ContentRecord {
  return {
    revisionId: row.revision_id,
    content: row.content ?? null,
    byteSize: toNumber(row.byte_size),
    contentChecksum: row.content_checksum,
    mimeType: (row.mime_type as 'application/json') ?? 'application/json',
    schemaVersion: toNumber(row.schema_version),
    contentVersion: toNumber(row.content_version),
    updatedAt: toIsoString(row.updated_at),
  }
}

function rowToQuantityItem(row: QuantityItemRow, sources: readonly QuantitySourceRow[]): QuantityItemRecord {
  return {
    id: row.id,
    revisionId: row.revision_id,
    groupKey: row.group_key,
    workType: row.work_type ?? undefined,
    specification: row.specification ?? undefined,
    method: row.method as QuantityItemRecord['method'],
    unit: row.unit as QuantityItemRecord['unit'],
    rawValue: toNumber(row.raw_value),
    roundedValue: toNumber(row.rounded_value),
    sources: sources.map((s) => ({
      geometryId: s.geometry_id,
      contributionRaw: toNumber(s.contribution_raw),
    })),
    status: row.item_status as QuantityItemRecord['status'],
  }
}

function rowToWorkflowAction(row: WorkflowActionRow): WorkflowActionRecord {
  return {
    id: row.id,
    revisionId: row.revision_id,
    action: row.action as WorkflowActionRecord['action'],
    fromStatus: row.from_status as RevisionRecord['status'],
    toStatus: row.to_status as RevisionRecord['status'],
    actorId: row.actor_id,
    comment: row.comment ?? undefined,
    occurredAt: toIsoString(row.occurred_at),
  }
}

function rowToExportJob(row: ExportJobRow): ExportJobRecord {
  return {
    id: row.id,
    revisionId: row.revision_id,
    format: row.format as ExportJobRecord['format'],
    status: row.status as ExportJobRecord['status'],
    objectProvider: row.object_provider as ExportObjectProvider,
    objectKey: row.object_key ?? undefined,
    byteSize: row.byte_size === null ? undefined : toNumber(row.byte_size),
    contentChecksum: row.content_checksum ?? undefined,
    errorCode: row.error_code ?? undefined,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by,
    completedAt: row.completed_at === null ? undefined : toIsoString(row.completed_at),
  }
}

function rowToAuditLog(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    occurredAt: toIsoString(row.occurred_at),
    eventName: row.event_name,
    actorId: row.actor_id,
    projectId: row.project_id ?? undefined,
    entityType: row.entity_type ?? undefined,
    entityId: row.entity_id ?? undefined,
    result: row.result as 'success' | 'failure',
    correlationId: row.correlation_id,
    detail: row.detail ?? undefined,
    previousHash: row.previous_hash ?? undefined,
    entryHash: row.entry_hash ?? undefined,
  }
}

// ---------------------------------------------------------------------------
// Transaction query builders (#68)
// ---------------------------------------------------------------------------
//
// `sql.transaction((txn) => [...])` は非 async のコールバックを要求し、
// txn`...` の呼び出し（NeonQueryPromise）は即座に発行されず、返した配列を
// transaction() が単一 HTTP トランザクションとしてバッチ実行する。
// 複数の persistX/persistXWithY で同じクエリ列を再利用するため、
// クエリ構築ロジックを txn を受け取る純粋関数として切り出す。

/** Build the snapshot + items + sources upsert queries for a quantity snapshot. */
function buildQuantitiesQueries(
  txn: NeonQueryFunctionInTransaction<boolean, boolean>,
  snapshot: QuantitySnapshotRecord,
): NeonQueryInTransaction[] {
  const queries: NeonQueryInTransaction[] = [
    txn`
      INSERT INTO quantity_snapshots (revision_id, quantity_version, updated_at, updated_by)
      VALUES (${snapshot.revisionId}, ${snapshot.quantityVersion}, ${snapshot.updatedAt}, ${snapshot.updatedBy})
      ON CONFLICT (revision_id) DO UPDATE SET
        quantity_version = EXCLUDED.quantity_version,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
    `,
  ]
  for (const item of snapshot.items) {
    queries.push(txn`
      INSERT INTO quantity_items (id, revision_id, group_key, work_type, specification, method, unit, raw_value, rounded_value, item_status, quantity_version)
      VALUES (${item.id}, ${item.revisionId}, ${item.groupKey}, ${item.workType ?? null}, ${item.specification ?? null}, ${item.method}, ${item.unit}, ${item.rawValue}, ${item.roundedValue}, ${item.status}, ${snapshot.quantityVersion})
      ON CONFLICT (id) DO UPDATE SET
        group_key = EXCLUDED.group_key,
        work_type = EXCLUDED.work_type,
        specification = EXCLUDED.specification,
        method = EXCLUDED.method,
        unit = EXCLUDED.unit,
        raw_value = EXCLUDED.raw_value,
        rounded_value = EXCLUDED.rounded_value,
        item_status = EXCLUDED.item_status,
        quantity_version = EXCLUDED.quantity_version
    `)
    for (const source of item.sources) {
      queries.push(txn`
        INSERT INTO quantity_sources (quantity_item_id, geometry_id, contribution_raw)
        VALUES (${item.id}, ${source.geometryId}, ${source.contributionRaw})
        ON CONFLICT (quantity_item_id, geometry_id) DO UPDATE SET
          contribution_raw = EXCLUDED.contribution_raw
      `)
    }
  }
  // #73: スナップショットに存在しない item は削除意図。`!= ALL('{}')` は
  // 全行に一致するため、items が空配列（全件削除）でも正しく機能する。
  // quantity_sources は ON DELETE CASCADE (0004) で追従削除される。
  queries.push(txn`
    DELETE FROM quantity_items
    WHERE revision_id = ${snapshot.revisionId}
      AND id != ALL(${snapshot.items.map((item) => item.id)})
  `)
  return queries
}

/** Build the revision upsert query (shared by persist*WithRevision combos). */
function buildRevisionQuery(
  txn: NeonQueryFunctionInTransaction<boolean, boolean>,
  revision: RevisionRecord,
): NeonQueryInTransaction {
  return txn`
    INSERT INTO drawing_revisions (id, drawing_id, revision_number, status, change_summary, based_on_revision_id, content_version, content_checksum, created_at, created_by, updated_at, updated_by)
    VALUES (${revision.id}, ${revision.drawingId}, ${revision.revisionNumber}, ${revision.status}, ${revision.changeSummary}, ${revision.basedOnRevisionId ?? null}, ${revision.contentVersion}, ${revision.contentChecksum}, ${revision.createdAt}, ${revision.createdBy}, ${revision.updatedAt}, ${revision.updatedBy})
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      change_summary = EXCLUDED.change_summary,
      content_version = EXCLUDED.content_version,
      content_checksum = EXCLUDED.content_checksum,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by
  `
}

// ---------------------------------------------------------------------------
// NeonApiStore
// ---------------------------------------------------------------------------

export class NeonApiStore implements ApiStore {
  readonly #sql: SqlClient

  // -- ApiStore contract (Map-based) --
  readonly projects = new Map<string, ProjectRecord>()
  readonly projectMembers = new Map<string, ProjectMemberRecord>()
  readonly drawings = new Map<string, DrawingRecord>()
  readonly revisions = new Map<string, RevisionRecord>()
  readonly contents = new Map<string, ContentRecord>()
  readonly quantities = new Map<string, QuantitySnapshotRecord>()
  readonly workflowActions: WorkflowActionRecord[] = []
  readonly exportJobs = new Map<string, ExportJobRecord>()
  readonly auditLogs: AuditLogRecord[] = []

  #initialized = false

  constructor(sql: SqlClient) {
    this.#sql = sql
  }

  /** Load all data from Neon into the local Maps.  Must be called once before use. */
  async initialize(): Promise<void> {
    if (this.#initialized) return
    await Promise.all([
      this.#loadProjects(),
      this.#loadDrawings(),
      this.#loadRevisions(),
      this.#loadContents(),
      this.#loadQuantities(),
      this.#loadWorkflowActions(),
      this.#loadExportJobs(),
      this.#loadAuditLogs(),
    ])
    this.#initialized = true
  }

  // -----------------------------------------------------------------------
  // Read helpers (load)
  // -----------------------------------------------------------------------

  async #loadProjects(): Promise<void> {
    const rows = await this.#sql`SELECT * FROM projects` as ProjectRow[]
    for (const row of rows) {
      this.projects.set(row.id, rowToProject(row))
    }
    const memberRows = await this.#sql`SELECT * FROM project_members` as ProjectMemberRow[]
    for (const row of memberRows) {
      this.projectMembers.set(memberMapKey(row.project_id, row.user_id), rowToProjectMember(row))
    }
  }

  async #loadDrawings(): Promise<void> {
    const rows = await this.#sql`SELECT * FROM drawings` as DrawingRow[]
    for (const row of rows) {
      this.drawings.set(row.id, rowToDrawing(row))
    }
  }

  async #loadRevisions(): Promise<void> {
    const rows = await this.#sql`SELECT * FROM drawing_revisions` as RevisionRow[]
    for (const row of rows) {
      this.revisions.set(row.id, rowToRevision(row))
    }
  }

  async #loadContents(): Promise<void> {
    const rows = await this.#sql`SELECT * FROM drawing_contents` as ContentRow[]
    for (const row of rows) {
      this.contents.set(row.revision_id, rowToContent(row))
    }
  }

  async #loadQuantities(): Promise<void> {
    const snapshots = await this.#sql`SELECT * FROM quantity_snapshots` as QuantitySnapshotRow[]
    const itemRows = await this.#sql`SELECT * FROM quantity_items` as QuantityItemRow[]
    const sourceRows = await this.#sql`SELECT * FROM quantity_sources` as QuantitySourceRow[]

    // Group items by revision_id
    const itemMap = new Map<string, QuantityItemRow[]>()
    for (const item of itemRows) {
      const list = itemMap.get(item.revision_id)
      if (list) {
        list.push(item)
      } else {
        itemMap.set(item.revision_id, [item])
      }
    }

    // Group sources by owning item (quantity_sources.quantity_item_id).
    // 旧実装は geometry_id でグループ化して item.id で引いており、reload 時に
    // sources が常に空になる自己矛盾があった（#66 roundtrip 検証で確定）。
    const sourceMap = new Map<string, QuantitySourceRow[]>()
    for (const src of sourceRows) {
      const list = sourceMap.get(src.quantity_item_id)
      if (list) {
        list.push(src)
      } else {
        sourceMap.set(src.quantity_item_id, [src])
      }
    }

    for (const snap of snapshots) {
      const items: QuantityItemRecord[] = (itemMap.get(snap.revision_id) ?? []).map((item) =>
        rowToQuantityItem(item, sourceMap.get(item.id) ?? []),
      )
      this.quantities.set(snap.revision_id, {
        revisionId: snap.revision_id,
        items,
        quantityVersion: toNumber(snap.quantity_version),
        updatedAt: toIsoString(snap.updated_at),
        updatedBy: snap.updated_by,
      })
    }
  }

  async #loadWorkflowActions(): Promise<void> {
    const rows = await this.#sql`SELECT * FROM workflow_actions ORDER BY occurred_at` as WorkflowActionRow[]
    for (const row of rows) {
      this.workflowActions.push(rowToWorkflowAction(row))
    }
  }

  async #loadExportJobs(): Promise<void> {
    const rows = await this.#sql`SELECT * FROM export_jobs` as ExportJobRow[]
    for (const row of rows) {
      this.exportJobs.set(row.id, rowToExportJob(row))
    }
  }

  async #loadAuditLogs(): Promise<void> {
    const rows = await this.#sql`SELECT * FROM audit_logs ORDER BY occurred_at` as AuditLogRow[]
    for (const row of rows) {
      this.auditLogs.push(rowToAuditLog(row))
    }
  }

  // -----------------------------------------------------------------------
  // Write helpers (persist to Neon, then update local cache)
  // -----------------------------------------------------------------------

  /** Insert a project into Neon and the local Map. */
  async persistProject(project: ProjectRecord): Promise<void> {
    await this.#sql`
      INSERT INTO projects (id, project_number, name, client_name, status, created_at, created_by, updated_at, updated_by, version)
      VALUES (${project.id}, ${project.projectNumber}, ${project.name}, ${project.clientName ?? null}, ${project.status}, ${project.createdAt}, ${project.createdBy}, ${project.updatedAt}, ${project.updatedBy}, ${project.version})
      ON CONFLICT (id) DO UPDATE SET
        project_number = EXCLUDED.project_number,
        name = EXCLUDED.name,
        client_name = EXCLUDED.client_name,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by,
        version = EXCLUDED.version
    `
    this.projects.set(project.id, project)
  }

  /** Insert a project member. */
  async persistProjectMember(member: ProjectMemberRecord): Promise<void> {
    await this.#sql`
      INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
      VALUES (${member.projectId}, ${member.userId}, ${member.role}, ${member.createdAt}, ${member.updatedAt})
      ON CONFLICT (project_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        updated_at = EXCLUDED.updated_at
    `
    this.projectMembers.set(memberMapKey(member.projectId, member.userId), member)
  }

  /** Insert or update a drawing. */
  async persistDrawing(drawing: DrawingRecord): Promise<void> {
    // settings は任意の JSON（配列やプリミティブを含む）を受けるため、
    // 明示的に JSON 文字列化して ::jsonb へキャストする（pg 系ドライバは
    // トップレベル配列を Postgres 配列リテラルとして直列化してしまうため）。
    await this.#sql`
      INSERT INTO drawings (id, project_id, drawing_number, name, drawing_type, settings, status, active_revision_id, created_at, created_by, updated_at, updated_by, version)
      VALUES (${drawing.id}, ${drawing.projectId}, ${drawing.drawingNumber}, ${drawing.name}, ${drawing.drawingType}, ${JSON.stringify(drawing.settings ?? {})}::jsonb, ${drawing.status}, ${drawing.activeRevisionId ?? null}, ${drawing.createdAt}, ${drawing.createdBy}, ${drawing.updatedAt}, ${drawing.updatedBy}, ${drawing.version})
      ON CONFLICT (id) DO UPDATE SET
        drawing_number = EXCLUDED.drawing_number,
        name = EXCLUDED.name,
        drawing_type = EXCLUDED.drawing_type,
        settings = EXCLUDED.settings,
        status = EXCLUDED.status,
        active_revision_id = EXCLUDED.active_revision_id,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by,
        version = EXCLUDED.version
    `
    this.drawings.set(drawing.id, drawing)
  }

  /** Insert or update a revision. */
  async persistRevision(revision: RevisionRecord): Promise<void> {
    await this.#sql`
      INSERT INTO drawing_revisions (id, drawing_id, revision_number, status, change_summary, based_on_revision_id, content_version, content_checksum, created_at, created_by, updated_at, updated_by)
      VALUES (${revision.id}, ${revision.drawingId}, ${revision.revisionNumber}, ${revision.status}, ${revision.changeSummary}, ${revision.basedOnRevisionId ?? null}, ${revision.contentVersion}, ${revision.contentChecksum}, ${revision.createdAt}, ${revision.createdBy}, ${revision.updatedAt}, ${revision.updatedBy})
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        change_summary = EXCLUDED.change_summary,
        content_version = EXCLUDED.content_version,
        content_checksum = EXCLUDED.content_checksum,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
    `
    this.revisions.set(revision.id, revision)
  }

  /** Insert or update drawing content. */
  async persistContent(content: ContentRecord): Promise<void> {
    // content は図面 JSON 本体（配列・プリミティブ含む任意 JSON）のため、
    // JSON.stringify + ::jsonb キャストで直列化を確定させる。
    // storage_provider は ADR-0014（R2 スキップ・Neon 直接格納）に合わせ 'neon'。
    await this.#sql`
      INSERT INTO drawing_contents (revision_id, content, byte_size, content_checksum, mime_type, schema_version, content_version, updated_at, updated_by, storage_provider)
      VALUES (${content.revisionId}, ${JSON.stringify(content.content ?? null)}::jsonb, ${content.byteSize}, ${content.contentChecksum}, ${content.mimeType}, ${content.schemaVersion}, ${content.contentVersion}, ${content.updatedAt}, 'system', 'neon')
      ON CONFLICT (revision_id) DO UPDATE SET
        content = EXCLUDED.content,
        byte_size = EXCLUDED.byte_size,
        content_checksum = EXCLUDED.content_checksum,
        schema_version = EXCLUDED.schema_version,
        content_version = EXCLUDED.content_version,
        updated_at = EXCLUDED.updated_at
    `
    this.contents.set(content.revisionId, content)
  }

  /** Insert or update a quantity snapshot with its items and sources (single transaction; #68). */
  async persistQuantities(snapshot: QuantitySnapshotRecord): Promise<void> {
    await this.#sql.transaction((txn) => buildQuantitiesQueries(txn, snapshot))
    this.quantities.set(snapshot.revisionId, snapshot)
  }

  /** Append a workflow action. */
  async persistWorkflowAction(action: WorkflowActionRecord): Promise<void> {
    await this.#sql`
      INSERT INTO workflow_actions (id, revision_id, action, from_status, to_status, actor_id, comment, occurred_at)
      VALUES (${action.id}, ${action.revisionId}, ${action.action}, ${action.fromStatus}, ${action.toStatus}, ${action.actorId}, ${action.comment ?? null}, ${action.occurredAt})
    `
    this.workflowActions.push(action)
  }

  /** Insert or update an export job. */
  async persistExportJob(job: ExportJobRecord): Promise<void> {
    // object_provider は export 成果物の実体が未保存である現状を表す
    // 'unassigned'（実体未割当）が正式値。job.objectProvider は将来
    // R2 / Neon へ実体格納を導入する際にレコード単位で明示できるよう型で保持する（Issue #74）。
    await this.#sql`
      INSERT INTO export_jobs (id, revision_id, format, status, object_key, byte_size, content_checksum, error_code, created_at, created_by, completed_at, object_provider)
      VALUES (${job.id}, ${job.revisionId}, ${job.format}, ${job.status}, ${job.objectKey ?? null}, ${job.byteSize ?? null}, ${job.contentChecksum ?? null}, ${job.errorCode ?? null}, ${job.createdAt}, ${job.createdBy}, ${job.completedAt ?? null}, ${job.objectProvider})
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        object_key = EXCLUDED.object_key,
        byte_size = EXCLUDED.byte_size,
        content_checksum = EXCLUDED.content_checksum,
        object_provider = EXCLUDED.object_provider,
        completed_at = EXCLUDED.completed_at
    `
    this.exportJobs.set(job.id, job)
  }

  /** Append an audit log entry. */
  async persistAuditLog(log: AuditLogRecord): Promise<void> {
    // detail は任意 JSON（配列を含む）のため JSON.stringify + ::jsonb で確定させる。
    // 未指定は SQL NULL（jsonb 'null' ではなく列 NULL）として格納する。
    const detailJson = log.detail === undefined ? null : JSON.stringify(log.detail)
    // hash chain（Issue #61 / ADR-0009）: 直前レコード（時系列ロード済みの末尾）の
    // entry_hash を previous_hash として entry_hash を計算する。書き込みが直列化される
    // 前提（同一 store インスタンス内の逐次 flush）でチェーンを維持する。
    const previousRecord = this.auditLogs.length > 0 ? this.auditLogs[this.auditLogs.length - 1] : undefined
    const previousHash = previousRecord?.entryHash
    const entryHash = await computeEntryHash(previousHash, log)
    const hashedLog: AuditLogRecord = { ...log, previousHash, entryHash }
    await this.#sql`
      INSERT INTO audit_logs (id, occurred_at, event_name, actor_id, project_id, entity_type, entity_id, result, correlation_id, detail, previous_hash, entry_hash, hash_algorithm)
      VALUES (${hashedLog.id}, ${hashedLog.occurredAt}, ${hashedLog.eventName}, ${hashedLog.actorId}, ${hashedLog.projectId ?? null}, ${hashedLog.entityType ?? null}, ${hashedLog.entityId ?? null}, ${hashedLog.result}, ${hashedLog.correlationId}, ${detailJson}::jsonb, ${hashedLog.previousHash ?? null}, ${hashedLog.entryHash}, 'sha256')
    `
    this.auditLogs.push(hashedLog)
  }

  // -----------------------------------------------------------------------
  // Composite write helpers — single transaction for 2 records (#68)
  // -----------------------------------------------------------------------

  /** Insert a project and its initial member in one transaction. */
  async persistProjectWithMember(project: ProjectRecord, member: ProjectMemberRecord): Promise<void> {
    await this.#sql.transaction((txn) => [
      txn`
        INSERT INTO projects (id, project_number, name, client_name, status, created_at, created_by, updated_at, updated_by, version)
        VALUES (${project.id}, ${project.projectNumber}, ${project.name}, ${project.clientName ?? null}, ${project.status}, ${project.createdAt}, ${project.createdBy}, ${project.updatedAt}, ${project.updatedBy}, ${project.version})
        ON CONFLICT (id) DO UPDATE SET
          project_number = EXCLUDED.project_number,
          name = EXCLUDED.name,
          client_name = EXCLUDED.client_name,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by,
          version = EXCLUDED.version
      `,
      txn`
        INSERT INTO project_members (project_id, user_id, role, created_at, updated_at)
        VALUES (${member.projectId}, ${member.userId}, ${member.role}, ${member.createdAt}, ${member.updatedAt})
        ON CONFLICT (project_id, user_id) DO UPDATE SET
          role = EXCLUDED.role,
          updated_at = EXCLUDED.updated_at
      `,
    ])
    this.projects.set(project.id, project)
    this.projectMembers.set(memberMapKey(member.projectId, member.userId), member)
  }

  /** Insert a revision and update its parent drawing's active_revision_id in one transaction. */
  async persistRevisionWithDrawing(revision: RevisionRecord, drawing: DrawingRecord): Promise<void> {
    await this.#sql.transaction((txn) => [
      buildRevisionQuery(txn, revision),
      txn`
        INSERT INTO drawings (id, project_id, drawing_number, name, drawing_type, settings, status, active_revision_id, created_at, created_by, updated_at, updated_by, version)
        VALUES (${drawing.id}, ${drawing.projectId}, ${drawing.drawingNumber}, ${drawing.name}, ${drawing.drawingType}, ${JSON.stringify(drawing.settings ?? {})}::jsonb, ${drawing.status}, ${drawing.activeRevisionId ?? null}, ${drawing.createdAt}, ${drawing.createdBy}, ${drawing.updatedAt}, ${drawing.updatedBy}, ${drawing.version})
        ON CONFLICT (id) DO UPDATE SET
          drawing_number = EXCLUDED.drawing_number,
          name = EXCLUDED.name,
          drawing_type = EXCLUDED.drawing_type,
          settings = EXCLUDED.settings,
          status = EXCLUDED.status,
          active_revision_id = EXCLUDED.active_revision_id,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by,
          version = EXCLUDED.version
      `,
    ])
    this.revisions.set(revision.id, revision)
    this.drawings.set(drawing.id, drawing)
  }

  /** Insert drawing content and update its revision's checksum/version in one transaction. */
  async persistContentWithRevision(content: ContentRecord, revision: RevisionRecord): Promise<void> {
    await this.#sql.transaction((txn) => [
      txn`
        INSERT INTO drawing_contents (revision_id, content, byte_size, content_checksum, mime_type, schema_version, content_version, updated_at, updated_by, storage_provider)
        VALUES (${content.revisionId}, ${JSON.stringify(content.content ?? null)}::jsonb, ${content.byteSize}, ${content.contentChecksum}, ${content.mimeType}, ${content.schemaVersion}, ${content.contentVersion}, ${content.updatedAt}, 'system', 'neon')
        ON CONFLICT (revision_id) DO UPDATE SET
          content = EXCLUDED.content,
          byte_size = EXCLUDED.byte_size,
          content_checksum = EXCLUDED.content_checksum,
          schema_version = EXCLUDED.schema_version,
          content_version = EXCLUDED.content_version,
          updated_at = EXCLUDED.updated_at
      `,
      buildRevisionQuery(txn, revision),
    ])
    this.contents.set(content.revisionId, content)
    this.revisions.set(revision.id, revision)
  }

  /** Insert a quantity snapshot (with items/sources) and update its revision in one transaction. */
  async persistQuantitiesWithRevision(
    snapshot: QuantitySnapshotRecord,
    revision: RevisionRecord,
  ): Promise<void> {
    await this.#sql.transaction((txn) => [
      ...buildQuantitiesQueries(txn, snapshot),
      buildRevisionQuery(txn, revision),
    ])
    this.quantities.set(snapshot.revisionId, snapshot)
    this.revisions.set(revision.id, revision)
  }

  /** Append a workflow action and update its revision's status in one transaction. */
  async persistWorkflowActionWithRevision(
    action: WorkflowActionRecord,
    revision: RevisionRecord,
  ): Promise<void> {
    await this.#sql.transaction((txn) => [
      txn`
        INSERT INTO workflow_actions (id, revision_id, action, from_status, to_status, actor_id, comment, occurred_at)
        VALUES (${action.id}, ${action.revisionId}, ${action.action}, ${action.fromStatus}, ${action.toStatus}, ${action.actorId}, ${action.comment ?? null}, ${action.occurredAt})
      `,
      buildRevisionQuery(txn, revision),
    ])
    this.workflowActions.push(action)
    this.revisions.set(revision.id, revision)
  }
}

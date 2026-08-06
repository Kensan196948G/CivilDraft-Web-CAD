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

/**
 * DB 側で期待バージョン不一致を検出した場合のエラー（Issue #114 Phase 3）。
 * handleRequest の catch で 409 Conflict へマッピングされる。
 */
export class VersionConflictError extends Error {
  readonly entity: string

  constructor(entity: string, expected: number) {
    super(`${entity} のバージョンが一致しません（expected=${expected}）。並行更新の競合です`)
    this.name = 'VersionConflictError'
    this.entity = entity
  }
}

// ---------------------------------------------------------------------------
// SQL client type — compatible with `neon()` return
// ---------------------------------------------------------------------------

/** Subset of the `@neondatabase/serverless` SQL function we actually use. */
export type SqlClient = ReturnType<typeof neon>

/**
 * リクエスト単位のロードスコープ（Issue #114 Phase 1）。
 * neon-r2 モードではリクエスト毎の全件ロードをやめ、このスコープで必要な
 * サブセットだけを述語付き SELECT でロードする。undefined の場合は従来どおり
 * 全件ロード（メモリ/dev 互換・既存テスト互換）。
 */
export type NeonStoreScope =
  | { readonly kind: 'projects' }
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'projectMembers'; readonly projectId: string }
  | { readonly kind: 'projectDrawings'; readonly projectId: string }
  | { readonly kind: 'drawing'; readonly drawingId: string }
  | { readonly kind: 'revision'; readonly revisionId: string }
  | { readonly kind: 'revisionRead'; readonly revisionId: string }
  | { readonly kind: 'export'; readonly exportId: string }
  | { readonly kind: 'audit' }
  | { readonly kind: 'auditVerify' }

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
  expectedQuantityVersion?: number,
): NeonQueryInTransaction[] {
  const snapshotUpsert =
    expectedQuantityVersion === undefined
      ? txn`
          INSERT INTO quantity_snapshots (revision_id, quantity_version, updated_at, updated_by)
          VALUES (${snapshot.revisionId}, ${snapshot.quantityVersion}, ${snapshot.updatedAt}, ${snapshot.updatedBy})
          ON CONFLICT (revision_id) DO UPDATE SET
            quantity_version = EXCLUDED.quantity_version,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
        `
      : txn`
          INSERT INTO quantity_snapshots (revision_id, quantity_version, updated_at, updated_by)
          VALUES (${snapshot.revisionId}, ${snapshot.quantityVersion}, ${snapshot.updatedAt}, ${snapshot.updatedBy})
          ON CONFLICT (revision_id) DO UPDATE SET
            quantity_version = EXCLUDED.quantity_version,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
          WHERE quantity_snapshots.quantity_version = ${expectedQuantityVersion}
          RETURNING revision_id
        `
  const queries: NeonQueryInTransaction[] = [
    snapshotUpsert,
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

  /**
   * Load data from Neon into the local Maps.  Must be called once before use.
   * scope 指定時は該当サブセットのみを述語付き SELECT でロードする
   * （Issue #114 Phase 1: リクエスト毎の全件ロード廃止）。
   */
  async initialize(scope?: NeonStoreScope): Promise<void> {
    if (this.#initialized) return
    if (scope === undefined) {
      await this.#loadAll()
    } else {
      await this.#initializeScoped(scope)
    }
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
  // Scoped loaders (Issue #114 Phase 1)
  // -----------------------------------------------------------------------

  /** 従来互換の全件ロード。 */
  async #loadAll(): Promise<void> {
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
  }

  /** スコープに応じた述語付きロード。 */
  async #initializeScoped(scope: NeonStoreScope): Promise<void> {
    switch (scope.kind) {
      case 'projects':
        // 案件一覧/作成: 全案件 + 全メンバーシップ（一覧の権限判定）+ 監査チェーン末尾
        await Promise.all([
          this.#loadProjectsAll(),
          this.#loadProjectMembersAll(),
          this.#loadAuditTail(),
        ])
        break
      case 'project':
        // 案件取得/更新: 全案件（projectNumber 重複チェック）+ 対象メンバー + 監査末尾
        await Promise.all([
          this.#loadProjectsAll(),
          this.#loadProjectMembersByProject(scope.projectId),
          this.#loadAuditTail(),
        ])
        break
      case 'projectMembers':
        // メンバー管理（#119）: 対象案件 + メンバー一覧 + 監査末尾
        await Promise.all([
          this.#loadProjectById(scope.projectId),
          this.#loadProjectMembersByProject(scope.projectId),
          this.#loadAuditTail(),
        ])
        break
      case 'projectDrawings':
        // 図面一覧/作成: 対象案件 + メンバー + 対象案件の図面 + 監査末尾
        await Promise.all([
          this.#loadProjectById(scope.projectId),
          this.#loadProjectMembersByProject(scope.projectId),
          this.#loadDrawingsByProject(scope.projectId),
          this.#loadAuditTail(),
        ])
        break
      case 'drawing': {
        // 図面取得/更新・改訂作成: 図面 → 案件 → 案件の図面（番号重複）+ 改訂（番号重複）
        const drawing = await this.#loadDrawingById(scope.drawingId)
        if (drawing) {
          await Promise.all([
            this.#loadProjectById(drawing.project_id),
            this.#loadProjectMembersByProject(drawing.project_id),
            this.#loadDrawingsByProject(drawing.project_id),
            this.#loadRevisionsByDrawing(drawing.id),
            this.#loadAuditTail(),
          ])
        }
        break
      }
      case 'revision': {
        // 改訂系（取得/内容/数量/ワークフロー/出力）: 改訂 → 図面 → 案件 → 内容/数量
        const revision = await this.#loadRevisionById(scope.revisionId)
        if (revision) {
          const drawing = await this.#loadDrawingById(revision.drawing_id)
          await Promise.all([
            this.#loadContentByRevision(revision.id),
            this.#loadQuantitiesByRevision(revision.id),
            this.#loadAuditTail(),
            ...(drawing
              ? [
                  this.#loadProjectById(drawing.project_id),
                  this.#loadProjectMembersByProject(drawing.project_id),
                ]
              : []),
          ])
        }
        break
      }
      case 'revisionRead':
        // SQL-first 読み取り経路（#114 Phase 2）: ハンドラが queryX メソッドで
        // 必要なレコードを個別に取得するため、Map への事前ロードは行わない。
        break
      case 'export': {
        // 出力ジョブ取得: ジョブ → 改訂 → 図面 → 案件
        const exportJob = await this.#loadExportJobById(scope.exportId)
        if (exportJob) {
          const revision = await this.#loadRevisionById(exportJob.revision_id)
          const drawing = revision ? await this.#loadDrawingById(revision.drawing_id) : undefined
          await Promise.all([
            this.#loadAuditTail(),
            ...(drawing
              ? [
                  this.#loadProjectById(drawing.project_id),
                  this.#loadProjectMembersByProject(drawing.project_id),
                ]
              : []),
          ])
        }
        break
      }
      case 'audit':
      case 'auditVerify':
        // 監査検索/検証: 監査ログ全件（フィルタ・チェーン検証はハンドラ/検証器が実施）
        await this.#loadAuditLogs()
        break
    }
  }

  async #loadProjectsAll(): Promise<void> {
    const rows = await this.#sql`SELECT * FROM projects ORDER BY project_number` as ProjectRow[]
    for (const row of rows) {
      this.projects.set(row.id, rowToProject(row))
    }
  }

  async #loadProjectMembersAll(): Promise<void> {
    const rows =
      await this.#sql`SELECT * FROM project_members ORDER BY project_id, user_id` as ProjectMemberRow[]
    for (const row of rows) {
      this.projectMembers.set(memberMapKey(row.project_id, row.user_id), rowToProjectMember(row))
    }
  }

  async #loadProjectById(projectId: string): Promise<void> {
    const rows = await this.#sql`SELECT * FROM projects WHERE id = ${projectId}` as ProjectRow[]
    for (const row of rows) {
      this.projects.set(row.id, rowToProject(row))
    }
  }

  async #loadProjectMembersByProject(projectId: string): Promise<void> {
    const rows =
      await this.#sql`SELECT * FROM project_members WHERE project_id = ${projectId}` as ProjectMemberRow[]
    for (const row of rows) {
      this.projectMembers.set(memberMapKey(row.project_id, row.user_id), rowToProjectMember(row))
    }
  }

  async #loadDrawingsByProject(projectId: string): Promise<void> {
    const rows =
      await this.#sql`SELECT * FROM drawings WHERE project_id = ${projectId} ORDER BY drawing_number` as DrawingRow[]
    for (const row of rows) {
      this.drawings.set(row.id, rowToDrawing(row))
    }
  }

  async #loadDrawingById(drawingId: string): Promise<DrawingRow | undefined> {
    const rows = await this.#sql`SELECT * FROM drawings WHERE id = ${drawingId}` as DrawingRow[]
    const row = rows[0]
    if (row) {
      this.drawings.set(row.id, rowToDrawing(row))
    }
    return row
  }

  async #loadRevisionById(revisionId: string): Promise<RevisionRow | undefined> {
    const rows =
      await this.#sql`SELECT * FROM drawing_revisions WHERE id = ${revisionId}` as RevisionRow[]
    const row = rows[0]
    if (row) {
      this.revisions.set(row.id, rowToRevision(row))
    }
    return row
  }

  async #loadRevisionsByDrawing(drawingId: string): Promise<void> {
    const rows =
      await this.#sql`SELECT * FROM drawing_revisions WHERE drawing_id = ${drawingId} ORDER BY revision_number` as RevisionRow[]
    for (const row of rows) {
      this.revisions.set(row.id, rowToRevision(row))
    }
  }

  async #loadContentByRevision(revisionId: string): Promise<void> {
    const rows =
      await this.#sql`SELECT * FROM drawing_contents WHERE revision_id = ${revisionId}` as ContentRow[]
    for (const row of rows) {
      this.contents.set(row.revision_id, rowToContent(row))
    }
  }

  async #loadQuantitiesByRevision(revisionId: string): Promise<void> {
    const snapshots =
      await this.#sql`SELECT * FROM quantity_snapshots WHERE revision_id = ${revisionId}` as QuantitySnapshotRow[]
    const itemRows =
      await this.#sql`SELECT * FROM quantity_items WHERE revision_id = ${revisionId} ORDER BY id` as QuantityItemRow[]
    const itemIds = itemRows.map((item) => item.id)
    const sourceRows =
      itemIds.length === 0
        ? []
        : ((await this.#sql`SELECT * FROM quantity_sources WHERE quantity_item_id = ANY(${itemIds}) ORDER BY id`) as QuantitySourceRow[])

    for (const snapshot of this.#rowsToQuantities(snapshots, itemRows, sourceRows)) {
      this.quantities.set(snapshot.revisionId, snapshot)
    }
  }

  async #loadExportJobById(exportId: string): Promise<ExportJobRow | undefined> {
    const rows = await this.#sql`SELECT * FROM export_jobs WHERE id = ${exportId}` as ExportJobRow[]
    const row = rows[0]
    if (row) {
      this.exportJobs.set(row.id, rowToExportJob(row))
    }
    return row
  }

  /**
   * 監査ハッシュチェーンの末尾 1 件のみロードする。
   * 書き込み系リクエストで previous_hash 計算に使う（Issue #61 / #114 Phase 1）。
   */
  async #loadAuditTail(): Promise<void> {
    const rows =
      await this.#sql`SELECT * FROM audit_logs ORDER BY occurred_at DESC, id DESC LIMIT 1` as AuditLogRow[]
    this.auditLogs.length = 0
    for (const row of rows) {
      this.auditLogs.push(rowToAuditLog(row))
    }
  }

  /** DB 上の最新 entry_hash を返す（並行チェーン直列化のため毎回 DB から読む）。 */
  async #loadLatestAuditHash(): Promise<string | undefined> {
    const rows = await this.#sql`
      SELECT entry_hash
      FROM audit_logs
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
    ` as { entry_hash: string | null }[]
    return rows[0]?.entry_hash ?? undefined
  }

  /** quantity_snapshots/items/sources の行群を API 契約レコードへ組立てる。 */
  #rowsToQuantities(
    snapshots: readonly QuantitySnapshotRow[],
    itemRows: readonly QuantityItemRow[],
    sourceRows: readonly QuantitySourceRow[],
  ): readonly QuantitySnapshotRecord[] {
    const itemMap = new Map<string, QuantityItemRow[]>()
    for (const item of itemRows) {
      const list = itemMap.get(item.revision_id)
      if (list) {
        list.push(item)
      } else {
        itemMap.set(item.revision_id, [item])
      }
    }
    const sourceMap = new Map<string, QuantitySourceRow[]>()
    for (const src of sourceRows) {
      const list = sourceMap.get(src.quantity_item_id)
      if (list) {
        list.push(src)
      } else {
        sourceMap.set(src.quantity_item_id, [src])
      }
    }
    return snapshots.map((snap) => {
      const items: QuantityItemRecord[] = (itemMap.get(snap.revision_id) ?? []).map((item) =>
        rowToQuantityItem(item, sourceMap.get(item.id) ?? []),
      )
      return {
        revisionId: snap.revision_id,
        items,
        quantityVersion: toNumber(snap.quantity_version),
        updatedAt: toIsoString(snap.updated_at),
        updatedBy: snap.updated_by,
      }
    })
  }

  // -----------------------------------------------------------------------
  // SQL-first read methods（#114 Phase 2）
  // ハンドラが単一レコード/サブセットを述語付き・明示列で直接取得する。
  // Map キャッシュは更新しない（読み取り専用・書き込み経路は Phase 1 のスコープ
  // ロードを引き続き使用）。
  // -----------------------------------------------------------------------

  async queryRevision(revisionId: string): Promise<RevisionRecord | undefined> {
    const rows =
      await this.#sql`SELECT id, drawing_id, revision_number, status, change_summary, based_on_revision_id, content_version, content_checksum, created_at, created_by, updated_at, updated_by FROM drawing_revisions WHERE id = ${revisionId}` as RevisionRow[]
    const row = rows[0]
    return row ? rowToRevision(row) : undefined
  }

  async queryDrawing(drawingId: string): Promise<DrawingRecord | undefined> {
    const rows =
      await this.#sql`SELECT id, project_id, drawing_number, name, drawing_type, settings, status, active_revision_id, created_at, created_by, updated_at, updated_by, version FROM drawings WHERE id = ${drawingId}` as DrawingRow[]
    const row = rows[0]
    return row ? rowToDrawing(row) : undefined
  }

  async queryProjectMembers(projectId: string): Promise<readonly ProjectMemberRecord[]> {
    const rows =
      await this.#sql`SELECT project_id, user_id, role, created_at, updated_at FROM project_members WHERE project_id = ${projectId} ORDER BY user_id` as ProjectMemberRow[]
    return rows.map((row) => rowToProjectMember(row))
  }

  async queryContent(revisionId: string): Promise<ContentRecord | undefined> {
    const rows =
      await this.#sql`SELECT revision_id, content, byte_size, content_checksum, mime_type, schema_version, content_version, updated_at, storage_provider FROM drawing_contents WHERE revision_id = ${revisionId}` as ContentRow[]
    const row = rows[0]
    return row ? rowToContent(row) : undefined
  }

  async queryQuantities(revisionId: string): Promise<QuantitySnapshotRecord | undefined> {
    const snapshots =
      await this.#sql`SELECT revision_id, quantity_version, updated_at, updated_by FROM quantity_snapshots WHERE revision_id = ${revisionId}` as QuantitySnapshotRow[]
    const itemRows =
      await this.#sql`SELECT id, revision_id, group_key, work_type, specification, method, unit, raw_value, rounded_value, item_status, quantity_version FROM quantity_items WHERE revision_id = ${revisionId} ORDER BY id` as QuantityItemRow[]
    const itemIds = itemRows.map((item) => item.id)
    const sourceRows =
      itemIds.length === 0
        ? []
        : ((await this.#sql`SELECT quantity_item_id, geometry_id, contribution_raw FROM quantity_sources WHERE quantity_item_id = ANY(${itemIds}) ORDER BY id`) as QuantitySourceRow[])
    return this.#rowsToQuantities(snapshots, itemRows, sourceRows)[0]
  }

  // -----------------------------------------------------------------------
  // Write helpers (persist to Neon, then update local cache)
  // -----------------------------------------------------------------------

  /**
   * Insert a project into Neon and the local Map.
   * expectedVersion 指定時は DB 側で version 述語を強制し、不一致なら
   * VersionConflictError を投げる（Issue #114 Phase 3・楽観ロックの DB 強制）。
   */
  async persistProject(project: ProjectRecord, expectedVersion?: number): Promise<void> {
    if (expectedVersion !== undefined) {
      const rows = await this.#sql`
        UPDATE projects SET
          project_number = ${project.projectNumber},
          name = ${project.name},
          client_name = ${project.clientName ?? null},
          status = ${project.status},
          updated_at = ${project.updatedAt},
          updated_by = ${project.updatedBy},
          version = ${project.version}
        WHERE id = ${project.id} AND version = ${expectedVersion}
        RETURNING id
      ` as ProjectRow[]
      if (rows.length === 0) {
        throw new VersionConflictError('project', expectedVersion)
      }
    } else {
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
    }
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

  /** Insert or update a drawing. expectedVersion 指定時は DB 側で version 述語を強制する。 */
  async persistDrawing(drawing: DrawingRecord, expectedVersion?: number): Promise<void> {
    // settings は任意の JSON（配列やプリミティブを含む）を受けるため、
    // 明示的に JSON 文字列化して ::jsonb へキャストする（pg 系ドライバは
    // トップレベル配列を Postgres 配列リテラルとして直列化してしまうため）。
    if (expectedVersion !== undefined) {
      const rows = await this.#sql`
        UPDATE drawings SET
          drawing_number = ${drawing.drawingNumber},
          name = ${drawing.name},
          drawing_type = ${drawing.drawingType},
          settings = ${JSON.stringify(drawing.settings ?? {})}::jsonb,
          status = ${drawing.status},
          active_revision_id = ${drawing.activeRevisionId ?? null},
          updated_at = ${drawing.updatedAt},
          updated_by = ${drawing.updatedBy},
          version = ${drawing.version}
        WHERE id = ${drawing.id} AND version = ${expectedVersion}
        RETURNING id
      ` as DrawingRow[]
      if (rows.length === 0) {
        throw new VersionConflictError('drawing', expectedVersion)
      }
    } else {
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
    }
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

  /** Insert or update drawing content. expectedContentVersion 指定時は DB 側で version 述語を強制する。 */
  async persistContent(content: ContentRecord, expectedContentVersion?: number): Promise<void> {
    // content は図面 JSON 本体（配列・プリミティブ含む任意 JSON）のため、
    // JSON.stringify + ::jsonb キャストで直列化を確定させる。
    // storage_provider は ADR-0014（R2 スキップ・Neon 直接格納）に合わせ 'neon'。
    if (expectedContentVersion !== undefined) {
      const rows = await this.#sql`
        UPDATE drawing_contents SET
          content = ${JSON.stringify(content.content ?? null)}::jsonb,
          byte_size = ${content.byteSize},
          content_checksum = ${content.contentChecksum},
          mime_type = ${content.mimeType},
          schema_version = ${content.schemaVersion},
          content_version = ${content.contentVersion},
          updated_at = ${content.updatedAt},
          updated_by = 'system'
        WHERE revision_id = ${content.revisionId} AND content_version = ${expectedContentVersion}
        RETURNING revision_id
      ` as ContentRow[]
      if (rows.length === 0) {
        throw new VersionConflictError('drawing_contents', expectedContentVersion)
      }
    } else {
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
    }
    this.contents.set(content.revisionId, content)
  }

  /** Insert or update a quantity snapshot with its items and sources (single transaction; #68). */
  async persistQuantities(snapshot: QuantitySnapshotRecord, expectedQuantityVersion?: number): Promise<void> {
    const results = (await this.#sql.transaction((txn) =>
      buildQuantitiesQueries(txn, snapshot, expectedQuantityVersion),
    )) as readonly unknown[][]
    if (expectedQuantityVersion !== undefined && (results[0]?.length ?? 0) === 0) {
      throw new VersionConflictError('quantity_snapshots', expectedQuantityVersion)
    }
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

  /**
   * Append an audit log entry.
   *
   * ハッシュチェーンの並行分岐対策（Issue #114 Phase 4）: previous_hash は
   * リクエストローカル末尾ではなく DB の最新 entry_hash から毎回取得する。
   * migration 0006 の previous_hash 一意索引により、並行書き込みの片方が
   * unique violation で失敗するため、再試行で新しい末尾を基準に挿入し直す。
   * これによりチェーンは常に単一（分岐しない）ことが DB 制約で保証される。
   */
  async persistAuditLog(log: AuditLogRecord): Promise<void> {
    // detail は任意 JSON（配列を含む）のため JSON.stringify + ::jsonb で確定させる。
    // 未指定は SQL NULL（jsonb 'null' ではなく列 NULL）として格納する。
    const detailJson = log.detail === undefined ? null : JSON.stringify(log.detail)
    // 再試行上限: 並行衝突が集中しても 3 回で打ち切る（fail-visible 500 に落ちる）。
    const MAX_ATTEMPTS = 3
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const previousHash = await this.#loadLatestAuditHash()
      const entryHash = await computeEntryHash(previousHash, log)
      const hashedLog: AuditLogRecord = { ...log, previousHash, entryHash }
      try {
        await this.#sql`
          INSERT INTO audit_logs (id, occurred_at, event_name, actor_id, project_id, entity_type, entity_id, result, correlation_id, detail, previous_hash, entry_hash, hash_algorithm)
          VALUES (${hashedLog.id}, ${hashedLog.occurredAt}, ${hashedLog.eventName}, ${hashedLog.actorId}, ${hashedLog.projectId ?? null}, ${hashedLog.entityType ?? null}, ${hashedLog.entityId ?? null}, ${hashedLog.result}, ${hashedLog.correlationId}, ${detailJson}::jsonb, ${hashedLog.previousHash ?? null}, ${hashedLog.entryHash}, 'sha256')
        `
        this.auditLogs.push(hashedLog)
        return
      } catch (err) {
        const uniqueViolation =
          typeof err === 'object' &&
          err !== null &&
          (('code' in err && err.code === '23505') ||
            ('message' in err && /duplicate key|already exists/i.test(String(err.message))))
        if (uniqueViolation && attempt < MAX_ATTEMPTS - 1) {
          continue
        }
        throw err
      }
    }
  }

  /** Delete a project member (Issue #119). 存在しない場合は何もしない。 */
  async removeProjectMember(projectId: string, userId: string): Promise<void> {
    const rows = await this.#sql`
      DELETE FROM project_members
      WHERE project_id = ${projectId} AND user_id = ${userId}
      RETURNING project_id
    ` as ProjectMemberRow[]
    if (rows.length > 0) {
      this.projectMembers.delete(memberMapKey(projectId, userId))
    }
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
  async persistContentWithRevision(
    content: ContentRecord,
    revision: RevisionRecord,
    expectedContentVersion?: number,
  ): Promise<void> {
    const contentQuery =
      expectedContentVersion === undefined
        ? (txn: NeonQueryFunctionInTransaction<boolean, boolean>) =>
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
            `
        : (txn: NeonQueryFunctionInTransaction<boolean, boolean>) =>
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
              WHERE drawing_contents.content_version = ${expectedContentVersion}
              RETURNING revision_id
            `
    const results = (await this.#sql.transaction((txn) => [
      contentQuery(txn),
      buildRevisionQuery(txn, revision),
    ])) as readonly unknown[][]
    if (expectedContentVersion !== undefined && (results[0]?.length ?? 0) === 0) {
      throw new VersionConflictError('drawing_contents', expectedContentVersion)
    }
    this.contents.set(content.revisionId, content)
    this.revisions.set(revision.id, revision)
  }

  /** Insert a quantity snapshot (with items/sources) and update its revision in one transaction. */
  async persistQuantitiesWithRevision(
    snapshot: QuantitySnapshotRecord,
    revision: RevisionRecord,
    expectedQuantityVersion?: number,
  ): Promise<void> {
    const results = (await this.#sql.transaction((txn) => [
      ...buildQuantitiesQueries(txn, snapshot, expectedQuantityVersion),
      buildRevisionQuery(txn, revision),
    ])) as readonly unknown[][]
    if (expectedQuantityVersion !== undefined && (results[0]?.length ?? 0) === 0) {
      throw new VersionConflictError('quantity_snapshots', expectedQuantityVersion)
    }
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

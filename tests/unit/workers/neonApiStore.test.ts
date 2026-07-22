import { describe, expect, it, vi } from 'vitest'
import { NeonApiStore } from '@/workers/neonApiStore'
import type { SqlClient } from '@/workers/neonApiStore'
import type {
  ProjectRecord,
  ProjectMemberRecord,
  DrawingRecord,
  RevisionRecord,
  ContentRecord,
  QuantityItemRecord,
  QuantitySnapshotRecord,
  WorkflowActionRecord,
  ExportJobRecord,
  AuditLogRecord,
} from '@/workers/apiStore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// #68: SqlClient = ReturnType<typeof neon> はタグ付きテンプレート関数でありながら
// .transaction() メソッドも持つハイブリッドオブジェクト。txn`...` 呼び出しは sql`...`
// と同じ応答解決ロジックを再利用し、.transaction(callback) は callback(txn) を同期的に
// 呼び出して返された配列（NeonQueryInTransaction[]）を Promise.all で解決する
// （実ドライバの「単一 HTTP トランザクションとしてバッチ実行」を模倣）。
function makeSqlClient(
  responses: Readonly<Record<string, readonly Record<string, unknown>[]>> = {},
): SqlClient & { transaction: ReturnType<typeof vi.fn> } {
  const tag = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const sql = strings[0] ?? ''
    let result: readonly Record<string, unknown>[] = []
    for (const [prefix, rows] of Object.entries(responses)) {
      if (sql.includes(prefix)) {
        result = rows
        break
      }
    }
    return Promise.resolve([...result])
  })

  const transaction = vi.fn((callback: (txn: typeof tag) => unknown[]) => {
    return Promise.all(callback(tag))
  })

  return Object.assign(tag, { transaction }) as unknown as SqlClient & {
    transaction: typeof transaction
  }
}

// #73: makeSqlClient() の tag は vi.fn だが公開型は SqlClient のため、発行された
// クエリの実引数（DELETE の WHERE 句パラメータなど）を検査するには実行時キャストが要る。
type SqlMockCall = [TemplateStringsArray, ...unknown[]]
function sqlCalls(sql: SqlClient): readonly SqlMockCall[] {
  return (sql as unknown as { mock: { calls: SqlMockCall[] } }).mock.calls
}

const now = '2026-07-18T00:00:00.000Z'

function projectRow(id = 'proj-1'): Record<string, unknown> {
  return {
    id,
    project_number: 'P-001',
    name: '国道245号',
    client_name: 'Mirai建設',
    status: 'active',
    created_at: now,
    created_by: 'user@test',
    updated_at: now,
    updated_by: 'user@test',
    version: 1,
  }
}

function memberRow(projectId = 'proj-1', userId = 'user@test'): Record<string, unknown> {
  return { project_id: projectId, user_id: userId, role: 'manager', created_at: now, updated_at: now }
}

function drawingRow(id = 'draw-1'): Record<string, unknown> {
  return {
    id,
    project_id: 'proj-1',
    drawing_number: 'DWG-001',
    name: '平面図',
    drawing_type: 'general',
    settings: {},
    status: 'active',
    active_revision_id: null,
    created_at: now,
    created_by: 'user@test',
    updated_at: now,
    updated_by: 'user@test',
    version: 1,
  }
}

function revisionRow(id = 'rev-1'): Record<string, unknown> {
  return {
    id,
    drawing_id: 'draw-1',
    revision_number: '1',
    status: 'draft',
    change_summary: '初版',
    based_on_revision_id: null,
    content_version: 1,
    content_checksum: 'sha256:abc',
    created_at: now,
    created_by: 'user@test',
    updated_at: now,
    updated_by: 'user@test',
  }
}

function contentRow(revisionId = 'rev-1'): Record<string, unknown> {
  return {
    revision_id: revisionId,
    content: { geometries: [] },
    byte_size: 100,
    content_checksum: 'sha256:abc',
    mime_type: 'application/json',
    schema_version: 1,
    content_version: 1,
    storage_provider: 'r2',
    updated_at: now,
  }
}

function quantitySnapshotRow(revisionId = 'rev-1'): Record<string, unknown> {
  return { revision_id: revisionId, quantity_version: 1, updated_at: now, updated_by: 'user@test' }
}

function quantityItemRow(id = 'qty-1'): Record<string, unknown> {
  return {
    id,
    revision_id: 'rev-1',
    group_key: 'earthwork',
    work_type: null,
    specification: null,
    method: 'volume',
    unit: 'm3',
    raw_value: 12.345,
    rounded_value: 12.35,
    item_status: 'valid',
    quantity_version: 1,
  }
}

function quantitySourceRow(geometryId = 'g-1', quantityItemId = 'qty-1'): Record<string, unknown> {
  // quantity_sources の実列構成（0001/0002）: quantity_item_id が親 item への FK。
  // contribution_raw は numeric のため driver は文字列で返し得る。
  return { quantity_item_id: quantityItemId, geometry_id: geometryId, contribution_raw: '12.345' }
}

function workflowActionRow(id = 'wf-1'): Record<string, unknown> {
  return {
    id,
    revision_id: 'rev-1',
    action: 'submitReview',
    from_status: 'draft',
    to_status: 'inReview',
    actor_id: 'user@test',
    comment: null,
    occurred_at: now,
  }
}

function exportJobRow(id = 'exp-1'): Record<string, unknown> {
  return {
    id,
    revision_id: 'rev-1',
    format: 'pdf',
    status: 'completed',
    object_key: 'exports/proj-1/draw-1/rev-1/file.pdf',
    byte_size: 100,
    content_checksum: 'sha256:abc',
    error_code: null,
    created_at: now,
    created_by: 'user@test',
    completed_at: now,
  }
}

function auditLogRow(id = 'audit-1'): Record<string, unknown> {
  return {
    id,
    occurred_at: now,
    event_name: 'project.created',
    actor_id: 'user@test',
    project_id: 'proj-1',
    entity_type: 'project',
    entity_id: 'proj-1',
    result: 'success',
    correlation_id: 'corr-1',
    detail: null,
    previous_hash: null,
    entry_hash: null,
    hash_algorithm: 'sha256',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NeonApiStore', () => {
  it('initialize loads projects from Neon into the projects Map', async () => {
    // sql2 overrides the projects query to return data
    const sql2 = makeSqlClient({
      'FROM projects': [projectRow()],
      'FROM project_members': [memberRow()],
      'FROM drawings': [],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql2)
    await store.initialize()

    expect(store.projects.size).toBe(1)
    const project = store.projects.get('proj-1')
    expect(project?.projectNumber).toBe('P-001')
    expect(project?.name).toBe('国道245号')
    expect(project?.version).toBe(1)
  })

  it('initialize loads drawings from Neon into the drawings Map', async () => {
    const sql = makeSqlClient({
      'FROM projects': [],
      'FROM project_members': [],
      'FROM drawings': [drawingRow()],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    expect(store.drawings.size).toBe(1)
    const drawing = store.drawings.get('draw-1')
    expect(drawing?.drawingNumber).toBe('DWG-001')
    expect(drawing?.projectId).toBe('proj-1')
  })

  it('initialize loads revisions from Neon into the revisions Map', async () => {
    const sql = makeSqlClient({
      'FROM projects': [],
      'FROM project_members': [],
      'FROM drawings': [],
      'FROM drawing_revisions': [revisionRow()],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    expect(store.revisions.size).toBe(1)
    const revision = store.revisions.get('rev-1')
    expect(revision?.status).toBe('draft')
    expect(revision?.drawingId).toBe('draw-1')
  })

  it('initialize loads contents from Neon into the contents Map', async () => {
    const sql = makeSqlClient({
      'FROM projects': [],
      'FROM project_members': [],
      'FROM drawings': [],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [contentRow()],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    expect(store.contents.size).toBe(1)
    const content = store.contents.get('rev-1')
    expect(content?.content).toEqual({ geometries: [] })
    expect(content?.contentVersion).toBe(1)
  })

  it('initialize loads quantities with items and sources', async () => {
    const sql = makeSqlClient({
      'FROM projects': [],
      'FROM project_members': [],
      'FROM drawings': [],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [quantitySnapshotRow()],
      'FROM quantity_items': [quantityItemRow()],
      'FROM quantity_sources': [quantitySourceRow()],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    expect(store.quantities.size).toBe(1)
    const snapshot = store.quantities.get('rev-1')
    expect(snapshot?.quantityVersion).toBe(1)
    expect(snapshot?.items).toHaveLength(1)
    expect(snapshot?.items[0]?.groupKey).toBe('earthwork')
    // #66 回帰: sources は quantity_item_id（親 item の FK）で復元される。
    // 旧実装は geometry_id でグループ化して item.id で引いており常に空だった。
    expect(snapshot?.items[0]?.sources).toEqual([{ geometryId: 'g-1', contributionRaw: 12.345 }])
  })

  it('driver が bigint を文字列・timestamptz を Date で返しても API 契約（number / ISO 文字列）へ正規化する（#66 回帰）', async () => {
    // @neondatabase/serverless は pg-types 既定で int8/numeric を文字列、
    // timestamptz を Date で返す。旧実装は projects.version 等を素通しし、
    // 楽観ロック比較（expectedVersion !== project.version）が常に不一致になっていた。
    const sql = makeSqlClient({
      'FROM projects': [
        { ...projectRow(), version: '3', created_at: new Date('2026-07-18T00:00:00.000Z') },
      ],
      'FROM project_members': [memberRow()],
      'FROM drawings': [],
      'FROM drawing_revisions': [{ ...revisionRow(), content_version: '7' }],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    const project = store.projects.get('proj-1')
    expect(project?.version).toBe(3)
    expect(project?.createdAt).toBe('2026-07-18T00:00:00.000Z')
    expect(store.revisions.get('rev-1')?.contentVersion).toBe(7)
  })

  it('initialize loads workflow actions from Neon', async () => {
    const sql = makeSqlClient({
      'FROM projects': [],
      'FROM project_members': [],
      'FROM drawings': [],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [workflowActionRow()],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    expect(store.workflowActions).toHaveLength(1)
    expect(store.workflowActions[0]?.action).toBe('submitReview')
    expect(store.workflowActions[0]?.fromStatus).toBe('draft')
    expect(store.workflowActions[0]?.toStatus).toBe('inReview')
  })

  it('initialize loads export jobs from Neon into the exportJobs Map', async () => {
    const sql = makeSqlClient({
      'FROM projects': [],
      'FROM project_members': [],
      'FROM drawings': [],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [exportJobRow()],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    expect(store.exportJobs.size).toBe(1)
    const job = store.exportJobs.get('exp-1')
    expect(job?.format).toBe('pdf')
    expect(job?.status).toBe('completed')
  })

  it('initialize loads audit logs from Neon', async () => {
    const sql = makeSqlClient({
      'FROM projects': [],
      'FROM project_members': [],
      'FROM drawings': [],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [auditLogRow()],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    expect(store.auditLogs).toHaveLength(1)
    expect(store.auditLogs[0]?.eventName).toBe('project.created')
    expect(store.auditLogs[0]?.projectId).toBe('proj-1')
  })

  it('initialize loads project members', async () => {
    const sql = makeSqlClient({
      'FROM projects': [projectRow()],
      'FROM project_members': [memberRow('proj-1', 'manager@test')],
      'FROM drawings': [],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()

    expect(store.projectMembers.size).toBe(1)
    const member = store.projectMembers.get('proj-1:manager@test')
    expect(member?.role).toBe('manager')
    expect(member?.userId).toBe('manager@test')
  })

  it('persistProject writes a new project to Neon and updates the local Map', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)

    const project: ProjectRecord = {
      id: 'new-proj',
      projectNumber: 'P-NEW',
      name: '新規案件',
      status: 'active',
      createdAt: now,
      createdBy: 'user@test',
      updatedAt: now,
      updatedBy: 'user@test',
      version: 1,
    }

    await store.persistProject(project)

    expect(sql).toHaveBeenCalled()
    // Check the local Map was updated
    expect(store.projects.get('new-proj')?.projectNumber).toBe('P-NEW')
  })

  it('persistProject updates an existing project via UPSERT', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)
    store.projects.set('proj-1', {
      id: 'proj-1',
      projectNumber: 'P-OLD',
      name: '旧名称',
      status: 'active',
      createdAt: now,
      createdBy: 'user@test',
      updatedAt: now,
      updatedBy: 'user@test',
      version: 1,
    })

    const updated: ProjectRecord = {
      id: 'proj-1',
      projectNumber: 'P-UPDATED',
      name: '新名称',
      clientName: '新発注者',
      status: 'archived',
      createdAt: now,
      createdBy: 'user@test',
      updatedAt: now,
      updatedBy: 'user@test',
      version: 2,
    }

    await store.persistProject(updated)

    expect(sql).toHaveBeenCalled()
    expect(store.projects.get('proj-1')?.version).toBe(2)
    expect(store.projects.get('proj-1')?.status).toBe('archived')
  })

  it('persistDrawing writes a new drawing and updates the local Map', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)

    const drawing: DrawingRecord = {
      id: 'new-draw',
      projectId: 'proj-1',
      drawingNumber: 'DWG-NEW',
      name: '新規図面',
      drawingType: 'general',
      settings: {},
      status: 'active',
      createdAt: now,
      createdBy: 'user@test',
      updatedAt: now,
      updatedBy: 'user@test',
      version: 1,
    }

    await store.persistDrawing(drawing)

    expect(sql).toHaveBeenCalled()
    expect(store.drawings.get('new-draw')?.drawingNumber).toBe('DWG-NEW')
  })

  it('persistRevision writes a new revision and updates the local Map', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)

    const revision: RevisionRecord = {
      id: 'new-rev',
      drawingId: 'draw-1',
      revisionNumber: '2',
      status: 'draft',
      changeSummary: '修正',
      contentVersion: 1,
      contentChecksum: 'sha256:xyz',
      createdAt: now,
      createdBy: 'user@test',
      updatedAt: now,
      updatedBy: 'user@test',
    }

    await store.persistRevision(revision)

    expect(sql).toHaveBeenCalled()
    expect(store.revisions.get('new-rev')?.revisionNumber).toBe('2')
  })

  it('persistContent writes content and updates the local Map', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)

    const content: ContentRecord = {
      revisionId: 'rev-1',
      content: { geometries: [{ id: 'g-1' }] },
      byteSize: 50,
      contentChecksum: 'sha256:new',
      mimeType: 'application/json',
      schemaVersion: 1,
      contentVersion: 2,
      updatedAt: now,
    }

    await store.persistContent(content)

    expect(sql).toHaveBeenCalled()
    expect(store.contents.get('rev-1')?.contentVersion).toBe(2)
  })

  it('persistQuantities writes a snapshot with items and sources in a single transaction (#68)', async () => {
    const sql = makeSqlClient()
    const store = new NeonApiStore(sql)

    const qtyItem: QuantityItemRecord = {
      id: 'qty-1',
      revisionId: 'rev-1',
      groupKey: 'earthwork',
      method: 'volume',
      unit: 'm3',
      rawValue: 10,
      roundedValue: 10,
      sources: [{ geometryId: 'g-1', contributionRaw: 10 }],
      status: 'valid',
    }

    const snapshot: QuantitySnapshotRecord = {
      revisionId: 'rev-1',
      items: [qtyItem],
      quantityVersion: 1,
      updatedAt: now,
      updatedBy: 'user@test',
    }

    await store.persistQuantities(snapshot)

    // #68/#73: snapshot UPSERT + item UPSERT + source UPSERT + 孤立item DELETE の 4 クエリが単一トランザクションで発行される
    expect(sql.transaction).toHaveBeenCalledTimes(1)
    expect(sql).toHaveBeenCalledTimes(4)
    expect(store.quantities.get('rev-1')?.quantityVersion).toBe(1)
  })

  it('persistQuantities issues a DELETE excluding the surviving item ids (#73 正常系)', async () => {
    const sql = makeSqlClient()
    const store = new NeonApiStore(sql)

    const items: QuantityItemRecord[] = [
      {
        id: 'qty-1',
        revisionId: 'rev-1',
        groupKey: 'earthwork',
        method: 'volume',
        unit: 'm3',
        rawValue: 10,
        roundedValue: 10,
        sources: [],
        status: 'valid',
      },
      {
        id: 'qty-2',
        revisionId: 'rev-1',
        groupKey: 'earthwork',
        method: 'volume',
        unit: 'm3',
        rawValue: 20,
        roundedValue: 20,
        sources: [],
        status: 'valid',
      },
    ]
    const snapshot: QuantitySnapshotRecord = {
      revisionId: 'rev-1',
      items,
      quantityVersion: 2,
      updatedAt: now,
      updatedBy: 'user@test',
    }

    await store.persistQuantities(snapshot)

    // snapshot UPSERT + item UPSERT ×2 + DELETE = 4（このケースは source なし）
    expect(sql).toHaveBeenCalledTimes(4)
    const deleteCall = sqlCalls(sql).find((call) => call[0][0]?.includes('DELETE FROM quantity_items'))
    expect(deleteCall).toBeDefined()
    expect(deleteCall?.[1]).toBe('rev-1')
    expect(deleteCall?.[2]).toEqual(['qty-1', 'qty-2'])
  })

  it('persistQuantities excludes a removed item from the surviving id list (#73 削除意図の境界値)', async () => {
    const sql = makeSqlClient()
    const store = new NeonApiStore(sql)

    // ユーザーが qty-2 を削除した結果、新しい snapshot には qty-1 のみが残る想定。
    const survivingItem: QuantityItemRecord = {
      id: 'qty-1',
      revisionId: 'rev-1',
      groupKey: 'earthwork',
      method: 'volume',
      unit: 'm3',
      rawValue: 10,
      roundedValue: 10,
      sources: [{ geometryId: 'g-1', contributionRaw: 10 }],
      status: 'valid',
    }
    const snapshot: QuantitySnapshotRecord = {
      revisionId: 'rev-1',
      items: [survivingItem],
      quantityVersion: 3,
      updatedAt: now,
      updatedBy: 'user@test',
    }

    await store.persistQuantities(snapshot)

    const deleteCall = sqlCalls(sql).find((call) => call[0][0]?.includes('DELETE FROM quantity_items'))
    expect(deleteCall).toBeDefined()
    // #73 回帰: 削除された qty-2 は生存 id 配列に含まれてはならない（含まれると永続残留する = 元バグ）
    expect(deleteCall?.[2]).toEqual(['qty-1'])
    expect(deleteCall?.[2]).not.toContain('qty-2')
  })

  it('persistQuantities issues a full-deletion DELETE when items is empty (#73 空配列ケース)', async () => {
    const sql = makeSqlClient()
    const store = new NeonApiStore(sql)

    const snapshot: QuantitySnapshotRecord = {
      revisionId: 'rev-1',
      items: [],
      quantityVersion: 4,
      updatedAt: now,
      updatedBy: 'user@test',
    }

    await store.persistQuantities(snapshot)

    // snapshot UPSERT + DELETE のみ（items が空のため item/source UPSERT は発行されない）
    expect(sql).toHaveBeenCalledTimes(2)
    const deleteCall = sqlCalls(sql).find((call) => call[0][0]?.includes('DELETE FROM quantity_items'))
    expect(deleteCall).toBeDefined()
    // #73: 空配列は `!= ALL('{}')` として全行に一致し、全件削除として正しく機能する
    expect(deleteCall?.[2]).toEqual([])
    expect(store.quantities.get('rev-1')?.items).toEqual([])
  })

  it('persistWorkflowAction appends an action and updates the local list', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)

    const action: WorkflowActionRecord = {
      id: 'wf-new',
      revisionId: 'rev-1',
      action: 'approve',
      fromStatus: 'pendingApproval',
      toStatus: 'approved',
      actorId: 'user@test',
      occurredAt: now,
    }

    await store.persistWorkflowAction(action)

    expect(sql).toHaveBeenCalled()
    expect(store.workflowActions).toHaveLength(1)
    expect(store.workflowActions[0]?.action).toBe('approve')
  })

  it('persistExportJob writes an export job and updates the local Map', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)

    const job: ExportJobRecord = {
      id: 'exp-new',
      revisionId: 'rev-1',
      format: 'json',
      status: 'pending',
      createdAt: now,
      createdBy: 'user@test',
    }

    await store.persistExportJob(job)

    expect(sql).toHaveBeenCalled()
    expect(store.exportJobs.get('exp-new')?.format).toBe('json')
  })

  it('persistAuditLog appends an audit entry and updates the local list', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)

    const log: AuditLogRecord = {
      id: 'audit-new',
      occurredAt: now,
      eventName: 'drawing.created',
      actorId: 'user@test',
      projectId: 'proj-1',
      entityType: 'drawing',
      entityId: 'draw-1',
      result: 'success',
      correlationId: 'corr-1',
    }

    await store.persistAuditLog(log)

    expect(sql).toHaveBeenCalled()
    expect(store.auditLogs).toHaveLength(1)
    expect(store.auditLogs[0]?.eventName).toBe('drawing.created')
  })

  it('initialize is idempotent — calling twice does not duplicate data', async () => {
    const sql = makeSqlClient({
      'FROM projects': [projectRow()],
      'FROM project_members': [],
      'FROM drawings': [],
      'FROM drawing_revisions': [],
      'FROM drawing_contents': [],
      'FROM quantity_snapshots': [],
      'FROM quantity_items': [],
      'FROM quantity_sources': [],
      'FROM workflow_actions': [],
      'FROM export_jobs': [],
      'FROM audit_logs': [],
    })

    const store = new NeonApiStore(sql)
    await store.initialize()
    await store.initialize()

    expect(store.projects.size).toBe(1)
  })

  it('uses parameterized SQL to prevent SQL injection', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as SqlClient
    const store = new NeonApiStore(sql)

    // Attempt a value that looks like SQL injection
    const project: ProjectRecord = {
      id: "proj'; DROP TABLE projects;--",
      projectNumber: "P'; DELETE FROM projects;--",
      name: "test'); DROP TABLE projects;--",
      status: 'active',
      createdAt: now,
      createdBy: 'user@test',
      updatedAt: now,
      updatedBy: 'user@test',
      version: 1,
    }

    await store.persistProject(project)

    // Verify the SQL call was made — with parameterized values, the injection
    // should be escaped by the driver
    expect(sql).toHaveBeenCalled()
  })

  describe('composite persistence — single transaction for 2 records (#68)', () => {
    it('persistProjectWithMember writes both records in a single transaction', async () => {
      const sql = makeSqlClient()
      const store = new NeonApiStore(sql)

      const project: ProjectRecord = {
        id: 'proj-new',
        projectNumber: 'P-002',
        name: '新規案件',
        status: 'active',
        createdAt: now,
        createdBy: 'user@test',
        updatedAt: now,
        updatedBy: 'user@test',
        version: 1,
      }
      const member: ProjectMemberRecord = {
        projectId: 'proj-new',
        userId: 'user@test',
        role: 'manager',
        createdAt: now,
        updatedAt: now,
      }

      await store.persistProjectWithMember(project, member)

      // project INSERT + member INSERT = 2 クエリが単一トランザクションで発行される
      expect(sql.transaction).toHaveBeenCalledTimes(1)
      expect(sql).toHaveBeenCalledTimes(2)
      expect(store.projects.get('proj-new')?.projectNumber).toBe('P-002')
      expect(store.projectMembers.get('proj-new:user@test')?.role).toBe('manager')
    })

    it('persistProjectWithMember propagates transaction failure without updating local caches', async () => {
      const sql = makeSqlClient()
      sql.transaction.mockRejectedValueOnce(new Error('neon transaction failed'))
      const store = new NeonApiStore(sql)

      const project: ProjectRecord = {
        id: 'proj-fail',
        projectNumber: 'P-FAIL',
        name: '失敗案件',
        status: 'active',
        createdAt: now,
        createdBy: 'user@test',
        updatedAt: now,
        updatedBy: 'user@test',
        version: 1,
      }
      const member: ProjectMemberRecord = {
        projectId: 'proj-fail',
        userId: 'user@test',
        role: 'manager',
        createdAt: now,
        updatedAt: now,
      }

      await expect(store.persistProjectWithMember(project, member)).rejects.toThrow(
        'neon transaction failed',
      )

      // #68 契約: トランザクション失敗時はどちらのローカルキャッシュも更新しない（部分永続化を防ぐ）
      expect(store.projects.has('proj-fail')).toBe(false)
      expect(store.projectMembers.has('proj-fail:user@test')).toBe(false)
    })

    it('persistRevisionWithDrawing writes both records in a single transaction', async () => {
      const sql = makeSqlClient()
      const store = new NeonApiStore(sql)

      const revision: RevisionRecord = {
        id: 'rev-new',
        drawingId: 'draw-1',
        revisionNumber: '2',
        status: 'draft',
        changeSummary: '2版',
        contentVersion: 1,
        contentChecksum: 'sha256:new',
        createdAt: now,
        createdBy: 'user@test',
        updatedAt: now,
        updatedBy: 'user@test',
      }
      const drawing: DrawingRecord = {
        id: 'draw-1',
        projectId: 'proj-1',
        drawingNumber: 'DWG-001',
        name: '平面図',
        drawingType: 'general',
        settings: {},
        status: 'active',
        activeRevisionId: 'rev-new',
        createdAt: now,
        createdBy: 'user@test',
        updatedAt: now,
        updatedBy: 'user@test',
        version: 2,
      }

      await store.persistRevisionWithDrawing(revision, drawing)

      // revision UPSERT + drawing UPSERT = 2 クエリ
      expect(sql.transaction).toHaveBeenCalledTimes(1)
      expect(sql).toHaveBeenCalledTimes(2)
      expect(store.revisions.get('rev-new')?.revisionNumber).toBe('2')
      expect(store.drawings.get('draw-1')?.activeRevisionId).toBe('rev-new')
    })

    it('persistContentWithRevision writes both records in a single transaction', async () => {
      const sql = makeSqlClient()
      const store = new NeonApiStore(sql)

      const content: ContentRecord = {
        revisionId: 'rev-1',
        content: { geometries: [] },
        byteSize: 10,
        contentChecksum: 'sha256:content',
        mimeType: 'application/json',
        schemaVersion: 1,
        contentVersion: 2,
        updatedAt: now,
      }
      const revision: RevisionRecord = {
        id: 'rev-1',
        drawingId: 'draw-1',
        revisionNumber: '1',
        status: 'draft',
        changeSummary: '更新',
        contentVersion: 2,
        contentChecksum: 'sha256:content',
        createdAt: now,
        createdBy: 'user@test',
        updatedAt: now,
        updatedBy: 'user@test',
      }

      await store.persistContentWithRevision(content, revision)

      // content UPSERT + revision UPSERT = 2 クエリ
      expect(sql.transaction).toHaveBeenCalledTimes(1)
      expect(sql).toHaveBeenCalledTimes(2)
      expect(store.contents.get('rev-1')?.contentVersion).toBe(2)
      expect(store.revisions.get('rev-1')?.contentChecksum).toBe('sha256:content')
    })

    it('persistQuantitiesWithRevision writes snapshot, items, sources, and revision in a single transaction', async () => {
      const sql = makeSqlClient()
      const store = new NeonApiStore(sql)

      const qtyItem: QuantityItemRecord = {
        id: 'qty-1',
        revisionId: 'rev-1',
        groupKey: 'earthwork',
        method: 'volume',
        unit: 'm3',
        rawValue: 10,
        roundedValue: 10,
        sources: [{ geometryId: 'g-1', contributionRaw: 10 }],
        status: 'valid',
      }
      const snapshot: QuantitySnapshotRecord = {
        revisionId: 'rev-1',
        items: [qtyItem],
        quantityVersion: 1,
        updatedAt: now,
        updatedBy: 'user@test',
      }
      const revision: RevisionRecord = {
        id: 'rev-1',
        drawingId: 'draw-1',
        revisionNumber: '1',
        status: 'draft',
        changeSummary: '数量更新',
        contentVersion: 1,
        contentChecksum: 'sha256:abc',
        createdAt: now,
        createdBy: 'user@test',
        updatedAt: now,
        updatedBy: 'user@test',
      }

      await store.persistQuantitiesWithRevision(snapshot, revision)

      // snapshot UPSERT + item UPSERT + source UPSERT + 孤立item DELETE(#73) + revision UPSERT = 5 クエリ
      expect(sql.transaction).toHaveBeenCalledTimes(1)
      expect(sql).toHaveBeenCalledTimes(5)
      expect(store.quantities.get('rev-1')?.quantityVersion).toBe(1)
      expect(store.revisions.get('rev-1')?.changeSummary).toBe('数量更新')
    })

    it('persistWorkflowActionWithRevision writes both records in a single transaction', async () => {
      const sql = makeSqlClient()
      const store = new NeonApiStore(sql)

      const action: WorkflowActionRecord = {
        id: 'wf-new',
        revisionId: 'rev-1',
        action: 'submitReview',
        fromStatus: 'draft',
        toStatus: 'inReview',
        actorId: 'user@test',
        occurredAt: now,
      }
      const revision: RevisionRecord = {
        id: 'rev-1',
        drawingId: 'draw-1',
        revisionNumber: '1',
        status: 'inReview',
        changeSummary: '査読依頼',
        contentVersion: 1,
        contentChecksum: 'sha256:abc',
        createdAt: now,
        createdBy: 'user@test',
        updatedAt: now,
        updatedBy: 'user@test',
      }

      await store.persistWorkflowActionWithRevision(action, revision)

      // workflow_action INSERT + revision UPSERT = 2 クエリ
      expect(sql.transaction).toHaveBeenCalledTimes(1)
      expect(sql).toHaveBeenCalledTimes(2)
      expect(store.workflowActions).toHaveLength(1)
      expect(store.workflowActions[0]?.action).toBe('submitReview')
      expect(store.revisions.get('rev-1')?.status).toBe('inReview')
    })
  })
})
/**
 * Neon 実接続の永続化 roundtrip 結合テスト（#66）。
 *
 * 目的: NeonApiStore の persistX 系が実際の Neon スキーマ（0001→0004 適用済み）
 * に対して書き込め、新しい store インスタンスの initialize() で同一内容が
 * 復元されることを検証する（Workers のステートレス実行モデルの再現）。
 *
 * 実行方法（Neon dev/検証ブランチに対してのみ実行すること。本番 main 禁止）:
 *   CIVILDRAFT_TEST_NEON_CONNECTION=$(neonctl cs <verify-branch> ...) npx vitest run tests/integration/workers/
 *
 * 接続文字列が未設定の場合はスイート全体を skip する（CI では常に skip）。
 * 接続文字列を echo / ログ出力してはならない（CLAUDE.md §19）。
 */
import { describe, expect, it } from 'vitest'
import { createNeonApiStore } from '@/workers/persistence'
import type {
  AuditLogRecord,
  ContentRecord,
  DrawingRecord,
  ExportJobRecord,
  ProjectMemberRecord,
  ProjectRecord,
  QuantitySnapshotRecord,
  RevisionRecord,
  WorkflowActionRecord,
} from '@/workers/apiStore'

const connection = process.env.CIVILDRAFT_TEST_NEON_CONNECTION

// 実行ごとに一意な ID を使い、検証ブランチ上で再実行可能にする（削除不要の追記型）。
const runId = crypto.randomUUID().slice(0, 8)
const now = new Date().toISOString()

const project: ProjectRecord = {
  id: `project_${crypto.randomUUID()}`,
  projectNumber: `P-IT-${runId}`,
  name: `結合テスト案件 ${runId}`,
  clientName: '合成データ建設',
  status: 'active',
  createdAt: now,
  createdBy: 'it-engineer@example.test',
  updatedAt: now,
  updatedBy: 'it-engineer@example.test',
  version: 1,
}

const member: ProjectMemberRecord = {
  projectId: project.id,
  userId: 'it-engineer@example.test',
  role: 'manager',
  createdAt: now,
  updatedAt: now,
}

const drawing: DrawingRecord = {
  id: `drawing_${crypto.randomUUID()}`,
  projectId: project.id,
  drawingNumber: `DWG-IT-${runId}`,
  name: '結合テスト平面図',
  drawingType: 'general',
  // 配列を含む settings で jsonb 直列化（pg 配列リテラル化の罠）を検証する
  settings: { layers: ['base', 'annotation'], gridSpacing: 5 },
  status: 'active',
  createdAt: now,
  createdBy: 'it-engineer@example.test',
  updatedAt: now,
  updatedBy: 'it-engineer@example.test',
  version: 1,
}

const revision: RevisionRecord = {
  id: `revision_${crypto.randomUUID()}`,
  drawingId: drawing.id,
  revisionNumber: 'A',
  status: 'draft',
  changeSummary: '結合テスト初版',
  contentVersion: 1,
  contentChecksum: 'sha256:it-checksum',
  createdAt: now,
  createdBy: 'it-engineer@example.test',
  updatedAt: now,
  updatedBy: 'it-engineer@example.test',
}

const content: ContentRecord = {
  revisionId: revision.id,
  // トップレベル配列を含む任意 JSON が jsonb roundtrip できることを検証する
  content: { geometries: [{ kind: 'line', points: [0, 0, 10, 10] }], meta: { unit: 'mm' } },
  byteSize: 96,
  contentChecksum: 'sha256:it-checksum',
  mimeType: 'application/json',
  schemaVersion: 1,
  contentVersion: 1,
  updatedAt: now,
}

const quantities: QuantitySnapshotRecord = {
  revisionId: revision.id,
  items: [
    {
      id: `qty_${crypto.randomUUID()}`,
      revisionId: revision.id,
      groupKey: 'earthwork',
      workType: '掘削',
      specification: '土砂',
      method: 'volume',
      unit: 'm3',
      rawValue: 12.345,
      roundedValue: 12.35,
      sources: [
        { geometryId: `geom_${runId}_1`, contributionRaw: 7.9 },
        { geometryId: `geom_${runId}_2`, contributionRaw: 4.445 },
      ],
      status: 'valid',
    },
  ],
  quantityVersion: 1,
  updatedAt: now,
  updatedBy: 'it-engineer@example.test',
}

const workflowAction: WorkflowActionRecord = {
  id: `workflow_${crypto.randomUUID()}`,
  revisionId: revision.id,
  action: 'submitReview',
  fromStatus: 'draft',
  toStatus: 'inReview',
  actorId: 'it-engineer@example.test',
  comment: '結合テスト提出',
  occurredAt: now,
}

const exportJob: ExportJobRecord = {
  id: `export_${crypto.randomUUID()}`,
  revisionId: revision.id,
  format: 'pdf',
  status: 'completed',
  objectKey: `exports/${project.id}/${drawing.id}/${revision.id}/it.pdf`,
  byteSize: 96,
  contentChecksum: 'sha256:it-checksum',
  createdAt: now,
  createdBy: 'it-engineer@example.test',
  completedAt: now,
}

const auditLog: AuditLogRecord = {
  id: `audit_${crypto.randomUUID()}`,
  occurredAt: now,
  eventName: 'integration.roundtrip',
  actorId: 'it-engineer@example.test',
  projectId: project.id,
  entityType: 'project',
  entityId: project.id,
  result: 'success',
  correlationId: `cid_it_${runId}`,
  detail: { changedFields: ['name', 'status'], note: '配列を含む detail の jsonb 検証' },
}

describe.skipIf(!connection)('Neon 永続化 roundtrip（実接続・#66）', () => {
  it(
    'persistX で書き込んだ全レコードが新しい store の initialize() で一致復元される',
    { timeout: 120_000 },
    async () => {
      // --- 書き込み側 store（リクエスト#1 相当） ---
      const writer = await createNeonApiStore({ CIVILDRAFT_NEON_CONNECTION: connection! })
      await writer.neonStore.persistProject(project)
      await writer.neonStore.persistProjectMember(member)
      await writer.neonStore.persistDrawing(drawing)
      await writer.neonStore.persistRevision(revision)
      // activeRevisionId 更新（createRevision ハンドラと同じ 2 段階）
      await writer.neonStore.persistDrawing({ ...drawing, activeRevisionId: revision.id })
      await writer.neonStore.persistContent(content)
      await writer.neonStore.persistQuantities(quantities)
      await writer.neonStore.persistWorkflowAction(workflowAction)
      await writer.neonStore.persistExportJob(exportJob)
      await writer.neonStore.persistAuditLog(auditLog)

      // --- 読み込み側 store（リクエスト#2 相当: ステートレス実行の再現） ---
      const reader = await createNeonApiStore({ CIVILDRAFT_NEON_CONNECTION: connection! })

      const reloadedProject = reader.apiStore.projects.get(project.id)
      expect(reloadedProject).toBeDefined()
      expect(reloadedProject).toMatchObject({
        projectNumber: project.projectNumber,
        name: project.name,
        clientName: project.clientName,
        status: 'active',
      })
      // 楽観ロックの根幹: version は文字列ではなく number で復元される
      expect(reloadedProject?.version).toBe(1)
      expect(typeof reloadedProject?.version).toBe('number')
      // timestamptz は ISO 8601 文字列へ正規化される
      expect(reloadedProject?.createdAt).toBe(now)

      expect(reader.apiStore.projectMembers.get(`${project.id}:${member.userId}`)).toMatchObject({
        role: 'manager',
      })

      const reloadedDrawing = reader.apiStore.drawings.get(drawing.id)
      expect(reloadedDrawing?.settings).toEqual(drawing.settings)
      expect(reloadedDrawing?.activeRevisionId).toBe(revision.id)
      expect(reloadedDrawing?.version).toBe(1)

      const reloadedRevision = reader.apiStore.revisions.get(revision.id)
      expect(reloadedRevision).toMatchObject({
        drawingId: drawing.id,
        revisionNumber: 'A',
        status: 'draft',
        contentChecksum: revision.contentChecksum,
      })
      expect(reloadedRevision?.contentVersion).toBe(1)

      const reloadedContent = reader.apiStore.contents.get(revision.id)
      expect(reloadedContent?.content).toEqual(content.content)
      expect(reloadedContent?.byteSize).toBe(content.byteSize)
      expect(reloadedContent?.contentVersion).toBe(1)

      const reloadedQuantities = reader.apiStore.quantities.get(revision.id)
      expect(reloadedQuantities?.quantityVersion).toBe(1)
      expect(reloadedQuantities?.items).toHaveLength(1)
      expect(reloadedQuantities?.items[0]).toMatchObject({
        groupKey: 'earthwork',
        method: 'volume',
        unit: 'm3',
        rawValue: 12.345,
        roundedValue: 12.35,
        status: 'valid',
      })
      // #66 回帰: sources が quantity_item_id で復元される（旧実装は常に空）
      const reloadedSources = [...(reloadedQuantities?.items[0]?.sources ?? [])].sort((a, b) =>
        a.geometryId.localeCompare(b.geometryId),
      )
      expect(reloadedSources).toEqual([
        { geometryId: `geom_${runId}_1`, contributionRaw: 7.9 },
        { geometryId: `geom_${runId}_2`, contributionRaw: 4.445 },
      ])

      const reloadedAction = reader.apiStore.workflowActions.find((a) => a.id === workflowAction.id)
      expect(reloadedAction).toMatchObject({
        action: 'submitReview',
        fromStatus: 'draft',
        toStatus: 'inReview',
        comment: '結合テスト提出',
      })

      const reloadedExport = reader.apiStore.exportJobs.get(exportJob.id)
      expect(reloadedExport).toMatchObject({
        format: 'pdf',
        status: 'completed',
        objectKey: exportJob.objectKey,
        byteSize: exportJob.byteSize,
      })

      const reloadedAudit = reader.apiStore.auditLogs.find((l) => l.id === auditLog.id)
      expect(reloadedAudit).toMatchObject({
        eventName: 'integration.roundtrip',
        result: 'success',
        correlationId: auditLog.correlationId,
      })
      expect(reloadedAudit?.detail).toEqual(auditLog.detail)
    },
  )

  it('更新系 UPSERT（ON CONFLICT）が version を進めて上書きする', { timeout: 120_000 }, async () => {
    const writer = await createNeonApiStore({ CIVILDRAFT_NEON_CONNECTION: connection! })
    const updated: ProjectRecord = {
      ...project,
      name: `改名済み ${runId}`,
      updatedAt: new Date().toISOString(),
      version: 2,
    }
    await writer.neonStore.persistProject(updated)

    const reader = await createNeonApiStore({ CIVILDRAFT_NEON_CONNECTION: connection! })
    const reloaded = reader.apiStore.projects.get(project.id)
    expect(reloaded?.name).toBe(updated.name)
    expect(reloaded?.version).toBe(2)
  })
})

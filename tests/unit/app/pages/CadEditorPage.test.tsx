import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CadEditorPage, type CloudDraftSession, type CloudSaveClient } from '@/app/pages/CadEditorPage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createDefaultLayer, createEditorStore, type EditorStore } from '@/app/store/editorStore'
import { MemoryAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { Geometry, GeometryId } from '@/shared/types'

vi.mock('@/app/canvas/CanvasStage', () => ({
  CanvasStage: () => <div data-testid="canvas-stage">CANVAS</div>,
}))

function line(gid: string): Geometry {
  const layer = createDefaultLayer()
  return {
    id: gid as GeometryId,
    layerId: layer.id,
    type: 'line',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    start: { x: 0, y: 0 },
    end: { x: 1000, y: 0 },
  }
}

function renderPage(
  store: EditorStore,
  cloudApiClient: CloudSaveClient,
  cloudDraftSession?: CloudDraftSession,
) {
  return render(
    <EditorStoreProvider store={store}>
      <CadEditorPage
        autosaveStore={new MemoryAutosaveStore()}
        onNavigate={() => {}}
        cloudApiClient={cloudApiClient}
        cloudDraftSession={cloudDraftSession}
      />
    </EditorStoreProvider>,
  )
}

describe('CadEditorPage cloud save', () => {
  it('図形が無い場合は共有保存を実行せず、画面に理由を表示する', async () => {
    const cloudApiClient: CloudSaveClient = { saveDraft: vi.fn(), getRevisionContent: vi.fn() }
    renderPage(createEditorStore(), cloudApiClient)

    await userEvent.click(screen.getByRole('button', { name: '共有保存' }))

    expect(cloudApiClient.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByText('共有保存できる図形がありません')).toBeInTheDocument()
  })

  it('現在の図面状態をWorkers APIクライアントへ渡し、成功メッセージを表示する', async () => {
    const store = createEditorStore()
    store.getState().addGeometries([line('g-1')])
    const cloudApiClient: CloudSaveClient = {
      saveDraft: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          project: { id: 'project-1', projectNumber: 'P-245-ROAD-WIDENING', name: '国道245号 道路拡幅工事', version: 1 },
          drawing: { id: 'drawing-1', projectId: 'project-1', drawingNumber: 'DWG-014', name: '施工ヤード計画図', version: 1 },
          revision: { id: 'revision-1', drawingId: 'drawing-1', revisionNumber: 'Rev.3', status: 'draft', contentVersion: 1, contentChecksum: 'sha256:test' },
          content: { revisionId: 'revision-1', content: {}, contentVersion: 1, contentChecksum: 'sha256:test' },
          exportJob: { id: 'export-1', revisionId: 'revision-1', format: 'json', status: 'completed' },
        },
      }),
      getRevisionContent: vi.fn(),
    }
    renderPage(store, cloudApiClient)

    await userEvent.click(screen.getByRole('button', { name: '共有保存' }))

    await waitFor(() => expect(cloudApiClient.saveDraft).toHaveBeenCalledTimes(1))
    expect(cloudApiClient.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ projectNumber: 'P-245-ROAD-WIDENING' }),
        drawing: expect.objectContaining({ drawingNumber: 'DWG-014' }),
        revision: expect.objectContaining({ revisionNumber: 'Rev.3' }),
        document: expect.objectContaining({
          geometries: [expect.objectContaining({ id: 'g-1', type: 'line' })],
          layers: expect.arrayContaining([expect.objectContaining({ id: createDefaultLayer().id })]),
        }),
        exportFormat: 'json',
      }),
    )
    expect(await screen.findByText(/共有保存済み: P-245-ROAD-WIDENING \/ DWG-014/)).toBeInTheDocument()
  })

  it('注入された案件・図面コンテキストを共有保存ペイロードとヘッダー表示へ反映する', async () => {
    const store = createEditorStore()
    store.getState().addGeometries([line('g-custom')])
    const session: CloudDraftSession = {
      projectNumber: 'P-RIVER-001',
      projectName: '大和川 河川護岸補修工事',
      clientName: '○○県土木部',
      drawingNumber: 'DWG-011',
      drawingName: '仮設計画図（矢板・切梁）',
      drawingType: 'temporary-plan',
      revisionNumber: 'Rev.2',
      changeSummary: 'DWG-011 Rev.2 をCAD編集画面から共有保存',
    }
    const cloudApiClient: CloudSaveClient = {
      saveDraft: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          project: { id: 'project-2', projectNumber: 'P-RIVER-001', name: '大和川 河川護岸補修工事', version: 1 },
          drawing: { id: 'drawing-2', projectId: 'project-2', drawingNumber: 'DWG-011', name: '仮設計画図（矢板・切梁）', version: 1 },
          revision: { id: 'revision-2', drawingId: 'drawing-2', revisionNumber: 'Rev.2', status: 'draft', contentVersion: 1, contentChecksum: 'sha256:test' },
          content: { revisionId: 'revision-2', content: {}, contentVersion: 1, contentChecksum: 'sha256:test' },
        },
      }),
      getRevisionContent: vi.fn(),
    }
    renderPage(store, cloudApiClient, session)

    expect(screen.getByText('大和川 河川護岸補修工事')).toBeInTheDocument()
    expect(screen.getByText('仮設計画図（矢板・切梁）')).toBeInTheDocument()
    expect(screen.getByText('Rev.2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '共有保存' }))

    await waitFor(() => expect(cloudApiClient.saveDraft).toHaveBeenCalledTimes(1))
    expect(cloudApiClient.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        project: { projectNumber: 'P-RIVER-001', name: '大和川 河川護岸補修工事', clientName: '○○県土木部' },
        drawing: expect.objectContaining({
          drawingNumber: 'DWG-011',
          name: '仮設計画図（矢板・切梁）',
          drawingType: 'temporary-plan',
        }),
        revision: { revisionNumber: 'Rev.2', changeSummary: 'DWG-011 Rev.2 をCAD編集画面から共有保存' },
      }),
    )
    expect(await screen.findByText(/共有保存済み: P-RIVER-001 \/ DWG-011/)).toBeInTheDocument()
  })

  it('APIクライアントの業務エラーを画面に表示する', async () => {
    const store = createEditorStore()
    store.getState().addGeometries([line('g-1')])
    const cloudApiClient: CloudSaveClient = {
      saveDraft: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'CLOUD_API_HTTP', severity: 'error', message: 'Neon/R2 binding missing' },
      }),
      getRevisionContent: vi.fn(),
    }
    renderPage(store, cloudApiClient)

    await userEvent.click(screen.getByRole('button', { name: '共有保存' }))

    expect(await screen.findByText(/共有保存失敗: Neon\/R2 binding missing/)).toBeInTheDocument()
  })

  it('共有保存後に再読込すると、クラウド上の図面内容でStoreを置換する', async () => {
    const store = createEditorStore()
    store.getState().addGeometries([line('local-before')])
    const remote = line('remote-after')
    const cloudApiClient: CloudSaveClient = {
      saveDraft: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          project: { id: 'project-1', projectNumber: 'P-245-ROAD-WIDENING', name: '国道245号 道路拡幅工事', version: 1 },
          drawing: { id: 'drawing-1', projectId: 'project-1', drawingNumber: 'DWG-014', name: '施工ヤード計画図', version: 1 },
          revision: { id: 'revision-1', drawingId: 'drawing-1', revisionNumber: 'Rev.3', status: 'draft', contentVersion: 1, contentChecksum: 'sha256:test' },
          content: { revisionId: 'revision-1', content: {}, contentVersion: 1, contentChecksum: 'sha256:test' },
        },
      }),
      getRevisionContent: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          revisionId: 'revision-1',
          content: { geometries: [remote], layers: [createDefaultLayer()] },
          contentVersion: 2,
          contentChecksum: 'sha256:remote',
        },
      }),
    }
    renderPage(store, cloudApiClient)

    await userEvent.click(screen.getByRole('button', { name: '共有保存' }))
    await screen.findByText(/共有保存済み/)
    await userEvent.click(screen.getByRole('button', { name: '共有再読込' }))

    await screen.findByText(/共有再読込済み: 2版 \/ 図形1件/)
    expect(cloudApiClient.getRevisionContent).toHaveBeenCalledWith('revision-1')
    expect(store.getState().geometries.map((g) => g.id)).toEqual(['remote-after'])
    expect(store.getIndex().size).toBe(1)
    expect(store.getState().undoStack).toHaveLength(0)
  })

  it('共有再読込の内容形式が不正ならStoreを置換せず警告する', async () => {
    const store = createEditorStore()
    store.getState().addGeometries([line('local-before')])
    const cloudApiClient: CloudSaveClient = {
      saveDraft: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          project: { id: 'project-1', projectNumber: 'P-245-ROAD-WIDENING', name: '国道245号 道路拡幅工事', version: 1 },
          drawing: { id: 'drawing-1', projectId: 'project-1', drawingNumber: 'DWG-014', name: '施工ヤード計画図', version: 1 },
          revision: { id: 'revision-1', drawingId: 'drawing-1', revisionNumber: 'Rev.3', status: 'draft', contentVersion: 1, contentChecksum: 'sha256:test' },
          content: { revisionId: 'revision-1', content: {}, contentVersion: 1, contentChecksum: 'sha256:test' },
        },
      }),
      getRevisionContent: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          revisionId: 'revision-1',
          content: { unexpected: true },
          contentVersion: 2,
          contentChecksum: 'sha256:bad',
        },
      }),
    }
    renderPage(store, cloudApiClient)

    await userEvent.click(screen.getByRole('button', { name: '共有保存' }))
    await screen.findByText(/共有保存済み/)
    await userEvent.click(screen.getByRole('button', { name: '共有再読込' }))

    expect(await screen.findByText(/共有再読込失敗: 図面内容の形式が不正です/)).toBeInTheDocument()
    expect(store.getState().geometries.map((g) => g.id)).toEqual(['local-before'])
  })
})

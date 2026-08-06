/**
 * Issue #118 の回帰テスト: ヘッダーの「📥 取込」から DXF を選択すると
 * 図面が置き換わり、1 回の Ctrl+Z で取込前へ戻れることを検証する。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CadEditorPage, type CloudSaveClient } from '@/app/pages/CadEditorPage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createDefaultLayer, createEditorStore } from '@/app/store/editorStore'
import { MemoryAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { createAddGeometryCommand } from '@/domain/commands/geometryCommands'
import { defaultCreationContext } from '@/domain/geometry/geometryFactory'
import type { Geometry } from '@/shared/types'

const { stageMock, layerMock } = vi.hoisted(() => ({
  stageMock: vi.fn(({ children }: { children: ReactNode }) => <div data-testid="stage">{children}</div>),
  layerMock: vi.fn(({ children }: { children: ReactNode }) => <div data-testid="layer">{children}</div>),
}))

vi.mock('react-konva', () => ({
  Stage: stageMock,
  Layer: layerMock,
  Line: vi.fn(() => null),
  Rect: vi.fn(() => null),
  Circle: vi.fn(() => null),
  Arc: vi.fn(() => null),
  Text: vi.fn(() => null),
  Arrow: vi.fn(() => null),
  Ellipse: vi.fn(() => null),
  Group: vi.fn(({ children }: { children: ReactNode }) => <>{children}</>),
}))

const LINE_DXF =
  '0\nSECTION\n2\nENTITIES\n' +
  '0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n100.0\n21\n50.0\n' +
  '0\nENDSEC\n0\nEOF\n'

function line(gid: string): Geometry {
  const layer = createDefaultLayer()
  return {
    id: gid as Geometry['id'],
    layerId: layer.id,
    type: 'line',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    start: { x: 0, y: 0 },
    end: { x: 1000, y: 0 },
  }
}

function renderPage(store: ReturnType<typeof createEditorStore>) {
  const cloudApiClient: CloudSaveClient = { saveDraft: vi.fn(), getRevisionContent: vi.fn() }
  const view = render(
    <EditorStoreProvider store={store}>
      <CadEditorPage
        autosaveStore={new MemoryAutosaveStore()}
        onNavigate={() => {}}
        cloudApiClient={cloudApiClient}
      />
    </EditorStoreProvider>,
  )
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement | null
  if (input === null) throw new Error('DXF取込用の file input が見つかりません')
  return { ...view, input }
}

describe('CadEditorPage DXF取込（Issue #118）', () => {
  it('DXFファイル選択で図面が置き換わり、Ctrl+Z 1回で取込前へ戻る', async () => {
    const store = createEditorStore()
    store.getState().dispatchCommand(createAddGeometryCommand(line('g-1'), defaultCreationContext))
    const { input, getByText } = renderPage(store)
    expect(store.getState().geometries).toHaveLength(1)

    const file = new File([LINE_DXF], 'sample.dxf', { type: 'application/dxf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(store.getState().geometries).toHaveLength(1)
      const geom = store.getState().geometries[0]
      expect(geom?.type).toBe('line')
      expect(geom?.id).not.toBe('g-1')
    })
    expect(getByText(/DXF取込完了: 図形 1 件/)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, code: 'KeyZ' })
    expect(store.getState().geometries).toHaveLength(1)
    expect(store.getState().geometries[0]?.id).toBe('g-1')
  })

  it('空のDXFはエラーメッセージを表示し、既存図面を変更しない', async () => {
    const store = createEditorStore()
    store.getState().dispatchCommand(createAddGeometryCommand(line('g-1'), defaultCreationContext))
    const { input, getByText } = renderPage(store)

    const file = new File(['   '], 'empty.dxf', { type: 'application/dxf' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(getByText(/DXF取込に失敗/)).toBeInTheDocument()
    })
    expect(store.getState().geometries).toHaveLength(1)
    expect(store.getState().geometries[0]?.id).toBe('g-1')
  })

  it('未対応形式（DWG等）は移行アシスタントの案内を表示し、図面を変更しない（Issue #60）', async () => {
    const store = createEditorStore()
    store.getState().dispatchCommand(createAddGeometryCommand(line('g-1'), defaultCreationContext))
    const { input, getByText } = renderPage(store)

    const file = new File(['dummy'], 'sample.dwg', { type: 'application/octet-stream' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(getByText(/DWG は Autodesk 非公開形式のため直接取込できません/)).toBeInTheDocument()
    })
    expect(store.getState().geometries).toHaveLength(1)
    expect(store.getState().geometries[0]?.id).toBe('g-1')
  })
})

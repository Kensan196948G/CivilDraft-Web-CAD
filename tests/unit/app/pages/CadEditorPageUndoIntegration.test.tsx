/**
 * Issue #117 の回帰テスト。
 * CadEditorPage（ページ側）と CanvasStage（キャンバス側）の両方が window に
 * keydown リスナーを登録し、Ctrl+Z/Y が二重発火していた問題を検出する。
 * ページ・キャンバスを実物のまま統合描画し、1 キー押下 = 1 Undo を検証する。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
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

describe('CadEditorPage + CanvasStage キーボードショートカット統合（Issue #117）', () => {
  it('Ctrl+Z は 1 回の押下で 1 ステップだけ Undo し、Ctrl+Y / Ctrl+Shift+Z で Redo する', () => {
    const store = createEditorStore()
    const cloudApiClient: CloudSaveClient = { saveDraft: vi.fn(), getRevisionContent: vi.fn() }
    render(
      <EditorStoreProvider store={store}>
        <CadEditorPage
          autosaveStore={new MemoryAutosaveStore()}
          onNavigate={() => {}}
          cloudApiClient={cloudApiClient}
        />
      </EditorStoreProvider>,
    )

    store.getState().dispatchCommand(createAddGeometryCommand(line('g-1'), defaultCreationContext))
    store.getState().dispatchCommand(createAddGeometryCommand(line('g-2'), defaultCreationContext))
    expect(store.getState().geometries).toHaveLength(2)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, code: 'KeyZ' })
    expect(store.getState().geometries).toHaveLength(1)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, code: 'KeyZ' })
    expect(store.getState().geometries).toHaveLength(0)

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true, code: 'KeyY' })
    expect(store.getState().geometries).toHaveLength(1)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true, code: 'KeyZ' })
    expect(store.getState().geometries).toHaveLength(2)
  })
})

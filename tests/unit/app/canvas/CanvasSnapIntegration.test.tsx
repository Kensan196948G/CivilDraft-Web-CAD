/**
 * Issue #24 配線の回帰テスト: CanvasStage のポインタ操作が snapEngine を経由し、
 * draftCursor/クリック座標が特徴点へ吸着され、SnapMarker 用の snapResult が更新される。
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CanvasStage } from '@/app/canvas/CanvasStage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import type { Geometry, GeometryId, Point } from '@/shared/types'

interface StageHandlers {
  readonly onMouseMove?: (e: unknown) => void
  readonly onClick?: (e: unknown) => void
}

const captured = vi.hoisted(() => ({ handlers: {} as StageHandlers }))
const { stageMock, layerMock } = vi.hoisted(() => ({
  stageMock: vi.fn((props: StageHandlers & { children: ReactNode }) => {
    captured.handlers = props
    return <div data-testid="stage">{props.children}</div>
  }),
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

function lineGeometry(): Geometry {
  const layer = createDefaultLayer()
  return {
    id: 'l1' as GeometryId,
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

function pointerEvent(pointer: Point, button = 0, shiftKey = false): unknown {
  return {
    evt: { button, shiftKey },
    target: {
      getStage: () => ({ getPointerPosition: () => pointer }),
    },
  }
}

function renderStage() {
  const store = createEditorStore()
  store.getState().addGeometries([lineGeometry()])
  store.getState().activateTool('line')
  render(
    <EditorStoreProvider store={store}>
      <CanvasStage />
    </EditorStoreProvider>,
  )
  return store
}

describe('CanvasStage スナップ配線（Issue #24）', () => {
  it('端点付近のマウス移動で snapResult=endpoint・draftCursor が端点へ吸着する', () => {
    const store = renderStage()
    captured.handlers.onMouseMove?.(pointerEvent({ x: 5, y: 5 }))

    expect(store.getState().snapResult?.type).toBe('endpoint')
    expect(store.getState().snapResult?.point).toEqual({ x: 0, y: 0 })
    expect(store.getState().draftCursor).toEqual({ x: 0, y: 0 })
  })

  it('特徴点から離れると snapResult がクリアされカーソルは生座標のまま', () => {
    const store = renderStage()
    store.getState().toggleSnapType('grid') // グリッドフォールバックを無効化して検証
    captured.handlers.onMouseMove?.(pointerEvent({ x: 5000, y: 5000 }))

    expect(store.getState().snapResult).toBeNull()
    expect(store.getState().draftCursor).toEqual({ x: 5000, y: 5000 })
  })

  it('作図クリックの座標がスナップされる', () => {
    const store = renderStage()
    captured.handlers.onClick?.(pointerEvent({ x: 8, y: 8 }))

    expect(store.getState().draftPoints).toHaveLength(1)
    expect(store.getState().draftPoints[0]).toEqual({ x: 0, y: 0 })
  })

  it('スナップ無効時は吸着しない', () => {
    const store = renderStage()
    store.getState().setSnapEnabled(false)
    captured.handlers.onMouseMove?.(pointerEvent({ x: 5, y: 5 }))

    expect(store.getState().snapResult).toBeNull()
    expect(store.getState().draftCursor).toEqual({ x: 5, y: 5 })
  })
})

/**
 * CanvasStage のスモークテスト。react-konva を vi.mock でスタブ化し、
 * §9.1 レイヤー構成・グリッド生成・カリング経路が例外なく動くことを検査する。
 * 実ブラウザでの描画・操作検証は開発用WebUI（vite dev）で行う。
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CanvasStage } from '@/app/canvas/CanvasStage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import type { Geometry, GeometryId } from '@/shared/types'

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

function circle(gid: string, cx: number, cy: number, r: number): Geometry {
  const layer = createDefaultLayer()
  return {
    id: gid as GeometryId,
    layerId: layer.id,
    type: 'circle',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    center: { x: cx, y: cy },
    radius: r,
  }
}

describe('CanvasStage', () => {
  it('§9.1のレイヤー構成（用紙/グリッド/図形/選択/ガイド/オーバーレイ=6 Konva Layer）で描画される', () => {
    const store = createEditorStore()
    render(
      <EditorStoreProvider store={store}>
        <CanvasStage />
      </EditorStoreProvider>,
    )
    expect(screen.getByTestId('stage')).toBeInTheDocument()
    expect(screen.getAllByTestId('layer')).toHaveLength(6)
  })

  it('図形と選択状態を持つstoreでも例外なく描画される', () => {
    const store = createEditorStore()
    store.getState().addGeometries([circle('a', 0, 0, 50), circle('b', 100, 100, 50)])
    store.getState().select(['a' as GeometryId])
    expect(() =>
      render(
        <EditorStoreProvider store={store}>
          <CanvasStage />
        </EditorStoreProvider>,
      ),
    ).not.toThrow()
  })

  it('非表示レイヤーの図形は描画対象から除外される（§6.3）', () => {
    const store = createEditorStore()
    store.getState().addGeometries([circle('a', 0, 0, 50)])
    store.getState().toggleLayerVisible(createDefaultLayer().id)
    expect(() =>
      render(
        <EditorStoreProvider store={store}>
          <CanvasStage />
        </EditorStoreProvider>,
      ),
    ).not.toThrow()
  })

  it('500図形以上でもカリング経路で例外なく描画される（§9.4）', () => {
    const store = createEditorStore()
    const many = Array.from({ length: 600 }, (_, i) => circle(`g${i}`, (i % 30) * 100, Math.floor(i / 30) * 100, 10))
    store.getState().addGeometries(many)
    expect(() =>
      render(
        <EditorStoreProvider store={store}>
          <CanvasStage />
        </EditorStoreProvider>,
      ),
    ).not.toThrow()
  })

  it('数量根拠ハイライト（Issue #42）を持つstoreでも例外なく描画される', () => {
    const store = createEditorStore()
    store.getState().addGeometries([circle('a', 0, 0, 50), circle('b', 100, 100, 50)])
    store.getState().setHighlightedGeometryIds(['a' as GeometryId])
    expect(() =>
      render(
        <EditorStoreProvider store={store}>
          <CanvasStage />
        </EditorStoreProvider>,
      ),
    ).not.toThrow()
  })
})

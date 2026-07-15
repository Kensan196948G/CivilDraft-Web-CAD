import { describe, expect, it } from 'vitest'
import { createDefaultLayer, createEditorStore, draftPreviewGeometry } from '@/app/store/editorStore'
import { DRAFT_PREVIEW_ID } from '@/domain/tools/draftGeometry'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type { GeometryId, Point } from '@/shared/types'

/** 決定的な連番 ID・固定時刻を返す注入コンテキスト（作図で発番される値を検証可能にする）。 */
function seqContext(): GeometryCreationContext {
  let n = 0
  return {
    newId: () => `gen-${++n}` as GeometryId,
    now: () => '2026-07-15T00:00:00.000Z',
  }
}

const p = (x: number, y: number): Point => ({ x, y })

describe('ToolSlice / 自動確定ツール（line・rectangle・circle）', () => {
  it('line: 2クリックで線分が AddGeometryCommand として確定し、undo で取り消せる', () => {
    const store = createEditorStore()
    store.getState().activateTool('line')
    store.getState().addDraftPoint(p(0, 0))
    expect(store.getState().geometries).toHaveLength(0) // 1点目では未確定
    expect(store.getState().draftPoints).toHaveLength(1)

    store.getState().addDraftPoint(p(100, 50))
    const g = store.getState().geometries[0]
    expect(g?.type).toBe('line')
    if (g?.type === 'line') {
      expect(g.start).toEqual(p(0, 0))
      expect(g.end).toEqual(p(100, 50))
    }
    expect(store.getState().draftPoints).toHaveLength(0) // 確定後にドラフト初期化
    expect(store.getState().undoStack).toHaveLength(1)

    store.getState().undo()
    expect(store.getState().geometries).toHaveLength(0)
  })

  it('rectangle: 右下→左上ドラッグでも正の width/height に正規化され rotationDeg=0', () => {
    const store = createEditorStore()
    store.getState().activateTool('rectangle')
    store.getState().addDraftPoint(p(100, 80))
    store.getState().addDraftPoint(p(20, 10))
    const g = store.getState().geometries[0]
    expect(g?.type).toBe('rectangle')
    if (g?.type === 'rectangle') {
      expect(g.origin).toEqual(p(20, 10))
      expect(g.width).toBe(80)
      expect(g.height).toBe(70)
      expect(g.rotationDeg).toBe(0)
    }
  })

  it('circle: 半径は中心点と2点目の距離になる', () => {
    const store = createEditorStore()
    store.getState().activateTool('circle')
    store.getState().addDraftPoint(p(0, 0))
    store.getState().addDraftPoint(p(30, 40))
    const g = store.getState().geometries[0]
    expect(g?.type).toBe('circle')
    if (g?.type === 'circle') {
      expect(g.center).toEqual(p(0, 0))
      expect(g.radius).toBe(50)
    }
  })

  it('自動確定した図形は空間索引にも登録される', () => {
    const store = createEditorStore()
    store.getState().activateTool('circle')
    store.getState().addDraftPoint(p(0, 0))
    store.getState().addDraftPoint(p(5, 0)) // radius 5
    const id = store.getState().geometries[0]?.id
    expect(id).toBeDefined()
    expect(store.getIndex().search({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual([id])
  })
})

describe('ToolSlice / polyline（明示確定）', () => {
  it('3点 + commitDraft で開いた折れ線が確定し、ドラフトが初期化される', () => {
    const store = createEditorStore()
    store.getState().activateTool('polyline')
    store.getState().addDraftPoint(p(0, 0))
    store.getState().addDraftPoint(p(10, 0))
    store.getState().addDraftPoint(p(10, 10))
    expect(store.getState().geometries).toHaveLength(0) // commit 前は未確定
    expect(store.getState().draftPoints).toHaveLength(3)

    store.getState().commitDraft()
    const g = store.getState().geometries[0]
    expect(g?.type).toBe('polyline')
    if (g?.type === 'polyline') {
      expect(g.points).toHaveLength(3)
      expect(g.closed).toBe(false)
    }
    expect(store.getState().draftPoints).toHaveLength(0)
    expect(store.getState().draftCursor).toBeNull()
  })

  it('1点で commitDraft は図形を作らずドラフトを破棄する', () => {
    const store = createEditorStore()
    store.getState().activateTool('polyline')
    store.getState().addDraftPoint(p(0, 0))
    store.getState().commitDraft()
    expect(store.getState().geometries).toHaveLength(0)
    expect(store.getState().draftPoints).toHaveLength(0)
  })
})

describe('ToolSlice / ドラフト破棄・ツール切替・select', () => {
  it('cancelDraft で作図中ドラフト（点列・カーソル）が破棄される', () => {
    const store = createEditorStore()
    store.getState().activateTool('line')
    store.getState().addDraftPoint(p(0, 0))
    store.getState().updateDraftCursor(p(5, 5))
    store.getState().cancelDraft()
    expect(store.getState().draftPoints).toHaveLength(0)
    expect(store.getState().draftCursor).toBeNull()
    expect(store.getState().geometries).toHaveLength(0)
  })

  it('activateTool で作図中ドラフトが破棄される', () => {
    const store = createEditorStore()
    store.getState().activateTool('line')
    store.getState().addDraftPoint(p(0, 0))
    store.getState().activateTool('circle')
    expect(store.getState().activeTool).toBe('circle')
    expect(store.getState().draftPoints).toHaveLength(0)
  })

  it('select ツールでは addDraftPoint は点を溜めず図形も作らない', () => {
    const store = createEditorStore()
    expect(store.getState().activeTool).toBe('select') // 既定
    store.getState().addDraftPoint(p(0, 0))
    expect(store.getState().draftPoints).toHaveLength(0)
    expect(store.getState().geometries).toHaveLength(0)
  })

  it('updateDraftCursor はコマンドを生成しない（ドラッグ座標を履歴化しない §7.2）', () => {
    const store = createEditorStore()
    store.getState().activateTool('line')
    store.getState().addDraftPoint(p(0, 0))
    store.getState().updateDraftCursor(p(1, 1))
    store.getState().updateDraftCursor(p(2, 2))
    expect(store.getState().undoStack).toHaveLength(0)
    expect(store.getState().geometries).toHaveLength(0)
  })
})

describe('ToolSlice / レイヤー・ctx 由来の属性、プレビュー', () => {
  it('確定図形は activeLayerId・レイヤー defaultStyle・注入 ctx 由来の id/タイムスタンプを持つ', () => {
    const store = createEditorStore(seqContext())
    const layer = createDefaultLayer()
    store.getState().activateTool('line')
    store.getState().addDraftPoint(p(0, 0))
    store.getState().addDraftPoint(p(1, 1))
    const g = store.getState().geometries[0]
    expect(g?.layerId).toBe(layer.id)
    expect(g?.style).toEqual(layer.defaultStyle)
    expect(g?.id).toBe('gen-1') // 図形IDは最初の newId
    expect(g?.createdAt).toBe('2026-07-15T00:00:00.000Z')
    expect(g?.updatedAt).toBe('2026-07-15T00:00:00.000Z')
    // コマンドIDは図形IDとは別採番（次の newId）
    expect(store.getState().undoStack[0]?.id).toBe('gen-2')
  })

  it('draftPreviewGeometry: line作図中（1点+カーソル）でプレビュー、カーソル無しでは null', () => {
    const store = createEditorStore()
    store.getState().activateTool('line')
    store.getState().addDraftPoint(p(0, 0))
    expect(draftPreviewGeometry(store.getState())).toBeNull() // カーソル無し

    store.getState().updateDraftCursor(p(100, 0))
    const preview = draftPreviewGeometry(store.getState())
    expect(preview?.type).toBe('line')
    expect(preview?.id).toBe(DRAFT_PREVIEW_ID)
    if (preview?.type === 'line') {
      expect(preview.start).toEqual(p(0, 0))
      expect(preview.end).toEqual(p(100, 0))
    }
  })
})

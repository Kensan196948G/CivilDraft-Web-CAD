import { describe, expect, it } from 'vitest'
import { createEditorStore, MAX_ZOOM, MIN_ZOOM } from '@/app/store/editorStore'
import { LAYER_TEMPLATES } from '@/domain/catalog/layerTemplates'
import {
  createAddGeometryCommand,
  createDeleteGeometriesCommand,
  createUpdateGeometryCommand,
} from '@/domain/commands/geometryCommands'
import { checkDrawingHealth } from '@/domain/validation/drawingHealth'
import type {
  DrawingLayer,
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
} from '@/shared/types'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base: Omit<GeometryBase, 'id' | 'type'> = {
  layerId: 'layer-default' as LayerId,
  style,
  constructionStepIds: [],
  locked: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

function id(v: string): GeometryId {
  return v as GeometryId
}

function circle(gid: string, cx: number, cy: number, r: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center: { x: cx, y: cy }, radius: r }
}

function layer(lid: string, name: string): DrawingLayer {
  return {
    id: lid as LayerId,
    name,
    order: 0,
    visible: true,
    locked: false,
    printable: true,
    defaultStyle: style,
  }
}

describe('EditorStore / DocumentSlice と空間索引の同期', () => {
  it('addGeometriesで図形と索引が同時に更新される', () => {
    const store = createEditorStore()
    store.getState().addGeometries([circle('a', 0, 0, 5)])
    expect(store.getState().geometries).toHaveLength(1)
    expect(store.getIndex().search({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual(['a'])
  })

  it('updateGeometryで座標変更が状態と索引の両方に反映される', () => {
    const store = createEditorStore()
    store.getState().addGeometries([circle('a', 0, 0, 5)])
    store.getState().updateGeometry(circle('a', 500, 500, 5))
    const g = store.getState().geometries[0]
    expect(g?.type === 'circle' && g.center.x).toBe(500)
    expect(store.getIndex().search({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual([])
    expect(store.getIndex().search({ minX: 490, minY: 490, maxX: 510, maxY: 510 })).toEqual(['a'])
  })

  it('removeGeometriesで図形・索引・選択・ホバーから除去される', () => {
    const store = createEditorStore()
    store.getState().addGeometries([circle('a', 0, 0, 5), circle('b', 100, 100, 5)])
    store.getState().select([id('a'), id('b')])
    store.getState().setHovered(id('a'))
    store.getState().removeGeometries([id('a')])
    expect(store.getState().geometries.map((g) => g.id)).toEqual(['b'])
    expect(store.getState().selectedIds).toEqual(['b'])
    expect(store.getState().hoveredId).toBeNull()
    expect(store.getIndex().size).toBe(1)
  })

  it('replaceDocumentで図形・レイヤー・索引が置き換わり選択がクリアされる', () => {
    const store = createEditorStore()
    store.getState().addGeometries([circle('old', 0, 0, 5)])
    store.getState().select([id('old')])
    store.getState().replaceDocument([circle('new', 10, 10, 5)], [layer('L1', '外形線')])
    expect(store.getState().geometries.map((g) => g.id)).toEqual(['new'])
    expect(store.getState().layers.map((l) => l.name)).toEqual(['外形線'])
    expect(store.getState().activeLayerId).toBe('L1')
    expect(store.getState().selectedIds).toEqual([])
    expect(store.getIndex().size).toBe(1)
  })

  it('replaceDocumentで空レイヤー配列を渡すと既定レイヤーへフォールバックする', () => {
    const store = createEditorStore()
    store.getState().replaceDocument([], [])
    expect(store.getState().layers).toHaveLength(1)
    expect(store.getState().activeLayerId).toBe('layer-default')
  })
})

describe('EditorStore / ViewportSlice', () => {
  it('setZoomは0.001〜50へクランプされる（継承元canvasStoreの範囲踏襲）', () => {
    const store = createEditorStore()
    store.getState().setZoom(1000)
    expect(store.getState().zoom).toBe(MAX_ZOOM)
    store.getState().setZoom(0)
    expect(store.getState().zoom).toBe(MIN_ZOOM)
  })

  it('zoomAtはアンカー直下のdomain点を固定したままズームする', () => {
    const store = createEditorStore()
    store.getState().setPan(100, 60)
    store.getState().setZoom(2)
    const anchor = { x: 300, y: 260 }
    // domain点 = (300-100)/2, (260-60)/2 = (100, 100)
    store.getState().zoomAt(anchor, 2)
    const { zoom, panX, panY } = store.getState()
    expect(zoom).toBe(4)
    // 同じdomain点(100,100)がanchor位置に留まる: screen = 100*4 + pan
    expect(100 * zoom + panX).toBeCloseTo(anchor.x)
    expect(100 * zoom + panY).toBeCloseTo(anchor.y)
  })

  it('zoomFitで全図形のBBoxがビューポートに収まる', () => {
    const store = createEditorStore()
    store.getState().addGeometries([circle('a', 0, 0, 50), circle('b', 1000, 500, 50)])
    store.getState().zoomFit(800, 600)
    const { zoom, panX, panY } = store.getState()
    // bbox: (-50,-50)〜(1050,550) → 1100x600。zoom = min(800/1100, 600/600)*0.9
    expect(zoom).toBeCloseTo(Math.min(800 / 1100, 600 / 600) * 0.9)
    // bbox中心(500,250)がビューポート中心(400,300)へ写る
    expect(500 * zoom + panX).toBeCloseTo(400)
    expect(250 * zoom + panY).toBeCloseTo(300)
  })

  it('zoomFitは図形なし（BBox不能）のとき初期ビューへ戻す', () => {
    const store = createEditorStore()
    store.getState().setPan(500, 500)
    store.getState().setZoom(10)
    store.getState().zoomFit(800, 600)
    expect(store.getState().zoom).toBe(1)
    expect(store.getState().panX).toBe(0)
    expect(store.getState().panY).toBe(0)
  })
})

describe('EditorStore / LayerSlice・SelectionSlice', () => {
  it('既定レイヤー「レイヤー0」で初期化される', () => {
    const store = createEditorStore()
    expect(store.getState().layers).toHaveLength(1)
    expect(store.getState().layers[0]?.name).toBe('レイヤー0')
    expect(store.getState().activeLayerId).toBe('layer-default')
  })

  it('setActiveLayerは存在しないレイヤーIDを無視する', () => {
    const store = createEditorStore()
    store.getState().setActiveLayer('missing' as LayerId)
    expect(store.getState().activeLayerId).toBe('layer-default')
  })

  it('toggleLayerVisible/Lockが該当レイヤーのみ反転する', () => {
    const store = createEditorStore()
    store.getState().replaceDocument([], [layer('L1', 'a'), layer('L2', 'b')])
    store.getState().toggleLayerVisible('L1' as LayerId)
    store.getState().toggleLayerLock('L2' as LayerId)
    const [l1, l2] = store.getState().layers
    expect(l1?.visible).toBe(false)
    expect(l1?.locked).toBe(false)
    expect(l2?.visible).toBe(true)
    expect(l2?.locked).toBe(true)
  })

  it('addLayer: 新規レイヤーを作成し、orderは既存最大+1、visible/locked/printableはデフォルト', () => {
    const store = createEditorStore()
    const initialCount = store.getState().layers.length
    const newId = store.getState().addLayer('テストレイヤー')
    const layers = store.getState().layers
    expect(layers).toHaveLength(initialCount + 1)
    const added = layers.find((l) => l.id === newId)
    expect(added?.name).toBe('テストレイヤー')
    expect(added?.visible).toBe(true)
    expect(added?.locked).toBe(false)
    expect(added?.printable).toBe(true)
  })

  it('removeLayer: レイヤーを削除し、属する図形は残存レイヤーへ再割当て', () => {
    const store = createEditorStore()
    const l1Id = store.getState().addLayer('削除対象')
    store.getState().setActiveLayer(l1Id)
    store.getState().activateTool('line')
    store.getState().addDraftPoint({ x: 0, y: 0 })
    store.getState().addDraftPoint({ x: 10, y: 10 })
    expect(store.getState().geometries).toHaveLength(1)
    expect(store.getState().geometries[0]?.layerId).toBe(l1Id)

    store.getState().removeLayer(l1Id)
    const layers = store.getState().layers
    expect(layers.find((l) => l.id === l1Id)).toBeUndefined()
    // 図形は先頭レイヤーへ再割当て
    expect(store.getState().geometries[0]?.layerId).toBe(layers[0]?.id)
    expect(store.getState().activeLayerId).toBe(layers[0]?.id)
  })

  it('removeLayer: 唯一のレイヤーは削除できない', () => {
    const store = createEditorStore()
    expect(store.getState().layers).toHaveLength(1)
    store.getState().removeLayer('layer-default' as LayerId)
    expect(store.getState().layers).toHaveLength(1)
  })

  it('updateLayerName: 指定レイヤーの名前を変更', () => {
    const store = createEditorStore()
    store.getState().updateLayerName('layer-default' as LayerId, '新名称')
    expect(store.getState().layers[0]?.name).toBe('新名称')
  })

  it('updateLayerLineWidth: 指定レイヤーのデフォルト線幅を変更', () => {
    const store = createEditorStore()
    store.getState().updateLayerLineWidth('layer-default' as LayerId, 3)
    expect(store.getState().layers[0]?.defaultStyle.strokeWidth).toBe(3)
  })

  it('toggleLayerPrintable: 印刷可否を切り替え', () => {
    const store = createEditorStore()
    expect(store.getState().layers[0]?.printable).toBe(true)
    store.getState().toggleLayerPrintable('layer-default' as LayerId)
    expect(store.getState().layers[0]?.printable).toBe(false)
    store.getState().toggleLayerPrintable('layer-default' as LayerId)
    expect(store.getState().layers[0]?.printable).toBe(true)
  })

  it('reorderLayer: up/down で order が入れ替わる', () => {
    const store = createEditorStore()
    store.getState().addLayer('B')
    store.getState().addLayer('C')
    // default(0), B(1), C(2)
    const layers = [...store.getState().layers].sort((a, b) => a.order - b.order)
    const bId = layers[1]?.id
    expect(bId).toBeDefined()

    store.getState().reorderLayer(bId!, 'down')
    const afterDown = [...store.getState().layers].sort((a, b) => a.order - b.order)
    // default(0), C(1), B(2) — B moved down
    expect(afterDown[2]?.id).toBe(bId)

    store.getState().reorderLayer(bId!, 'up')
    const afterUp = [...store.getState().layers].sort((a, b) => a.order - b.order)
    expect(afterUp[1]?.id).toBe(bId)
  })

  it('reorderLayer: 先頭の up や末尾の down は移動しない', () => {
    const store = createEditorStore()
    const layers = [...store.getState().layers].sort((a, b) => a.order - b.order)
    const firstId = layers[0]?.id
    const lastId = layers[layers.length - 1]?.id
    expect(firstId).toBeDefined()
    expect(lastId).toBeDefined()

    store.getState().reorderLayer(firstId!, 'up')
    const afterUp = [...store.getState().layers].sort((a, b) => a.order - b.order)
    expect(afterUp[0]?.id).toBe(firstId)

    store.getState().reorderLayer(lastId!, 'down')
    const afterDown = [...store.getState().layers].sort((a, b) => a.order - b.order)
    expect(afterDown[afterDown.length - 1]?.id).toBe(lastId)
  })

  it('toggleSelectで選択のオンオフが切り替わる', () => {
    const store = createEditorStore()
    store.getState().toggleSelect(id('a'))
    expect(store.getState().selectedIds).toEqual(['a'])
    store.getState().toggleSelect(id('a'))
    expect(store.getState().selectedIds).toEqual([])
  })
})

describe('EditorStore / 複数インスタンス独立性（Issue #7）', () => {
  it('2つのstore間で図形・索引・ビューポートが混線しない', () => {
    const s1 = createEditorStore()
    const s2 = createEditorStore()
    s1.getState().addGeometries([circle('a', 0, 0, 5)])
    s2.getState().setZoom(10)
    expect(s1.getState().geometries).toHaveLength(1)
    expect(s2.getState().geometries).toHaveLength(0)
    expect(s1.getIndex().size).toBe(1)
    expect(s2.getIndex().size).toBe(0)
    expect(s1.getState().zoom).toBe(1)
    expect(s2.getState().zoom).toBe(10)
  })
})

describe('EditorStore / 数量根拠ハイライト（Issue #42）', () => {
  it('highlightedGeometryIds を設定・クリアできる', () => {
    const store = createEditorStore()
    expect(store.getState().highlightedGeometryIds).toEqual([])

    store.getState().setHighlightedGeometryIds(['g-1', 'g-2'])
    expect(store.getState().highlightedGeometryIds).toEqual(['g-1', 'g-2'])

    store.getState().clearHighlightedGeometryIds()
    expect(store.getState().highlightedGeometryIds).toEqual([])
  })
})

describe('EditorStore / レイヤーテンプレート適用（Issue #40）', () => {
  it('applyLayerTemplate は同名レイヤーを残し不足分のみ追加し、アクティブを先頭追加レイヤーへ切替える', () => {
    const store = createEditorStore()
    // 同名レイヤー（注記）を事前に用意し、維持されることを直接検証する
    const preExisting = store.getState().addLayer('注記')
    const initialCount = store.getState().layers.length
    const initialActive = store.getState().activeLayerId

    store.getState().applyLayerTemplate('survey')

    const survey = LAYER_TEMPLATES.find((t) => t.id === 'survey')
    expect(survey).toBeDefined()
    const expectedAdditions = survey?.layers.filter((l) => l.name !== '注記').length ?? 0
    const layers = store.getState().layers
    expect(layers.length).toBe(initialCount + expectedAdditions)
    expect(layers.some((l) => l.name === '測点')).toBe(true)
    expect(layers.some((l) => l.name === '地形')).toBe(true)
    expect(layers.find((l) => l.name === '測点')?.defaultStyle.strokeColor).toBe('#7A5FA0')
    expect(layers.find((l) => l.name === '補助線')).toBeUndefined()
    // 事前作成の「注記」が維持され、テンプレート側の同名レイヤーは追加されない
    expect(layers.filter((l) => l.name === '注記')).toHaveLength(1)
    expect(layers.some((l) => l.id === preExisting)).toBe(true)
    // アクティブは先頭の追加レイヤー（基準線）へ切替
    const firstAdded = layers.find((l) => l.name === '基準線')
    expect(store.getState().activeLayerId).toBe(firstAdded?.id)
    expect(store.getState().activeLayerId).not.toBe(initialActive)

    // 再適用しても重複しない
    store.getState().applyLayerTemplate('survey')
    expect(store.getState().layers.length).toBe(initialCount + expectedAdditions)
  })

  it('未知テンプレートIDは無視される', () => {
    const store = createEditorStore()
    const count = store.getState().layers.length
    store.getState().applyLayerTemplate('unknown')
    expect(store.getState().layers.length).toBe(count)
  })
})

describe('EditorStore / 数量 state 同期（Issue #116 Phase 3）', () => {
  function doc(store: ReturnType<typeof createEditorStore>) {
    const s = store.getState()
    return { geometries: s.geometries, layers: s.layers }
  }

  it('replaceDocument で現図面から数量明細が算出される', () => {
    const store = createEditorStore()
    store.getState().replaceDocument([circle('a', 0, 0, 5)], [layer('L1', '外形線')])
    const items = store.getState().quantityItems
    expect(items).toHaveLength(1)
    expect(items[0]?.method).toBe('area')
    expect(items[0]?.status).toBe('valid')
    expect(items[0]?.sources.map((source) => source.geometryId)).toEqual(['a'])
  })

  it('図形削除後も quantityItems が sources を保持し unlinked-quantity を検出する', () => {
    const store = createEditorStore()
    const a = { ...circle('a', 0, 0, 5), layerId: 'L1' as LayerId }
    const b = { ...circle('b', 100, 100, 5), layerId: 'L1' as LayerId }
    store.getState().replaceDocument([a, b], [layer('L1', '外形線')])
    store
      .getState()
      .dispatchCommand(createDeleteGeometriesCommand(doc(store), [id('a')]))
    expect(store.getState().quantityItems[0]?.sources.map((source) => source.geometryId)).toEqual(['a', 'b'])

    const result = checkDrawingHealth(
      doc(store),
      {},
      { quantities: store.getState().quantityItems },
    )
    const issue = result.issues.find((i) => i.code === 'unlinked-quantity')
    expect(issue?.count).toBe(1)
    expect(issue?.geometryIds).toContain('a')
  })

  it('削除を undo すると unlinked-quantity が解消される', () => {
    const store = createEditorStore()
    const a = { ...circle('a', 0, 0, 5), layerId: 'L1' as LayerId }
    const b = { ...circle('b', 100, 100, 5), layerId: 'L1' as LayerId }
    store.getState().replaceDocument([a, b], [layer('L1', '外形線')])
    store
      .getState()
      .dispatchCommand(createDeleteGeometriesCommand(doc(store), [id('a')]))
    store.getState().undo()

    const result = checkDrawingHealth(
      doc(store),
      {},
      { quantities: store.getState().quantityItems },
    )
    expect(result.issues.find((i) => i.code === 'unlinked-quantity')).toBeUndefined()
  })

  it('図形変更で依存明細が stale になり、再計算で解消される', () => {
    const store = createEditorStore()
    const a = { ...circle('a', 0, 0, 5), layerId: 'L1' as LayerId }
    store.getState().replaceDocument([a], [layer('L1', '外形線')])
    store
      .getState()
      .dispatchCommand(createUpdateGeometryCommand(a, { ...a, center: { x: 500, y: 500 } }))

    expect(store.getState().quantityItems[0]?.status).toBe('stale')
    const staleResult = checkDrawingHealth(
      doc(store),
      {},
      { quantities: store.getState().quantityItems },
    )
    expect(staleResult.issues.find((i) => i.code === 'stale-quantity')?.count).toBe(1)

    store.getState().recalculateQuantities()
    expect(store.getState().quantityItems[0]?.status).toBe('valid')
    const fixedResult = checkDrawingHealth(
      doc(store),
      {},
      { quantities: store.getState().quantityItems },
    )
    expect(fixedResult.issues.find((i) => i.code === 'stale-quantity')).toBeUndefined()
  })

  it('直接 updateGeometry / removeGeometries でも数量 state が同期される', () => {
    const store = createEditorStore()
    const a = { ...circle('a', 0, 0, 5), layerId: 'L1' as LayerId }
    store.getState().replaceDocument([a], [layer('L1', '外形線')])

    store.getState().updateGeometry({ ...a, center: { x: 300, y: 300 } })
    expect(store.getState().quantityItems[0]?.status).toBe('stale')

    store.getState().removeGeometries([id('a')])
    const result = checkDrawingHealth(
      doc(store),
      {},
      { quantities: store.getState().quantityItems },
    )
    expect(result.issues.find((i) => i.code === 'unlinked-quantity')?.count).toBe(1)
  })

  it('addGeometries は数量 state を変更しない（再計算まで新図形は含めない）', () => {
    const store = createEditorStore()
    store.getState().replaceDocument([circle('a', 0, 0, 5)], [layer('L1', '外形線')])
    const before = store.getState().quantityItems
    store.getState().addGeometries([circle('b', 200, 200, 5)])
    expect(store.getState().quantityItems).toBe(before)
    expect(store.getState().quantityItems[0]?.sources).toHaveLength(1)
  })

  it('dispatchCommand の ADD_GEOMETRY は quantityItems の参照を維持する', () => {
    const store = createEditorStore()
    store.getState().replaceDocument([circle('a', 0, 0, 5)], [layer('L1', '外形線')])
    const before = store.getState().quantityItems
    store.getState().dispatchCommand(createAddGeometryCommand(circle('b', 200, 200, 5)))
    expect(store.getState().quantityItems).toBe(before)
  })

  describe('SnapSlice（Issue #24 配線）', () => {
    it('既定値: 有効・許容差10px・端点/中点/中心/交点/グリッドON', () => {
      const s = createEditorStore().getState()
      expect(s.snapEnabled).toBe(true)
      expect(s.snapTolerancePx).toBe(10)
      expect(s.snapEndpoint).toBe(true)
      expect(s.snapMidpoint).toBe(true)
      expect(s.snapCenter).toBe(true)
      expect(s.snapIntersection).toBe(true)
      expect(s.snapGrid).toBe(true)
      expect(s.snapPerpendicular).toBe(false)
      expect(s.snapResult).toBeNull()
    })

    it('setSnapEnabled(false) はスナップ結果をクリアする', () => {
      const store = createEditorStore()
      store.getState().setSnapResult({ point: { x: 1, y: 2 }, type: 'endpoint' })
      store.getState().setSnapEnabled(false)
      expect(store.getState().snapResult).toBeNull()
    })

    it('setSnapTolerancePx は 1〜40px にクランプする', () => {
      const store = createEditorStore()
      store.getState().setSnapTolerancePx(0)
      expect(store.getState().snapTolerancePx).toBe(1)
      store.getState().setSnapTolerancePx(999)
      expect(store.getState().snapTolerancePx).toBe(40)
    })

    it('toggleSnapType は指定種別のみ反転する', () => {
      const store = createEditorStore()
      store.getState().toggleSnapType('midpoint')
      expect(store.getState().snapMidpoint).toBe(false)
      expect(store.getState().snapEndpoint).toBe(true)
      store.getState().toggleSnapType('midpoint')
      expect(store.getState().snapMidpoint).toBe(true)
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildDraftFields,
  buildDraftPreview,
  composeDraftGeometry,
  DRAFT_PREVIEW_ID,
  makeArcDraft,
  makeCircleDraft,
  makeCloudDraft,
  makeEllipseDraft,
  makeLeaderDraft,
  makeLineDraft,
  makeMlineDraft,
  makePolylineDraft,
  makeRectangleDraft,
  makeSplineDraft,
  type DraftGeometryBase,
} from '@/domain/tools/draftGeometry'
import type { GeometryId, GeometryStyle, LayerId, Point } from '@/shared/types'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base: DraftGeometryBase = {
  id: 'g1' as GeometryId,
  layerId: 'layer-default' as LayerId,
  style,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

const p = (x: number, y: number): Point => ({ x, y })

describe('draftGeometry / 図形フィールド生成', () => {
  it('makeLineDraft: 2点から線分、点不足・ゼロ長は null', () => {
    expect(makeLineDraft([p(0, 0), p(10, 5)])).toEqual({ type: 'line', start: p(0, 0), end: p(10, 5) })
    expect(makeLineDraft([p(0, 0)])).toBeNull()
    expect(makeLineDraft([p(3, 3), p(3, 3)])).toBeNull()
  })

  it('makeRectangleDraft: 対角2点を正規化（右下→左上でも正サイズ）、rotationDeg=0', () => {
    const r = makeRectangleDraft([p(100, 80), p(20, 10)])
    expect(r).toEqual({ type: 'rectangle', origin: p(20, 10), width: 80, height: 70, rotationDeg: 0 })
  })

  it('makeRectangleDraft: ゼロ面積（幅か高さ0）は null', () => {
    expect(makeRectangleDraft([p(0, 0), p(0, 50)])).toBeNull()
    expect(makeRectangleDraft([p(0, 0), p(50, 0)])).toBeNull()
  })

  it('makeCircleDraft: 半径=2点間距離（3-4-5）、半径0は null', () => {
    expect(makeCircleDraft([p(0, 0), p(30, 40)])).toEqual({ type: 'circle', center: p(0, 0), radius: 50 })
    expect(makeCircleDraft([p(7, 7), p(7, 7)])).toBeNull()
  })

  it('makePolylineDraft: 2点以上で closed=false、1点以下は null、入力配列から独立', () => {
    const pts = [p(0, 0), p(10, 0), p(10, 10)]
    const poly = makePolylineDraft(pts)
    expect(poly?.type).toBe('polyline')
    expect(poly?.closed).toBe(false)
    expect(poly?.points).toHaveLength(3)
    expect(makePolylineDraft([p(0, 0)])).toBeNull()
    // 入力配列の後続変更に影響されない（スナップショット）
    const mutable = [p(0, 0), p(1, 1)]
    const snap = makePolylineDraft(mutable)
    mutable.push(p(2, 2))
    expect(snap?.points).toHaveLength(2)
  })

  it('makeArcDraft: 中心・半径点・終点角度点の3点から円弧、点不足・半径0は null', () => {
    // 中心(0,0)、半径点(50,0) → startAngle=0、終点(0,50)（画面下）は時計回り 90°。
    const arc = makeArcDraft([p(0, 0), p(50, 0), p(0, 50)])
    expect(arc?.type).toBe('arc')
    expect(arc?.radius).toBeCloseTo(50)
    expect(arc?.startAngleDeg).toBeCloseTo(0)
    expect(arc?.endAngleDeg).toBeCloseTo(90)
    expect(makeArcDraft([p(0, 0), p(1, 1)])).toBeNull()
    expect(makeArcDraft([p(0, 0), p(0, 0), p(1, 1)])).toBeNull()
  })

  it('makeEllipseDraft: 中心+半径点から半径X/Y（絶対値）、回転0', () => {
    expect(makeEllipseDraft([p(10, 20), p(30, 10)])).toEqual({
      type: 'ellipse',
      center: p(10, 20),
      radiusX: 20,
      radiusY: 10,
      rotationDeg: 0,
    })
    expect(makeEllipseDraft([p(0, 0), p(5, 0)])).toBeNull()
  })

  it('makeSplineDraft: 2点以上・tension=0.5、入力配列から独立', () => {
    const pts = [p(0, 0), p(50, 80), p(100, 0)]
    const spline = makeSplineDraft(pts)
    expect(spline).toEqual({ type: 'spline', points: pts, tension: 0.5 })
    expect(makeSplineDraft([p(0, 0)])).toBeNull()
  })

  it('makeCloudDraft: 対角2点で外接矩形、arcSize=15、同一座標は null', () => {
    expect(makeCloudDraft([p(0, 0), p(100, 60)])).toEqual({
      type: 'cloud',
      x1: 0,
      y1: 0,
      x2: 100,
      y2: 60,
      arcSize: 15,
    })
    expect(makeCloudDraft([p(5, 5), p(5, 5)])).toBeNull()
  })

  it('makeMlineDraft: 2点で中心線・offset=10、ゼロ長は null', () => {
    expect(makeMlineDraft([p(0, 0), p(100, 0)])).toEqual({
      type: 'mline',
      start: p(0, 0),
      end: p(100, 0),
      offset: 10,
    })
    expect(makeMlineDraft([p(1, 1), p(1, 1)])).toBeNull()
  })

  it('makeLeaderDraft: 2点で引出線（既定テキスト「注記」）、ゼロ長は null', () => {
    expect(makeLeaderDraft([p(0, 0), p(80, 40)])).toEqual({
      type: 'leader',
      start: p(0, 0),
      end: p(80, 40),
      text: '注記',
      textHeight: 14,
    })
    expect(makeLeaderDraft([p(0, 0), p(0, 0)])).toBeNull()
  })

  it('buildDraftFields: ツール種別で適切なメーカーへ振り分け、select は null', () => {
    expect(buildDraftFields('line', [p(0, 0), p(1, 1)])?.type).toBe('line')
    expect(buildDraftFields('rectangle', [p(0, 0), p(1, 1)])?.type).toBe('rectangle')
    expect(buildDraftFields('circle', [p(0, 0), p(1, 0)])?.type).toBe('circle')
    expect(buildDraftFields('arc', [p(0, 0), p(1, 0), p(0, 1)])?.type).toBe('arc')
    expect(buildDraftFields('ellipse', [p(0, 0), p(1, 1)])?.type).toBe('ellipse')
    expect(buildDraftFields('polyline', [p(0, 0), p(1, 1)])?.type).toBe('polyline')
    expect(buildDraftFields('spline', [p(0, 0), p(1, 1)])?.type).toBe('spline')
    expect(buildDraftFields('cloud', [p(0, 0), p(1, 1)])?.type).toBe('cloud')
    expect(buildDraftFields('mline', [p(0, 0), p(1, 1)])?.type).toBe('mline')
    expect(buildDraftFields('leader', [p(0, 0), p(1, 1)])?.type).toBe('leader')
    expect(buildDraftFields('select', [p(0, 0), p(1, 1)])).toBeNull()
    expect(buildDraftFields('measure', [p(0, 0), p(1, 1)])).toBeNull()
  })
})

describe('draftGeometry / GeometryBase 合成', () => {
  it('composeDraftGeometry: 図形固有フィールドと base を結合して完全な Geometry を作る', () => {
    const fields = makeLineDraft([p(0, 0), p(4, 3)])
    expect(fields).not.toBeNull()
    if (fields === null) return
    const g = composeDraftGeometry(fields, base)
    expect(g).toEqual({
      id: 'g1',
      layerId: 'layer-default',
      style,
      constructionStepIds: [],
      locked: false,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      type: 'line',
      start: p(0, 0),
      end: p(4, 3),
    })
  })

  it('composeDraftGeometry: circle でも base フィールドを引き継ぐ', () => {
    const fields = makeCircleDraft([p(0, 0), p(0, 5)])
    if (fields === null) throw new Error('fields should not be null')
    const g = composeDraftGeometry(fields, base)
    expect(g.type).toBe('circle')
    expect(g.layerId).toBe('layer-default')
    if (g.type === 'circle') expect(g.radius).toBe(5)
  })
})

describe('draftGeometry / プレビュー合成', () => {
  it('buildDraftPreview: line作図中（1点+カーソル）でプレビュー、固定IDが付く', () => {
    const preview = buildDraftPreview({
      tool: 'line',
      draftPoints: [p(0, 0)],
      draftCursor: p(100, 0),
      layerId: base.layerId,
      style,
    })
    expect(preview?.type).toBe('line')
    expect(preview?.id).toBe(DRAFT_PREVIEW_ID)
    if (preview?.type === 'line') expect(preview.end).toEqual(p(100, 0))
  })

  it('buildDraftPreview: polyline は確定点列 + カーソルを連結する', () => {
    const preview = buildDraftPreview({
      tool: 'polyline',
      draftPoints: [p(0, 0), p(10, 0)],
      draftCursor: p(10, 10),
      layerId: base.layerId,
      style,
    })
    expect(preview?.type).toBe('polyline')
    if (preview?.type === 'polyline') expect(preview.points).toHaveLength(3)
  })

  it('buildDraftPreview: カーソル未設定・select・退化形状は null', () => {
    expect(
      buildDraftPreview({ tool: 'line', draftPoints: [p(0, 0)], draftCursor: null, layerId: base.layerId, style }),
    ).toBeNull()
    expect(
      buildDraftPreview({ tool: 'select', draftPoints: [], draftCursor: p(1, 1), layerId: base.layerId, style }),
    ).toBeNull()
    // line で確定点なし + カーソルのみ → 点1つで線分にならず null
    expect(
      buildDraftPreview({ tool: 'line', draftPoints: [], draftCursor: p(1, 1), layerId: base.layerId, style }),
    ).toBeNull()
  })
})

describe('draftGeometry / 寸法ツール', () => {
  it('buildDraftFields dimension: 2点で寸法フィールド生成、水平線の場合は horizontal orientation', () => {
    const fields = buildDraftFields('dimension', [p(0, 0), p(100, 10)])
    expect(fields?.type).toBe('dimension')
    if (fields?.type === 'dimension') {
      expect(fields.start).toEqual(p(0, 0))
      expect(fields.end).toEqual(p(100, 10))
      expect(fields.orientation).toBe('horizontal')
      expect(fields.offset).toBe(50)
      expect(fields.textHeight).toBe(12)
      expect(fields.arrowSize).toBe(8)
    }
  })

  it('buildDraftFields dimension: 垂直線の場合は vertical orientation', () => {
    const fields = buildDraftFields('dimension', [p(0, 0), p(10, 200)])
    expect(fields?.type).toBe('dimension')
    if (fields?.type === 'dimension') {
      expect(fields.orientation).toBe('vertical')
    }
  })

  it('buildDraftFields dimension: ゼロ長（始点=終点）は null', () => {
    expect(buildDraftFields('dimension', [p(5, 5), p(5, 5)])).toBeNull()
  })

  it('buildDraftFields dimension: 点不足（1点のみ）は null', () => {
    expect(buildDraftFields('dimension', [p(0, 0)])).toBeNull()
  })

  it('buildDraftFields text/hatch: 常に null を返す（作図ドラフト方式ではない）', () => {
    expect(buildDraftFields('text', [p(10, 20)])).toBeNull()
    expect(buildDraftFields('hatch', [p(10, 20), p(30, 40)])).toBeNull()
  })

  it('buildDraftPreview dimension: 1点+カーソルで寸法プレビュー、固定IDが付く', () => {
    const preview = buildDraftPreview({
      tool: 'dimension',
      draftPoints: [p(0, 0)],
      draftCursor: p(100, 0),
      layerId: base.layerId,
      style,
    })
    expect(preview?.type).toBe('dimension')
    expect(preview?.id).toBe(DRAFT_PREVIEW_ID)
    if (preview?.type === 'dimension') {
      expect(preview.start).toEqual(p(0, 0))
      expect(preview.end).toEqual(p(100, 0))
    }
  })

  it('composeDraftGeometry: dimension フィールドを合成できる', () => {
    const fields = buildDraftFields('dimension', [p(0, 0), p(100, 0)])
    expect(fields).not.toBeNull()
    if (fields === null) return
    const g = composeDraftGeometry(fields, base)
    expect(g.type).toBe('dimension')
    expect(g.layerId).toBe('layer-default')
    if (g.type === 'dimension') {
      expect(g.start).toEqual(p(0, 0))
      expect(g.end).toEqual(p(100, 0))
    }
  })
})

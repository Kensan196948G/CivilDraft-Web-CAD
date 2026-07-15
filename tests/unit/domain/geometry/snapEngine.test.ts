import { describe, expect, it } from 'vitest'
import { computeSnap, type SnapOptions } from '@/domain/geometry/snapEngine'
import type { Geometry, GeometryBase, GeometryId, GeometryStyle, LayerId, Point } from '@/shared/types'

// テストヘルパーは selection.test.ts / shapeBBox.test.ts のパターンを踏襲する。
const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base: Omit<GeometryBase, 'id' | 'type'> = {
  layerId: 'layer-1' as LayerId,
  style,
  constructionStepIds: [],
  locked: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

function id(v: string): GeometryId {
  return v as GeometryId
}

function line(gid: string, x1: number, y1: number, x2: number, y2: number): Geometry {
  return { ...base, id: id(gid), type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function rectangle(
  gid: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDeg = 0,
): Geometry {
  return { ...base, id: id(gid), type: 'rectangle', origin: { x, y }, width, height, rotationDeg }
}

function circle(gid: string, cx: number, cy: number, radius: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center: { x: cx, y: cy }, radius }
}

function arc(
  gid: string,
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'arc',
    center: { x: cx, y: cy },
    radius,
    startAngleDeg,
    endAngleDeg,
  }
}

function ellipse(
  gid: string,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  rotationDeg = 0,
): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'ellipse',
    center: { x: cx, y: cy },
    radiusX,
    radiusY,
    rotationDeg,
  }
}

function polyline(gid: string, points: readonly Point[], closed = false): Geometry {
  return { ...base, id: id(gid), type: 'polyline', points, closed }
}

function spline(gid: string, points: readonly Point[], tension = 0.5): Geometry {
  return { ...base, id: id(gid), type: 'spline', points, tension }
}

function text(gid: string, x: number, y: number): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'text',
    anchor: { x, y },
    text: 'S',
    height: 3,
    rotationDeg: 0,
    horizontalAlign: 'left',
  }
}

function dimension(gid: string, x1: number, y1: number, x2: number, y2: number): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'dimension',
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    orientation: 'horizontal',
    offset: 5,
    textHeight: 3,
    arrowSize: 2,
  }
}

function leader(gid: string, x1: number, y1: number, x2: number, y2: number): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'leader',
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    text: 'note',
    textHeight: 3,
  }
}

function hatch(gid: string, boundaryPoints: readonly Point[]): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'hatch',
    boundaryPoints,
    pattern: 'concrete',
    angleDeg: 45,
    spacing: 2,
  }
}

function symbol(gid: string, x: number, y: number): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'symbol',
    symbolId: 'manhole',
    position: { x, y },
    rotationDeg: 0,
    scale: 1,
  }
}

function parametric(gid: string): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'parametricObject',
    definitionId: 'heavy-machine-radius',
    definitionVersion: 1,
    parameters: {},
    generatedGeometryIds: [],
  }
}

const ALL_OFF: SnapOptions = {
  snapGrid: false,
  snapEndpoint: false,
  snapMidpoint: false,
  snapCenter: false,
  snapPerpendicular: false,
  snapTangent: false,
  snapNearest: false,
  snapIntersection: false,
}

function opts(overrides: Partial<SnapOptions>): SnapOptions {
  return { ...ALL_OFF, ...overrides }
}

const GRID = 10

describe('computeSnap / endpoint（端点スナップ）', () => {
  it('端点がSNAP_RADIUS内なら端点へ吸着する', () => {
    const shapes = [line('a', 0, 0, 100, 0)]
    const r = computeSnap({ x: 1, y: 1 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(r.type).toBe('endpoint')
    expect(r.point).toEqual({ x: 0, y: 0 })
  })

  it('全端点がSNAP_RADIUS外ならnone', () => {
    const shapes = [line('a', 0, 0, 100, 0)]
    const r = computeSnap({ x: 50, y: 50 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(r.type).toBe('none')
    expect(r.point).toEqual({ x: 50, y: 50 })
  })
})

describe('computeSnap / midpoint（中点スナップ）', () => {
  it('直線の中点へ吸着する', () => {
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 5, y: 2 }, shapes, GRID, opts({ snapMidpoint: true }))
    expect(r.type).toBe('midpoint')
    expect(r.point).toEqual({ x: 5, y: 0 })
  })

  it('中点が遠いときはnone', () => {
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 5, y: 50 }, shapes, GRID, opts({ snapMidpoint: true }))
    expect(r.type).toBe('none')
  })

  it('開ポリラインは頂点間の中点のみ（閉じ辺は対象外）', () => {
    // 頂点 (0,0),(10,0),(10,10)。中点 (5,0),(10,5)。閉じ辺中点 (5,5) は含まない。
    const shapes = [polyline('p', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], false)]
    const r = computeSnap({ x: 5, y: 5.5 }, shapes, GRID, opts({ snapMidpoint: true }))
    expect(r.type).toBe('midpoint')
    expect(r.point).toEqual({ x: 10, y: 5 })
  })

  it('閉ポリラインは閉じ辺（末尾→先頭）の中点も対象になる', () => {
    const shapes = [polyline('p', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true)]
    const r = computeSnap({ x: 5, y: 5.5 }, shapes, GRID, opts({ snapMidpoint: true }))
    expect(r.type).toBe('midpoint')
    expect(r.point).toEqual({ x: 5, y: 5 })
  })
})

describe('computeSnap / center（中心スナップ）', () => {
  it('円の中心へ吸着する', () => {
    const shapes = [circle('c', 0, 0, 50)]
    const r = computeSnap({ x: 2, y: 2 }, shapes, GRID, opts({ snapCenter: true }))
    expect(r.type).toBe('center')
    expect(r.point).toEqual({ x: 0, y: 0 })
  })

  it('円弧の中心へ吸着する', () => {
    const shapes = [arc('a', 5, 5, 50, 0, 90)]
    const r = computeSnap({ x: 5, y: 5 }, shapes, GRID, opts({ snapCenter: true }))
    expect(r.type).toBe('center')
    expect(r.point).toEqual({ x: 5, y: 5 })
  })

  it('楕円は中心スナップ対象外（継承元踏襲）', () => {
    const shapes = [ellipse('e', 0, 0, 50, 30)]
    const r = computeSnap({ x: 1, y: 1 }, shapes, GRID, opts({ snapCenter: true }))
    expect(r.type).toBe('none')
  })
})

describe('computeSnap / intersection（交点スナップ）', () => {
  it('交差する2直線の交点へ吸着する', () => {
    const shapes = [line('a', 0, 0, 10, 10), line('b', 0, 10, 10, 0)]
    const r = computeSnap({ x: 5, y: 5.5 }, shapes, GRID, opts({ snapIntersection: true }))
    expect(r.type).toBe('intersection')
    expect(r.point.x).toBeCloseTo(5)
    expect(r.point.y).toBeCloseTo(5)
  })

  it('平行な2直線は交点なしでnone', () => {
    const shapes = [line('a', 0, 0, 10, 0), line('b', 0, 5, 10, 5)]
    const r = computeSnap({ x: 5, y: 2 }, shapes, GRID, opts({ snapIntersection: true }))
    expect(r.type).toBe('none')
  })
})

describe('computeSnap / perpendicular（垂線足スナップ）', () => {
  it('線分上への垂線足へ吸着する', () => {
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 5, y: 3 }, shapes, GRID, opts({ snapPerpendicular: true }))
    expect(r.type).toBe('perpendicular')
    expect(r.point).toEqual({ x: 5, y: 0 })
  })

  it('線分の外側（t∉[0,1]）へは垂線足なしでnone', () => {
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 15, y: 3 }, shapes, GRID, opts({ snapPerpendicular: true }))
    expect(r.type).toBe('none')
  })
})

describe('computeSnap / tangent（接点スナップ）', () => {
  it('外部カーソルから円への接点へ吸着する', () => {
    const shapes = [circle('c', 0, 0, 5)]
    const r = computeSnap({ x: 10, y: 0 }, shapes, GRID, opts({ snapTangent: true }))
    expect(r.type).toBe('tangent')
    // 接点は円周上（中心からの距離=半径5）
    expect(Math.hypot(r.point.x, r.point.y)).toBeCloseTo(5)
    expect(r.point.x).toBeCloseTo(2.5)
    expect(r.point.y).toBeCloseTo(-4.330127)
  })

  it('円の内部にカーソルがある場合は接点なしでnone', () => {
    const shapes = [circle('c', 0, 0, 5)]
    const r = computeSnap({ x: 1, y: 0 }, shapes, GRID, opts({ snapTangent: true }))
    expect(r.type).toBe('none')
  })
})

describe('computeSnap / nearest（最近点スナップ）', () => {
  it('線分上の最近点へ吸着する', () => {
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 5, y: 3 }, shapes, GRID, opts({ snapNearest: true }))
    expect(r.type).toBe('nearest')
    expect(r.point).toEqual({ x: 5, y: 0 })
  })

  it('円周上の最近点へ吸着する', () => {
    const shapes = [circle('c', 0, 0, 5)]
    const r = computeSnap({ x: 10, y: 0 }, shapes, GRID, opts({ snapNearest: true }))
    expect(r.type).toBe('nearest')
    expect(r.point.x).toBeCloseTo(5)
    expect(r.point.y).toBeCloseTo(0)
  })

  it('最近点が遠いときはnone', () => {
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 5, y: 50 }, shapes, GRID, opts({ snapNearest: true }))
    expect(r.type).toBe('none')
  })

  it('矩形の辺上の最近点へ吸着する（rotationDegは無視）', () => {
    const shapes = [rectangle('r', 0, 0, 10, 10, 30)]
    const r = computeSnap({ x: 5, y: -3 }, shapes, GRID, opts({ snapNearest: true }))
    expect(r.type).toBe('nearest')
    expect(r.point).toEqual({ x: 5, y: 0 })
  })
})

describe('computeSnap / grid（グリッドスナップ）', () => {
  it('他に何も無ければ最も近いグリッド交点へ吸着する', () => {
    const r = computeSnap({ x: 12, y: 8 }, [], GRID, opts({ snapGrid: true }))
    expect(r.type).toBe('grid')
    expect(r.point).toEqual({ x: 10, y: 10 })
  })

  it('grid以外が全てヒットしない場合の最終手段として発火する', () => {
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 50, y: 50 }, shapes, GRID, opts({ snapEndpoint: true, snapGrid: true }))
    expect(r.type).toBe('grid')
    expect(r.point).toEqual({ x: 50, y: 50 })
  })
})

describe('computeSnap / 優先順位', () => {
  it('フェーズ1（endpoint）はより近いフェーズ2（nearest）より優先される', () => {
    // カーソル(0.5,0.5): endpoint(0,0)=0.707, nearest(0.5,0)=0.5。nearestが近いが端点が勝つ。
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 0.5, y: 0.5 }, shapes, GRID, opts({ snapEndpoint: true, snapNearest: true }))
    expect(r.type).toBe('endpoint')
    expect(r.point).toEqual({ x: 0, y: 0 })
  })

  it('フェーズ1内では厳密に近い種別が勝つ（centerがendpointより近い場合）', () => {
    // 円中心(0,0)、カーソル(1,1): center=1.41、最寄り端点(10,0)=9.06。centerが勝つ。
    const shapes = [circle('c', 0, 0, 10)]
    const r = computeSnap({ x: 1, y: 1 }, shapes, GRID, opts({ snapEndpoint: true, snapCenter: true }))
    expect(r.type).toBe('center')
    expect(r.point).toEqual({ x: 0, y: 0 })
  })

  it('フェーズ1内の同距離タイは先に評価される種別（endpoint > midpoint）が勝つ', () => {
    // カーソル(2.5,2): endpoint(0,0)=sqrt(10.25)、midpoint(5,0)=sqrt(10.25)。同距離→endpoint。
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap({ x: 2.5, y: 2 }, shapes, GRID, opts({ snapEndpoint: true, snapMidpoint: true }))
    expect(r.type).toBe('endpoint')
    expect(r.point).toEqual({ x: 0, y: 0 })
  })

  it('フェーズ2の同距離タイは先に評価される種別（perpendicular > nearest）が勝つ', () => {
    // 線分中央上のカーソルでは垂線足と最近点が同一・同距離。perpendicularが勝つ。
    const shapes = [line('a', 0, 0, 10, 0)]
    const r = computeSnap(
      { x: 5, y: 3 },
      shapes,
      GRID,
      opts({ snapPerpendicular: true, snapNearest: true }),
    )
    expect(r.type).toBe('perpendicular')
    expect(r.point).toEqual({ x: 5, y: 0 })
  })
})

describe('computeSnap / tolerance境界', () => {
  it('距離 = SNAP_RADIUS(10) ちょうどは吸着しない（d < radius の厳密比較）', () => {
    const shapes = [line('a', 0, 0, 100, 0)]
    const r = computeSnap({ x: 0, y: 10 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(r.type).toBe('none')
  })

  it('距離 = 9.9 は吸着する', () => {
    const shapes = [line('a', 0, 0, 100, 0)]
    const r = computeSnap({ x: 0, y: 9.9 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(r.type).toBe('endpoint')
    expect(r.point).toEqual({ x: 0, y: 0 })
  })
})

describe('computeSnap / 角度変換（deg→rad）', () => {
  it('円弧端点は startAngleDeg/endAngleDeg を度数法として解釈する', () => {
    // 中心(0,0) 半径10 開始0° 終了90° → 端点 (10,0) と (0,10)。
    const shapes = [arc('a', 0, 0, 10, 0, 90)]
    const rStart = computeSnap({ x: 10, y: 1 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(rStart.type).toBe('endpoint')
    expect(rStart.point.x).toBeCloseTo(10)
    expect(rStart.point.y).toBeCloseTo(0)

    const rEnd = computeSnap({ x: 1, y: 10 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(rEnd.type).toBe('endpoint')
    expect(rEnd.point.x).toBeCloseTo(0)
    expect(rEnd.point.y).toBeCloseTo(10)
  })

  it('円弧の最近点は角度範囲内ならその点、範囲外なら近い端点を返す', () => {
    const shapes = [arc('a', 0, 0, 10, 0, 90)]
    // (5,5)方向(45°)は範囲内 → 円弧上 (7.07,7.07)
    const inRange = computeSnap({ x: 5, y: 5 }, shapes, GRID, opts({ snapNearest: true }))
    expect(inRange.type).toBe('nearest')
    expect(inRange.point.x).toBeCloseTo(7.071068)
    expect(inRange.point.y).toBeCloseTo(7.071068)
  })
})

describe('computeSnap / 対象外・特殊図形種別', () => {
  it('parametricObjectはスナップ点を持たない', () => {
    const r = computeSnap({ x: 0, y: 0 }, [parametric('p')], GRID, opts({ snapEndpoint: true }))
    expect(r.type).toBe('none')
  })

  it('textは端点（anchor）へ吸着するが線分は持たない', () => {
    const shapes = [text('t', 20, 20)]
    const ep = computeSnap({ x: 21, y: 21 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(ep.type).toBe('endpoint')
    expect(ep.point).toEqual({ x: 20, y: 20 })

    const near = computeSnap({ x: 21, y: 21 }, shapes, GRID, opts({ snapNearest: true }))
    expect(near.type).toBe('none')
  })

  it('symbolは端点（position）へ吸着する', () => {
    const shapes = [symbol('s', 30, 30)]
    const r = computeSnap({ x: 31, y: 29 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(r.type).toBe('endpoint')
    expect(r.point).toEqual({ x: 30, y: 30 })
  })

  it('dimensionは始点・終点へ吸着する', () => {
    const shapes = [dimension('d', 0, 0, 40, 0)]
    const r = computeSnap({ x: 40, y: 2 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(r.type).toBe('endpoint')
    expect(r.point).toEqual({ x: 40, y: 0 })
  })

  it('leaderは始点・終点へ吸着する', () => {
    const shapes = [leader('l', 0, 0, 40, 40)]
    const r = computeSnap({ x: 1, y: 1 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(r.type).toBe('endpoint')
    expect(r.point).toEqual({ x: 0, y: 0 })
  })

  it('hatchは境界点を端点として吸着するが線分は持たない', () => {
    const shapes = [hatch('h', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])]
    const ep = computeSnap({ x: 1, y: 0 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(ep.type).toBe('endpoint')
    expect(ep.point).toEqual({ x: 0, y: 0 })

    const near = computeSnap({ x: 5, y: 1 }, shapes, GRID, opts({ snapNearest: true }))
    expect(near.type).toBe('none')
  })

  it('splineは頂点を端点として吸着するが線分は持たない', () => {
    const shapes = [spline('sp', [{ x: 0, y: 0 }, { x: 50, y: 0 }])]
    const ep = computeSnap({ x: 1, y: 1 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(ep.type).toBe('endpoint')
    expect(ep.point).toEqual({ x: 0, y: 0 })

    const near = computeSnap({ x: 25, y: 1 }, shapes, GRID, opts({ snapNearest: true }))
    expect(near.type).toBe('none')
  })

  it('ellipseは4端点へ吸着するが中心・線分は持たない', () => {
    const shapes = [ellipse('e', 0, 0, 50, 30)]
    const ep = computeSnap({ x: 50, y: 1 }, shapes, GRID, opts({ snapEndpoint: true }))
    expect(ep.type).toBe('endpoint')
    expect(ep.point).toEqual({ x: 50, y: 0 })

    const near = computeSnap({ x: 25, y: 1 }, shapes, GRID, opts({ snapNearest: true }))
    expect(near.type).toBe('none')
  })

  it('空頂点のポリラインはスナップ点を持たない', () => {
    const shapes = [polyline('p', [])]
    const r = computeSnap({ x: 0, y: 0 }, shapes, GRID, opts({ snapEndpoint: true, snapNearest: true }))
    expect(r.type).toBe('none')
  })

  it('全オプションoffなら常にnone', () => {
    const shapes = [line('a', 0, 0, 10, 0), circle('c', 0, 0, 5)]
    const r = computeSnap({ x: 0, y: 0 }, shapes, GRID, ALL_OFF)
    expect(r.type).toBe('none')
    expect(r.point).toEqual({ x: 0, y: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import { scaleShape, scaleShapes, validateScaleConfig } from '@/domain/geometry/scaleEngine'
import type { ScaleConfig } from '@/domain/geometry/scaleEngine'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type {
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  Point,
} from '@/shared/types'

// selection.test.ts のヘルパーパターン（style / base / id）を踏襲する。
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

const GEN_TIME = '2026-07-15T12:00:00.000Z'

function id(v: string): GeometryId {
  return v as GeometryId
}

/** 決定的コンテキスト: 連番ID（gen-1, gen-2, ...）と固定タイムスタンプを注入する。 */
function seqContext(): GeometryCreationContext {
  let n = 0
  return {
    newId: () => `gen-${++n}` as GeometryId,
    now: () => GEN_TIME,
  }
}

function line(gid: string, start: Point, end: Point): Geometry {
  return { ...base, id: id(gid), type: 'line', start, end }
}

function rectangle(gid: string, origin: Point, width: number, height: number): Geometry {
  return { ...base, id: id(gid), type: 'rectangle', origin, width, height, rotationDeg: 0 }
}

function circle(gid: string, center: Point, radius: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center, radius }
}

function ellipse(gid: string, center: Point, radiusX: number, radiusY: number): Geometry {
  return { ...base, id: id(gid), type: 'ellipse', center, radiusX, radiusY, rotationDeg: 0 }
}

function textAt(gid: string, anchor: Point, height: number): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'text',
    anchor,
    text: 'A',
    height,
    rotationDeg: 0,
    horizontalAlign: 'left',
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

/** 生成コピー（新規id・タイムスタンプ）の期待値を組み立てるヘルパー。 */
function withGenIdentity(geometry: Geometry, gid: string): Geometry {
  return { ...geometry, id: id(gid), createdAt: GEN_TIME, updatedAt: GEN_TIME }
}

describe('scaleShape', () => {
  it('line を基準点回りにスケールし、新規id・タイムスタンプを付与する', () => {
    const config: ScaleConfig = { cx: 0, cy: 0, sx: 2, sy: 3 }
    const result = scaleShape(line('a', { x: 1, y: 1 }, { x: 2, y: 2 }), config, seqContext())
    expect(result).toEqual(withGenIdentity(line('gen-1', { x: 2, y: 3 }, { x: 4, y: 6 }), 'gen-1'))
  })

  it('circle の半径は max(sx,sy) 倍される', () => {
    const config: ScaleConfig = { cx: 0, cy: 0, sx: 2, sy: 4 }
    const result = scaleShape(circle('c', { x: 10, y: 10 }, 5), config, seqContext())
    expect(result).toEqual(withGenIdentity(circle('gen-1', { x: 20, y: 40 }, 20), 'gen-1'))
  })

  it('rectangle は width*sx, height*sy でスケールする', () => {
    const config: ScaleConfig = { cx: 0, cy: 0, sx: 2, sy: 3 }
    const result = scaleShape(rectangle('r', { x: 1, y: 2 }, 10, 20), config, seqContext())
    expect(result).toEqual(withGenIdentity(rectangle('gen-1', { x: 2, y: 6 }, 20, 60), 'gen-1'))
  })

  it('ellipse は radiusX*sx, radiusY*sy で個別にスケールする', () => {
    const config: ScaleConfig = { cx: 0, cy: 0, sx: 2, sy: 5 }
    const result = scaleShape(ellipse('e', { x: 0, y: 0 }, 4, 2), config, seqContext())
    expect(result).toEqual(withGenIdentity(ellipse('gen-1', { x: 0, y: 0 }, 8, 10), 'gen-1'))
  })

  it('text は基準点のみスケールし、文字高さ(height)は変えない（継承元踏襲）', () => {
    const config: ScaleConfig = { cx: 0, cy: 0, sx: 2, sy: 2 }
    const result = scaleShape(textAt('t', { x: 2, y: 2 }, 5), config, seqContext())
    expect(result).toEqual(withGenIdentity(textAt('gen-1', { x: 4, y: 4 }, 5), 'gen-1'))
  })

  it('倍率が非正（sx<=0 または sy<=0）の場合は null を返す', () => {
    expect(scaleShape(line('a', { x: 0, y: 0 }, { x: 1, y: 1 }), { cx: 0, cy: 0, sx: 0, sy: 1 })).toBeNull()
    expect(scaleShape(line('a', { x: 0, y: 0 }, { x: 1, y: 1 }), { cx: 0, cy: 0, sx: 1, sy: -1 })).toBeNull()
  })

  it('parametricObject はスケール対象外として null を返す', () => {
    expect(scaleShape(parametric('p1'), { cx: 0, cy: 0, sx: 2, sy: 2 })).toBeNull()
  })
})

describe('scaleShapes', () => {
  it('in-place（同一id・createdAt/updatedAt維持）で座標のみスケールする', () => {
    const config: ScaleConfig = { cx: 0, cy: 0, sx: 2, sy: 2 }
    const result = scaleShapes([line('orig-1', { x: 1, y: 1 }, { x: 2, y: 2 })], config)
    expect(result).toEqual([line('orig-1', { x: 2, y: 2 }, { x: 4, y: 4 })])
  })

  it('parametricObject を含む配列では対象外図形を除外する', () => {
    const config: ScaleConfig = { cx: 0, cy: 0, sx: 2, sy: 2 }
    const result = scaleShapes([parametric('p1'), line('orig-1', { x: 1, y: 1 }, { x: 2, y: 2 })], config)
    expect(result).toEqual([line('orig-1', { x: 2, y: 2 }, { x: 4, y: 4 })])
  })

  it('倍率不正の場合は空配列を返す', () => {
    expect(scaleShapes([line('a', { x: 0, y: 0 }, { x: 1, y: 1 })], { cx: 0, cy: 0, sx: 0, sy: 1 })).toEqual([])
  })
})

describe('validateScaleConfig', () => {
  it('正の倍率は null（問題なし）', () => {
    expect(validateScaleConfig({ cx: 0, cy: 0, sx: 1, sy: 1 })).toBeNull()
  })

  it('非正の倍率は SCALE_FACTOR_NOT_POSITIVE を返す', () => {
    expect(validateScaleConfig({ cx: 0, cy: 0, sx: 0, sy: 1 })).toEqual({
      code: 'SCALE_FACTOR_NOT_POSITIVE',
      severity: 'error',
      message: 'スケール倍率は 0 より大きい値を指定してください',
    })
  })
})

// QAカバレッジ補強: 既存テスト未到達の図形種別（arc/polyline/spline/hatch/symbol）の
// スケール変換を検証する。非等方倍率(sx≠sy)で circle/arc の半径が max(sx,sy) 倍になること、
// text/symbol が基準点のみスケールされ寸法(height/scale)を変えないことを確認する。
describe('scaleShape / 追加カバレッジ（arc・polyline・spline・hatch・symbol）', () => {
  const config: ScaleConfig = { cx: 0, cy: 0, sx: 2, sy: 4 }

  it('arc は中心をスケールし半径を max(sx,sy) 倍にする（角度は不変）', () => {
    const arc: Geometry = {
      ...base, id: id('a'), type: 'arc',
      center: { x: 10, y: 10 }, radius: 5, startAngleDeg: 0, endAngleDeg: 90,
    }
    const scaled: Geometry = {
      ...base, id: id('a'), type: 'arc',
      center: { x: 20, y: 40 }, radius: 20, startAngleDeg: 0, endAngleDeg: 90,
    }
    expect(scaleShape(arc, config, seqContext())).toEqual(withGenIdentity(scaled, 'gen-1'))
  })

  it('polyline は全頂点をスケールし closed を維持する', () => {
    const poly: Geometry = {
      ...base, id: id('p'), type: 'polyline',
      points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], closed: true,
    }
    const scaled: Geometry = {
      ...base, id: id('p'), type: 'polyline',
      points: [{ x: 2, y: 4 }, { x: 4, y: 8 }], closed: true,
    }
    expect(scaleShape(poly, config, seqContext())).toEqual(withGenIdentity(scaled, 'gen-1'))
  })

  it('spline は全頂点をスケールし tension を維持する', () => {
    const sp: Geometry = {
      ...base, id: id('s'), type: 'spline',
      points: [{ x: 1, y: 1 }, { x: 3, y: 2 }], tension: 0.5,
    }
    const scaled: Geometry = {
      ...base, id: id('s'), type: 'spline',
      points: [{ x: 2, y: 4 }, { x: 6, y: 8 }], tension: 0.5,
    }
    expect(scaleShape(sp, config, seqContext())).toEqual(withGenIdentity(scaled, 'gen-1'))
  })

  it('hatch は境界点をスケールし pattern/angleDeg/spacing を維持する', () => {
    const h: Geometry = {
      ...base, id: id('h'), type: 'hatch',
      boundaryPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      pattern: 'concrete', angleDeg: 45, spacing: 2,
    }
    const scaled: Geometry = {
      ...base, id: id('h'), type: 'hatch',
      boundaryPoints: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }],
      pattern: 'concrete', angleDeg: 45, spacing: 2,
    }
    expect(scaleShape(h, config, seqContext())).toEqual(withGenIdentity(scaled, 'gen-1'))
  })

  it('symbol は基準点(position)のみスケールし scale 値は変えない（継承元踏襲）', () => {
    const sym: Geometry = {
      ...base, id: id('sy'), type: 'symbol',
      symbolId: 'cone', position: { x: 5, y: 5 }, rotationDeg: 30, scale: 2,
    }
    const scaled: Geometry = {
      ...base, id: id('sy'), type: 'symbol',
      symbolId: 'cone', position: { x: 10, y: 20 }, rotationDeg: 30, scale: 2,
    }
    expect(scaleShape(sym, config, seqContext())).toEqual(withGenIdentity(scaled, 'gen-1'))
  })

  it('cloud は外接矩形と arcSize をスケールする', () => {
    const cloud: Geometry = {
      ...base, id: id('cl'), type: 'cloud',
      x1: 10, y1: 10, x2: 30, y2: 20, arcSize: 5,
    }
    const scaled = scaleShape(cloud, { cx: 0, cy: 0, sx: 2, sy: 3 })
    expect(scaled).not.toBeNull()
    if (scaled?.type === 'cloud') {
      expect(scaled.x1).toBeCloseTo(20)
      expect(scaled.y1).toBeCloseTo(30)
      expect(scaled.x2).toBeCloseTo(60)
      expect(scaled.y2).toBeCloseTo(60)
      expect(scaled.arcSize).toBeCloseTo(15)
    }
  })

  it('mline は中心線と offset をスケールする', () => {
    const mline: Geometry = {
      ...base, id: id('ml'), type: 'mline',
      start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, offset: 10,
    }
    const scaled = scaleShape(mline, { cx: 0, cy: 0, sx: 2, sy: 3 })
    expect(scaled).not.toBeNull()
    if (scaled?.type === 'mline') {
      expect(scaled.end.x).toBeCloseTo(200)
      expect(scaled.offset).toBeCloseTo(30)
    }
  })
})

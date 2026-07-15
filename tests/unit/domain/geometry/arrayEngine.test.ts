import { describe, expect, it } from 'vitest'
import { applyArray, validateArrayConfig } from '@/domain/geometry/arrayEngine'
import type { ArrayConfig } from '@/domain/geometry/arrayEngine'
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

function circle(gid: string, center: Point, radius: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center, radius }
}

function polyline(gid: string, points: Point[], closed = false): Geometry {
  return { ...base, id: id(gid), type: 'polyline', points, closed }
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

describe('applyArray（直線配列）', () => {
  it('count=3 は複製2個（元図形は含まない）を連番idで生成する', () => {
    const config: ArrayConfig = { kind: 'linear', count: 3, dx: 10, dy: 0 }
    const result = applyArray([line('a', { x: 0, y: 0 }, { x: 1, y: 0 })], config, seqContext())
    expect(result).toEqual([
      withGenIdentity(line('gen-1', { x: 10, y: 0 }, { x: 11, y: 0 }), 'gen-1'),
      withGenIdentity(line('gen-2', { x: 20, y: 0 }, { x: 21, y: 0 }), 'gen-2'),
    ])
  })

  it('count=2 は複製1個', () => {
    const config: ArrayConfig = { kind: 'linear', count: 2, dx: 5, dy: 5 }
    const result = applyArray([line('a', { x: 0, y: 0 }, { x: 1, y: 1 })], config, seqContext())
    expect(result).toEqual([withGenIdentity(line('gen-1', { x: 5, y: 5 }, { x: 6, y: 6 }), 'gen-1')])
  })

  it('circle は中心を平行移動する', () => {
    const config: ArrayConfig = { kind: 'linear', count: 2, dx: 100, dy: 50 }
    const result = applyArray([circle('c', { x: 0, y: 0 }, 5)], config, seqContext())
    expect(result).toEqual([withGenIdentity(circle('gen-1', { x: 100, y: 50 }, 5), 'gen-1')])
  })

  it('複製図形は layerId/style/locked/constructionStepIds を維持する', () => {
    const config: ArrayConfig = { kind: 'linear', count: 2, dx: 10, dy: 0 }
    const [copy] = applyArray([line('a', { x: 0, y: 0 }, { x: 1, y: 0 })], config, seqContext())
    expect(copy?.layerId).toBe('layer-1')
    expect(copy?.style).toEqual(style)
    expect(copy?.locked).toBe(false)
    expect(copy?.constructionStepIds).toEqual([])
    expect(copy?.id).toBe('gen-1')
    expect(copy?.createdAt).toBe(GEN_TIME)
  })
})

describe('applyArray（矩形配列）', () => {
  it('rows=2, cols=2 は原点セルを除く3セルを (col*c, row*r) で複製する', () => {
    const config: ArrayConfig = { kind: 'rect', rows: 2, cols: 2, rowSpacing: 100, colSpacing: 50 }
    const result = applyArray([polyline('p', [{ x: 0, y: 0 }])], config, seqContext())
    // 走査順: (r0,c1)=(50,0), (r1,c0)=(0,100), (r1,c1)=(50,100)
    expect(result).toEqual([
      withGenIdentity(polyline('gen-1', [{ x: 50, y: 0 }]), 'gen-1'),
      withGenIdentity(polyline('gen-2', [{ x: 0, y: 100 }]), 'gen-2'),
      withGenIdentity(polyline('gen-3', [{ x: 50, y: 100 }]), 'gen-3'),
    ])
  })
})

describe('applyArray（対象外・境界）', () => {
  it('空配列は空配列を返す', () => {
    expect(applyArray([], { kind: 'linear', count: 3, dx: 10, dy: 0 })).toEqual([])
  })

  it('parametricObject は複写対象外として除外され、id連番も消費しない', () => {
    const config: ArrayConfig = { kind: 'linear', count: 2, dx: 10, dy: 0 }
    const result = applyArray(
      [line('a', { x: 0, y: 0 }, { x: 1, y: 0 }), parametric('p1')],
      config,
      seqContext(),
    )
    // parametric は早期除外され gen-2 を消費しない → line 複製のみ gen-1
    expect(result).toEqual([withGenIdentity(line('gen-1', { x: 10, y: 0 }, { x: 11, y: 0 }), 'gen-1')])
  })
})

describe('validateArrayConfig', () => {
  it('linear count<2 は ARRAY_COUNT_TOO_SMALL', () => {
    expect(validateArrayConfig({ kind: 'linear', count: 1, dx: 10, dy: 0 })).toEqual({
      code: 'ARRAY_COUNT_TOO_SMALL',
      severity: 'error',
      field: 'count',
      message: '複写数は 2 以上を指定してください',
    })
  })

  it('linear で dx=dy=0 は ARRAY_LINEAR_ZERO_OFFSET', () => {
    expect(validateArrayConfig({ kind: 'linear', count: 3, dx: 0, dy: 0 })?.code).toBe('ARRAY_LINEAR_ZERO_OFFSET')
  })

  it('rect rows<1 は ARRAY_RECT_DIMENSION_TOO_SMALL', () => {
    expect(validateArrayConfig({ kind: 'rect', rows: 0, cols: 2, rowSpacing: 10, colSpacing: 10 })?.code).toBe(
      'ARRAY_RECT_DIMENSION_TOO_SMALL',
    )
  })

  it('rect が単一セル(1x1)は ARRAY_RECT_SINGLE_CELL', () => {
    expect(validateArrayConfig({ kind: 'rect', rows: 1, cols: 1, rowSpacing: 10, colSpacing: 10 })?.code).toBe(
      'ARRAY_RECT_SINGLE_CELL',
    )
  })

  it('rect で行間隔0かつ複数行は ARRAY_RECT_ZERO_ROW_SPACING', () => {
    expect(validateArrayConfig({ kind: 'rect', rows: 2, cols: 1, rowSpacing: 0, colSpacing: 10 })?.code).toBe(
      'ARRAY_RECT_ZERO_ROW_SPACING',
    )
  })

  it('妥当な linear / rect 設定は null', () => {
    expect(validateArrayConfig({ kind: 'linear', count: 3, dx: 10, dy: 0 })).toBeNull()
    expect(validateArrayConfig({ kind: 'rect', rows: 2, cols: 2, rowSpacing: 10, colSpacing: 10 })).toBeNull()
  })
})

// QAカバレッジ補強: 既存テスト未到達の図形種別（rectangle/text/symbol/hatch）の平行移動と、
// 列間隔0の検証経路（ARRAY_RECT_ZERO_COL_SPACING）を検証する。
describe('applyArray / 追加カバレッジ（rectangle・text・symbol・hatch 平行移動）', () => {
  it('rectangle は origin を平行移動する（width/height は不変）', () => {
    const config: ArrayConfig = { kind: 'linear', count: 2, dx: 10, dy: 5 }
    const rect: Geometry = {
      ...base, id: id('r'), type: 'rectangle',
      origin: { x: 1, y: 2 }, width: 10, height: 20, rotationDeg: 0,
    }
    const moved: Geometry = {
      ...base, id: id('r'), type: 'rectangle',
      origin: { x: 11, y: 7 }, width: 10, height: 20, rotationDeg: 0,
    }
    expect(applyArray([rect], config, seqContext())).toEqual([withGenIdentity(moved, 'gen-1')])
  })

  it('text は anchor を、symbol は position をそれぞれ平行移動する', () => {
    const config: ArrayConfig = { kind: 'linear', count: 2, dx: 100, dy: 0 }
    const text: Geometry = {
      ...base, id: id('t'), type: 'text',
      anchor: { x: 5, y: 5 }, text: 'A', height: 3, rotationDeg: 0, horizontalAlign: 'left',
    }
    const symbol: Geometry = {
      ...base, id: id('s'), type: 'symbol',
      symbolId: 'cone', position: { x: 0, y: 0 }, rotationDeg: 0, scale: 1,
    }
    const movedText: Geometry = {
      ...base, id: id('t'), type: 'text',
      anchor: { x: 105, y: 5 }, text: 'A', height: 3, rotationDeg: 0, horizontalAlign: 'left',
    }
    const movedSymbol: Geometry = {
      ...base, id: id('s'), type: 'symbol',
      symbolId: 'cone', position: { x: 100, y: 0 }, rotationDeg: 0, scale: 1,
    }
    expect(applyArray([text, symbol], config, seqContext())).toEqual([
      withGenIdentity(movedText, 'gen-1'),
      withGenIdentity(movedSymbol, 'gen-2'),
    ])
  })

  it('hatch は boundaryPoints を平行移動する', () => {
    const config: ArrayConfig = { kind: 'linear', count: 2, dx: 10, dy: 10 }
    const hatch: Geometry = {
      ...base, id: id('h'), type: 'hatch',
      boundaryPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      pattern: 'concrete', angleDeg: 0, spacing: 5,
    }
    const moved: Geometry = {
      ...base, id: id('h'), type: 'hatch',
      boundaryPoints: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }],
      pattern: 'concrete', angleDeg: 0, spacing: 5,
    }
    expect(applyArray([hatch], config, seqContext())).toEqual([withGenIdentity(moved, 'gen-1')])
  })
})

describe('validateArrayConfig / 追加カバレッジ（列間隔0）', () => {
  it('rect で列間隔0かつ複数列は ARRAY_RECT_ZERO_COL_SPACING', () => {
    expect(
      validateArrayConfig({ kind: 'rect', rows: 1, cols: 2, rowSpacing: 10, colSpacing: 0 })?.code,
    ).toBe('ARRAY_RECT_ZERO_COL_SPACING')
  })
})

import { describe, expect, it } from 'vitest'
import {
  computeDimOffset,
  generateAutoDimensions,
  resolveDimOrientation,
  type AutoDimConfig,
} from '@/domain/geometry/dimensionEngine'
import type {
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
} from '@/shared/types'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'

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

/** 決定的な連番ID・固定タイムスタンプを注入するコンテキスト（ADR-0013）。 */
function seqContext(): GeometryCreationContext {
  let n = 0
  return {
    newId: () => `dim-${++n}` as GeometryId,
    now: () => '2026-07-15T00:00:00.000Z',
  }
}

const config: AutoDimConfig = { layerId: 'layer-1' as LayerId, style }

describe('resolveDimOrientation', () => {
  it("'auto'は横長（|dx|>=|dy|）でhorizontal", () => {
    expect(resolveDimOrientation('auto', { x: 0, y: 0 }, { x: 10, y: 3 })).toBe('horizontal')
  })

  it("'auto'は縦長（|dx|<|dy|）でvertical", () => {
    expect(resolveDimOrientation('auto', { x: 0, y: 0 }, { x: 3, y: 10 })).toBe('vertical')
  })

  it("'auto'は|dx|==|dy|の境界でhorizontal（>=判定）", () => {
    expect(resolveDimOrientation('auto', { x: 0, y: 0 }, { x: 5, y: 5 })).toBe('horizontal')
  })

  it('明示モードはそのまま返す', () => {
    const p = { x: 0, y: 0 }
    const q = { x: 10, y: 1 }
    expect(resolveDimOrientation('vertical', p, q)).toBe('vertical')
    expect(resolveDimOrientation('parallel', p, q)).toBe('parallel')
    expect(resolveDimOrientation('horizontal', p, q)).toBe('horizontal')
  })
})

describe('computeDimOffset', () => {
  it('horizontalはstart.y - mouse.y', () => {
    expect(computeDimOffset('horizontal', { x: 0, y: 100 }, { x: 50, y: 100 }, { x: 25, y: 70 })).toBe(30)
  })

  it('verticalはstart.x - mouse.x', () => {
    expect(computeDimOffset('vertical', { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 70, y: 25 })).toBe(30)
  })

  it('parallelは線分への符号付き垂直距離（90°反時計回り法線との内積）', () => {
    // start(0,0)-end(10,0) の90°CCW法線は (0,1)。mouse(5,4) → 内積 = 4
    expect(computeDimOffset('parallel', { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 4 })).toBeCloseTo(4)
    // 反対側 mouse(5,-4) → -4
    expect(computeDimOffset('parallel', { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -4 })).toBeCloseTo(-4)
  })

  it('parallelでstart≈end（長さ0）は0を返す', () => {
    expect(computeDimOffset('parallel', { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 })).toBe(0)
  })
})

describe('generateAutoDimensions', () => {
  it('幅・高さ両方ありで水平・垂直の2本を決定的に生成する', () => {
    const shapes = [line('a', 0, 0, 100, 0), line('b', 0, 0, 0, 40)]
    const dims = generateAutoDimensions(shapes, config, seqContext())
    expect(dims).toHaveLength(2)

    const [h, v] = dims
    expect(h?.id).toBe('dim-1')
    expect(h?.orientation).toBe('horizontal')
    expect(h?.start).toEqual({ x: 0, y: 0 })
    expect(h?.end).toEqual({ x: 100, y: 0 })
    expect(h?.createdAt).toBe('2026-07-15T00:00:00.000Z')
    expect(h?.updatedAt).toBe('2026-07-15T00:00:00.000Z')
    expect(h?.layerId).toBe('layer-1')

    expect(v?.id).toBe('dim-2')
    expect(v?.orientation).toBe('vertical')
    expect(v?.start).toEqual({ x: 0, y: 0 })
    expect(v?.end).toEqual({ x: 0, y: 40 })
  })

  it('デフォルト値（offset=20/textHeight=12/arrowSize=8）を適用する', () => {
    const dims = generateAutoDimensions([line('a', 0, 0, 100, 40)], config, seqContext())
    expect(dims[0]?.offset).toBe(20)
    expect(dims[0]?.textHeight).toBe(12)
    expect(dims[0]?.arrowSize).toBe(8)
  })

  it('config指定値でデフォルトを上書きする', () => {
    const custom: AutoDimConfig = {
      layerId: 'layer-1' as LayerId,
      style,
      offset: 5,
      textHeight: 3,
      arrowSize: 2,
    }
    const dims = generateAutoDimensions([line('a', 0, 0, 100, 40)], custom, seqContext())
    expect(dims[0]?.offset).toBe(5)
    expect(dims[0]?.textHeight).toBe(3)
    expect(dims[0]?.arrowSize).toBe(2)
  })

  it('空配列はBBox=nullで空を返す', () => {
    expect(generateAutoDimensions([], config, seqContext())).toEqual([])
  })

  it('高さがつぶれた（水平のみ）図形は水平寸法1本のみ', () => {
    const dims = generateAutoDimensions([line('a', 0, 5, 100, 5)], config, seqContext())
    expect(dims).toHaveLength(1)
    expect(dims[0]?.orientation).toBe('horizontal')
  })

  it('幅がつぶれた（垂直のみ）図形は垂直寸法1本のみ', () => {
    const dims = generateAutoDimensions([line('a', 5, 0, 5, 100)], config, seqContext())
    expect(dims).toHaveLength(1)
    expect(dims[0]?.orientation).toBe('vertical')
  })

  it('BBox計算不可の図形（parametricObject）のみは空を返す', () => {
    expect(generateAutoDimensions([parametric('p1')], config, seqContext())).toEqual([])
  })

  it('ctx省略時はdefaultCreationContextでUUID的なidが付与される', () => {
    const dims = generateAutoDimensions([line('a', 0, 0, 100, 40)], config)
    expect(dims).toHaveLength(2)
    expect(typeof dims[0]?.id).toBe('string')
    expect(dims[0]?.id).not.toBe('')
    expect(dims[0]?.id).not.toBe(dims[1]?.id)
  })
})

import { describe, expect, it } from 'vitest'
import type { GeometryId, GeometryStyle, LayerId } from '@/shared/types'
import type { GenerationContext } from '@/domain/parametric/generationContext'
import {
  barricadeLineDefinition,
  craneWorkingSectorDefinition,
  heavyMachineRadiusDefinition,
  slopePatternDefinition,
  steelPlateArrayDefinition,
  temporaryFenceDefinition,
  trafficRouteDefinition,
} from '@/domain/parametric'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const GEN_TIME = '2026-07-15T00:00:00.000Z'
const LAYER = 'layer-1' as LayerId

/** 決定的コンテキスト: 連番 ID（pm-1, pm-2, ...）・固定タイムスタンプ・固定レイヤ/スタイル。 */
function seqContext(): GenerationContext {
  let n = 0
  return {
    newId: () => `pm-${++n}` as GeometryId,
    now: () => GEN_TIME,
    layerId: LAYER,
    style,
  }
}

describe('heavy-machine-radius', () => {
  it('円・塗り・注記を生成し注記へ免責を含める', () => {
    const geometries = heavyMachineRadiusDefinition.generate(
      { center: { x: 0, y: 0 }, radius: 4000, machineName: 'バックホウ' },
      seqContext(),
    )
    expect(geometries).toHaveLength(3)
    expect(geometries.map((g) => g.type)).toEqual(['circle', 'hatch', 'text'])

    const [circle, hatch, text] = geometries
    expect(circle).toMatchObject({ type: 'circle', center: { x: 0, y: 0 }, radius: 4000 })
    expect(hatch).toMatchObject({ type: 'hatch', pattern: 'parallel', spacing: 500 })
    expect(text).toMatchObject({ type: 'text', anchor: { x: 0, y: -4200 } })
    if (text?.type === 'text') {
      expect(text.text).toContain('※能力判定なし')
      expect(text.text).toContain('R=4000')
    }
    // 全図形へ ctx の帰属・監査が注入される
    for (const g of geometries) {
      expect(g.layerId).toBe(LAYER)
      expect(g.createdAt).toBe(GEN_TIME)
      expect(g.style).toEqual(style)
    }
  })

  it('旋回半径 0 以下は PARAM_RANGE エラー', () => {
    const issues = heavyMachineRadiusDefinition.validate({
      center: { x: 0, y: 0 },
      radius: -100,
      machineName: 'x',
    })
    expect(issues.some((i) => i.code === 'PARAM_RANGE' && i.field === 'radius')).toBe(true)
  })

  it('必須パラメータ欠落は PARAM_REQUIRED エラー', () => {
    const issues = heavyMachineRadiusDefinition.validate({ radius: 4000 })
    expect(issues.some((i) => i.code === 'PARAM_REQUIRED' && i.field === 'center')).toBe(true)
    expect(issues.some((i) => i.code === 'PARAM_REQUIRED' && i.field === 'machineName')).toBe(true)
  })
})

describe('crane-working-sector', () => {
  it('内半径ありは外弧・内弧・半径線2本・注記の5図形', () => {
    const geometries = craneWorkingSectorDefinition.generate(
      { center: { x: 0, y: 0 }, minRadius: 2000, maxRadius: 8000, startAngleDeg: -60, endAngleDeg: 60 },
      seqContext(),
    )
    expect(geometries).toHaveLength(5)
    expect(geometries.map((g) => g.type)).toEqual(['arc', 'arc', 'line', 'line', 'text'])
    const [outer] = geometries
    expect(outer).toMatchObject({ type: 'arc', radius: 8000, startAngleDeg: -60, endAngleDeg: 60 })
  })

  it('内半径0は内弧を省き4図形（半径線は中心起点）', () => {
    const geometries = craneWorkingSectorDefinition.generate(
      { center: { x: 0, y: 0 }, minRadius: 0, maxRadius: 8000, startAngleDeg: -60, endAngleDeg: 60 },
      seqContext(),
    )
    expect(geometries).toHaveLength(4)
    expect(geometries.map((g) => g.type)).toEqual(['arc', 'line', 'line', 'text'])
    const line = geometries[1]
    if (line?.type === 'line') expect(line.start).toEqual({ x: 0, y: 0 })
  })

  it('最大半径 <= 最小半径は CRANE_RADIUS_ORDER エラー', () => {
    const issues = craneWorkingSectorDefinition.validate({
      center: { x: 0, y: 0 },
      minRadius: 5000,
      maxRadius: 5000,
      startAngleDeg: 0,
      endAngleDeg: 90,
    })
    expect(issues.some((i) => i.code === 'CRANE_RADIUS_ORDER')).toBe(true)
  })
})

describe('steel-plate-array', () => {
  it('rows×cols の矩形を間隔付きで配置する', () => {
    const geometries = steelPlateArrayDefinition.generate(
      { origin: { x: 0, y: 0 }, plateWidth: 1000, plateLength: 2000, rows: 2, cols: 3, gap: 100 },
      seqContext(),
    )
    expect(geometries).toHaveLength(6)
    expect(geometries.every((g) => g.type === 'rectangle')).toBe(true)
    expect(geometries[0]).toMatchObject({ origin: { x: 0, y: 0 }, width: 1000, height: 2000 })
    // 2列目 = x:1000+100、2行目 = y:2000+100
    expect(geometries[1]).toMatchObject({ origin: { x: 1100, y: 0 } })
    expect(geometries[3]).toMatchObject({ origin: { x: 0, y: 2100 } })
  })

  it('行数0は PARAM_RANGE エラー', () => {
    const issues = steelPlateArrayDefinition.validate({
      origin: { x: 0, y: 0 },
      plateWidth: 1000,
      plateLength: 2000,
      rows: 0,
      cols: 3,
    })
    expect(issues.some((i) => i.code === 'PARAM_RANGE' && i.field === 'rows')).toBe(true)
  })
})

describe('temporary-fence', () => {
  it('フェンス線1本と支柱記号を生成する', () => {
    const geometries = temporaryFenceDefinition.generate(
      { path: [{ x: 0, y: 0 }, { x: 10000, y: 0 }], height: 3000, postSpacing: 2000 },
      seqContext(),
    )
    // polyline 1 + 支柱 6（0,2000,...,10000）
    expect(geometries).toHaveLength(7)
    expect(geometries[0]?.type).toBe('polyline')
    expect(geometries.slice(1).every((g) => g.type === 'symbol')).toBe(true)
  })

  it('支柱間隔0は PARAM_RANGE エラー', () => {
    const issues = temporaryFenceDefinition.validate({
      path: [{ x: 0, y: 0 }, { x: 10000, y: 0 }],
      height: 3000,
      postSpacing: 0,
    })
    expect(issues.some((i) => i.code === 'PARAM_RANGE' && i.field === 'postSpacing')).toBe(true)
  })
})

describe('barricade-line', () => {
  it('経路に沿ったバリケード記号列を生成する', () => {
    const geometries = barricadeLineDefinition.generate(
      { path: [{ x: 0, y: 0 }, { x: 6000, y: 0 }], spacing: 1500 },
      seqContext(),
    )
    // 0,1500,3000,4500,6000 = 5 記号
    expect(geometries).toHaveLength(5)
    expect(geometries.every((g) => g.type === 'symbol')).toBe(true)
  })

  it('頂点1点の経路は pointList 型エラー', () => {
    const issues = barricadeLineDefinition.validate({ path: [{ x: 0, y: 0 }], spacing: 1500 })
    expect(issues.some((i) => i.field === 'path')).toBe(true)
  })
})

describe('slope-pattern', () => {
  it('斜面線・法面記号・注記を生成する', () => {
    const geometries = slopePatternDefinition.generate(
      { crest: { x: 0, y: 0 }, toe: { x: 3000, y: 4000 }, slopeRatio: '1:0.5', symbolSpacing: 1000 },
      seqContext(),
    )
    // polyline 1 + 記号（爪）6（長さ5000を1000刻み+終点） + 注記1 = 8
    expect(geometries).toHaveLength(8)
    expect(geometries[0]?.type).toBe('polyline')
    const text = geometries[geometries.length - 1]
    expect(text?.type).toBe('text')
    if (text?.type === 'text') expect(text.text).toBe('1:0.5')
  })

  it('法肩と法尻が同一点は SLOPE_ZERO_LENGTH エラー', () => {
    const issues = slopePatternDefinition.validate({
      crest: { x: 100, y: 100 },
      toe: { x: 100, y: 100 },
      slopeRatio: '1:0.5',
      symbolSpacing: 1000,
    })
    expect(issues.some((i) => i.code === 'SLOPE_ZERO_LENGTH')).toBe(true)
  })

  it('勾配表記不正は slopeRatio 検証エラー', () => {
    const issues = slopePatternDefinition.validate({
      crest: { x: 0, y: 0 },
      toe: { x: 3000, y: 4000 },
      slopeRatio: 'abc',
      symbolSpacing: 1000,
    })
    expect(issues.some((i) => i.field === 'slopeRatio' && i.severity === 'error')).toBe(true)
  })
})

describe('traffic-route', () => {
  it('両縁ポリライン2本と方向矢印を生成する', () => {
    const geometries = trafficRouteDefinition.generate(
      { path: [{ x: 0, y: 0 }, { x: 12000, y: 0 }], width: 4000, arrowSpacing: 3000 },
      seqContext(),
    )
    // 両縁2 + 矢印5（0,3000,6000,9000,12000）
    expect(geometries).toHaveLength(7)
    expect(geometries[0]?.type).toBe('polyline')
    expect(geometries[1]?.type).toBe('polyline')
    const left = geometries[0]
    if (left?.type === 'polyline') {
      expect(left.points).toEqual([
        { x: 0, y: 2000 },
        { x: 12000, y: 2000 },
      ])
    }
    expect(geometries.slice(2).every((g) => g.type === 'symbol')).toBe(true)
  })
})

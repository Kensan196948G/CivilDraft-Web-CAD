import { describe, expect, it } from 'vitest'
import { filletLines } from '@/domain/geometry/filletEngine'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type {
  ConstructionStepId,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  LineGeometry,
} from '@/shared/types'

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

function line(
  gid: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  overrides: Partial<GeometryBase> = {},
): LineGeometry {
  return {
    ...base,
    ...overrides,
    id: id(gid),
    type: 'line',
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
  }
}

/** 決定的コンテキスト: 連番ID・固定タイムスタンプ（ADR-0013）。 */
function detCtx(): GeometryCreationContext {
  let seq = 0
  return {
    newId: () => `fillet-${++seq}` as GeometryId,
    now: () => '2026-07-15T12:00:00.000Z',
  }
}

describe('filletLines / 正常系', () => {
  it('直角L字コーナーを半径rで丸め、後退線分と接円弧を返す', () => {
    const line1 = line('L1', 0, 0, 10, 0)
    const line2 = line('L2', 0, 0, 0, 10)
    const result = filletLines(line1, line2, 2, detCtx())

    expect(result).not.toBeNull()
    if (!result) return

    // トリム後: corner側(start)が (2,0)/(0,2) へ後退、away側の端点は不変
    expect(result.line1.start.x).toBeCloseTo(2)
    expect(result.line1.start.y).toBeCloseTo(0)
    expect(result.line1.end).toEqual({ x: 10, y: 0 })
    expect(result.line2.start.x).toBeCloseTo(0)
    expect(result.line2.start.y).toBeCloseTo(2)
    expect(result.line2.end).toEqual({ x: 0, y: 10 })

    // 接円弧: 両軸に接する中心(2,2)・半径2
    expect(result.arc.type).toBe('arc')
    expect(result.arc.center.x).toBeCloseTo(2)
    expect(result.arc.center.y).toBeCloseTo(2)
    expect(result.arc.radius).toBeCloseTo(2)
  })

  it('円弧角度はラジアンではなく度数法で格納され、小さい弧（≤180°掃引）になる（ADR-0012・Issue #23）', () => {
    const result = filletLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    // atan2 の端点順は (-90°, 180°) だが正方向掃引は 270° になるため、
    // フィレット弧（90°）を表すよう入れ替えられ (180°, -90°) になる。
    expect(result.arc.startAngleDeg).toBeCloseTo(180)
    expect(result.arc.endAngleDeg).toBeCloseTo(-90)
    const sweep = ((result.arc.endAngleDeg - result.arc.startAngleDeg + 360) % 360) || 360
    expect(sweep).toBeCloseTo(90)
  })

  it('端点が逆順格納（corner=end側）でもend側を正しくトリムする', () => {
    // line1: start=(10,0), end=(0,0) → cornerは end 側
    const result = filletLines(line('L1', 10, 0, 0, 0), line('L2', 0, 0, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.line1.start).toEqual({ x: 10, y: 0 })
    expect(result.line1.end.x).toBeCloseTo(2)
    expect(result.line1.end.y).toBeCloseTo(0)
  })
})

describe('filletLines / 属性継承・コンテキスト注入', () => {
  it('新規arcのbase属性(layerId/style/constructionStepIds/locked)をline1から継承する', () => {
    const line1 = line('L1', 0, 0, 10, 0, {
      layerId: 'layer-fillet' as LayerId,
      constructionStepIds: ['step-9' as ConstructionStepId],
      locked: true,
    })
    const line2 = line('L2', 0, 0, 0, 10)
    const result = filletLines(line1, line2, 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.arc.layerId).toBe('layer-fillet')
    expect(result.arc.style).toBe(style)
    expect(result.arc.constructionStepIds).toEqual(['step-9'])
    expect(result.arc.locked).toBe(true)
  })

  it('arcのid/createdAt/updatedAtは注入コンテキストから採番される', () => {
    const result = filletLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.arc.id).toBe('fillet-1')
    expect(result.arc.createdAt).toBe('2026-07-15T12:00:00.000Z')
    expect(result.arc.updatedAt).toBe('2026-07-15T12:00:00.000Z')
  })

  it('トリムされた線分はidを維持しupdatedAtをctx.now()で更新する', () => {
    const result = filletLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.line1.id).toBe('L1')
    expect(result.line1.createdAt).toBe('2026-07-15T00:00:00.000Z')
    expect(result.line1.updatedAt).toBe('2026-07-15T12:00:00.000Z')
  })

  it('コンテキスト省略時は既定コンテキストでUUID形式のidを発番する', () => {
    const result = filletLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 2)
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.arc.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('filletLines / 境界・失敗', () => {
  it('平行な2線分はnullを返す', () => {
    const result = filletLines(line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5), 2, detCtx())
    expect(result).toBeNull()
  })

  it('半径が0以下のときnullを返す', () => {
    expect(filletLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 0, detCtx())).toBeNull()
    expect(filletLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), -3, detCtx())).toBeNull()
  })

  it('半径が過大で後退量が線分長を超えるときnullを返す', () => {
    // 直角: retreatDist = radius。線分長3に対し radius=10 は後退不能。
    const result = filletLines(line('L1', 0, 0, 3, 0), line('L2', 0, 0, 0, 3), 10, detCtx())
    expect(result).toBeNull()
  })
})

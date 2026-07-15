import { describe, expect, it } from 'vitest'
import { chamferLines } from '@/domain/geometry/chamferEngine'
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
    newId: () => `chamfer-${++seq}` as GeometryId,
    now: () => '2026-07-15T12:00:00.000Z',
  }
}

describe('chamferLines / 正常系', () => {
  it('直角L字コーナーをdistで面取りし、後退線分と面取り線を返す', () => {
    const line1 = line('L1', 0, 0, 10, 0)
    const line2 = line('L2', 0, 0, 0, 10)
    const result = chamferLines(line1, line2, 2, detCtx())

    expect(result).not.toBeNull()
    if (!result) return

    // トリム後: corner側(start)が (2,0)/(0,2) へ後退
    expect(result.line1.start.x).toBeCloseTo(2)
    expect(result.line1.start.y).toBeCloseTo(0)
    expect(result.line1.end).toEqual({ x: 10, y: 0 })
    expect(result.line2.start.x).toBeCloseTo(0)
    expect(result.line2.start.y).toBeCloseTo(2)
    expect(result.line2.end).toEqual({ x: 0, y: 10 })

    // 面取り線: (2,0)-(0,2) を結ぶ新規線分
    expect(result.chamferLine.type).toBe('line')
    expect(result.chamferLine.start.x).toBeCloseTo(2)
    expect(result.chamferLine.start.y).toBeCloseTo(0)
    expect(result.chamferLine.end.x).toBeCloseTo(0)
    expect(result.chamferLine.end.y).toBeCloseTo(2)
  })

  it('端点が逆順格納（corner=end側）でもend側を正しくトリムする', () => {
    // line1: start=(10,0), end=(0,0) → cornerは end 側
    const result = chamferLines(line('L1', 10, 0, 0, 0), line('L2', 0, 0, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.line1.start).toEqual({ x: 10, y: 0 })
    expect(result.line1.end.x).toBeCloseTo(2)
    expect(result.line1.end.y).toBeCloseTo(0)
  })

  it('延長を要するコーナー（線分が交点まで届かない）でも面取りできる', () => {
    // line1: (0,0)-(4,0), line2: (0,4)-(0,10)。交点(0,0)へline2を延長して面取り。
    const result = chamferLines(line('L1', 0, 0, 4, 0), line('L2', 0, 4, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    // line2のcorner側端点(0,4)はcornerから距離4。dist=2で(0,2)へ後退。
    expect(result.line2.start.x).toBeCloseTo(0)
    expect(result.line2.start.y).toBeCloseTo(2)
  })
})

describe('chamferLines / 属性継承・コンテキスト注入', () => {
  it('新規chamferLineのbase属性(layerId/style/constructionStepIds/locked)をline1から継承する', () => {
    const line1 = line('L1', 0, 0, 10, 0, {
      layerId: 'layer-chamfer' as LayerId,
      constructionStepIds: ['step-7' as ConstructionStepId],
      locked: true,
    })
    const result = chamferLines(line1, line('L2', 0, 0, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.chamferLine.layerId).toBe('layer-chamfer')
    expect(result.chamferLine.style).toBe(style)
    expect(result.chamferLine.constructionStepIds).toEqual(['step-7'])
    expect(result.chamferLine.locked).toBe(true)
  })

  it('chamferLineのid/createdAt/updatedAtは注入コンテキストから採番される', () => {
    const result = chamferLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.chamferLine.id).toBe('chamfer-1')
    expect(result.chamferLine.createdAt).toBe('2026-07-15T12:00:00.000Z')
    expect(result.chamferLine.updatedAt).toBe('2026-07-15T12:00:00.000Z')
  })

  it('トリムされた線分はidを維持しupdatedAtをctx.now()で更新する', () => {
    const result = chamferLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 2, detCtx())
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.line1.id).toBe('L1')
    expect(result.line1.createdAt).toBe('2026-07-15T00:00:00.000Z')
    expect(result.line1.updatedAt).toBe('2026-07-15T12:00:00.000Z')
  })

  it('コンテキスト省略時は既定コンテキストでUUID形式のidを発番する', () => {
    const result = chamferLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 2)
    expect(result).not.toBeNull()
    if (!result) return
    expect(result.chamferLine.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('chamferLines / 境界・失敗', () => {
  it('平行な2線分はnullを返す', () => {
    const result = chamferLines(line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5), 2, detCtx())
    expect(result).toBeNull()
  })

  it('distが0以下のときnullを返す', () => {
    expect(chamferLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), 0, detCtx())).toBeNull()
    expect(chamferLines(line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10), -3, detCtx())).toBeNull()
  })

  it('distが過大で後退量が線分長を超えるときnullを返す', () => {
    const result = chamferLines(line('L1', 0, 0, 3, 0), line('L2', 0, 0, 0, 3), 10, detCtx())
    expect(result).toBeNull()
  })
})

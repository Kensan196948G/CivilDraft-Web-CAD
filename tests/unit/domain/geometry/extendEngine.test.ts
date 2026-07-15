import { describe, expect, it } from 'vitest'
import { extendLine } from '@/domain/geometry/extendEngine'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type {
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  Point,
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

/** 決定的コンテキストが返す固定タイムスタンプ（baseのupdatedAtとは別値にして更新を検証する）。 */
const NOW = '2026-07-15T12:00:00.000Z'

function id(v: string): GeometryId {
  return v as GeometryId
}

function seqCtx(): GeometryCreationContext {
  let n = 0
  return { newId: () => `gen-${++n}` as GeometryId, now: () => NOW }
}

function line(gid: string, x1: number, y1: number, x2: number, y2: number): Geometry {
  return { ...base, id: id(gid), type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function rect(
  gid: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDeg = 0,
): Geometry {
  return { ...base, id: id(gid), type: 'rectangle', origin: { x, y }, width, height, rotationDeg }
}

function polyline(gid: string, points: readonly Point[], closed: boolean): Geometry {
  return { ...base, id: id(gid), type: 'polyline', points, closed }
}

function hatch(gid: string, boundaryPoints: readonly Point[]): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'hatch',
    boundaryPoints,
    pattern: 'parallel',
    angleDeg: 0,
    spacing: 10,
  }
}

describe('extendLine', () => {
  it('クリックに近い終点側を線分境界まで延長する', () => {
    const target = line('target', 0, 0, 50, 0)
    const boundary = line('b', 100, -50, 100, 50)
    const result = extendLine(target, [boundary], { x: 50, y: 0 }, seqCtx())
    // 終点のみ(100,0)へ延長。createdAtは不変、updatedAtのみNOWへ更新。IDは維持。
    expect(result).toEqual({
      ...base,
      id: id('target'),
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      updatedAt: NOW,
    })
  })

  it('クリックに近い始点側を延長する', () => {
    const target = line('target', 50, 0, 100, 0)
    const boundary = line('b', 0, -50, 0, 50)
    const result = extendLine(target, [boundary], { x: 50, y: 0 }, seqCtx())
    expect(result?.start).toEqual({ x: 0, y: 0 })
    expect(result?.end).toEqual({ x: 100, y: 0 })
  })

  it('延長方向に境界が無ければnullを返す', () => {
    const target = line('target', 0, 0, 50, 0)
    // 境界は延長方向（+x）の後方（-x）にあるため交差しない。
    const boundary = line('b', -100, -50, -100, 50)
    expect(extendLine(target, [boundary], { x: 50, y: 0 }, seqCtx())).toBeNull()
  })

  it('ターゲットが線分以外ならnullを返す（対象外図形種）', () => {
    const target = rect('target', 0, 0, 10, 10)
    const boundary = line('b', 100, -50, 100, 50)
    expect(extendLine(target, [boundary], { x: 5, y: 5 }, seqCtx())).toBeNull()
  })

  it('矩形境界（回転0）の最も近い辺まで延長する', () => {
    const target = line('target', 0, 0, 10, 0)
    const boundary = rect('b', 50, -10, 20, 20)
    const result = extendLine(target, [boundary], { x: 10, y: 0 }, seqCtx())
    // 矩形左辺 x=50 に最初に到達する。
    expect(result?.end).toEqual({ x: 50, y: 0 })
  })

  it('polyline境界のセグメントまで延長する', () => {
    const target = line('target', 0, 0, 10, 0)
    const boundary = polyline('b', [{ x: 50, y: -10 }, { x: 50, y: 10 }], false)
    const result = extendLine(target, [boundary], { x: 10, y: 0 }, seqCtx())
    expect(result?.end).toEqual({ x: 50, y: 0 })
  })

  it('hatch境界（常に閉じる）まで延長する', () => {
    const target = line('target', 0, 0, 10, 0)
    const boundary = hatch('b', [{ x: 50, y: -10 }, { x: 50, y: 10 }])
    const result = extendLine(target, [boundary], { x: 10, y: 0 }, seqCtx())
    expect(result?.end).toEqual({ x: 50, y: 0 })
  })

  it('境界がターゲット自身（同一ID）ならスキップする', () => {
    const target = line('target', 0, 0, 50, 0)
    // 同一IDの境界は無視 → 交差なしでnull。
    expect(extendLine(target, [line('target', 100, -50, 100, 50)], { x: 50, y: 0 }, seqCtx())).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { trimLine } from '@/domain/geometry/trimEngine'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type { Geometry, GeometryBase, GeometryId, GeometryStyle, LayerId } from '@/shared/types'

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

/** 決定的コンテキストが返す固定タイムスタンプ（baseのcreatedAtとは別値にして更新を検証する）。 */
const NOW = '2026-07-15T12:00:00.000Z'

function id(v: string): GeometryId {
  return v as GeometryId
}

/** 連番ID・固定タイムスタンプの決定的コンテキスト。 */
function seqCtx(): GeometryCreationContext {
  let n = 0
  return { newId: () => `gen-${++n}` as GeometryId, now: () => NOW }
}

function line(gid: string, x1: number, y1: number, x2: number, y2: number): Geometry {
  return { ...base, id: id(gid), type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function circle(gid: string, cx: number, cy: number, radius: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center: { x: cx, y: cy }, radius }
}

/** 生成された線分の期待値（createdAt/updatedAtは決定的コンテキストのNOWで上書きされる）。 */
function expectLine(gid: string, start: { x: number; y: number }, end: { x: number; y: number }): Geometry {
  return { ...base, id: id(gid), type: 'line', start, end, createdAt: NOW, updatedAt: NOW }
}

describe('trimLine', () => {
  it('クリック位置を挟む2交点で線分を2本に分割する', () => {
    const target = line('target', 0, 0, 100, 0)
    const cutters = [line('c1', 30, -10, 30, 10), line('c2', 70, -10, 70, 10)]
    const result = trimLine(target, cutters, { x: 50, y: 0 }, seqCtx())
    expect(result).toEqual([
      expectLine('gen-1', { x: 0, y: 0 }, { x: 30, y: 0 }),
      expectLine('gen-2', { x: 70, y: 0 }, { x: 100, y: 0 }),
    ])
  })

  it('クリックより後方のみ交点がある場合は前区間を除去し1本を残す', () => {
    const target = line('target', 0, 0, 100, 0)
    const cutters = [line('c1', 30, -10, 30, 10)]
    // クリックt=0.1、交点t=0.3 → クリック区間[0,0.3]を除去し[0.3,1]を残す。
    const result = trimLine(target, cutters, { x: 10, y: 0 }, seqCtx())
    expect(result).toEqual([expectLine('gen-1', { x: 30, y: 0 }, { x: 100, y: 0 })])
  })

  it('交点が無ければnullを返す（線分が範囲外）', () => {
    const target = line('target', 0, 0, 100, 0)
    const cutters = [line('c1', 200, -10, 200, 10)]
    expect(trimLine(target, cutters, { x: 50, y: 0 }, seqCtx())).toBeNull()
  })

  it('ターゲットが線分以外ならnullを返す（対象外図形種）', () => {
    const target = circle('target', 50, 0, 20)
    const cutters = [line('c1', 30, -10, 30, 10)]
    expect(trimLine(target, cutters, { x: 50, y: 0 }, seqCtx())).toBeNull()
  })

  it('切断図形がターゲット自身（同一ID）ならスキップする', () => {
    const target = line('target', 0, 0, 100, 0)
    // 同一IDの線分は自己交差として無視 → 交点なしでnull。
    expect(trimLine(target, [line('target', 50, -10, 50, 10)], { x: 50, y: 0 }, seqCtx())).toBeNull()
  })

  it('切断図形が非線分（円）ならセグメントを持たず無視する', () => {
    const target = line('target', 0, 0, 100, 0)
    expect(trimLine(target, [circle('c1', 50, 0, 30)], { x: 50, y: 0 }, seqCtx())).toBeNull()
  })

  it('元図形のlayerId/style/lockedを分割線分へ維持する', () => {
    const target = line('target', 0, 0, 100, 0)
    const cutters = [line('c1', 40, -10, 40, 10), line('c2', 60, -10, 60, 10)]
    const result = trimLine(target, cutters, { x: 50, y: 0 }, seqCtx())
    expect(result).not.toBeNull()
    for (const seg of result ?? []) {
      expect(seg.layerId).toBe('layer-1')
      expect(seg.style).toEqual(style)
      expect(seg.locked).toBe(false)
    }
  })
})

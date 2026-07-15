/**
 * GeometryIndex（rbush R-tree）の性能ベンチマーク（Issue #7 完了条件「性能劣化がないことを確認」）。
 *
 * 方針:
 * - 絶対時間ではなく「相対比」でアサートし、CI 環境の速度差に頑健にする。
 *   局所的な矩形問い合わせでは R-tree が O(log N + k)、線形走査が O(N) のため桁違いに速いはずだが、
 *   環境ゆらぎを見込んで下限を保守的に 5 倍差に置く。実測値は expect メッセージに含める（console には出さない）。
 * - 機能的健全性（index の結果 == 線形走査の結果）と、インスタンス化改修（Issue #7）で
 *   複数インスタンスが干渉しないことも合わせて検証する。
 * - performance.now() による時間計測はテスト内の決定性の例外として許容（node:perf_hooks から取得）。
 * - テスト全体が 5 秒以内に収まるよう図形数・反復数を調整している。
 */
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { GeometryIndex } from '@/domain/geometry/spatialIndex'
import { findShapesInRect, bboxIntersects } from '@/domain/geometry/selection'
import { shapeBBox, type BBox } from '@/domain/geometry/shapeBBox'
import type { CircleGeometry, Geometry, GeometryId, GeometryStyle, LayerId } from '@/shared/types'

const GRID = 100 // 100 × 100 = 10,000 図形
const COUNT = GRID * GRID
const SPACING = 10
const RADIUS = 3
const QUERY_COUNT = 200 // 相対比計測の反復回数（線形走査側が計測可能な時間になるよう設定）
const SPEEDUP_FLOOR = 5 // index が線形走査の 1/5 以下（= 5 倍以上高速）であること

const STYLE: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}
const TS = '2026-07-15T00:00:00.000Z'

function circle(id: string, cx: number, cy: number): CircleGeometry {
  return {
    id: id as GeometryId,
    layerId: 'layer-default' as LayerId,
    type: 'circle',
    style: STYLE,
    constructionStepIds: [],
    locked: false,
    createdAt: TS,
    updatedAt: TS,
    center: { x: cx, y: cy },
    radius: RADIUS,
  }
}

/** GRID×GRID のグリッド上に circle を敷き詰める。prefix でID空間、offset で座標を分離できる。 */
function buildGrid(prefix = 'c', offset = 0): Geometry[] {
  const out: Geometry[] = []
  let idx = 0
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      out.push(circle(`${prefix}-${idx++}`, i * SPACING + offset, j * SPACING + offset))
    }
  }
  return out
}

/** 小領域（約 5×5 セル）の問い合わせ矩形を、位置を散らして QUERY_COUNT 個作る。 */
function buildQueryRects(): BBox[] {
  const rects: BBox[] = []
  const span = 5 * SPACING
  for (let q = 0; q < QUERY_COUNT; q++) {
    const min = ((q * 37) % (GRID - 6)) * SPACING // 端を避けつつ位置を巡回させる
    rects.push({ minX: min, minY: min, maxX: min + span, maxY: min + span })
  }
  return rects
}

function elapsed(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

describe('GeometryIndex 性能ベンチマーク（Issue #7）', () => {
  it(`局所矩形問い合わせで index が線形走査より ${SPEEDUP_FLOOR} 倍以上高速（10,000図形×${QUERY_COUNT}問い合わせ）`, () => {
    const geometries = buildGrid()
    const index = new GeometryIndex()
    index.load(geometries)
    expect(index.size).toBe(COUNT)

    const rects = buildQueryRects()
    const sampleRect = rects[0]
    expect(sampleRect).toBeDefined()
    if (sampleRect === undefined) return

    // ウォームアップ（JIT 安定化。計測に含めない）。
    for (let w = 0; w < 5; w++) {
      findShapesInRect(geometries, sampleRect)
      index.search(sampleRect)
    }

    let linearSink = 0
    const linearTime = elapsed(() => {
      for (const rect of rects) linearSink += findShapesInRect(geometries, rect).length
    })

    let indexSink = 0
    const indexTime = elapsed(() => {
      for (const rect of rects) indexSink += index.search(rect).length
    })

    // 両者が同数ヒットしている（＝同じ仕事をしている）ことを担保。
    expect(indexSink).toBe(linearSink)
    expect(indexSink).toBeGreaterThan(0)

    const ratio = indexTime > 0 ? linearTime / indexTime : Number.POSITIVE_INFINITY
    const summary = `linear=${linearTime.toFixed(2)}ms index=${indexTime.toFixed(2)}ms speedup=${ratio.toFixed(1)}x (floor ${SPEEDUP_FLOOR}x)`
    expect(ratio, summary).toBeGreaterThanOrEqual(SPEEDUP_FLOOR)
  })

  it('10,000図形で index.search の結果が線形走査と完全一致する（Set比較・複数矩形）', () => {
    const geometries = buildGrid()
    const index = new GeometryIndex()
    index.load(geometries)

    const queries: BBox[] = [
      { minX: 0, minY: 0, maxX: 25, maxY: 25 }, // 小領域
      { minX: 300, minY: 300, maxX: 360, maxY: 360 }, // 中央付近
      { minX: -100, minY: -100, maxX: -50, maxY: -50 }, // ヒット0
      { minX: -50, minY: -50, maxX: GRID * SPACING + 50, maxY: GRID * SPACING + 50 }, // 全件
    ]

    for (const rect of queries) {
      const fromIndex = new Set(index.search(rect))
      const fromLinear = new Set(findShapesInRect(geometries, rect))
      expect(fromIndex).toEqual(fromLinear)
    }

    // 全件クエリでは索引済み全図形が返ることも確認。
    const all = index.search({ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 })
    expect(all.length).toBe(COUNT)
  })

  it('複数インスタンス（2個）が独立して load/search でき、相互に干渉しない（Issue #7）', () => {
    // ID 空間（c-/d-）と座標領域（0 起点/1000 起点）の両方を分離した別図面。
    const gridA = buildGrid('c', 0)
    const gridB = buildGrid('d', 1000)

    const indexA = new GeometryIndex()
    const indexB = new GeometryIndex()
    indexA.load(gridA)
    indexB.load(gridB)

    expect(indexA.size).toBe(COUNT)
    expect(indexB.size).toBe(COUNT)

    const rectA: BBox = { minX: 0, minY: 0, maxX: 25, maxY: 25 } // gridA の領域
    const rectB: BBox = { minX: 1000, minY: 1000, maxX: 1025, maxY: 1025 } // gridB の領域

    // それぞれが自分のデータに対して線形走査と一致する。
    const aIds = new Set(indexA.search(rectA))
    const bIds = new Set(indexB.search(rectB))
    expect(aIds).toEqual(new Set(findShapesInRect(gridA, rectA)))
    expect(bIds).toEqual(new Set(findShapesInRect(gridB, rectB)))
    expect(aIds.size).toBeGreaterThan(0)
    expect(bIds.size).toBeGreaterThan(0)

    // 非干渉: A は B の領域に何も持たず、B は A の領域に何も持たない。
    expect(indexA.search(rectB)).toEqual([])
    expect(indexB.search(rectA)).toEqual([])

    // 一方を clear しても他方は無傷。
    indexA.clear()
    expect(indexA.size).toBe(0)
    expect(indexB.size).toBe(COUNT)
    expect(new Set(indexB.search(rectB))).toEqual(bIds)
  })

  it('線形走査ベースラインの健全性（shapeBBox + bboxIntersects と findShapesInRect が整合）', () => {
    const geometries = buildGrid()
    const rect: BBox = { minX: 0, minY: 0, maxX: 25, maxY: 25 }

    const viaHelper = new Set(findShapesInRect(geometries, rect))
    const viaManual = new Set(
      geometries
        .filter((g) => {
          const bbox = shapeBBox(g)
          return bbox !== null && bboxIntersects(bbox, rect)
        })
        .map((g) => g.id),
    )
    expect(viaHelper).toEqual(viaManual)
  })
})

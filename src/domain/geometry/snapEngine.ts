/**
 * カーソル位置を近傍の図形特徴点（端点・中点・中心・交点・垂線足・接点・最近点・
 * グリッド）へ吸着させるスナップ判定エンジン。
 * 継承元: Civil-Draw src/utils/snapEngine.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - 入力型を Shape 型（フラット座標 x1/y1・平坦 number[] 頂点、14種）から、詳細設計仕様書§6の
 *   Geometry 判別共用体（Point ベース、13種、Issue #20で確定）へ全面的に置き換えた。
 * - 継承元の `cloud`・`mline` は新13種に存在しない。両者のスナップ点抽出ロジック
 *   （cloud=矩形4隅、mline=start/end）は移植対象外とした。
 * - `parametricObject` は生成図形IDへの間接参照のみで座標を直接持たない（§15）ため、
 *   スナップ点なし（空配列）とする。shapeBBox.ts が null を返す設計判断と同趣旨。
 * - 角度: 継承元 arc の `startAngle`/`endAngle` はラジアン（ADR-0012 Context が指摘した
 *   「rotation(deg) と startAngle/endAngle(rad) 混在」の後者）。新 `ArcGeometry` は
 *   `startAngleDeg`/`endAngleDeg`（度数法・公開API境界）で保持するため、三角関数へ渡す前に
 *   deg→rad 変換する（ADR-0012 決定3: 公開APIは度数法、内部計算は radian 可）。
 * - `rectangle`・`ellipse` の `rotationDeg` はスナップ点抽出で無視し、回転前（主軸整列）の
 *   特徴点を返す。継承元 Shape の rect/ellipse も rotation を未考慮であり、shapeBBox.ts の
 *   「rotationDeg を考慮せず回転前の AABB を返す」方針と一致させた。
 * - `polyline` の `closed` は継承元に無い概念。閉ポリラインでは閉じ辺（末尾頂点→先頭頂点）を
 *   セグメント・中点抽出の対象に含める（型が持つ幾何的意味への適応。§末尾の設計注記参照）。
 * - すべての図形種別 switch に `default: never` の網羅性検査を追加した（shapeBBox.ts 準拠）。
 * - 引数の図形配列を `readonly Geometry[]` とし、noUncheckedIndexedAccess 下の平坦→Point
 *   走査には undefined ガードを付した。
 *
 * Issue #24（スナップエンジン改善）での追加変更:
 * - 項目2: 許容半径 SNAP_RADIUS(10mm) 固定を、SnapOptions.toleranceMm で UI 層から注入可能化。
 *   未指定時は既定 10mm を維持（後方互換）。UI は screenLengthToDomain(px) で換算して渡す。
 * - 項目3: 楕円 `ellipse` を中心スナップ対象に追加（従来は円・円弧のみ）。楕円の4象限点は
 *   既存の endpoint 系抽出で既に対象（rotationDeg=0 前提）。回転楕円の象限点・許容差以外の
 *   回転対応は項目1（回転図形対応・描画層検証が必要）で別途扱う。
 * - いずれも追加的変更で、既存スナップ種別の優先順位・距離比較ロジックは変更していない。
 *
 * アルゴリズム本体（各特徴点の抽出・距離比較・2段階の優先順位）は継承元を忠実に踏襲している。
 */
import type { Geometry, Point } from '@/shared/types'

export type SnapType =
  | 'grid'
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'perpendicular'
  | 'tangent'
  | 'nearest'
  | 'intersection'
  | 'none'

export interface SnapResult {
  readonly point: Point
  readonly type: SnapType
}

export interface SnapOptions {
  readonly snapGrid: boolean
  readonly snapEndpoint: boolean
  readonly snapMidpoint: boolean
  readonly snapCenter: boolean
  readonly snapPerpendicular: boolean
  readonly snapTangent: boolean
  readonly snapNearest: boolean
  readonly snapIntersection: boolean
  /**
   * スナップ判定の許容半径（domain mm）。省略時は既定 SNAP_RADIUS(10mm)（後方互換）。
   * Issue #24 項目2: 画面ズームに応じた許容差の調整をUI層から注入可能にする。
   * UI層は固定ピクセル許容量を CoordinateTransformer.screenLengthToDomain(px) で
   * domain mm へ換算した値を渡す想定（ズームしても画面上の吸着感度を一定に保つ）。
   */
  readonly toleranceMm?: number
}

/**
 * スナップ判定の許容半径の既定値。継承元の値 10 をそのまま踏襲する。
 * ADR-0012 により内部座標は mm 単位のため、この値は「カーソルから 10mm 以内」を意味する。
 * Issue #24 項目2: 画面ズームに応じた許容差は本エンジンの責務外だが、SnapOptions.toleranceMm
 * で UI 層から注入可能にした。未指定時のみこの既定値を使う（後方互換）。
 */
const SNAP_RADIUS = 10

const DEG_TO_RAD = Math.PI / 180

/** 公開API境界の度数法（ADR-0012 決定3）を内部三角関数計算用の radian へ変換する。 */
function degToRad(deg: number): number {
  return deg * DEG_TO_RAD
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function snapToGrid(p: Point, gridSize: number): Point {
  return {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  }
}

/** 図形の端点（頂点・特徴的な端点）を列挙する。 */
function getEndpoints(geometry: Geometry): Point[] {
  switch (geometry.type) {
    case 'line':
      return [geometry.start, geometry.end]
    case 'rectangle': {
      // 継承元同様、rotationDeg は無視して回転前の4隅を返す（shapeBBox.ts と同一方針）。
      const { origin, width, height } = geometry
      return [
        { x: origin.x, y: origin.y },
        { x: origin.x + width, y: origin.y },
        { x: origin.x + width, y: origin.y + height },
        { x: origin.x, y: origin.y + height },
      ]
    }
    case 'circle': {
      const { center, radius } = geometry
      return [
        { x: center.x, y: center.y - radius },
        { x: center.x + radius, y: center.y },
        { x: center.x, y: center.y + radius },
        { x: center.x - radius, y: center.y },
      ]
    }
    case 'arc': {
      const { center, radius } = geometry
      const startRad = degToRad(geometry.startAngleDeg)
      const endRad = degToRad(geometry.endAngleDeg)
      return [
        { x: center.x + radius * Math.cos(startRad), y: center.y + radius * Math.sin(startRad) },
        { x: center.x + radius * Math.cos(endRad), y: center.y + radius * Math.sin(endRad) },
      ]
    }
    case 'ellipse': {
      // Issue #24 項目3: 楕円の4象限点（center±radiusX / center±radiusY）を endpoint 系
      // スナップ点として扱う。rotationDeg=0 前提で主軸整列の4点を返す（回転楕円は象限点も
      // 回転するため未対応。回転対応は項目1=回転図形対応と同時に行う）。
      const { center, radiusX, radiusY } = geometry
      return [
        { x: center.x, y: center.y - radiusY },
        { x: center.x + radiusX, y: center.y },
        { x: center.x, y: center.y + radiusY },
        { x: center.x - radiusX, y: center.y },
      ]
    }
    case 'polyline':
    case 'spline':
      // 継承元は平坦 number[] を2要素ずつ走査したが、新型は既に Point[] のため全頂点を返す。
      return [...geometry.points]
    case 'hatch':
      return [...geometry.boundaryPoints]
    case 'text':
      return [geometry.anchor]
    case 'dimension':
    case 'leader':
      // 継承元の dimension/callout/mline に相当（callout→leader、mline は新13種になく対象外）。
      return [geometry.start, geometry.end]
    case 'symbol':
      return [geometry.position]
    case 'parametricObject':
      // 生成図形IDへの間接参照のみでスナップ対象座標を持たない（§15）。
      return []
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 図形の中心点を列挙する。円・円弧・楕円（Issue #24 で追加）が対象。 */
function getCenterPoints(geometry: Geometry): Point[] {
  switch (geometry.type) {
    case 'circle':
    case 'arc':
      return [geometry.center]
    case 'ellipse':
      // Issue #24 項目3: 楕円中心をスナップ対象に追加（継承元は非対象だった）。
      // 中心座標は rotationDeg に依存しないため、回転楕円でも正しい中心を返す。
      return [geometry.center]
    case 'line':
    case 'rectangle':
    case 'polyline':
    case 'spline':
    case 'text':
    case 'dimension':
    case 'leader':
    case 'hatch':
    case 'symbol':
    case 'parametricObject':
      // 上記以外は中心スナップ対象外（継承元踏襲）。
      return []
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 図形の中点（線分の中点）を列挙する。継承元同様、直線とポリラインのみが対象。 */
function getMidpoints(geometry: Geometry): Point[] {
  switch (geometry.type) {
    case 'line':
      return [
        {
          x: (geometry.start.x + geometry.end.x) / 2,
          y: (geometry.start.y + geometry.end.y) / 2,
        },
      ]
    case 'polyline': {
      const pts = geometry.points
      const mids: Point[] = []
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        if (a === undefined || b === undefined) continue
        mids.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
      // closed は継承元に無い概念。閉ポリラインは閉じ辺（末尾→先頭）の中点も対象に含める。
      if (geometry.closed && pts.length > 1) {
        const first = pts[0]
        const last = pts[pts.length - 1]
        if (first !== undefined && last !== undefined) {
          mids.push({ x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 })
        }
      }
      return mids
    }
    case 'rectangle':
    case 'circle':
    case 'arc':
    case 'ellipse':
    case 'spline':
    case 'text':
    case 'dimension':
    case 'leader':
    case 'hatch':
    case 'symbol':
    case 'parametricObject':
      return []
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 図形を構成する線分列を返す。継承元同様、直線・矩形・ポリラインのみが対象。 */
function getSegments(geometry: Geometry): [Point, Point][] {
  switch (geometry.type) {
    case 'line':
      return [[geometry.start, geometry.end]]
    case 'rectangle': {
      // 継承元同様 rotationDeg は無視。回転前の4辺を返す。
      const { origin, width, height } = geometry
      const tl: Point = { x: origin.x, y: origin.y }
      const tr: Point = { x: origin.x + width, y: origin.y }
      const br: Point = { x: origin.x + width, y: origin.y + height }
      const bl: Point = { x: origin.x, y: origin.y + height }
      return [
        [tl, tr],
        [tr, br],
        [br, bl],
        [bl, tl],
      ]
    }
    case 'polyline': {
      const pts = geometry.points
      const segs: [Point, Point][] = []
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        if (a === undefined || b === undefined) continue
        segs.push([a, b])
      }
      // closed は継承元に無い概念。閉ポリラインは閉じ辺（末尾→先頭）も線分に含める。
      if (geometry.closed && pts.length > 1) {
        const first = pts[0]
        const last = pts[pts.length - 1]
        if (first !== undefined && last !== undefined) segs.push([last, first])
      }
      return segs
    }
    case 'circle':
    case 'arc':
    case 'ellipse':
    case 'spline':
    case 'text':
    case 'dimension':
    case 'leader':
    case 'hatch':
    case 'symbol':
    case 'parametricObject':
      // 継承元の getSegments は line/rect/polyline のみ対象（spline/hatch 等は非対象を踏襲）。
      return []
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 点 P から線分 AB への垂線の足。t ∉ [0,1] のとき（線分外）は null を返す。 */
function perpendicularFoot(p: Point, a: Point, b: Point): Point | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return null
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  if (t <= 0 || t >= 1) return null
  return { x: a.x + t * dx, y: a.y + t * dy }
}

function getPerpendicularPoints(geometry: Geometry, cursor: Point): Point[] {
  const pts: Point[] = []
  for (const [a, b] of getSegments(geometry)) {
    const foot = perpendicularFoot(cursor, a, b)
    if (foot) pts.push(foot)
  }
  return pts
}

/**
 * 点 P に最も近い線分 AB 上の点（t ∈ [0,1] にクランプ）。
 * perpendicularFoot と異なり、t が範囲外でも必ず点（最も近い端点）を返す。
 */
function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return a
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

/** 点 P に最も近い、円周上の点。 */
function nearestOnCircle(p: Point, cx: number, cy: number, r: number): Point {
  const dx = p.x - cx
  const dy = p.y - cy
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d < 1e-12) return { x: cx + r, y: cy }
  return { x: cx + (dx / d) * r, y: cy + (dy / d) * r }
}

/**
 * 点 P に最も近い、円弧上の点。P が円弧の角度範囲外に射影される場合は近い方の端点を返す。
 * startAngle/endAngle は radian（呼び出し側で degToRad 済み）。
 */
function nearestOnArc(
  p: Point,
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): Point {
  const theta = Math.atan2(p.y - cy, p.x - cx)
  const sweep = (endAngle - startAngle + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI
  const rel = (theta - startAngle + 2 * Math.PI) % (2 * Math.PI)
  if (rel <= sweep) {
    // P は円弧上に射影される
    return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) }
  }
  // 円弧の角度範囲外 — 近い方の端点を返す
  const ps: Point = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) }
  const pe: Point = { x: cx + r * Math.cos(endAngle), y: cy + r * Math.sin(endAngle) }
  const ds = (p.x - ps.x) ** 2 + (p.y - ps.y) ** 2
  const de = (p.x - pe.x) ** 2 + (p.y - pe.y) ** 2
  return ds <= de ? ps : pe
}

function getNearestPoints(geometry: Geometry, cursor: Point): Point[] {
  if (geometry.type === 'circle') {
    return [nearestOnCircle(cursor, geometry.center.x, geometry.center.y, geometry.radius)]
  }
  if (geometry.type === 'arc') {
    return [
      nearestOnArc(
        cursor,
        geometry.center.x,
        geometry.center.y,
        geometry.radius,
        degToRad(geometry.startAngleDeg),
        degToRad(geometry.endAngleDeg),
      ),
    ]
  }
  return getSegments(geometry).map((seg) => nearestOnSegment(cursor, seg[0], seg[1]))
}

/**
 * 外部の点 P から円 (cx, cy, r) への接点を求める。
 * P から引いた接線が円に接する点を最大2つ返す。P が円の内部または円周上のときは空配列。
 */
function circleTangentPoints(p: Point, cx: number, cy: number, r: number): Point[] {
  const dx = cx - p.x
  const dy = cy - p.y
  const d2 = dx * dx + dy * dy
  if (d2 <= r * r + 1e-10) return []
  const d = Math.sqrt(d2)
  const L = Math.sqrt(d2 - r * r)
  // PC と接線のなす角
  const alpha = Math.asin(r / d)
  const theta = Math.atan2(dy, dx)
  return [
    { x: p.x + L * Math.cos(theta + alpha), y: p.y + L * Math.sin(theta + alpha) },
    { x: p.x + L * Math.cos(theta - alpha), y: p.y + L * Math.sin(theta - alpha) },
  ]
}

function getTangentPoints(geometry: Geometry, cursor: Point): Point[] {
  switch (geometry.type) {
    case 'circle':
      return circleTangentPoints(cursor, geometry.center.x, geometry.center.y, geometry.radius)
    case 'arc': {
      // 円弧の角度範囲内に収まる接点のみを返す
      const { center, radius } = geometry
      const startRad = degToRad(geometry.startAngleDeg)
      const endRad = degToRad(geometry.endAngleDeg)
      const pts = circleTangentPoints(cursor, center.x, center.y, radius)
      return pts.filter((p) => {
        const angle = Math.atan2(p.y - center.y, p.x - center.x)
        // [start, start + sweep] に正規化
        const sweep = (endRad - startRad + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI
        const rel = (angle - startRad + 2 * Math.PI) % (2 * Math.PI)
        return rel <= sweep
      })
    }
    case 'line':
    case 'rectangle':
    case 'ellipse':
    case 'polyline':
    case 'spline':
    case 'text':
    case 'dimension':
    case 'leader':
    case 'hatch':
    case 'symbol':
    case 'parametricObject':
      return []
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 線分 P1P2 と P3P4 の交点。両線分の範囲内で交わるときのみ交点、それ以外は null。 */
function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-10) return null
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: p1.x + t * d1x, y: p1.y + t * d1y }
}

/**
 * カーソル位置を近傍の図形特徴点へ吸着させる。
 *
 * 継承元の2段階優先順位を踏襲する:
 * - フェーズ1（endpoint / center / midpoint / intersection）を先に評価し、いずれかがヒットした
 *   時点でそれを返す。4種は同一の bestDist を共有し、より近い点が勝つ。
 * - フェーズ1が何も見つけなかった場合のみフェーズ2（perpendicular / tangent / nearest）を評価する。
 *   3種は同一の bestDist を共有するため、同距離の場合は先に評価される種別（perpendicular >
 *   tangent > nearest）が勝つ。
 * - フェーズ2も見つからなければ、最後の手段として grid スナップを返す。
 */
export function computeSnap(
  cursor: Point,
  geometries: readonly Geometry[],
  gridSize: number,
  options: SnapOptions,
): SnapResult {
  // Issue #24 項目2: 許容半径を UI 層から注入可能に。未指定時は既定 SNAP_RADIUS を使う。
  const tolerance = options.toleranceMm ?? SNAP_RADIUS

  let best: SnapResult = { point: cursor, type: 'none' }
  let bestDist = tolerance

  if (options.snapEndpoint) {
    for (const geometry of geometries) {
      for (const ep of getEndpoints(geometry)) {
        const d = dist(cursor, ep)
        if (d < bestDist) {
          bestDist = d
          best = { point: ep, type: 'endpoint' }
        }
      }
    }
  }

  if (options.snapCenter) {
    for (const geometry of geometries) {
      for (const cp of getCenterPoints(geometry)) {
        const d = dist(cursor, cp)
        if (d < bestDist) {
          bestDist = d
          best = { point: cp, type: 'center' }
        }
      }
    }
  }

  if (options.snapMidpoint) {
    for (const geometry of geometries) {
      for (const mp of getMidpoints(geometry)) {
        const d = dist(cursor, mp)
        if (d < bestDist) {
          bestDist = d
          best = { point: mp, type: 'midpoint' }
        }
      }
    }
  }

  if (options.snapIntersection) {
    const allSegs = geometries.flatMap(getSegments)
    for (let i = 0; i < allSegs.length; i++) {
      const segA = allSegs[i]
      if (segA === undefined) continue
      for (let j = i + 1; j < allSegs.length; j++) {
        const segB = allSegs[j]
        if (segB === undefined) continue
        const ip = lineIntersection(segA[0], segA[1], segB[0], segB[1])
        if (ip) {
          const d = dist(cursor, ip)
          if (d < bestDist) {
            bestDist = d
            best = { point: ip, type: 'intersection' }
          }
        }
      }
    }
  }

  // フェーズ2はフェーズ1（endpoint/center/midpoint/intersection）が何も見つけなかった場合のみ実行。
  if (best.type !== 'none') return best

  bestDist = tolerance

  if (options.snapPerpendicular) {
    for (const geometry of geometries) {
      for (const pp of getPerpendicularPoints(geometry, cursor)) {
        const d = dist(cursor, pp)
        if (d < bestDist) {
          bestDist = d
          best = { point: pp, type: 'perpendicular' }
        }
      }
    }
  }

  if (options.snapTangent) {
    for (const geometry of geometries) {
      for (const tp of getTangentPoints(geometry, cursor)) {
        const d = dist(cursor, tp)
        if (d < bestDist) {
          bestDist = d
          best = { point: tp, type: 'tangent' }
        }
      }
    }
  }

  if (options.snapNearest) {
    for (const geometry of geometries) {
      for (const np of getNearestPoints(geometry, cursor)) {
        const d = dist(cursor, np)
        if (d < bestDist) {
          bestDist = d
          best = { point: np, type: 'nearest' }
        }
      }
    }
  }

  if (best.type !== 'none') return best

  if (options.snapGrid) {
    return { point: snapToGrid(cursor, gridSize), type: 'grid' }
  }

  return best
}

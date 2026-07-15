/**
 * パラメトリック生成で用いる図形ファクトリと幾何演算ヘルパー。
 *
 * make* は GenerationContext から帰属・監査フィールド（newIdentity）を発番し、既存 13 種
 * （詳細設計仕様書 §6）の 1 図形を組み立てる。幾何ヘルパー（pointOnCircle / circlePolygon /
 * sampleAlongPath / offsetPath）はテンプレート定義から共通利用する。角度は度数法（ADR-0012）。
 */
import type {
  ArcGeometry,
  CircleGeometry,
  HatchGeometry,
  HatchPattern,
  LineGeometry,
  Point,
  PolylineGeometry,
  RectangleGeometry,
  SymbolGeometry,
  TextGeometry,
} from '@/shared/types'
import { newIdentity, type GenerationContext } from './generationContext'

/** 注記テキストの既定文字高（world 単位 mm）。 */
export const ANNOTATION_TEXT_HEIGHT = 150

export function makeLine(ctx: GenerationContext, start: Point, end: Point): LineGeometry {
  return { ...newIdentity(ctx), type: 'line', start, end }
}

export function makePolyline(
  ctx: GenerationContext,
  points: readonly Point[],
  closed: boolean,
): PolylineGeometry {
  return { ...newIdentity(ctx), type: 'polyline', points, closed }
}

export function makeCircle(ctx: GenerationContext, center: Point, radius: number): CircleGeometry {
  return { ...newIdentity(ctx), type: 'circle', center, radius }
}

export function makeArc(
  ctx: GenerationContext,
  center: Point,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): ArcGeometry {
  return { ...newIdentity(ctx), type: 'arc', center, radius, startAngleDeg, endAngleDeg }
}

export function makeRectangle(
  ctx: GenerationContext,
  origin: Point,
  width: number,
  height: number,
  rotationDeg = 0,
): RectangleGeometry {
  return { ...newIdentity(ctx), type: 'rectangle', origin, width, height, rotationDeg }
}

export function makeHatch(
  ctx: GenerationContext,
  boundaryPoints: readonly Point[],
  pattern: HatchPattern,
  angleDeg: number,
  spacing: number,
): HatchGeometry {
  return { ...newIdentity(ctx), type: 'hatch', boundaryPoints, pattern, angleDeg, spacing }
}

export function makeSymbol(
  ctx: GenerationContext,
  symbolId: string,
  position: Point,
  rotationDeg = 0,
  scale = 1,
): SymbolGeometry {
  return { ...newIdentity(ctx), type: 'symbol', symbolId, position, rotationDeg, scale }
}

export interface TextOptions {
  readonly height?: number
  readonly rotationDeg?: number
  readonly horizontalAlign?: 'left' | 'center' | 'right'
}

export function makeText(
  ctx: GenerationContext,
  anchor: Point,
  text: string,
  options: TextOptions = {},
): TextGeometry {
  return {
    ...newIdentity(ctx),
    type: 'text',
    anchor,
    text,
    height: options.height ?? ANNOTATION_TEXT_HEIGHT,
    rotationDeg: options.rotationDeg ?? 0,
    horizontalAlign: options.horizontalAlign ?? 'left',
  }
}

/** 中心 center・半径 radius・角度 angleDeg（度）の円周上の点。 */
export function pointOnCircle(center: Point, radius: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180
  return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) }
}

/** 円を segments 分割した正多角形近似の頂点列（ハッチ境界などに利用）。 */
export function circlePolygon(center: Point, radius: number, segments = 32): Point[] {
  const points: Point[] = []
  for (let i = 0; i < segments; i++) {
    points.push(pointOnCircle(center, radius, (360 * i) / segments))
  }
  return points
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** 経路（頂点列）の総延長。 */
export function pathLength(path: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]
    const curr = path[i]
    if (prev === undefined || curr === undefined) continue
    total += distance(prev, curr)
  }
  return total
}

function segmentAngleDeg(a: Point, b: Point): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

/** 経路上の点とその点における進行方向。 */
export interface PathSample {
  readonly point: Point
  readonly angleDeg: number
}

/** 距離 d（0..総延長）にある経路上の点と、その区間の進行方向を返す。 */
function pointAtDistance(path: readonly Point[], d: number): PathSample {
  const first = path[0] ?? { x: 0, y: 0 }
  if (d <= 0) {
    const second = path[1] ?? first
    return { point: first, angleDeg: segmentAngleDeg(first, second) }
  }

  let remaining = d
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]
    const curr = path[i]
    if (prev === undefined || curr === undefined) continue
    const segLen = distance(prev, curr)
    if (segLen === 0) continue
    if (remaining <= segLen) {
      const t = remaining / segLen
      return {
        point: { x: prev.x + (curr.x - prev.x) * t, y: prev.y + (curr.y - prev.y) * t },
        angleDeg: segmentAngleDeg(prev, curr),
      }
    }
    remaining -= segLen
  }

  // d が総延長を超える場合は終点。
  const last = path[path.length - 1] ?? first
  const beforeLast = path[path.length - 2] ?? last
  return { point: last, angleDeg: segmentAngleDeg(beforeLast, last) }
}

const EPSILON = 1e-9

/**
 * 経路を spacing 間隔でサンプリングする。距離 0（始点）から spacing 刻みで採り、
 * 終点を必ず含める（記号列・支柱・矢印の配置に利用）。spacing<=0 または頂点 2 未満は [] を返す。
 */
export function sampleAlongPath(path: readonly Point[], spacing: number): PathSample[] {
  if (path.length < 2 || spacing <= 0) return []
  const total = pathLength(path)
  if (total === 0) return []

  const distances: number[] = []
  for (let d = 0; d <= total + EPSILON; d += spacing) distances.push(Math.min(d, total))

  const last = distances[distances.length - 1]
  if (last === undefined || Math.abs(last - total) > EPSILON) distances.push(total)

  return distances.map((d) => pointAtDistance(path, d))
}

/**
 * 経路を法線方向へ offset だけ平行移動した頂点列を返す（正 = 進行方向左手側）。
 * 端点は隣接 1 区間の法線、内部頂点は前後 2 区間の法線の平均を用いる簡易オフセット
 * （鋭角での自己交差は補正しない。搬入路の両縁生成など緩やかな経路を想定）。
 */
export function offsetPath(path: readonly Point[], offset: number): Point[] {
  const n = path.length
  if (n < 2) return path.map((p) => ({ ...p }))

  const leftNormal = (a: Point, b: Point): Point => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len === 0) return { x: 0, y: 0 }
    return { x: -dy / len, y: dx / len }
  }

  const result: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = path[i - 1]
    const curr = path[i]
    const next = path[i + 1]
    if (curr === undefined) continue

    let nx = 0
    let ny = 0
    if (prev !== undefined) {
      const nrm = leftNormal(prev, curr)
      nx += nrm.x
      ny += nrm.y
    }
    if (next !== undefined) {
      const nrm = leftNormal(curr, next)
      nx += nrm.x
      ny += nrm.y
    }
    const len = Math.hypot(nx, ny)
    if (len === 0) {
      result.push({ ...curr })
    } else {
      result.push({ x: curr.x + (nx / len) * offset, y: curr.y + (ny / len) * offset })
    }
  }
  return result
}

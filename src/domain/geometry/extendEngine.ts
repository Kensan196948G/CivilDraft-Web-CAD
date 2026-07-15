/**
 * 線分延長（クリック位置に近い端点を、延長方向で最初に交わる境界図形まで伸ばす）。
 * 継承元: Civil-Draw src/utils/extendEngine.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - Shape型（フラット座標）→ Geometry判別共用体（LineGeometry.start/end、RectangleGeometry.origin等）へ移植。
 * - 境界図形として扱えるのは継承元同様 line / rectangle / polyline / hatch のみ。
 *   circle/arc/ellipse等はセグメントを持たないものとして無視する。
 * - polyline/hatchの頂点列は継承元の`number[]`（x,y平坦配列）から`readonly Point[]`へ移植し、
 *   セグメント生成ループをPointペア反復へ書き換えた。
 * - 矩形の回転ピボットは継承元同様「origin（左上角）」を軸とする（Konvaの既定offsetX/Y=0挙動に一致）。
 * - 延長はターゲット線分の編集操作であり新規図形を生成しないため、IDは維持する。ただし新モデルの
 *   GeometryBaseはupdatedAtを持つため、編集を反映して`ctx.now()`でupdatedAtのみ更新する
 *   （継承元Shapeはタイムスタンプを持たなかったための追加適応。ID発番は行わない）。
 * - アルゴリズム（近い端点の判定→延長方向のレイと境界の最近接交点探索）はas_is相当で忠実に移植した。
 */
import type { Geometry, LineGeometry, Point } from '@/shared/types'
import { defaultCreationContext } from './geometryFactory'
import type { GeometryCreationContext } from './geometryFactory'

/**
 * レイ（origin + t*dir）と線分[a, b]の交差。交差するtを返す。
 * 平行、または交点がoriginの後方（t <= 0）／線分外（uが[0,1]外）ならnull。
 * 平行かつ共線の場合は、origin前方にある最近接の線分端点を返す（継承元のCodex P2対応を踏襲）。
 */
function raySegIntersect(
  origin: Point,
  dir: Point,
  a: Point,
  b: Point,
): { t: number; pt: Point } | null {
  const bax = b.x - a.x
  const bay = b.y - a.y
  // origin + t*dir = a + u*(b-a) を解く。
  const det = dir.x * -bay + bax * dir.y
  const rx = a.x - origin.x
  const ry = a.y - origin.y
  if (Math.abs(det) < 1e-10) {
    // 平行。cross(dir, a-origin)で「共線」と「単なる平行」を区別する。
    // 共線ギャップ（例: (0,0)-(50,0) を (100,0)-(120,0) 方向へ延長）はorigin前方の
    // 最近接端点をヒットさせる。
    const cross = dir.x * ry - dir.y * rx
    if (Math.abs(cross) > 1e-8) return null
    const dirLenSq = dir.x * dir.x + dir.y * dir.y
    /* v8 ignore next */ if (dirLenSq < 1e-20) return null
    const tA = (rx * dir.x + ry * dir.y) / dirLenSq
    const rbx = b.x - origin.x
    const rby = b.y - origin.y
    const tB = (rbx * dir.x + rby * dir.y) / dirLenSq
    let best = Infinity
    if (tA > 1e-6) best = Math.min(best, tA)
    if (tB > 1e-6) best = Math.min(best, tB)
    if (!isFinite(best)) return null
    return { t: best, pt: { x: origin.x + best * dir.x, y: origin.y + best * dir.y } }
  }
  const t = (-rx * bay + bax * ry) / det
  const u = (dir.x * ry - dir.y * rx) / det
  if (t <= 1e-6) return null
  if (u < -1e-6 || u > 1 + 1e-6) return null
  return { t, pt: { x: origin.x + t * dir.x, y: origin.y + t * dir.y } }
}

/** 図形から境界セグメントを取り出す。line / rectangle / polyline / hatch に対応。 */
function getBoundarySegments(geometry: Geometry): { a: Point; b: Point }[] {
  const segs: { a: Point; b: Point }[] = []
  if (geometry.type === 'line') {
    segs.push({ a: geometry.start, b: geometry.end })
  } else if (geometry.type === 'rectangle') {
    // 継承元同様、矩形はorigin（x,y）を軸に回転させる（Konva既定offsetX/Y=0の挙動に一致）。
    const { origin, width, height, rotationDeg } = geometry
    const rad = (rotationDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const rotate = (px: number, py: number): Point => ({
      x: origin.x + (px - origin.x) * cos - (py - origin.y) * sin,
      y: origin.y + (px - origin.x) * sin + (py - origin.y) * cos,
    })
    const corners: Point[] = [
      rotate(origin.x, origin.y),
      rotate(origin.x + width, origin.y),
      rotate(origin.x + width, origin.y + height),
      rotate(origin.x, origin.y + height),
    ]
    for (let i = 0; i < 4; i++) {
      const c1 = corners[i]
      const c2 = corners[(i + 1) % 4]
      if (c1 && c2) segs.push({ a: c1, b: c2 })
    }
  } else if (geometry.type === 'polyline' || geometry.type === 'hatch') {
    const pts = geometry.type === 'polyline' ? geometry.points : geometry.boundaryPoints
    for (let i = 0; i + 1 < pts.length; i++) {
      const p1 = pts[i]
      const p2 = pts[i + 1]
      if (p1 && p2) segs.push({ a: p1, b: p2 })
    }
    // hatchは常に閉じ、明示的にclosedなpolylineも最終辺（終点→始点）を追加する（継承元のCodex P2対応）。
    const isClosed = geometry.type === 'hatch' || geometry.closed
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (isClosed && pts.length >= 2 && first && last) {
      segs.push({ a: last, b: first })
    }
  }
  return segs
}

/**
 * ターゲット線分を延長し、クリック位置に近い端点を延長方向の最近接境界交点まで到達させる。
 * 戻り値: 延長後の線分。有効な交点が見つからなければnull。
 * ctx: updatedAt更新用コンテキスト（ADR-0013、省略時は既定実装。IDは変更しない）。
 */
export function extendLine(
  target: Geometry,
  boundaries: readonly Geometry[],
  clickPos: Point,
  ctx: GeometryCreationContext = defaultCreationContext,
): LineGeometry | null {
  if (target.type !== 'line') return null

  const a: Point = target.start
  const b: Point = target.end

  const dA = (clickPos.x - a.x) ** 2 + (clickPos.y - a.y) ** 2
  const dB = (clickPos.x - b.x) ** 2 + (clickPos.y - b.y) ** 2
  const extendFromB = dB < dA

  const origin = extendFromB ? b : a
  const dir: Point = extendFromB
    ? { x: b.x - a.x, y: b.y - a.y }
    : { x: a.x - b.x, y: a.y - b.y }

  const len = Math.hypot(dir.x, dir.y)
  if (len < 1e-10) return null

  let bestT = Infinity
  let bestPt: Point | null = null

  for (const boundary of boundaries) {
    if (boundary.id === target.id) continue
    for (const seg of getBoundarySegments(boundary)) {
      const result = raySegIntersect(origin, dir, seg.a, seg.b)
      if (result && result.t < bestT) {
        bestT = result.t
        bestPt = result.pt
      }
    }
  }

  if (!bestPt) return null

  const now = ctx.now()
  return extendFromB
    ? { ...target, end: bestPt, updatedAt: now }
    : { ...target, start: bestPt, updatedAt: now }
}

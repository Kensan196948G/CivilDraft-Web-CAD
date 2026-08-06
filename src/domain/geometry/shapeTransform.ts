/**
 * 図形の90°回転・鏡像変換エンジン、および選択図形の重心（キー点AABB中心）計算。
 * 継承元: Civil-Draw src/utils/shapeTransform.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - Shape型（14種・フラット座標 x1/y1 等）→ Geometry判別共用体（13種・Point構造）へ移植。
 * - cloud / mline は新13種に存在しないため対象外（本エンジンでは扱わない）。callout は
 *   LeaderGeometry（type: 'leader'）へ対応付ける。
 * - parametricObject は座標を直接持たない間接参照型（§15）のため変換対象外とし、
 *   transformShape では null を、shapeKeyPoints では空配列を返す（継承元に無い分岐）。
 *   変換は生成図形（generatedGeometryIds が指す実体）側で個別に行われる想定。
 * - 継承元は key points / points を flat number[] で扱っていたが、Point[] へ表現を変更した
 *   （min/max 集計の結果は同値。noUncheckedIndexedAccess 下の undefined ガードを避けるため）。
 * - arc は継承元では角度を rad で保持し deg 変換を挟んでいたが、新型 ArcGeometry は
 *   startAngleDeg / endAngleDeg（度数法・ADR-0012）のため deg 変換を省略し直接 applyAngle を適用する
 *   （net の角度変換は継承元と同値）。
 * - transformShape は id を保持する in-place 変換のため、createdAt/updatedAt を含む
 *   GeometryBase 全フィールドをスプレッドで維持する（新規発番=ADR-0013 の対象外。updatedAt の
 *   更新はストア/コマンド層の責務とし、本関数は純粋・決定的な座標変換に徹する）。
 *
 * 座標系: ADR-0012 に従い X 右方向・Y 下方向（canvas 系）。継承元の視覚 CW 回転式
 * (dx,dy)→(-dy,dx) をそのまま踏襲する。
 */
import type { Geometry, Point } from '@/shared/types'

export type TransformOp = 'rotateCW' | 'rotateCCW' | 'mirrorH' | 'mirrorV'

/** 点 p を基準点 (cx,cy) 回りに変換する。canvas 系（Y 下方向）での視覚 CW は (dx,dy)→(-dy,dx)。 */
function applyPoint(p: Point, cx: number, cy: number, op: TransformOp): Point {
  const dx = p.x - cx
  const dy = p.y - cy
  switch (op) {
    case 'rotateCW':
      return { x: cx - dy, y: cy + dx }
    case 'rotateCCW':
      return { x: cx + dy, y: cy - dx }
    case 'mirrorH':
      return { x: cx - dx, y: cy + dy }
    case 'mirrorV':
      return { x: cx + dx, y: cy - dy }
  }
}

/** 角度（度数法）を変換操作に応じて回す/反転する。 */
function applyAngle(angleDeg: number, op: TransformOp): number {
  switch (op) {
    case 'rotateCW':
      return angleDeg + 90
    case 'rotateCCW':
      return angleDeg - 90
    case 'mirrorH':
      return -angleDeg
    case 'mirrorV':
      return 180 - angleDeg
  }
}

/** 点列全体を同一の変換で写す。 */
function transformPointList(points: readonly Point[], cx: number, cy: number, op: TransformOp): Point[] {
  return points.map((p) => applyPoint(p, cx, cy, op))
}

/**
 * 重心計算に用いる代表点を返す。円・弧は 4 象限点、矩形・楕円は AABB 対角 2 点で近似する。
 * text/symbol は基準点 1 点のみを返すため、shapeBBox の外接矩形中心とは値が異なる
 * （継承元の shapeKeyPoints 準拠。unionBBox へ委譲せず忠実移植する）。
 */
function shapeKeyPoints(geometry: Geometry): Point[] {
  switch (geometry.type) {
    case 'line':
    case 'dimension':
    case 'leader':
      return [geometry.start, geometry.end]
    case 'ellipse':
      return [
        { x: geometry.center.x - geometry.radiusX, y: geometry.center.y - geometry.radiusY },
        { x: geometry.center.x + geometry.radiusX, y: geometry.center.y + geometry.radiusY },
      ]
    case 'rectangle':
      return [
        geometry.origin,
        { x: geometry.origin.x + geometry.width, y: geometry.origin.y + geometry.height },
      ]
    case 'circle':
    case 'arc':
      return [
        { x: geometry.center.x - geometry.radius, y: geometry.center.y },
        { x: geometry.center.x + geometry.radius, y: geometry.center.y },
        { x: geometry.center.x, y: geometry.center.y - geometry.radius },
        { x: geometry.center.x, y: geometry.center.y + geometry.radius },
      ]
    case 'polyline':
    case 'spline':
      return [...geometry.points]
    case 'hatch':
      return [...geometry.boundaryPoints]
    case 'text':
      return [geometry.anchor]
    case 'symbol':
      return [geometry.position]
    case 'parametricObject':
      return []
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * 選択図形群の重心を「代表点 AABB の中心」として求める（回転・鏡像の基準点に用いる）。
 * 代表点が 1 つも無い場合（空配列・parametricObject のみ等）は原点を返す。
 */
export function computeCentroid(geometries: readonly Geometry[]): { cx: number; cy: number } {
  const points = geometries.flatMap(shapeKeyPoints)
  if (points.length === 0) return { cx: 0, cy: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

/**
 * 1 図形を基準点 (cx,cy) 回りに 90°回転 / 鏡像変換する。id を保持する in-place 変換。
 * parametricObject は座標を直接持たないため変換対象外とし null を返す（呼び出し側は元図形を維持する）。
 */
export function transformShape(
  geometry: Geometry,
  cx: number,
  cy: number,
  op: TransformOp,
): Geometry | null {
  switch (geometry.type) {
    case 'line':
    case 'dimension':
    case 'leader':
      return {
        ...geometry,
        start: applyPoint(geometry.start, cx, cy, op),
        end: applyPoint(geometry.end, cx, cy, op),
      }
    case 'rectangle': {
      // 矩形は「原点(左上)+幅/高さ+rotationDeg」で表現され、レンダラーが原点回りに
      // 回転する。変換は原点を写像し回転角のみ更新すればよく、幅/高さを入れ替えると
      // 二重適用になる（Issue #25: 継承元の入れ替えは rotationDeg 適用との二重回転）。
      return {
        ...geometry,
        origin: applyPoint(geometry.origin, cx, cy, op),
        rotationDeg: applyAngle(geometry.rotationDeg, op),
      }
    }
    case 'circle':
      return { ...geometry, center: applyPoint(geometry.center, cx, cy, op) }
    case 'arc':
      return {
        ...geometry,
        center: applyPoint(geometry.center, cx, cy, op),
        startAngleDeg: applyAngle(geometry.startAngleDeg, op),
        endAngleDeg: applyAngle(geometry.endAngleDeg, op),
      }
    case 'ellipse': {
      // 楕円も同様に、中心を写像し回転角のみ更新する（半径の入替は二重適用、Issue #25）。
      return {
        ...geometry,
        center: applyPoint(geometry.center, cx, cy, op),
        rotationDeg: applyAngle(geometry.rotationDeg, op),
      }
    }
    case 'polyline':
    case 'spline':
      return { ...geometry, points: transformPointList(geometry.points, cx, cy, op) }
    case 'hatch':
      return { ...geometry, boundaryPoints: transformPointList(geometry.boundaryPoints, cx, cy, op) }
    case 'text':
      return {
        ...geometry,
        anchor: applyPoint(geometry.anchor, cx, cy, op),
        rotationDeg: applyAngle(geometry.rotationDeg, op),
      }
    case 'symbol':
      return {
        ...geometry,
        position: applyPoint(geometry.position, cx, cy, op),
        rotationDeg: applyAngle(geometry.rotationDeg, op),
      }
    case 'parametricObject':
      return null
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

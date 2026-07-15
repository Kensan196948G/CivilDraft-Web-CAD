/**
 * 2本の線分の交点にフィレット（角の丸め）を適用する幾何演算エンジン。
 * 継承元: Civil-Draw src/utils/filletEngine.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との設計差分:
 * - Shape型→Geometry型: line{x1,y1,x2,y2}→LineGeometry{start,end}、
 *   arc{cx,cy,radius,startAngle,endAngle}→ArcGeometry{center,radius,startAngleDeg,endAngleDeg}。
 * - 角度の単位変換: 継承元ArcShapeはMath.atan2()の出力（ラジアン）をstartAngle/endAngleへ
 *   直接格納していた。ArcGeometryは度数法（ADR-0012、Degサフィックス）で統一するため、
 *   生成時にラジアン→度数へ変換する（radToDeg）。
 * - ID発番の副作用分離（ADR-0013）: 継承元は関数内部でnanoid()を直呼びしていたが、
 *   GeometryCreationContextを省略可能な最終引数で受け取り、id/createdAt/updatedAtを
 *   ctx.newId()/ctx.now()から取得する。
 * - layerId引数の廃止: 新規arcのbase属性（layerId/style/constructionStepIds/locked）は
 *   line1から継承する。トリムされたline1/line2はupdatedAtをctx.now()で更新し、idは維持する。
 * - 失敗時の返却は継承元同様nullのまま維持する。継承元は失敗理由をstringで返しておらず
 *   （nullのみ）、codebase既存のnull返却パターン（shapeBBox/selection）に整合させる。
 * - runtime型ガード（type!=='line'）は撤去した。LineGeometry型で受けるためコンパイル時に保証される。
 *
 * アルゴリズムは継承元を忠実に移植している（as_is相当）。
 */
import type { ArcGeometry, LineGeometry, Point } from '@/shared/types'
import { defaultCreationContext, type GeometryCreationContext } from './geometryFactory'

/** 2直線（無限延長）の交点を求める。平行なときはnull。 */
function lineIntersect(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const dx1 = a2.x - a1.x
  const dy1 = a2.y - a1.y
  const dx2 = b2.x - b1.x
  const dy2 = b2.y - b1.y
  const denom = dx1 * dy2 - dy1 * dx2
  if (Math.abs(denom) < 1e-10) return null
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom
  return { x: a1.x + t * dx1, y: a1.y + t * dy1 }
}

/**
 * 線分のどちらの端点がcornerに対する「遠い側（away）」かを判定する。
 *
 * 通常のL字コーナーではcornerから遠い端点がaway。
 * T字/X字交差（両端点がcornerから等距離）では、格納順やもう一方の線分に依存しない
 * 正準的な端点順序（max x、次にmax y）でタイブレークする。
 */
function pickAwaySide(
  e1: Point,
  e2: Point,
  corner: Point,
): { awayPt: Point; awayDist: number; cornerIsE2: boolean } | null {
  const dE1 = Math.hypot(e1.x - corner.x, e1.y - corner.y)
  const dE2 = Math.hypot(e2.x - corner.x, e2.y - corner.y)
  /* v8 ignore next */ if (dE1 < 1e-10 && dE2 < 1e-10) return null

  let awayIsE1: boolean
  if (Math.abs(dE1 - dE2) < 1e-9) {
    // T字/X字: 座標が正準的に「大きい」端点を選ぶ。格納順・相手の線分に非依存。
    if (Math.abs(e1.x - e2.x) > 1e-9) awayIsE1 = e1.x > e2.x
    /* v8 ignore next */
    else if (Math.abs(e1.y - e2.y) > 1e-9) awayIsE1 = e1.y > e2.y
    /* v8 ignore next */
    else return null
  } else {
    awayIsE1 = dE1 > dE2
  }

  const awayPt = awayIsE1 ? e1 : e2
  const awayDist = awayIsE1 ? dE1 : dE2
  // corner側（トリム対象）の端点がe2のときcornerIsE2=true（=e1がaway）。
  return { awayPt, awayDist, cornerIsE2: awayIsE1 }
}

/**
 * cornerからawayPtの方向へdistだけ進んだ点を返す。
 * distが元の線分を消し尽くす（dist >= awayDist）場合は、長さ0の残線を作らないためnullを返す。
 */
function retreatToward(corner: Point, awayPt: Point, awayDist: number, dist: number): Point | null {
  /* v8 ignore next */ if (awayDist < 1e-10) return null
  if (dist >= awayDist - 1e-6) return null
  const ux = (awayPt.x - corner.x) / awayDist
  const uy = (awayPt.y - corner.y) / awayDist
  return { x: corner.x + ux * dist, y: corner.y + uy * dist }
}

/**
 * ラジアン→度数の変換。
 * 継承元ArcShapeはMath.atan2()の出力（ラジアン）を格納していたが、
 * ArcGeometryは度数法（ADR-0012）で統一するため生成時に変換する。
 */
function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export interface FilletResult {
  readonly line1: LineGeometry
  readonly line2: LineGeometry
  readonly arc: ArcGeometry
}

/**
 * 2本の線分のコーナーにフィレット（角の丸め）を適用する。
 *
 * 各線分はcorner側の端点が交点からr/tan(θ/2)だけ後退するようトリムされ、
 * 半径rの接円弧が2つの後退点を接続する。
 *
 * 平行・半径不正・線分が短すぎる場合はnullを返す。
 * arcのbase属性（layerId/style/constructionStepIds/locked）はline1から継承する。
 */
export function filletLines(
  line1: LineGeometry,
  line2: LineGeometry,
  radius: number,
  ctx: GeometryCreationContext = defaultCreationContext,
): FilletResult | null {
  if (radius <= 0) return null

  const a1 = line1.start
  const a2 = line1.end
  const b1 = line2.start
  const b2 = line2.end

  const corner = lineIntersect(a1, a2, b1, b2)
  if (!corner) return null

  // cornerから遠い側（away）への単位ベクトルを求める。
  const sideA = pickAwaySide(a1, a2, corner)
  const sideB = pickAwaySide(b1, b2, corner)
  /* v8 ignore next */ if (!sideA || !sideB) return null

  // 線分間の角度: cornerからaway方向の単位ベクトルの内積で求める。
  const uax = (sideA.awayPt.x - corner.x) / sideA.awayDist
  const uay = (sideA.awayPt.y - corner.y) / sideA.awayDist
  const ubx = (sideB.awayPt.x - corner.x) / sideB.awayDist
  const uby = (sideB.awayPt.y - corner.y) / sideB.awayDist

  const dot = Math.max(-1, Math.min(1, uax * ubx + uay * uby))
  const angleBetween = Math.acos(dot) // コーナーでの2線分のなす角
  /* v8 ignore next */ if (Math.abs(angleBetween) < 1e-10) return null

  // cornerからの後退距離 = r / tan(θ/2)
  const halfAngle = angleBetween / 2
  const retreatDist = radius / Math.tan(halfAngle)

  const pA = retreatToward(corner, sideA.awayPt, sideA.awayDist, retreatDist)
  const pB = retreatToward(corner, sideB.awayPt, sideB.awayDist, retreatDist)
  /* v8 ignore next */ if (!pA || !pB) return null

  // 円弧中心: cornerから角の二等分線方向へ r/sin(θ/2) の距離
  const bisX = (uax + ubx) / 2
  const bisY = (uay + uby) / 2
  const bisLen = Math.hypot(bisX, bisY)
  /* v8 ignore next */ if (bisLen < 1e-10) return null
  const centerDist = radius / Math.sin(halfAngle)
  const cx = corner.x + (bisX / bisLen) * centerDist
  const cy = corner.y + (bisY / bisLen) * centerDist

  // 中心からpA・pBへの角度（継承元はラジアンで格納。ArcGeometryは度数法へ変換）
  const startAngle = Math.atan2(pA.y - cy, pA.x - cx)
  const endAngle = Math.atan2(pB.y - cy, pB.x - cx)

  // トリムした線分を作る。cornerIsE2ならend側、そうでなければstart側を後退点へ差し替える。
  const now = ctx.now()
  const newLine1: LineGeometry = sideA.cornerIsE2
    ? { ...line1, end: pA, updatedAt: now }
    : { ...line1, start: pA, updatedAt: now }

  const newLine2: LineGeometry = sideB.cornerIsE2
    ? { ...line2, end: pB, updatedAt: now }
    : { ...line2, start: pB, updatedAt: now }

  const arc: ArcGeometry = {
    id: ctx.newId(),
    type: 'arc',
    layerId: line1.layerId,
    style: line1.style,
    constructionStepIds: line1.constructionStepIds,
    locked: line1.locked,
    createdAt: now,
    updatedAt: now,
    center: { x: cx, y: cy },
    radius,
    startAngleDeg: radToDeg(startAngle),
    endAngleDeg: radToDeg(endAngle),
  }

  return { line1: newLine1, line2: newLine2, arc }
}

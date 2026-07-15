/**
 * 線分トリム（切断図形との交点でターゲット線分を分割し、クリック位置の区間を除去）。
 * 継承元: Civil-Draw src/utils/trimEngine.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - Shape型（フラット座標 x1/y1/x2/y2）→ Geometry判別共用体（LineGeometry.start/end）へ移植。
 * - 派生線分のID発番を`nanoid()`直呼びから`GeometryCreationContext`注入（ADR-0013）へ変更。
 *   分割で生まれる各線分に`ctx.newId()`で新IDを、`ctx.now()`でcreatedAt/updatedAtを設定し、
 *   layerId/style/constructionStepIds/locked等は元図形からスプレッドで維持する。
 * - 切断図形として扱うのは継承元同様「線分（line）」のみ。arc/circle/polyline等はセグメントを
 *   持たないものとして無視する（継承元getLineSegmentsの挙動をそのまま踏襲）。
 * - アルゴリズム（交点t値の収集→クリックt値の前後で挟む2交点→両側の残存区間を再構築）は
 *   as_is相当で忠実に移植した。
 */
import type { Geometry, LineGeometry, Point } from '@/shared/types'
import { defaultCreationContext } from './geometryFactory'
import type { GeometryCreationContext } from './geometryFactory'

/** 線分AB上での点Pのパラメータt（最近接投影）。[0,1]にクランプする。 */
function tOnSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  /* v8 ignore next */ if (len2 < 1e-12) return 0
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
}

/** 線分同士の交差判定。交差があればt値と交点を返し、なければnull。 */
function segIntersect(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): { tA: number; tB: number; pt: Point } | null {
  const dx1 = a2.x - a1.x
  const dy1 = a2.y - a1.y
  const dx2 = b2.x - b1.x
  const dy2 = b2.y - b1.y
  const denom = dx1 * dy2 - dy1 * dx2
  if (Math.abs(denom) < 1e-10) return null
  const tA = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom
  const tB = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom
  if (tA < 0 || tA > 1 || tB < 0 || tB > 1) return null
  return { tA, tB, pt: { x: a1.x + tA * dx1, y: a1.y + tA * dy1 } }
}

/**
 * 図形から線分セグメントを取り出す。
 * 継承元同様、現状は line のみ対応（他の図形種はセグメントなしとして空配列を返す）。
 */
function getLineSegments(geometry: Geometry): { a: Point; b: Point }[] {
  if (geometry.type === 'line') {
    return [{ a: geometry.start, b: geometry.end }]
  }
  return []
}

/**
 * ターゲット線分を、切断図形との最近接交点で分割する。
 * clickPos: ユーザーがターゲット線分上をクリックしたワールド座標。
 * 戻り値: 置換用の線分配列（0〜2本）。トリム不可（線分でない／交点なし）の場合はnull。
 * ctx: 派生線分のID・タイムスタンプ発番コンテキスト（ADR-0013、省略時は既定実装）。
 */
export function trimLine(
  target: Geometry,
  cuttingShapes: readonly Geometry[],
  clickPos: Point,
  ctx: GeometryCreationContext = defaultCreationContext,
): LineGeometry[] | null {
  if (target.type !== 'line') return null

  const a: Point = target.start
  const b: Point = target.end

  // 切断図形との交点t値をターゲット線分上で収集する。
  const intersections: Array<{ t: number; pt: Point }> = []
  for (const cutter of cuttingShapes) {
    if (cutter.id === target.id) continue
    for (const seg of getLineSegments(cutter)) {
      const hit = segIntersect(a, b, seg.a, seg.b)
      if (hit) intersections.push({ t: hit.tA, pt: hit.pt })
    }
  }

  if (intersections.length === 0) return null

  // クリック位置のターゲット線分上でのt値を求める。
  const tClick = tOnSegment(clickPos, a, b)

  // 交点をt値の昇順にソートする。
  intersections.sort((i, j) => i.t - j.t)

  // クリック位置を挟む前後の交点を求める。
  const before = intersections.filter((i) => i.t <= tClick)
  const after = intersections.filter((i) => i.t > tClick)

  // noUncheckedIndexedAccess下ではlength判定後もインデックスアクセスはundefined含みとなるため
  // 変数に退避してガードする。
  const lastBefore = before.length > 0 ? before[before.length - 1] : undefined
  const firstAfter = after.length > 0 ? after[0] : undefined

  const now = ctx.now()
  const result: LineGeometry[] = []

  // 最初の挟み込み交点より前の区間を残す（t=0の位置でなければ）。
  if (lastBefore && lastBefore.t > 1e-6) {
    result.push({ ...target, id: ctx.newId(), createdAt: now, updatedAt: now, end: lastBefore.pt })
  }

  // 最後の挟み込み交点より後の区間を残す（t=1の位置でなければ）。
  if (firstAfter && firstAfter.t < 1 - 1e-6) {
    result.push({ ...target, id: ctx.newId(), createdAt: now, updatedAt: now, start: firstAfter.pt })
  }

  // 片側に挟み込み交点が無い場合は、クリック位置を含む区間（中央側）を削除する。
  return result
}

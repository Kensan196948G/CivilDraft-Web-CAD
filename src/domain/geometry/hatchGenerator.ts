/**
 * ハッチング（塗り）パターンの線分生成エンジン。
 * 継承元: Civil-Draw src/utils/hatchGenerator.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - ポリゴン境界を平坦number[]（x,y交互）からPoint値型のreadonly配列へ変更し、
 *   HatchGeometry.boundaryPoints（詳細設計仕様書§6）と整合させた（ADR-0012）。
 * - 生成線分HatchLineもx1/y1/x2/y2からstart/end:Point構造へ変更した。
 * - 継承元のBBox型・polygonBBox()は再実装せず、責務一元化済みのshapeBBox()で
 *   HatchGeometryの外接矩形を求める（BBox計算=shapeBBox.tsへ集約）。
 * - 防御分岐の追加（継承元に無い、selection.ts/shapeBBox.tsと同じ設計スタイル）:
 *   boundaryPointsが空（shapeBBox()がnull）またはspacing<=0のとき[]を返す。
 *   継承元はこの2ケースでMath.ceil(diag/spacing)がInfinityとなり無限ループする
 *   バグがあった（下記「継承元のバグ」参照）。
 * - switchはHatchPattern10種をdefault:never網羅性検査付きで移植した。継承元は
 *   default無しの全case列挙だった。
 *
 * 継承元のバグ（アルゴリズムは修正せず、防御分岐で無限ループのみ回避）:
 * - spacing<=0または空ポリゴンでmakeLinesのループ上限nがInfinityになり無限ループ。
 * - clipSegmentToPolygonのlastInsideは代入のみで一度も参照されないデッドコードだった
 *   （移植版では削除。挙動には影響しない）。
 *
 * angleはADR-0012に従い度数法（angleDeg）。earth/concrete/rock/asphalt/wood/steel/water
 * は継承元同様、ユーザー角度を無視した固定角パターン。
 */
import type { HatchGeometry, Point } from '@/shared/types'
import { shapeBBox } from './shapeBBox'

/** ハッチングを構成する1本の線分。 */
export interface HatchLine {
  readonly start: Point
  readonly end: Point
}

/**
 * 点がポリゴン内部にあるか判定する（ray-casting法）。
 * ray-casting特有の境界挙動を継承元から忠実移植: 頂点・辺上の点の判定は辺の向きに
 * 依存し、一般に一方の辺のみを内側扱いする（例: 軸平行矩形では左辺・下辺が内側、
 * 右辺・上辺が外側）。
 */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = polygon[i]
    const vj = polygon[j]
    // noUncheckedIndexedAccess対応。i,j∈[0,n)のため実際にundefinedにはならない。
    if (vi === undefined || vj === undefined) continue
    const intersect =
      vi.y > p.y !== vj.y > p.y && p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * 線分をポリゴンでクリップし、内部に入る区間だけをHatchLineとして返す。
 * 継承元同様、線分をsteps分割してサンプリングし内外の切り替わりで区間を切り出す
 * 近似アルゴリズム（区間境界は最大1ステップ分の誤差を持つ）。
 */
export function clipSegmentToPolygon(
  start: Point,
  end: Point,
  polygon: readonly Point[],
  steps = 50,
): HatchLine[] {
  const out: HatchLine[] = []
  let inSeg = false
  let segStart: Point = start
  let last: Point = start
  if (pointInPolygon(start, polygon)) {
    inSeg = true
    segStart = start
  }

  for (let s = 1; s <= steps; s++) {
    const t = s / steps
    const current: Point = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    }
    const inside = pointInPolygon(current, polygon)
    if (inside && !inSeg) {
      inSeg = true
      segStart = last
    } else if (!inside && inSeg) {
      out.push({ start: segStart, end: current })
      inSeg = false
    }
    last = current
  }
  if (inSeg) out.push({ start: segStart, end: last })
  return out
}

/**
 * ハッチ図形からパターンに応じたハッチング線分群を生成する。
 * boundaryPointsが空（shapeBBox=null）またはspacing<=0の場合は[]を返す（無限ループ防御）。
 */
export function generateHatchLines(hatch: HatchGeometry): HatchLine[] {
  const { boundaryPoints, pattern, angleDeg, spacing } = hatch

  const bbox = shapeBBox(hatch)
  if (bbox === null || spacing <= 0) return []

  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY)
  const cx = (bbox.minX + bbox.maxX) / 2
  const cy = (bbox.minY + bbox.maxY) / 2

  const makeLines = (a: number): HatchLine[] => {
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    const half = diag
    const lines: HatchLine[] = []
    const n = Math.ceil(diag / spacing) + 1
    for (let i = -n; i <= n; i++) {
      const offset = i * spacing
      // 線の中心を線方向に対して垂直へずらす
      const px = cx - sin * offset
      const py = cy + cos * offset
      const lineStart: Point = { x: px - cos * half, y: py - sin * half }
      const lineEnd: Point = { x: px + cos * half, y: py + sin * half }
      lines.push(...clipSegmentToPolygon(lineStart, lineEnd, boundaryPoints))
    }
    return lines
  }

  const rad = (angleDeg * Math.PI) / 180

  switch (pattern) {
    case 'parallel':
      return makeLines(rad)
    case 'cross':
      return [...makeLines(rad), ...makeLines(rad + Math.PI / 2)]
    case 'earth':
      return [...makeLines(Math.PI / 4), ...makeLines((Math.PI * 3) / 4)]
    case 'gravel':
      return makeLines(rad)
    // 以下は固定角パターン（ユーザー角度スライダーに依存しない）
    case 'concrete':
      // 0°+90° 直交グリッド（JISコンクリート）
      return [...makeLines(0), ...makeLines(Math.PI / 2)]
    case 'rock':
      // 0°+60°+120° 三角メッシュ（岩・花崗岩）
      return [...makeLines(0), ...makeLines(Math.PI / 3), ...makeLines((2 * Math.PI) / 3)]
    case 'asphalt':
      // 30°+150° 菱形（earthより急角度）
      return [...makeLines(Math.PI / 6), ...makeLines((5 * Math.PI) / 6)]
    case 'wood':
      // 固定水平線（0°）
      return makeLines(0)
    case 'steel':
      // 45°+90° 斜め+垂直（鋼材断面）
      return [...makeLines(Math.PI / 4), ...makeLines(Math.PI / 2)]
    case 'water':
      // 0°+10° 水平に近い二重線（波表現）
      return [...makeLines(0), ...makeLines(Math.PI / 18)]
    default: {
      const exhaustive: never = pattern
      throw new Error(`Unhandled hatch pattern: ${JSON.stringify(exhaustive)}`)
    }
  }
}

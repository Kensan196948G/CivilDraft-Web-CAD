/**
 * PDF出力の座標変換（内部mm座標 → PDF用紙座標pt）。
 * 継承元: なし（新規実装、Issue #10 / 詳細設計仕様書§24.1 PDF出力。継承元Civil-Drawに前例なし）。
 *
 * 設計方針（§24.1「出力用の実寸座標へ変換し、画面ズーム・panを使用しない」）:
 * - ADR-0012の内部座標（mm単位・X右・Y下）を、PDFのユーザー空間（pt単位・Y上・原点左下）へ写像する。
 * - 画面のzoom/panは一切参照しない。用紙サイズ・向き・余白・縮尺のみで決まる純関数。
 * - 縮尺: 用紙上mm = 実寸mm / scale（scaleは縮尺分母。1:100ならscale=100）。
 * - 単位: 1mm = 72/25.4 pt（PDFのptは1/72インチ。これは印刷組版の固定定数であり、
 *   DXFの$INSUNITSのように図面ごとに変わる係数ではないため、domain/unitsのLengthUnit変換
 *   （図面座標の単位換算）ではなく本モジュール内の定数として持つのが正当。mm/ptは「座標長」
 *   ではなく「組版単位」である、という線引き）。
 * - Y反転: 内部の+Y（下方向）は用紙上でも下（PDFのyが小さい方向）へ写す。
 *
 * 長さの2系統（CAD出力の要）:
 * - point()/length() は「図面空間」の量（座標・半径・文字高さ・寸法オフセット）で、縮尺で縮む。
 * - 線幅・矢印・枠線・表題欄などの「用紙空間」の量は縮尺で縮めない用紙固有属性であり、
 *   本モジュールではなく描画側でpt定数として扱う（§24.1「線幅を明示指定する」）。
 */
import { getPaperSizeMm } from '@/domain/canvas/paperSize'
import type { PaperOrientation, PaperSize } from '@/domain/canvas/paperSize'
import type { Point } from '@/shared/types'

/** 1mm を PDF の pt（1/72インチ）へ換算する組版定数。 */
export const PT_PER_MM = 72 / 25.4

/** 用紙寸法（pt）。 */
export interface PaperLayoutPt {
  readonly widthPt: number
  readonly heightPt: number
}

/**
 * 内部mm座標系から PDF pt座標系への写像を担う投影器。
 * すべての図形描画はこの投影器を単一の真実として絶対PDF座標へ変換する
 * （pdf-lib の drawSvgPath 等が内部で行う暗黙のY反転には依存しない）。
 */
export interface PdfProjector {
  /** 内部mm点 → PDF点（絶対座標、Y反転済み）。 */
  readonly point: (p: Point) => { readonly x: number; readonly y: number }
  /** 内部mm長さ → PDF長さpt（縮尺適用。図面空間の量: 半径・文字高さ・寸法オフセット等）。 */
  readonly length: (mm: number) => number
  /** 用紙寸法（pt）。ページ生成・枠線・表題欄配置に使う。 */
  readonly paper: PaperLayoutPt
  /** 余白（pt）。枠線・表題欄の内側配置に使う。 */
  readonly marginPt: number
}

/**
 * 用紙条件から投影器を生成する。
 *
 * 写像式（内部点 (ix, iy) mm → PDF点 (xPt, yPt)）:
 *   s        = PT_PER_MM / scale                  （内部mm → 用紙pt。縮尺適用）
 *   originX  = marginMm * PT_PER_MM               （描画領域左端 pt）
 *   originY  = (paperHmm - marginMm) * PT_PER_MM  （描画領域上端 pt。PDFはY上向きのため上端=大きいy）
 *   xPt = originX + ix * s
 *   yPt = originY - iy * s                        （+Y下向き → yを減らす＝Y反転）
 *
 * 内部原点(0,0)は描画領域の左上角（余白の内側）に置く。画面のpan/zoomは使わない（§24.1）。
 *
 * @param scale 縮尺分母（1:100なら100）。呼び出し側で scale > 0 を保証すること
 *              （0以下は本関数では検証しない。exportPdf側でfatal扱い）。
 * @param marginMm 用紙端からの余白（mm）。
 */
export function createProjector(
  paperSize: PaperSize,
  orientation: PaperOrientation,
  scale: number,
  marginMm: number,
): PdfProjector {
  const { w: paperWmm, h: paperHmm } = getPaperSizeMm(paperSize, orientation)
  const s = PT_PER_MM / scale
  const originXpt = marginMm * PT_PER_MM
  const originYpt = (paperHmm - marginMm) * PT_PER_MM
  return {
    paper: { widthPt: paperWmm * PT_PER_MM, heightPt: paperHmm * PT_PER_MM },
    marginPt: marginMm * PT_PER_MM,
    length: (mm: number) => mm * s,
    point: (p: Point) => ({ x: originXpt + p.x * s, y: originYpt - p.y * s }),
  }
}

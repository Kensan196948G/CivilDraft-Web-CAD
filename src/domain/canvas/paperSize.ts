/**
 * 用紙サイズ計算（A系列のmm寸法・px換算・向き適用）。
 * 継承元: Civil-Draw src/canvas/canvasStore.ts の PAPER_SIZES_MM / getPaperSizeMm / getPaperSizePx
 * （継承台帳 modify、Canvas描画補助）。
 *
 * 配置判断: framework非依存の純粋計算のため domain/canvas に切り出した。継承元では
 * canvasStore（Zustand store）内に同居していたが、domain層は Zustand に依存できない（§2.1）ため
 * store外の純粋関数として独立させた。用紙サイズ「状態」そのものの保持先（EditorStoreへの
 * paperSize 追加の要否）は親の別途判断とし、本ファイルは寸法の算出のみを担う。
 *
 * 継承元との差分:
 * - アルゴリズムは as_is で保全。返り値・寸法テーブルを readonly 化した。
 */

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0'
export type PaperOrientation = 'portrait' | 'landscape'

export interface PaperDimensions {
  readonly w: number
  readonly h: number
}

const PAPER_SIZES_MM: Record<PaperSize, PaperDimensions> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
}

/** 用紙のmm寸法（向き適用）。landscape は w/h を入れ替える。 */
export function getPaperSizeMm(size: PaperSize, orientation: PaperOrientation): PaperDimensions {
  const mm = PAPER_SIZES_MM[size]
  return orientation === 'landscape' ? { w: mm.h, h: mm.w } : { w: mm.w, h: mm.h }
}

/** 用紙のpx寸法（dpi換算・向き適用）。既定96dpi。 */
export function getPaperSizePx(
  size: PaperSize,
  orientation: PaperOrientation,
  dpi = 96,
): PaperDimensions {
  const mm = PAPER_SIZES_MM[size]
  const ratio = dpi / 25.4
  const w = mm.w * ratio
  const h = mm.h * ratio
  return orientation === 'landscape' ? { w: h, h: w } : { w, h }
}

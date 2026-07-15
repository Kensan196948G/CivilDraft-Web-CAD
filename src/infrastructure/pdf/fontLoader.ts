/**
 * PDF出力用の日本語フォントローダー（DD-TBD-006 配布条件の確定、2026-07-15 人間承認）。
 *
 * 同梱フォント: Noto Sans JP Regular のサブセット（public/fonts/NotoSansJP-Regular-subset.otf、
 * SIL OFL 1.1 = 再配布可、ライセンス全文は public/fonts/OFL.txt）。
 * 土木図面は地名等で常用漢字外のレア漢字（函渠・轍 等）を多用するため、常用漢字への
 * 絞り込みではなく CJK統合漢字ブロック全体 + かな + 記号 + 単位（㎡等）を保持した
 * サブセット（約3.5MB）とした。PDF出力時のみオンデマンドで fetch する設計のため、
 * 初期バンドルサイズには影響しない。
 *
 * 失敗（フォント配信欠落・ネットワーク断）は Result で返し、呼び出し側は
 * フォント未注入として exportPdf の代替規則（PDF_FONT_FALLBACK 警告）へ自然に退避する。
 */
import type { Result, ValidationIssue } from '@/shared/types'

export const JAPANESE_FONT_PATH = '/fonts/NotoSansJP-Regular-subset.otf'

let cachedFont: Uint8Array | null = null

/** テスト用: モジュールキャッシュを破棄する。 */
export function clearFontCache(): void {
  cachedFont = null
}

/**
 * 同梱日本語フォントを取得する（成功時はモジュール内キャッシュ、2回目以降はネットワーク不要）。
 */
export async function loadJapaneseFont(
  fetchFn: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<Result<Uint8Array, ValidationIssue>> {
  if (cachedFont !== null) {
    return { ok: true, value: cachedFont }
  }
  try {
    const response = await fetchFn(JAPANESE_FONT_PATH)
    if (!response.ok) {
      return {
        ok: false,
        error: {
          code: 'PDF_FONT_UNAVAILABLE',
          severity: 'warning',
          message: `日本語フォントの取得に失敗しました（HTTP ${response.status}）。PDFは代替描画になります`,
        },
      }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    cachedFont = bytes
    return { ok: true, value: bytes }
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'PDF_FONT_UNAVAILABLE',
        severity: 'warning',
        message: `日本語フォントの取得に失敗しました（${cause instanceof Error ? cause.message : String(cause)}）。PDFは代替描画になります`,
      },
    }
  }
}

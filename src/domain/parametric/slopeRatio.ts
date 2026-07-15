/**
 * 法勾配（詳細設計仕様書 §16.1）。
 *
 * 法勾配入力 `1:n` を鉛直 1 に対する水平 n として解析する。入力文字列は空白・全角記号を
 * 正規化し、n>0 を必須とする。表示文字列と内部値を保持し、利用者が入力した表記を
 * 可能な範囲で再現する。
 *
 * 設計判断:
 * - 仕様書の SlopeRatio 型は { vertical:1; horizontal:number } だが、§16.1 本文が
 *   「表示文字列と内部値を保持」を要求するため display フィールドを追加する。
 * - 鉛直側 v が 1 以外で入力された場合（例 '2:1'）は horizontal = n/v へ正規化して
 *   vertical=1 を保つ。display には正規化前（全角→半角・空白除去のみ）を保持する。
 */
import type { Result, ValidationIssue } from '@/shared/types'
import type { Point } from '@/shared/types'

export interface SlopeRatio {
  readonly vertical: 1
  /** 鉛直 1 に対する水平量（n>0）。 */
  readonly horizontal: number
  /** 利用者入力の再現表記（全角→半角・空白除去済み）。 */
  readonly display: string
}

/** 全角数字・全角ピリオド・全角コロンを半角へ変換する。 */
function normalizeFullwidth(input: string): string {
  return input.replace(/[０-９．：]/g, (ch) => {
    const code = ch.charCodeAt(0)
    if (code === 0xff0e) return '.'
    if (code === 0xff1a) return ':'
    // 全角数字 0xFF10-0xFF19 → 半角 0x30-0x39
    return String.fromCharCode(code - 0xff10 + 0x30)
  })
}

function formatError(input: string): ValidationIssue {
  return {
    code: 'SLOPE_RATIO_FORMAT',
    severity: 'error',
    field: 'slopeRatio',
    message: `法勾配は「1:n」形式で入力してください: "${input}"`,
  }
}

/**
 * 法勾配文字列を解析する。空白・全角を正規化し、`v:h`（v>0, h>0）を受理して
 * vertical=1 へ正規化した SlopeRatio を返す。書式不正・非正数は ValidationIssue で返す。
 */
export function parseSlopeRatio(input: string): Result<SlopeRatio, ValidationIssue> {
  const normalized = normalizeFullwidth(input).replace(/\s+/g, '')
  if (normalized.length === 0) return { ok: false, error: formatError(input) }

  const parts = normalized.split(':')
  if (parts.length !== 2) return { ok: false, error: formatError(input) }

  const [leftText, rightText] = parts
  // split(':') の length===2 分岐のため両要素は必ず string（noUncheckedIndexedAccess 対応）。
  if (leftText === undefined || rightText === undefined) {
    return { ok: false, error: formatError(input) }
  }

  const numericPattern = /^\d+(\.\d+)?$/
  if (!numericPattern.test(leftText) || !numericPattern.test(rightText)) {
    return { ok: false, error: formatError(input) }
  }

  const v = Number(leftText)
  const h = Number(rightText)
  if (!Number.isFinite(v) || !Number.isFinite(h) || v <= 0 || h <= 0) {
    return {
      ok: false,
      error: {
        code: 'SLOPE_RATIO_NONPOSITIVE',
        severity: 'error',
        field: 'slopeRatio',
        message: `法勾配は正の値で入力してください: "${input}"`,
      },
    }
  }

  return {
    ok: true,
    value: { vertical: 1, horizontal: h / v, display: normalized },
  }
}

/** SlopeRatio を `1:n` 表記へ整形する（内部値ベース。display とは独立）。 */
export function formatSlopeRatio(ratio: SlopeRatio): string {
  return `1:${ratio.horizontal}`
}

/** 鉛直落差 drop に対する法面の水平距離（= horizontal × drop）を返す。 */
export function slopeHorizontalRun(verticalDrop: number, ratio: SlopeRatio): number {
  return ratio.horizontal * Math.abs(verticalDrop)
}

/**
 * 法肩（crest）・法尻（toe）から法面ハッチの閉境界を生成する（土工テンプレート用）。
 * 斜面線 crest→toe と、法尻からの鉛直線・法肩からの水平線で閉じる三角形を返す
 * （Y 軸下方向・ADR-0012 前提）。ハッチ実体化は makeHatch と組み合わせて行う。
 */
export function slopeHatchBoundary(crest: Point, toe: Point): readonly Point[] {
  return [crest, toe, { x: toe.x, y: crest.y }]
}

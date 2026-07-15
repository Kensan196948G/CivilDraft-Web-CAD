/**
 * pdfGeometryPainter のフォント代替判定（純関数）の真理値テスト。
 * §24.1「非ASCII文字は文字化け出力せずプレースホルダ＋警告」の判定規則を固定する。
 */
import { describe, expect, it } from 'vitest'
import { requiresFontFallback } from '@/domain/pdf/pdfGeometryPainter'

describe('requiresFontFallback', () => {
  it('注入フォントなし＋日本語 → 代替が必要（true）', () => {
    expect(requiresFontFallback('日本語', false)).toBe(true)
  })

  it('注入フォントあり → 常に代替不要（false）', () => {
    expect(requiresFontFallback('日本語', true)).toBe(false)
  })

  it('ASCII のみ → 代替不要（false）', () => {
    expect(requiresFontFallback('Drawing No.12 1:100 m', false)).toBe(false)
  })

  it('Latin-1（U+00FF以下, é 等）は WinAnsi で描けるため代替不要（false）', () => {
    expect(requiresFontFallback('Café', false)).toBe(false)
  })

  it('空文字 → 代替不要（false）', () => {
    expect(requiresFontFallback('', false)).toBe(false)
  })

  it('U+0100 以上の記号（①=U+2460）→ 代替が必要（true）', () => {
    expect(requiresFontFallback('①', false)).toBe(true)
  })

  it('ASCII と CJK の混在 → 代替が必要（true）', () => {
    expect(requiresFontFallback('BM基準点', false)).toBe(true)
  })
})

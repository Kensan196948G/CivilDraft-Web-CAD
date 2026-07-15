import { describe, expect, it } from 'vitest'
import {
  formatSlopeRatio,
  parseSlopeRatio,
  slopeHatchBoundary,
  slopeHorizontalRun,
} from '@/domain/parametric/slopeRatio'

describe('parseSlopeRatio（§16.1 法勾配）', () => {
  it('1:0.5 を vertical=1・horizontal=0.5 で解析し表記を保持する', () => {
    const result = parseSlopeRatio('1:0.5')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.vertical).toBe(1)
    expect(result.value.horizontal).toBe(0.5)
    expect(result.value.display).toBe('1:0.5')
  })

  it('1:1.0 を horizontal=1 で解析する', () => {
    const result = parseSlopeRatio('1:1.0')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.horizontal).toBe(1)
    expect(result.value.display).toBe('1:1.0')
  })

  it('全角コロン・空白を正規化する（１ ： ０．５ → 1:0.5）', () => {
    const result = parseSlopeRatio('１ ： ０．５')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.horizontal).toBe(0.5)
    expect(result.value.display).toBe('1:0.5')
  })

  it('鉛直側が 1 以外なら horizontal を正規化する（2:1 → 0.5）', () => {
    const result = parseSlopeRatio('2:1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.horizontal).toBe(0.5)
    expect(result.value.display).toBe('2:1')
  })

  it('n=0（非正数）は SLOPE_RATIO_NONPOSITIVE エラー', () => {
    const result = parseSlopeRatio('1:0')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('SLOPE_RATIO_NONPOSITIVE')
    expect(result.error.severity).toBe('error')
  })

  it('コロン無し・非数値は SLOPE_RATIO_FORMAT エラー', () => {
    for (const bad of ['abc', '1-2', '', ':', '1:2:3']) {
      const result = parseSlopeRatio(bad)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('SLOPE_RATIO_FORMAT')
    }
  })
})

describe('slopeRatio ユーティリティ', () => {
  it('formatSlopeRatio は内部値を 1:n 表記へ整形する', () => {
    const result = parseSlopeRatio('2:1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(formatSlopeRatio(result.value)).toBe('1:0.5')
  })

  it('slopeHorizontalRun は落差×horizontal を返す', () => {
    const result = parseSlopeRatio('1:1.5')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(slopeHorizontalRun(2000, result.value)).toBe(3000)
  })

  it('slopeHatchBoundary は法肩・法尻・水平投影の三角形を返す', () => {
    const boundary = slopeHatchBoundary({ x: 0, y: 0 }, { x: 3000, y: 4000 })
    expect(boundary).toEqual([
      { x: 0, y: 0 },
      { x: 3000, y: 4000 },
      { x: 3000, y: 0 },
    ])
  })
})

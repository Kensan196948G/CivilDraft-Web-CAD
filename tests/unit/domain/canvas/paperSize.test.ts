import { describe, expect, it } from 'vitest'
import { getPaperSizeMm, getPaperSizePx } from '@/domain/canvas/paperSize'

describe('getPaperSizeMm', () => {
  it('portrait は A系列のmm寸法をそのまま返す', () => {
    expect(getPaperSizeMm('A4', 'portrait')).toEqual({ w: 210, h: 297 })
    expect(getPaperSizeMm('A3', 'portrait')).toEqual({ w: 297, h: 420 })
    expect(getPaperSizeMm('A0', 'portrait')).toEqual({ w: 841, h: 1189 })
  })

  it('landscape は w/h を入れ替える', () => {
    expect(getPaperSizeMm('A3', 'landscape')).toEqual({ w: 420, h: 297 })
    expect(getPaperSizeMm('A4', 'landscape')).toEqual({ w: 297, h: 210 })
  })
})

describe('getPaperSizePx', () => {
  it('dpi=25.4 では ratio=1 となりmm値と一致する', () => {
    expect(getPaperSizePx('A4', 'portrait', 25.4)).toEqual({ w: 210, h: 297 })
    expect(getPaperSizePx('A4', 'landscape', 25.4)).toEqual({ w: 297, h: 210 })
  })

  it('既定96dpiは ratio=96/25.4 でmm→px換算する', () => {
    const p = getPaperSizePx('A4', 'portrait')
    expect(p.w).toBeCloseTo((210 * 96) / 25.4, 6)
    expect(p.h).toBeCloseTo((297 * 96) / 25.4, 6)
  })
})

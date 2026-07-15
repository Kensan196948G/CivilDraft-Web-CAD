import { describe, expect, it } from 'vitest'
import { applyOrtho } from '@/domain/geometry/orthoConstraint'

describe('applyOrtho', () => {
  it('|dx| > |dy| の場合は水平に拘束する', () => {
    const result = applyOrtho({ x: 150, y: 30 }, { x: 100, y: 0 })
    expect(result.x).toBe(150)
    expect(result.y).toBe(0)
  })

  it('|dy| > |dx| の場合は垂直に拘束する', () => {
    const result = applyOrtho({ x: 110, y: 200 }, { x: 100, y: 0 })
    expect(result.x).toBe(100)
    expect(result.y).toBe(200)
  })

  it('|dx| === |dy| の場合は水平を優先する（タイブレーク）', () => {
    const result = applyOrtho({ x: 150, y: 50 }, { x: 100, y: 0 })
    expect(result.x).toBe(150)
    expect(result.y).toBe(0)
  })

  it('負のオフセットでも |dx| > |dy| なら水平に拘束する', () => {
    // dx = 50-100 = -50, dy = 90-100 = -10 → |dx| > |dy| → 水平
    const result = applyOrtho({ x: 50, y: 90 }, { x: 100, y: 100 })
    expect(result.x).toBe(50)
    expect(result.y).toBe(100)
  })

  it('p === from の場合は恒等変換になる', () => {
    const result = applyOrtho({ x: 100, y: 100 }, { x: 100, y: 100 })
    expect(result.x).toBe(100)
    expect(result.y).toBe(100)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SnapMarker } from '@/app/canvas/SnapMarker'
import type { SnapResult } from '@/domain/geometry/snapEngine'

// react-konva を DOM スタブへ差し替え（jsdomでKonva実体を起動しない）。
vi.mock('react-konva', () => ({
  Rect: (p: Record<string, unknown>) => <div data-testid="rect" data-konva={JSON.stringify(p)} />,
  Line: (p: Record<string, unknown>) => <div data-testid="line" data-konva={JSON.stringify(p)} />,
  Circle: (p: Record<string, unknown>) => <div data-testid="circle" data-konva={JSON.stringify(p)} />,
}))

function counts(): { rect: number; line: number; circle: number } {
  return {
    rect: screen.queryAllByTestId('rect').length,
    line: screen.queryAllByTestId('line').length,
    circle: screen.queryAllByTestId('circle').length,
  }
}

function snap(type: SnapResult['type'], x = 10, y = 20): SnapResult {
  return { point: { x, y }, type }
}

describe('SnapMarker', () => {
  it('snap=null は何も描かない', () => {
    render(<SnapMarker snap={null} zoom={1} />)
    expect(counts()).toEqual({ rect: 0, line: 0, circle: 0 })
  })

  it("type='none' は何も描かない", () => {
    render(<SnapMarker snap={snap('none')} zoom={1} />)
    expect(counts()).toEqual({ rect: 0, line: 0, circle: 0 })
  })

  it('endpoint は矩形1つ（色#fbbf24, size=10/zoom）', () => {
    render(<SnapMarker snap={snap('endpoint')} zoom={1} />)
    expect(counts()).toEqual({ rect: 1, line: 0, circle: 0 })
    const p = JSON.parse(screen.getByTestId('rect').getAttribute('data-konva') ?? '{}')
    expect(p.stroke).toBe('#fbbf24')
    expect(p.width).toBe(10)
    expect(p.listening).toBe(false)
  })

  it('grid は矩形1つ（色#60a5fa, size=10/zoom）', () => {
    render(<SnapMarker snap={snap('grid')} zoom={2} />)
    expect(counts()).toEqual({ rect: 1, line: 0, circle: 0 })
    const p = JSON.parse(screen.getByTestId('rect').getAttribute('data-konva') ?? '{}')
    expect(p.stroke).toBe('#60a5fa')
    expect(p.width).toBe(5)
  })

  it('midpoint は三角（Line1つ）', () => {
    render(<SnapMarker snap={snap('midpoint')} zoom={1} />)
    expect(counts()).toEqual({ rect: 0, line: 1, circle: 0 })
  })

  it('intersection は×2本＋円1つ', () => {
    render(<SnapMarker snap={snap('intersection')} zoom={1} />)
    expect(counts()).toEqual({ rect: 0, line: 2, circle: 1 })
  })

  it('center は円2つ', () => {
    render(<SnapMarker snap={snap('center')} zoom={1} />)
    expect(counts()).toEqual({ rect: 0, line: 0, circle: 2 })
  })

  it('perpendicular は線2本＋円1つ', () => {
    render(<SnapMarker snap={snap('perpendicular')} zoom={1} />)
    expect(counts()).toEqual({ rect: 0, line: 2, circle: 1 })
  })

  it('nearest は Line1つ', () => {
    render(<SnapMarker snap={snap('nearest')} zoom={1} />)
    expect(counts()).toEqual({ rect: 0, line: 1, circle: 0 })
  })

  it('tangent は円1つ＋線1本', () => {
    render(<SnapMarker snap={snap('tangent')} zoom={1} />)
    expect(counts()).toEqual({ rect: 0, line: 1, circle: 1 })
  })
})

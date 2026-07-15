import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { RULER_SIZE, Ruler } from '@/app/canvas/Ruler'

describe('Ruler', () => {
  it('水平・垂直ルーラーのコンテナを描画する', () => {
    render(<Ruler zoom={1} panX={0} panY={0} width={200} height={200} />)
    expect(screen.getByTestId('ruler-horizontal')).toBeInTheDocument()
    expect(screen.getByTestId('ruler-vertical')).toBeInTheDocument()
  })

  it('水平ルーラーに目盛りラベル（world値）を表示する', () => {
    render(<Ruler zoom={1} panX={0} panY={0} width={200} height={200} />)
    // calcHorizontalTicks(0,1,200) = world 0,50,100,150,200。
    const h = screen.getByTestId('ruler-horizontal')
    expect(within(h).getByText('100')).toBeInTheDocument()
    expect(within(h).getByText('200')).toBeInTheDocument()
  })

  it('垂直ルーラーにも目盛りラベルを表示する', () => {
    render(<Ruler zoom={1} panX={0} panY={0} width={200} height={200} />)
    const v = screen.getByTestId('ruler-vertical')
    expect(within(v).getByText('50')).toBeInTheDocument()
  })

  it('RULER_SIZE定数は24', () => {
    expect(RULER_SIZE).toBe(24)
  })
})

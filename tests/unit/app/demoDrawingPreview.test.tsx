import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DemoDrawingPreview } from '@/app/demoDrawingPreview'
import { createDemoDrawingContent } from '@/app/demoDrawingContents'

describe('DemoDrawingPreview', () => {
  it('サンプル2DデータをSVGでプレビュー表示する', () => {
    const content = createDemoDrawingContent('quantity-basis', 'DWG-025', {
      theme: 'road-widening',
      drawingName: '数量根拠図（舗装数量）',
    })
    render(<DemoDrawingPreview content={content} ariaLabel="DWG-025 のプレビュー" />)
    const svg = screen.getByRole('img', { name: 'DWG-025 のプレビュー' })
    expect(svg.tagName).toBe('svg')
    expect(svg.querySelector('rect')).not.toBeNull()
    expect(svg.querySelector('text')).not.toBeNull()
  })

  it('図形が無い場合は空状態を表示する', () => {
    render(<DemoDrawingPreview content={{ geometries: [], layers: [] }} />)
    expect(screen.getByText(/図形データがありません/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

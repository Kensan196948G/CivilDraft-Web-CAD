import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore } from '@/app/store/editorStore'
import { PaperBoundary } from '@/app/canvas/PaperBoundary'

// react-konva を DOM スタブへ差し替え（jsdomでKonva実体を起動しない）。propsはdata属性へ退避。
vi.mock('react-konva', () => ({
  Rect: (p: Record<string, unknown>) => <div data-testid="rect" data-konva={JSON.stringify(p)} />,
}))

function rectProps(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('rect').getAttribute('data-konva') ?? '{}')
}

describe('PaperBoundary', () => {
  it('A3 landscape の用紙寸法(420x297)で矩形を描く', () => {
    const store = createEditorStore()
    render(
      <EditorStoreProvider store={store}>
        <PaperBoundary paperSize="A3" paperOrientation="landscape" />
      </EditorStoreProvider>,
    )
    const p = rectProps()
    expect(p.width).toBe(420)
    expect(p.height).toBe(297)
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
    expect(p.listening).toBe(false)
  })

  it('zoomに応じてstroke幅・shadowをpx一定へ補正する（1/zoom）', () => {
    const store = createEditorStore()
    store.getState().setZoom(2)
    render(
      <EditorStoreProvider store={store}>
        <PaperBoundary paperSize="A4" paperOrientation="portrait" />
      </EditorStoreProvider>,
    )
    const p = rectProps()
    expect(p.width).toBe(210)
    expect(p.height).toBe(297)
    expect(p.strokeWidth).toBe(0.5)
    expect(p.shadowBlur).toBe(5)
    expect(p.shadowOffset).toEqual({ x: 1, y: 2 })
  })

  it('colors prop で配色を上書きできる', () => {
    const store = createEditorStore()
    render(
      <EditorStoreProvider store={store}>
        <PaperBoundary
          paperSize="A4"
          paperOrientation="portrait"
          colors={{ fill: '#112233', stroke: '#445566', shadow: '#778899' }}
        />
      </EditorStoreProvider>,
    )
    const p = rectProps()
    expect(p.fill).toBe('#112233')
    expect(p.stroke).toBe('#445566')
    expect(p.shadowColor).toBe('#778899')
  })

  it('colors未指定時はCSS変数フォールバック（jsdomでは既定#ffffff）', () => {
    const store = createEditorStore()
    render(
      <EditorStoreProvider store={store}>
        <PaperBoundary paperSize="A4" paperOrientation="portrait" />
      </EditorStoreProvider>,
    )
    expect(rectProps().fill).toBe('#ffffff')
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { useEditorStore } from '@/app/store/useEditorStore'
import { createEditorStore } from '@/app/store/editorStore'

function ZoomProbe() {
  const zoom = useEditorStore((s) => s.zoom)
  return <span data-testid="zoom">{zoom}</span>
}

describe('EditorStoreContext', () => {
  it('Provider配下でstore状態を購読できる（内部生成store）', () => {
    render(
      <EditorStoreProvider>
        <ZoomProbe />
      </EditorStoreProvider>,
    )
    expect(screen.getByTestId('zoom')).toHaveTextContent('1')
  })

  it('外部生成storeを注入できる（テスト・複数図面向け）', () => {
    const store = createEditorStore()
    store.getState().setZoom(5)
    render(
      <EditorStoreProvider store={store}>
        <ZoomProbe />
      </EditorStoreProvider>,
    )
    expect(screen.getByTestId('zoom')).toHaveTextContent('5')
  })

  it('Provider外での使用は明示的なエラーになる', () => {
    expect(() => render(<ZoomProbe />)).toThrow(/EditorStoreProvider/)
  })
})

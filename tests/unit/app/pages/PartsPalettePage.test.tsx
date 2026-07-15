import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PartsPalettePage } from '@/app/pages/PartsPalettePage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore } from '@/app/store/editorStore'
import type { EditorStore } from '@/app/store/editorStore'
import { SYMBOL_CATALOG } from '@/domain/catalog/symbolCatalog'
import { TEMPLATE_CATALOG } from '@/domain/catalog/templateCatalog'
import { PARAMETRIC_CATALOG } from '@/domain/parametric'

function renderPage(store: EditorStore) {
  return render(
    <EditorStoreProvider store={store}>
      <PartsPalettePage />
    </EditorStoreProvider>,
  )
}

/** name テキストを含むカード内の「図面に配置」ボタンを取得する。 */
function placeButtonInCardOf(name: string): HTMLElement {
  const card = screen.getByText(name).parentElement as HTMLElement
  return within(card).getByRole('button', { name: '図面に配置' })
}

describe('PartsPalettePage', () => {
  it('3タブとカタログ件数を表示する', () => {
    renderPage(createEditorStore())
    expect(screen.getByText('土木部材パレット')).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: new RegExp(`記号 \\(${SYMBOL_CATALOG.length}\\)`) }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: new RegExp(`テンプレート \\(${TEMPLATE_CATALOG.length}\\)`) }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: new RegExp(`パラメトリック \\(${PARAMETRIC_CATALOG.length}\\)`) }),
    ).toBeInTheDocument()
  })

  it('記号タブは symbolCatalog をカテゴリ別に表示する', () => {
    renderPage(createEditorStore())
    // 既定タブ=記号。cone（カラーコーン）が見える
    expect(screen.getByText('カラーコーン')).toBeInTheDocument()
    // カテゴリ見出し（仮設）
    expect(screen.getByText(/仮設（\d+種）/)).toBeInTheDocument()
  })

  it('記号を配置すると geometries が1件増え undoStack が積まれる', async () => {
    const store = createEditorStore()
    renderPage(store)
    expect(store.getState().geometries).toHaveLength(0)

    await userEvent.click(placeButtonInCardOf('カラーコーン'))

    expect(store.getState().geometries).toHaveLength(1)
    expect(store.getState().geometries[0]?.type).toBe('symbol')
    expect(store.getState().undoStack).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent(/1 件配置しました/)
  })

  it('テンプレートを配置すると shapes 件数ぶん geometries が増える', async () => {
    const store = createEditorStore()
    renderPage(store)
    await userEvent.click(screen.getByRole('tab', { name: /テンプレート/ }))

    const zone = TEMPLATE_CATALOG.find((t) => t.id === 'construction-zone')!
    await userEvent.click(placeButtonInCardOf(zone.name))

    expect(store.getState().geometries).toHaveLength(zone.shapes.length)
    expect(store.getState().undoStack).toHaveLength(zone.shapes.length)
  })

  it('パラメトリックタブはスキーマから既定値付きフォームを生成する', async () => {
    renderPage(createEditorStore())
    await userEvent.click(screen.getByRole('tab', { name: /パラメトリック/ }))

    // 既定選択=heavy-machine-radius。旋回半径の既定4000・機種名の既定が入る
    expect(screen.getByLabelText('旋回半径')).toHaveValue(4000)
    expect(screen.getByLabelText('機種名')).toHaveValue('バックホウ')
    // 中心（point）は X/Y 2入力
    expect(screen.getByLabelText('中心 X')).toHaveValue(0)
    expect(screen.getByLabelText('中心 Y')).toHaveValue(0)
  })

  it('パラメトリックを既定値で配置すると geometries と undoStack が増える', async () => {
    const store = createEditorStore()
    renderPage(store)
    await userEvent.click(screen.getByRole('tab', { name: /パラメトリック/ }))

    await userEvent.click(screen.getByRole('button', { name: '図面に配置' }))

    // heavy-machine-radius = 円・塗り・注記 の3図形
    expect(store.getState().geometries).toHaveLength(3)
    expect(store.getState().undoStack).toHaveLength(3)
    expect(screen.getByRole('status')).toHaveTextContent(/3 件配置しました/)
  })

  it('範囲外パラメータは ValidationIssue を表示し配置しない', async () => {
    const store = createEditorStore()
    renderPage(store)
    await userEvent.click(screen.getByRole('tab', { name: /パラメトリック/ }))

    // 旋回半径を負値へ（exclusiveMin:0 違反）
    fireEvent.change(screen.getByLabelText('旋回半径'), { target: { value: '-100' } })
    await userEvent.click(screen.getByRole('button', { name: '図面に配置' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/範囲外/)
    // 配置は行われない
    expect(store.getState().geometries).toHaveLength(0)
    expect(store.getState().undoStack).toHaveLength(0)
  })

  it('別の定義を選ぶとフォームが切り替わる（法面パターンは勾配入力）', async () => {
    renderPage(createEditorStore())
    await userEvent.click(screen.getByRole('tab', { name: /パラメトリック/ }))

    await userEvent.click(screen.getByRole('button', { name: /法面パターン/ }))
    // slopeRatio の既定表記が入る
    expect(screen.getByLabelText('勾配')).toHaveValue('1:0.5')
  })
})

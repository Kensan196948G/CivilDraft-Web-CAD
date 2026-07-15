import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DrawingComparePage } from '@/app/pages/DrawingComparePage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import { MemoryAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { EditorStore } from '@/app/store/editorStore'
import type { Geometry, GeometryId } from '@/shared/types'

const layer = createDefaultLayer()

/** 直線図形ヘルパー（HomePage.test の circle パターンを踏襲）。 */
function line(
  gid: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  overrides: Partial<Geometry> = {},
): Geometry {
  return {
    id: gid as GeometryId,
    layerId: layer.id,
    type: 'line',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    ...overrides,
  } as Geometry
}

/** 現図面（EditorStore）に図形を注入した状態のストアを作る。 */
function storeWith(geometries: readonly Geometry[]): EditorStore {
  const store = createEditorStore()
  store.getState().addGeometries(geometries)
  return store
}

/** 下書きを保存済みの MemoryAutosaveStore を作る。 */
async function autosaveWith(geometries: readonly Geometry[]): Promise<MemoryAutosaveStore> {
  const autosave = new MemoryAutosaveStore()
  await autosave.save({
    savedAt: '2026-07-15T12:00:00.000Z',
    geometries,
    layers: [layer],
  })
  return autosave
}

function renderPage(store: EditorStore, autosave: MemoryAutosaveStore) {
  return render(
    <EditorStoreProvider store={store}>
      <DrawingComparePage autosaveStore={autosave} />
    </EditorStoreProvider>,
  )
}

/** サブラベルからサマリーカード要素を引く（カードタイトルとバッジの '追加' 衝突を避ける）。 */
function statCardOf(sublabel: string): HTMLElement {
  const el = screen.getByText(sublabel).parentElement
  if (el === null) throw new Error(`card not found for ${sublabel}`)
  return el
}

describe('DrawingComparePage', () => {
  it('下書きが無い場合は「比較対象がありません」を表示し、差分計算を無効化する', async () => {
    const store = createEditorStore()
    renderPage(store, new MemoryAutosaveStore())
    expect(await screen.findByText(/比較対象がありません/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '差分を計算' })).toBeDisabled()
  })

  it('差分計算前はサマリー・明細を表示しない', async () => {
    const autosave = await autosaveWith([line('a', 0, 0, 1, 1)])
    renderPage(storeWith([line('a', 0, 0, 1, 1)]), autosave)
    // 下書き読込完了を待つ
    expect(await screen.findByText(/保存: 2026-07-15/)).toBeInTheDocument()
    expect(screen.queryByText('差分明細')).not.toBeInTheDocument()
    expect(screen.queryByText('差分はありません')).not.toBeInTheDocument()
  })

  it('追加・削除・変更を正しくカウント表示する', async () => {
    // 下書き: a,b,c / 現在: a(座標変更), x,y,z → 追加3・削除2・変更1
    const autosave = await autosaveWith([line('a', 0, 0, 1, 1), line('b', 5, 5, 6, 6), line('c', 7, 7, 8, 8)])
    const store = storeWith([
      line('a', 0, 0, 9, 9),
      line('x', 1, 1, 2, 2),
      line('y', 2, 2, 3, 3),
      line('z', 3, 3, 4, 4),
    ])
    renderPage(store, autosave)

    await userEvent.click(await screen.findByRole('button', { name: '差分を計算' }))

    expect(within(statCardOf('現図面で追加された図形')).getByText('3')).toBeInTheDocument()
    expect(within(statCardOf('下書きから削除された図形')).getByText('2')).toBeInTheDocument()
    expect(within(statCardOf('内訳: 座標 1')).getByText('1')).toBeInTheDocument()
  })

  it('明細テーブルに分類バッジ・図形ID・種別を表示する', async () => {
    const autosave = await autosaveWith([line('a', 0, 0, 1, 1), line('b', 5, 5, 6, 6), line('c', 7, 7, 8, 8)])
    const store = storeWith([
      line('a', 0, 0, 9, 9),
      line('x', 1, 1, 2, 2),
      line('y', 2, 2, 3, 3),
      line('z', 3, 3, 4, 4),
    ])
    renderPage(store, autosave)

    await userEvent.click(await screen.findByRole('button', { name: '差分を計算' }))

    const table = screen.getByRole('table')
    // 分類バッジ（追加3・削除2・変更1）
    expect(within(table).getAllByText('追加')).toHaveLength(3)
    expect(within(table).getAllByText('削除')).toHaveLength(2)
    expect(within(table).getAllByText('変更')).toHaveLength(1)
    // 図形ID・種別・変更内容
    expect(within(table).getByText('x')).toBeInTheDocument()
    expect(within(table).getByText('b')).toBeInTheDocument()
    expect(within(table).getAllByText('line').length).toBeGreaterThanOrEqual(6)
    expect(within(table).getByText('座標')).toBeInTheDocument()
  })

  it('差分が無ければ「差分はありません」を表示する', async () => {
    const same = [line('a', 0, 0, 1, 1), line('b', 2, 2, 3, 3)]
    const autosave = await autosaveWith(same)
    renderPage(storeWith(same), autosave)

    await userEvent.click(await screen.findByRole('button', { name: '差分を計算' }))
    expect(screen.getByText('差分はありません')).toBeInTheDocument()
    expect(screen.queryByText('差分明細')).not.toBeInTheDocument()
  })

  it('属性変更（civilAttributeId）を「変更」として集計し内訳・明細に「属性」を表示する', async () => {
    const autosave = await autosaveWith([line('a', 0, 0, 1, 1, { civilAttributeId: 'attr-1' })])
    const store = storeWith([line('a', 0, 0, 1, 1, { civilAttributeId: 'attr-2' })])
    renderPage(store, autosave)

    await userEvent.click(await screen.findByRole('button', { name: '差分を計算' }))

    expect(within(statCardOf('内訳: 属性 1')).getByText('1')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('変更')).toBeInTheDocument()
    expect(within(table).getByText('属性')).toBeInTheDocument()
  })
})

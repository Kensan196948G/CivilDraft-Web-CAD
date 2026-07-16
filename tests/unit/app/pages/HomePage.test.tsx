import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomePage } from '@/app/pages/HomePage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import { MemoryAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { Geometry, GeometryId } from '@/shared/types'

function circle(gid: string, cx: number, cy: number, r: number): Geometry {
  const layer = createDefaultLayer()
  return {
    id: gid as GeometryId,
    layerId: layer.id,
    type: 'circle',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    center: { x: cx, y: cy },
    radius: r,
  }
}

describe('HomePage', () => {
  it('復旧候補が無い場合はその旨を表示する', async () => {
    const store = createEditorStore()
    render(
      <EditorStoreProvider store={store}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={() => {}} />
      </EditorStoreProvider>,
    )
    expect(await screen.findByText('復旧候補はありません')).toBeInTheDocument()
    expect(screen.getByText('未確定の下書きなし')).toBeInTheDocument()
  })

  it('保存済み下書きがあると復旧候補として表示され、復元でエディタへ読み込まれる', async () => {
    const autosave = new MemoryAutosaveStore()
    await autosave.save({
      savedAt: '2026-07-15T12:00:00.000Z',
      geometries: [circle('a', 0, 0, 5)],
      layers: [createDefaultLayer()],
    })
    const store = createEditorStore()
    const onOpenEditor = vi.fn()
    render(
      <EditorStoreProvider store={store}>
        <HomePage autosaveStore={autosave} onOpenEditor={onOpenEditor} />
      </EditorStoreProvider>,
    )
    expect(await screen.findByText(/図形1件/)).toBeInTheDocument()
    expect(screen.getByText('未確定の下書きあり')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '復元' }))
    expect(onOpenEditor).toHaveBeenCalled()
    expect(store.getState().geometries.map((g) => g.id)).toEqual(['a'])
    expect(store.getIndex().size).toBe(1)
  })

  it('破棄すると下書きが消去され候補なし表示になる', async () => {
    const autosave = new MemoryAutosaveStore()
    await autosave.save({
      savedAt: '2026-07-15T12:00:00.000Z',
      geometries: [circle('a', 0, 0, 5)],
      layers: [createDefaultLayer()],
    })
    const store = createEditorStore()
    render(
      <EditorStoreProvider store={store}>
        <HomePage autosaveStore={autosave} onOpenEditor={() => {}} />
      </EditorStoreProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: '破棄' }))
    await waitFor(() => expect(screen.getByText('下書きを破棄しました')).toBeInTheDocument())
    const loaded = await autosave.load()
    expect(loaded.ok && loaded.value).toBeNull()
  })

  it('新規案件・図面ボタンで専用作成画面を開き、作成後に案件詳細を表示する', async () => {
    const onOpenEditor = vi.fn()
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={onOpenEditor} />
      </EditorStoreProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '＋ 新規案件・図面' }))
    expect(onOpenEditor).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '案件と図面を作成' })).toBeInTheDocument()

    const projectNameInput = screen.getByDisplayValue('新規施工ヤード計画')
    await userEvent.clear(projectNameInput)
    await userEvent.type(projectNameInput, '新規排水計画')
    await userEvent.click(screen.getByRole('button', { name: '案件と図面を作成' }))

    expect(screen.getByText('案件詳細: 新規排水計画')).toBeInTheDocument()
    expect(screen.getByText('施工ヤード計画図 を初期図面として作成')).toBeInTheDocument()
    expect(onOpenEditor).not.toHaveBeenCalled()
  })

  it('案件一覧、すべて表示、最近開いた図面、お知らせ、統計カードが詳細表示に切り替わる', async () => {
    const onOpenEditor = vi.fn()
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={onOpenEditor} />
      </EditorStoreProvider>,
    )

    await userEvent.click(screen.getAllByText('大和川 河川護岸補修工事')[0]!)
    expect(screen.getByText('案件詳細: 大和川 河川護岸補修工事')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'すべて表示 →' }))
    expect(screen.getByText('すべての案件')).toBeInTheDocument()
    expect(screen.getByText('高台地区 法面補強工事')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /施工ヤード計画図 Rev\.3/ }))
    expect(screen.getByText('最近開いた図面: 施工ヤード計画図')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'CAD編集で開く' }))
    expect(onOpenEditor).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: /定期メンテナンス予定/ }))
    expect(screen.getByText('お知らせ詳細')).toBeInTheDocument()
    expect(screen.getByText(/共有版の認証・監査ログ基盤メンテナンス予定です/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /照査待ち図面/ }))
    expect(screen.getByText('統計カード対象の案件')).toBeInTheDocument()
    expect(screen.getByText('港湾第3岸壁 排水改良')).toBeInTheDocument()
  })

  it('デザイン正本のサンプル案件・統計・お知らせが表示される（Home.dc.html 100%適用）', () => {
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={() => {}} />
      </EditorStoreProvider>,
    )
    expect(screen.getAllByText('国道245号 道路拡幅工事').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('進行中案件')).toBeInTheDocument()
    expect(screen.getByText('照査待ち図面')).toBeInTheDocument()
    expect(screen.getByText(/定期メンテナンス/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('案件名・図面番号で検索')).toBeInTheDocument()
  })
})

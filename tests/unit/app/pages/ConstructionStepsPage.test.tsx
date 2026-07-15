import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConstructionStepsPage } from '@/app/pages/ConstructionStepsPage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import { filterGeometriesByStep, stepIdOf } from '@/domain/construction-steps'
import type { EditorStore } from '@/app/store/editorStore'
import type { Geometry, GeometryId } from '@/shared/types'

/** 指定した施工ステップ code 群を割り当てた線分図形を作る（空配列=全ステップ共通）。 */
function lineGeo(gid: string, stepCodes: readonly string[]): Geometry {
  const layer = createDefaultLayer()
  return {
    id: gid as GeometryId,
    layerId: layer.id,
    type: 'line',
    style: layer.defaultStyle,
    constructionStepIds: stepCodes.map(stepIdOf),
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
  }
}

function renderPage(store: EditorStore) {
  return render(
    <EditorStoreProvider store={store}>
      <ConstructionStepsPage />
    </EditorStoreProvider>,
  )
}

describe('ConstructionStepsPage', () => {
  it('既定6ステップと「全表示」ボタンを表示する', () => {
    renderPage(createEditorStore())
    expect(screen.getByRole('button', { name: /全表示/ })).toBeInTheDocument()
    for (const name of ['施工前', '掘削時', '仮設設置時', '構造物施工時', '埋戻し時', '完成時']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    }
  })

  it('初期は「全表示」がアクティブで、ステップ選択でアクティブ表示が切り替わる', async () => {
    renderPage(createEditorStore())
    expect(screen.getByRole('button', { name: /全表示/ })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: /掘削時/ }))
    expect(screen.getByRole('button', { name: /掘削時/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /全表示/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /施工前/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('表示件数が filterGeometriesByStep の結果と一致する（割当済み/未割当を注入）', async () => {
    const store = createEditorStore()
    store.getState().addGeometries([
      lineGeo('g1', ['excavation']),
      lineGeo('g2', []), // 未割当（全ステップ共通）
      lineGeo('g3', ['structure']),
      lineGeo('g4', ['excavation', 'structure']),
    ])
    renderPage(store)

    const expected = filterGeometriesByStep(store.getState().geometries, stepIdOf('excavation')).length
    expect(expected).toBe(3) // g1, g4（割当）+ g2（全ステップ共通）

    await userEvent.click(screen.getByRole('button', { name: /掘削時/ }))
    expect(
      screen.getByText(new RegExp(`このステップで表示される図形: ${expected}件 / 全4件`)),
    ).toBeInTheDocument()
  })

  it('未割当図形数を「全ステップ共通」として集計表示する', () => {
    const store = createEditorStore()
    store.getState().addGeometries([
      lineGeo('g1', ['excavation']),
      lineGeo('g2', []),
      lineGeo('g3', []),
    ])
    renderPage(store)

    const label = screen.getByText('ステップ未割当図形')
    const card = label.parentElement as HTMLElement
    expect(within(card).getByText('2')).toBeInTheDocument()
  })

  it('空図面では表示件数・全件数ともに0を表示する', () => {
    renderPage(createEditorStore())
    expect(
      screen.getByText(/このステップで表示される図形: 0件 \/ 全0件/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /全表示/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('ステップ選択後に「全表示」へ戻すと全図形が対象になる', async () => {
    const store = createEditorStore()
    store.getState().addGeometries([lineGeo('g1', ['excavation']), lineGeo('g2', ['structure'])])
    renderPage(store)

    await userEvent.click(screen.getByRole('button', { name: /構造物施工時/ }))
    expect(screen.getByText(/このステップで表示される図形: 1件 \/ 全2件/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /全表示/ }))
    expect(screen.getByText(/このステップで表示される図形: 2件 \/ 全2件/)).toBeInTheDocument()
  })

  it('ステップ選択が EditorStore の currentStepId へ反映される（store 連動）', async () => {
    const store = createEditorStore()
    renderPage(store)
    expect(store.getState().currentStepId).toBeNull() // 初期は全表示

    await userEvent.click(screen.getByRole('button', { name: /掘削時/ }))
    expect(store.getState().currentStepId).toBe(stepIdOf('excavation'))

    await userEvent.click(screen.getByRole('button', { name: /全表示/ }))
    expect(store.getState().currentStepId).toBeNull()
  })
})

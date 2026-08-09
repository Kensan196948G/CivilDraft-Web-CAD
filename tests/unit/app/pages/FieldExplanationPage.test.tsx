import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldExplanationPage } from '@/app/pages/FieldExplanationPage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import type { EditorStore } from '@/app/store/editorStore'
import type { Geometry, GeometryId } from '@/shared/types'

function lineGeo(gid: string): Geometry {
  const layer = createDefaultLayer()
  return {
    id: gid as GeometryId,
    layerId: layer.id,
    type: 'line',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
  }
}

function renderPage(store: EditorStore, props: Parameters<typeof FieldExplanationPage>[0] = {}) {
  return render(
    <EditorStoreProvider store={store}>
      <FieldExplanationPage {...props} />
    </EditorStoreProvider>,
  )
}

describe('FieldExplanationPage', () => {
  it('案件・図面・改訂情報を表示する', () => {
    renderPage(createEditorStore(), {
      cloudDraftSession: {
        projectNumber: 'P-001',
        projectName: '試験工事',
        clientName: '国土交通省',
        drawingNumber: 'D-01',
        drawingName: '仮設平面図',
        drawingType: 'general',
        revisionNumber: '2',
        changeSummary: '修正',
      },
    })
    expect(screen.getByText('試験工事')).toBeInTheDocument()
    expect(screen.getByText('仮設平面図')).toBeInTheDocument()
    expect(screen.getByText(/D-01 \/ Rev\.2/)).toBeInTheDocument()
  })

  it('承認状態バッジを表示する（未指定は未取得）', () => {
    renderPage(createEditorStore())
    expect(screen.getByLabelText('承認状態: 未取得')).toBeInTheDocument()
  })

  it('承認済みのバッジを表示する', () => {
    renderPage(createEditorStore(), { revisionStatus: 'approved' })
    expect(screen.getByLabelText('承認状態: 承認済み')).toBeInTheDocument()
  })

  it('空図面では数量データの案内を表示する', () => {
    renderPage(createEditorStore())
    expect(screen.getByText(/数量データがありません/)).toBeInTheDocument()
  })

  it('「次へ」で施工ステップが前進する', async () => {
    const store = createEditorStore()
    renderPage(store)
    expect(screen.getByText('全表示')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /次へ/ }))
    expect(store.getState().currentStepId).not.toBeNull()
  })

  it('数量行クリックで根拠図形をハイライトする', async () => {
    const store = createEditorStore()
    store.getState().addGeometries([lineGeo('g1')])
    renderPage(store)
    const row = screen.getByRole('row', { name: /数量行/ })
    expect(row).toBeInTheDocument()
    await userEvent.click(row)
    expect(store.getState().highlightedGeometryIds).toContain('g1')
    expect(screen.getByText(/ハイライトしました/)).toBeInTheDocument()
  })
})

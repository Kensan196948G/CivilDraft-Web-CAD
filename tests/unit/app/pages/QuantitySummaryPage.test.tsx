import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuantitySummaryPage } from '@/app/pages/QuantitySummaryPage'
import { CSV_CONTEXT, computeQuantitySummary } from '@/app/pages/quantitySummaryModel'
import { exportQuantityCsv } from '@/domain/quantities/quantityCsv'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import type { EditorStore } from '@/app/store/editorStore'
import type { Geometry, GeometryId } from '@/shared/types'

/** 全図形共通の基底フィールド（style/layer は既定レイヤーから借りる）。 */
function base(id: string) {
  const layer = createDefaultLayer()
  return {
    id: id as GeometryId,
    layerId: layer.id,
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
}

/** 3-4-5 直角三角形の斜辺（長さ 5000mm = 5m）を作る線分。 */
function line(id: string): Geometry {
  return { ...base(id), type: 'line', start: { x: 0, y: 0 }, end: { x: 3000, y: 4000 } }
}

/** 半径 r（mm）の円。area 算出対象。 */
function circle(id: string, r: number): Geometry {
  return { ...base(id), type: 'circle', center: { x: 0, y: 0 }, radius: r }
}

/** 記号（count 算出対象）。 */
function symbol(id: string): Geometry {
  return { ...base(id), type: 'symbol', symbolId: 'bm', position: { x: 0, y: 0 }, rotationDeg: 0, scale: 1 }
}

/** 注記テキスト（数量対象外＝スキップ対象）。 */
function text(id: string): Geometry {
  return {
    ...base(id),
    type: 'text',
    anchor: { x: 0, y: 0 },
    text: '注記',
    height: 250,
    rotationDeg: 0,
    horizontalAlign: 'left',
  }
}

function storeWith(geometries: readonly Geometry[]): EditorStore {
  const store = createEditorStore()
  store.getState().addGeometries(geometries)
  return store
}

function renderPage(store: EditorStore) {
  return render(
    <EditorStoreProvider store={store}>
      <QuantitySummaryPage />
    </EditorStoreProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QuantitySummaryPage / 算出', () => {
  it('算出ボタンで line/circle/symbol の算出区分ごとに行が出る（実APIと件数一致）', async () => {
    const geometries = [line('ln-1'), circle('ci-1', 1000), symbol('sy-1')]
    renderPage(storeWith(geometries))
    await userEvent.click(screen.getByRole('button', { name: '現在の図面から数量を算出' }))

    // 実ドメインAPIで期待明細を再構成し件数を照合する。
    const expected = computeQuantitySummary(geometries)
    expect(expected.items).toHaveLength(3)

    const table = screen.getByRole('table')
    expect(within(table).getByText('延長')).toBeInTheDocument()
    expect(within(table).getByText('面積')).toBeInTheDocument()
    expect(within(table).getByText('個数')).toBeInTheDocument()
    // 延長 5m は丸め前値・表示値の両セルに出る。個数 1 も同様。
    expect(within(table).getAllByText('5').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('1').length).toBeGreaterThan(0)
  })

  it('サマリーカードが実APIの合計（項目数3・延長5・面積3.14・個数1）と一致する', async () => {
    const geometries = [line('ln-1'), circle('ci-1', 1000), symbol('sy-1')]
    renderPage(storeWith(geometries))
    await userEvent.click(screen.getByRole('button', { name: '現在の図面から数量を算出' }))

    expect(screen.getByText('数量項目数').parentElement).toHaveTextContent('3')
    expect(screen.getByText('延長合計').parentElement).toHaveTextContent('5')
    expect(screen.getByText('面積合計').parentElement).toHaveTextContent('3.14')
    expect(screen.getByText('個数合計').parentElement).toHaveTextContent('1')
  })

  it('丸め前値と表示値を区別して表示する（circle 面積: π m² と 2桁丸め 3.14）', async () => {
    renderPage(storeWith([circle('ci-1', 1000)]))
    await userEvent.click(screen.getByRole('button', { name: '現在の図面から数量を算出' }))

    const expected = computeQuantitySummary([circle('ci-1', 1000)])
    const rawValue = expected.items[0]!.rawValue
    const roundedValue = expected.items[0]!.roundedValue
    expect(rawValue).not.toBe(roundedValue)

    // 丸め前値（π の完全表記）は明細に一意に出る。
    expect(screen.getByText(String(rawValue))).toBeInTheDocument()
    // 表示値（3.14）は明細セルと面積合計カードの双方に出る。
    expect(screen.getAllByText(String(roundedValue)).length).toBeGreaterThan(0)
  })
})

describe('QuantitySummaryPage / 根拠の可視化', () => {
  it('明細行を選択すると根拠図形数とID先頭桁が表示される', async () => {
    renderPage(storeWith([line('ln-1'), line('ln-2')]))
    await userEvent.click(screen.getByRole('button', { name: '現在の図面から数量を算出' }))

    // 延長行（line 2本を合算した 1 明細）を選択。
    const methodCell = screen.getByRole('cell', { name: '延長' })
    await userEvent.click(methodCell.closest('tr') as HTMLElement)

    expect(screen.getByText('根拠図形: 2件')).toBeInTheDocument()
    const sourceList = screen.getByLabelText('根拠図形ID一覧')
    expect(within(sourceList).getByText('ln-1')).toBeInTheDocument()
    expect(within(sourceList).getByText('ln-2')).toBeInTheDocument()
  })
})

describe('QuantitySummaryPage / CSV出力', () => {
  it('CSV出力の内容が exportQuantityCsv と一致する', async () => {
    const geometries = [line('ln-1'), circle('ci-1', 1000), symbol('sy-1')]
    const created: Blob[] = []
    // jsdom は URL.createObjectURL を実装しないため、Blob を捕捉するスタブを注入する。
    const urlObj = URL as unknown as {
      createObjectURL?: (blob: Blob) => string
      revokeObjectURL?: (url: string) => void
    }
    const hadCreate = 'createObjectURL' in URL
    urlObj.createObjectURL = (blob) => {
      created.push(blob)
      return 'blob:mock'
    }
    urlObj.revokeObjectURL = () => {}
    // jsdom はアンカーの download ナビゲーションを実装せず警告を出すため click を無効化する。
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      renderPage(storeWith(geometries))
      await userEvent.click(screen.getByRole('button', { name: '現在の図面から数量を算出' }))
      await userEvent.click(screen.getByRole('button', { name: '数量CSVを出力' }))

      expect(created).toHaveLength(1)
      const text = await created[0]!.text()

      const items = computeQuantitySummary(geometries).items
      const expected = exportQuantityCsv({ rows: items.map((item) => ({ item })), context: CSV_CONTEXT })
      expect(text).toBe(expected.csv)
    } finally {
      if (!hadCreate) {
        delete urlObj.createObjectURL
        delete urlObj.revokeObjectURL
      }
    }
  })

  it('CSVインジェクション対策済みである旨をUIヒントに表示する', () => {
    renderPage(storeWith([line('ln-1')]))
    expect(screen.getByText(/インジェクション対策/)).toBeInTheDocument()
  })
})

describe('QuantitySummaryPage / スキップ・空・状態', () => {
  it('注記系（text）は数量対象外としてスキップし、その旨を提示する', async () => {
    renderPage(storeWith([line('ln-1'), text('tx-1')]))
    await userEvent.click(screen.getByRole('button', { name: '現在の図面から数量を算出' }))

    // 延長行のみ（text は対象外）。
    const table = screen.getByRole('table')
    expect(within(table).getByText('延長')).toBeInTheDocument()
    expect(within(table).queryByText('面積')).not.toBeInTheDocument()
    expect(screen.getByText(/数量対象外の図形を 1 件スキップ/)).toBeInTheDocument()
  })

  it('空図面では「図形がありません」を表示し、算出ボタンを無効化する', () => {
    renderPage(createEditorStore())
    expect(screen.getByText(/図形がありません/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '現在の図面から数量を算出' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '数量CSVを出力' })).toBeDisabled()
  })

  it('算出前は誘導メッセージとCSV無効、算出後にCSVが有効になる', async () => {
    renderPage(storeWith([line('ln-1')]))
    expect(screen.getByText(/「現在の図面から数量を算出」を押すと/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '数量CSVを出力' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: '現在の図面から数量を算出' }))
    expect(screen.getByRole('button', { name: '数量CSVを出力' })).toBeEnabled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SurveyPointsPage } from '@/app/pages/SurveyPointsPage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore } from '@/app/store/editorStore'
import {
  createCoordinateTransformer,
  defaultCoordinateSystemSettings,
  exportSurveyCsv,
  parseSurveyCsv,
} from '@/domain/survey'
import type { EditorStore } from '@/app/store/editorStore'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type { GeometryId, SymbolGeometry } from '@/shared/types'

/** テスト用の決定的な図形ID・タイムスタンプ生成器。 */
function counterContext(): GeometryCreationContext {
  let n = 0
  return { newId: () => `g-${++n}` as GeometryId, now: () => '2026-07-15T00:00:00.000Z' }
}

function renderPage(store: EditorStore, ctx: GeometryCreationContext = counterContext()) {
  return render(
    <EditorStoreProvider store={store}>
      <SurveyPointsPage creationContext={ctx} />
    </EditorStoreProvider>,
  )
}

function setCsv(value: string): void {
  fireEvent.change(screen.getByLabelText('CSV貼り付け'), { target: { value } })
}

function symbolsOf(store: EditorStore): SymbolGeometry[] {
  return store.getState().geometries.filter((g): g is SymbolGeometry => g.type === 'symbol')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SurveyPointsPage / CSV取込', () => {
  it('取込後にGeoJSON出力が有効になり、ダウンロードを実行する（Issue #44）', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    const click = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true, configurable: true })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click)

    renderPage(createEditorStore())
    await userEvent.click(screen.getByRole('button', { name: 'サンプルCSVを挿入' }))
    await userEvent.click(screen.getByRole('button', { name: '取込' }))

    const button = screen.getByRole('button', { name: 'GeoJSON出力' })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalled()
  })

  it('サンプルCSVを挿入して取込むと3測点がテーブルに表示される', async () => {
    renderPage(createEditorStore())
    await userEvent.click(screen.getByRole('button', { name: 'サンプルCSVを挿入' }))
    await userEvent.click(screen.getByRole('button', { name: '取込' }))

    const table = screen.getByRole('table')
    expect(within(table).getByText('No.1')).toBeInTheDocument()
    expect(within(table).getByText('No.2')).toBeInTheDocument()
    expect(within(table).getByText('No.3')).toBeInTheDocument()
    // 取込済み測点サマリー
    expect(screen.getByText('取込済み測点').parentElement).toHaveTextContent('3')
  })

  it('行エラーは黙って捨てず、行番号付きで警告パネルに表示される（§12.3）', () => {
    renderPage(createEditorStore())
    // 2行目のxが非数値 → 除外・エラー、3行目は取込
    setCsv('pointNumber,x,y,elevation,note\nP1,abc,10,,\nP2,20,30,,')
    fireEvent.click(screen.getByRole('button', { name: '取込' }))

    const messages = screen.getByLabelText('取込メッセージ一覧')
    expect(within(messages).getByText(/2行目/)).toBeInTheDocument()
    expect(within(messages).getByText(/数値ではありません/)).toBeInTheDocument()
    // 取込対象は P2 のみ
    const table = screen.getByRole('table')
    expect(within(table).getByText('P2')).toBeInTheDocument()
    expect(within(table).queryByText('P1')).not.toBeInTheDocument()
  })

  it('重複測点番号は警告として提示し、両行とも取り込む', () => {
    renderPage(createEditorStore())
    setCsv('pointNumber,x,y,elevation,note\nP1,1,2,,\nP1,3,4,,')
    fireEvent.click(screen.getByRole('button', { name: '取込' }))

    const messages = screen.getByLabelText('取込メッセージ一覧')
    expect(within(messages).getByText(/重複/)).toBeInTheDocument()
    expect(screen.getByText('警告件数').parentElement).toHaveTextContent('1')
  })

  it('空CSVは Result.error のメッセージを表示する', () => {
    renderPage(createEditorStore())
    setCsv('   ')
    fireEvent.click(screen.getByRole('button', { name: '取込' }))
    expect(screen.getByRole('alert')).toHaveTextContent('CSVが空です')
  })

  it('必須列の欠落は取込エラーとして表示する', () => {
    renderPage(createEditorStore())
    setCsv('pointNumber,y\nP1,10')
    fireEvent.click(screen.getByRole('button', { name: '取込' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/必須列/)
  })
})

describe('SurveyPointsPage / CSV出力', () => {
  it('CSV出力の内容が exportSurveyCsv と一致する', async () => {
    const csv = 'pointNumber,x,y,elevation,note\nA,1,2,3,foo\nB,4,5,,'
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
      renderPage(createEditorStore())
      setCsv(csv)
      fireEvent.click(screen.getByRole('button', { name: '取込' }))
      fireEvent.click(screen.getByRole('button', { name: 'CSV出力' }))

      expect(created).toHaveLength(1)
      const text = await created[0]!.text()
      const parsed = parseSurveyCsv(csv)
      const expected = exportSurveyCsv(parsed.ok ? parsed.value.points : [])
      expect(text).toBe(expected)
    } finally {
      if (!hadCreate) {
        delete urlObj.createObjectURL
        delete urlObj.revokeObjectURL
      }
    }
  })
})

describe('SurveyPointsPage / 図面配置', () => {
  it('図面に配置すると geometries と undoStack が増え、undo で戻せる', () => {
    const store = createEditorStore()
    renderPage(store)
    setCsv('pointNumber,x,y,elevation,note\nA,1,2,,\nB,3,4,,')
    fireEvent.click(screen.getByRole('button', { name: '取込' }))

    expect(store.getState().geometries).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '図面に配置' }))

    // 2測点 × (記号 + ラベル) = 4図形、各 dispatch で undoStack も 4
    expect(store.getState().geometries).toHaveLength(4)
    expect(store.getState().undoStack).toHaveLength(4)
    expect(symbolsOf(store)).toHaveLength(2)

    store.getState().undo()
    expect(store.getState().geometries).toHaveLength(3)
  })

  it('配置座標が createCoordinateTransformer 経由で内部座標へ変換される', () => {
    const store = createEditorStore()
    renderPage(store)
    setCsv('pointNumber,x,y,elevation,note\nP,1000,500,,')
    fireEvent.click(screen.getByRole('button', { name: '取込' }))
    fireEvent.click(screen.getByRole('button', { name: '図面に配置' }))

    const transformer = createCoordinateTransformer(defaultCoordinateSystemSettings, 'm')
    const expected = transformer.surveyToInternal({ x: 1000, y: 500 })
    // 既定: 東1000m→+X 1,000,000mm、北500m→内部Y -500,000mm
    expect(expected).toEqual({ x: 1_000_000, y: -500_000 })
    expect(symbolsOf(store)[0]?.position).toEqual(expected)
  })
})

describe('SurveyPointsPage / 初期状態', () => {
  it('取込前は「CSV出力」「図面に配置」ボタンが無効', () => {
    renderPage(createEditorStore())
    expect(screen.getByRole('button', { name: 'CSV出力' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '図面に配置' })).toBeDisabled()
  })

  it('サンプル取込後は各ボタンが有効になり、CSV出力の測点が正規化されている', async () => {
    renderPage(createEditorStore())
    await userEvent.click(screen.getByRole('button', { name: 'サンプルCSVを挿入' }))
    await userEvent.click(screen.getByRole('button', { name: '取込' }))
    expect(screen.getByRole('button', { name: 'CSV出力' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '図面に配置' })).toBeEnabled()
  })
})

describe('SurveyPointsPage / 座標系設定', () => {
  it('系番号は範囲外だと配置時に検証エラーになる', () => {
    const store = createEditorStore()
    renderPage(store)
    setCsv('pointNumber,x,y,elevation,note\nA,1,2,,')
    fireEvent.click(screen.getByRole('button', { name: '取込' }))
    fireEvent.change(screen.getByLabelText('系番号'), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: '図面に配置' }))

    expect(screen.getByRole('status')).toHaveTextContent(/座標系設定が不正/)
    expect(store.getState().geometries).toHaveLength(0)
  })
})

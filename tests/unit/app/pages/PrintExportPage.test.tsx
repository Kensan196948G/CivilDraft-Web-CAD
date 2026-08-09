import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrintExportPage } from '@/app/pages/PrintExportPage'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore } from '@/app/store/editorStore'
import { createDemoDrawingGeometries } from '@/app/demoData'

vi.mock('@/infrastructure/pdf/fontLoader', () => ({
  loadJapaneseFont: async () => ({ ok: false, error: new Error('font unavailable in unit test') }),
}))

vi.mock('@/domain/pdf/pdfExporter', () => ({
  exportPdf: async () => ({ ok: true, value: { bytes: new Uint8Array([37, 80, 68, 70]), issues: [] } }),
}))

vi.mock('@/domain/dxf/dxfExporter', () => ({
  exportDxf: () => '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF',
}))

function mockDownloads() {
  const blobs: Blob[] = []
  const urlObj = URL as unknown as {
    createObjectURL?: (blob: Blob) => string
    revokeObjectURL?: (url: string) => void
  }
  urlObj.createObjectURL = (blob) => {
    blobs.push(blob)
    return 'blob:mock'
  }
  urlObj.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  return blobs
}

afterEach(() => {
  vi.restoreAllMocks()
  // createObjectURL/revokeObjectURL は直接代入のためvi.restoreAllMocksでは戻らず、明示的に削除する
  const urlObj = URL as unknown as {
    createObjectURL?: (blob: Blob) => string
    revokeObjectURL?: (url: string) => void
  }
  delete urlObj.createObjectURL
  delete urlObj.revokeObjectURL
})

describe('PrintExportPage', () => {
  it('本番モード（enableSampleHistory=false）では初期サンプル履歴を表示しない', () => {
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <PrintExportPage enableSampleHistory={false} />
      </EditorStoreProvider>,
    )
    expect(screen.getByText(/出力履歴はまだありません/)).toBeInTheDocument()
    expect(screen.queryByText('PDF・Rev.2')).not.toBeInTheDocument()
    expect(screen.queryByText('DXF・Rev.1')).not.toBeInTheDocument()
  })

  it('指定された出力画面を表示し、PDF/DXF/CSVを出力して履歴へ追加する', async () => {
    const blobs = mockDownloads()
    const store = createEditorStore()
    store.getState().addGeometries(createDemoDrawingGeometries())
    render(
      <EditorStoreProvider store={store}>
        <PrintExportPage />
      </EditorStoreProvider>,
    )

    expect(screen.getByText('施工ヤード計画図 Rev.3 ・ プレビュー、PDF、DXF、CSV、警告')).toBeInTheDocument()
    expect(screen.getByText('出力プレビュー（A1横・S=1:500）')).toBeInTheDocument()
    expect(screen.getByText('⚠ 資材置場Bが用紙範囲外にはみ出しています。')).toBeInTheDocument()
    expect(screen.getByText('ⓘ DXF出力では土木属性の一部が失われる場合があります。')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('DXF（CAD交換用）'))
    await userEvent.click(screen.getByLabelText('CSV（数量根拠付き）'))
    await userEvent.click(screen.getByRole('button', { name: '出力を実行' }))

    await waitFor(() => expect(blobs.length).toBeGreaterThanOrEqual(3))
    expect(screen.getByText(/出力完了:/)).toBeInTheDocument()
    expect(screen.getByText(/PDF・DXF・CSV・Rev\.3/)).toBeInTheDocument()
  })

})

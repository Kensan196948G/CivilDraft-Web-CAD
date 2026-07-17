import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuditLogPage } from '@/app/pages/AuditLogPage'

vi.mock('@/infrastructure/pdf/fontLoader', () => ({
  loadJapaneseFont: async () => ({ ok: false, error: new Error('font unavailable in unit test') }),
}))

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    create: async () => ({
      addPage: () => ({
        drawText: vi.fn(),
      }),
      embedFont: async () => ({}),
      save: async () => new Uint8Array([37, 80, 68, 70]),
    }),
  },
  StandardFonts: {
    Helvetica: 'Helvetica',
  },
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

describe('AuditLogPage', () => {
  it('監査ログを表示し、CSV/PDF/HTMLエクスポートを生成する', async () => {
    const blobs = mockDownloads()
    render(<AuditLogPage />)

    expect(screen.getByText('保存、承認、出力、認証イベントの記録')).toBeInTheDocument()
    expect(screen.getByText('DWG-014を保存')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'CSVエクスポート' }))
    await userEvent.click(screen.getByRole('button', { name: 'PDFエクスポート' }))
    await userEvent.click(screen.getByRole('button', { name: 'HTMLエクスポート' }))

    await waitFor(() => expect(blobs).toHaveLength(3))
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8')
    expect(blobs[1]?.type).toBe('application/pdf')
    expect(blobs[2]?.type).toBe('text/html;charset=utf-8')
    expect(screen.getByText('HTMLエクスポートを作成しました')).toBeInTheDocument()
  })
})

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
  vi.unstubAllGlobals()
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
    // API 未接続（fail-closed 等）時はサンプル表示へフォールバックする
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network disabled in unit test')))
    const blobs = mockDownloads()
    render(<AuditLogPage />)

    expect(screen.getByText('保存、承認、出力、認証イベントの記録')).toBeInTheDocument()
    expect(screen.getByText('DWG-014を保存')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/監査APIに接続できないためサンプルを表示しています/)).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('button', { name: 'CSVエクスポート' }))
    await userEvent.click(screen.getByRole('button', { name: 'PDFエクスポート' }))
    await userEvent.click(screen.getByRole('button', { name: 'HTMLエクスポート' }))

    await waitFor(() => expect(blobs).toHaveLength(3))
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8')
    expect(blobs[1]?.type).toBe('application/pdf')
    expect(blobs[2]?.type).toBe('text/html;charset=utf-8')
    expect(screen.getByText('HTMLエクスポートを作成しました')).toBeInTheDocument()
  })

  it('API接続時は本番監査ログとチェーン検証結果を表示する（Issue #61）', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/api/v1/audit-logs/verify')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              auditChain: { valid: true, checkedCount: 1, hashedCount: 1, legacyCount: 0, tailHash: 'a'.repeat(64) },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/api/v1/audit-logs')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              auditLogs: [
                {
                  id: 'audit-1',
                  occurredAt: '2026-08-01T00:00:00.000Z',
                  eventName: 'drawing.created',
                  actorId: 'engineer@example.test',
                  entityType: 'drawing',
                  entityId: 'drawing_1',
                  result: 'success',
                  correlationId: 'cid-1',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AuditLogPage />)

    await waitFor(() => expect(screen.getByText('drawing.created')).toBeInTheDocument())
    expect(screen.getByText('engineer@example.test')).toBeInTheDocument()
    expect(screen.getByText(/監査チェーン検証: 正常（1件ハッシュ連結・検査1件）/)).toBeInTheDocument()
    expect(screen.queryByText('DWG-014を保存')).not.toBeInTheDocument()
  })

  it('フィルタ適用とカーソルページングが動作する（Issue #85）', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/api/v1/audit-logs/verify')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              auditChain: { valid: true, checkedCount: 1, hashedCount: 1, legacyCount: 0 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/api/v1/audit-logs')) {
        const isSecondPage = url.includes('cursor=c1')
        return Promise.resolve(
          new Response(
            JSON.stringify({
              auditLogs: [
                {
                  id: isSecondPage ? 'audit-2' : 'audit-1',
                  occurredAt: '2026-08-01T00:00:00.000Z',
                  eventName: 'drawing.created',
                  actorId: 'engineer@example.test',
                  result: 'success',
                  correlationId: 'cid-1',
                },
              ],
              total: 2,
              ...(isSecondPage ? {} : { nextCursor: 'c1' }),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(new Response('{}', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<AuditLogPage />)
    await waitFor(() => expect(screen.getByText('drawing.created')).toBeInTheDocument())
    expect(screen.getByText(/フィルタ該当 2 件・表示 1 件/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'さらに古い記録 →' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('cursor=c1'), expect.anything()),
    )
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SystemSettingsPage } from '@/app/pages/SystemSettingsPage'

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

describe('SystemSettingsPage', () => {
  it('ログインユーザー設定と案件ロール権限を統合して表示する', () => {
    render(<SystemSettingsPage />)

    expect(screen.getByText('ログインユーザー設定・権限（案件ロール）')).toBeInTheDocument()
    expect(screen.getAllByText('山田 太郎').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('taro.yamada@example.jp').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('現在の操作主体として監査ログへ記録')).toBeInTheDocument()

    for (const role of ['作成者', '照査者', '承認者', '管理者']) {
      expect(screen.getAllByText(role).length).toBeGreaterThanOrEqual(1)
    }
    expect(screen.getByText('案件ごとの割当で上書き可能')).toBeInTheDocument()
  })

  it('右側コンテンツに認証、テンプレート、監査ログ設定、システム情報を詳細表示する', () => {
    render(<SystemSettingsPage />)

    expect(screen.getByText('認証・セッション設定')).toBeInTheDocument()
    expect(screen.getAllByText('Cloudflare Access').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('再認証が必要な操作')).toBeInTheDocument()

    expect(screen.getByText('図面テンプレート')).toBeInTheDocument()
    expect(screen.getByText('施工ヤード計画図（標準）')).toBeInTheDocument()
    expect(screen.getByText('1:500')).toBeInTheDocument()

    expect(screen.getByText('監査ログ設定')).toBeInTheDocument()
    expect(screen.getByText('ハッシュチェーン方式（Workers本番接続後）')).toBeInTheDocument()

    expect(screen.getByText('システム情報')).toBeInTheDocument()
    expect(screen.getByText('Cloudflare Workers + Neon（本番接続待ち）')).toBeInTheDocument()
  })

  it('設定をエクスポートし、マスターを追加できる', async () => {
    const blobs = mockDownloads()
    render(<SystemSettingsPage />)

    await userEvent.click(screen.getByRole('button', { name: '設定をエクスポート' }))
    expect(blobs).toHaveLength(1)
    expect(blobs[0]?.type).toBe('application/json')

    await userEvent.click(screen.getByRole('button', { name: '＋ マスターを追加' }))
    expect(screen.getByText('追加工種6')).toBeInTheDocument()
    expect(screen.getByText('現場追加規格')).toBeInTheDocument()
  })
})

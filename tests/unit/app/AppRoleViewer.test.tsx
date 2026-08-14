/**
 * ロール連動の App 統合テスト（Issue #177 / #178）。
 * - viewer ロールでは編集系ナビ・作成ボタン・編集系画面が非表示になる
 * - 現場説明モードは実 revisionId から承認状態を取得して表示する
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

vi.mock('@/app/canvas/CanvasStage', () => ({
  CanvasStage: () => <div data-testid="canvas-stage">CANVAS</div>,
}))
vi.mock('react-konva', () => ({
  Stage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Layer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Rect: () => null,
  Circle: () => null,
  Arc: () => null,
  Text: () => null,
  Arrow: () => null,
  Ellipse: () => null,
  Group: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const { mockGetRevision, mockFetchAccessIdentity } = vi.hoisted(() => ({
  mockGetRevision: vi.fn(),
  mockFetchAccessIdentity: vi.fn(),
}))

vi.mock('@/infrastructure/cloud/civilDraftApiClient', () => ({
  createCivilDraftApiClient: () => ({
    listProjects: vi.fn(async () => ({ ok: true as const, value: [] })),
    createProject: vi.fn(async () => ({ ok: true as const, value: {} })),
    createDrawing: vi.fn(async () => ({ ok: true as const, value: {} })),
    getRevision: mockGetRevision,
  }),
}))
vi.mock('@/infrastructure/auth/accessIdentity', () => ({
  fetchAccessIdentity: mockFetchAccessIdentity,
}))

import { App } from '@/app/App'

const VIEWER_IDENTITY = {
  ok: true as const,
  value: {
    kind: 'authenticated' as const,
    identity: {
      email: 'viewer@example.com',
      name: '閲覧 太郎',
      groups: ['civildraft-viewer'],
    },
  },
}

const ENGINEER_IDENTITY = {
  ok: true as const,
  value: {
    kind: 'authenticated' as const,
    identity: {
      email: 'engineer@example.com',
      name: '作図 次郎',
      groups: ['civildraft-engineer'],
    },
  },
}

afterEach(() => {
  window.location.hash = ''
})

beforeEach(() => {
  mockGetRevision.mockReset()
  mockFetchAccessIdentity.mockReset()
  mockFetchAccessIdentity.mockResolvedValue(VIEWER_IDENTITY)
})

describe('App ロール連動', () => {
  it('viewer ロールではロールバッジが表示され、編集系ナビが非表示になる', async () => {
    render(<App />)
    expect(await screen.findByText('閲覧者')).toBeInTheDocument()
    expect(screen.getByText('閲覧 太郎')).toBeInTheDocument()

    expect(screen.queryByText('新規作図')).not.toBeInTheDocument()
    expect(screen.queryByText('作図編集')).not.toBeInTheDocument()
    expect(screen.queryByText('図面設定')).not.toBeInTheDocument()
    expect(screen.queryByText('土木部材パレット')).not.toBeInTheDocument()
    expect(screen.getByText('測点・座標一覧')).toBeInTheDocument()

    expect(screen.queryByText('照査・承認')).not.toBeInTheDocument()
    expect(screen.getByText('現場説明モード')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '＋ 新規案件・図面' })).not.toBeInTheDocument()
  })

  it('engineer ロールでは編集系ナビと作成ボタンが表示される', async () => {
    mockFetchAccessIdentity.mockResolvedValue(ENGINEER_IDENTITY)
    render(<App />)
    expect(await screen.findByText('技術者')).toBeInTheDocument()
    expect(screen.getByText('新規作図')).toBeInTheDocument()
    expect(screen.getByText('作図編集')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '＋ 新規案件・図面' })).toBeInTheDocument()
  })

  it('viewer が編集系 URL へ deep link してもホームへフォールバックする', async () => {
    window.location.hash = '#/editor?projectNumber=P-1&drawingNumber=D-1'
    render(<App />)
    expect(await screen.findByPlaceholderText('案件名・図面番号で検索')).toBeInTheDocument()
    expect(screen.queryByTestId('canvas-stage')).not.toBeInTheDocument()
  })

  it('現場説明モードは実 revisionId から承認状態を取得して表示する（#178）', async () => {
    mockGetRevision.mockResolvedValue({
      ok: true,
      value: {
        id: 'rev-1',
        drawingId: 'd-1',
        revisionNumber: 'R1',
        status: 'approved',
        contentVersion: 1,
        contentChecksum: 'sha256:x',
      },
    })
    window.location.hash =
      '#/editor?projectNumber=P-1&projectName=実工事&drawingNumber=D-1&drawingName=仮設図&revisionNumber=R1&revisionId=rev-1'
    render(<App />)
    expect(await screen.findByPlaceholderText('案件名・図面番号で検索')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /現場説明モード/ }))

    expect(mockGetRevision).toHaveBeenCalledWith('rev-1')
    expect(await screen.findByText('📢 現場説明モード', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(
      await screen.findByLabelText('承認状態: 承認済み', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  })

  it('承認状態の取得失敗時は「未取得」のまま表示する（#178）', async () => {
    mockGetRevision.mockResolvedValue({
      ok: false,
      error: { code: 'CD-AUTH-001', severity: 'error', message: '認証情報がありません' },
    })
    window.location.hash =
      '#/editor?projectNumber=P-1&projectName=実工事&drawingNumber=D-1&drawingName=仮設図&revisionNumber=R1&revisionId=rev-1'
    render(<App />)
    expect(await screen.findByPlaceholderText('案件名・図面番号で検索')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /現場説明モード/ }))

    expect(
      await screen.findByLabelText('承認状態: 未取得', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(mockGetRevision).toHaveBeenCalledWith('rev-1')
  })
})

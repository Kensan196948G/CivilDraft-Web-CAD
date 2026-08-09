import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectDetailPage } from '@/app/pages/ProjectDetailPage'
import type { ProjectDetailCloudClient } from '@/app/pages/ProjectDetailCloudPage'

describe('ProjectDetailPage', () => {
  it('指定された案件情報、図面一覧、メンバー、アクティビティを表示する', () => {
    render(<ProjectDetailPage onOpenEditor={() => {}} />)

    expect(screen.getByText('国道245号 道路拡幅工事')).toBeInTheDocument()
    expect(screen.getByText('2工区 ・ 発注者: ○○県土木部 ・ 工期 2026-04-01〜2027-03-31')).toBeInTheDocument()
    expect(screen.getByText('進行中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'すべて12' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '施工ヤード図3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '仮設計画図2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '土工・断面図4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '数量根拠図3' })).toBeInTheDocument()
    expect(screen.getByText('DWG-014')).toBeInTheDocument()
    expect(screen.getByText('施工ヤード計画図')).toBeInTheDocument()
    expect(screen.getByText('平面直角座標系 第Ⅵ系')).toBeInTheDocument()
    expect(screen.getByText('山田 太郎が DWG-014 Rev.3 を保存')).toBeInTheDocument()
  })

  it('案件編集、図面作成、図面種別フィルター、図面詳細が機能する', async () => {
    const onOpenEditor = vi.fn()
    render(<ProjectDetailPage onOpenEditor={onOpenEditor} />)

    await userEvent.click(screen.getByRole('button', { name: '案件を編集' }))
    fireEvent.change(screen.getByDisplayValue('国道245号 道路拡幅工事'), {
      target: { value: '国道245号 道路拡幅工事（変更）' },
    })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByText('国道245号 道路拡幅工事（変更）')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '＋ 図面を作成' }))
    fireEvent.change(screen.getByDisplayValue('新規施工ヤード計画図'), {
      target: { value: '新規仮設道路計画図' },
    })
    fireEvent.change(screen.getByDisplayValue('施工ヤード図'), {
      target: { value: '仮設計画図' },
    })
    await userEvent.click(screen.getByRole('button', { name: '作成' }))
    expect(screen.getByText('図面詳細: DWG-027 新規仮設道路計画図')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'CAD編集で開く' }))
    expect(onOpenEditor).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: '仮設計画図3' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('新規仮設道路計画図')).toBeInTheDocument()
    expect(within(table).queryByText('施工ヤード排水計画図')).not.toBeInTheDocument()

    await userEvent.click(within(table).getByText('DWG-011'))
    expect(screen.getByText('図面詳細: DWG-011 仮設計画図（矢板・切梁）')).toBeInTheDocument()
  })
})

describe('ProjectDetailPage / 実データ版（Issue #62）', () => {
  const realProject = {
    id: 'p-1',
    projectNumber: 'P-REAL-001',
    name: '本番実案件',
    clientName: 'テスト発注者',
    status: 'active' as const,
    version: 3,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  }
  const realDrawings = [
    {
      id: 'd-1',
      projectId: 'p-1',
      drawingNumber: 'DWG-001',
      name: '施工ヤード計画図',
      drawingType: 'temporary-yard-plan',
      status: 'active' as const,
      updatedAt: '2026-08-08T00:00:00.000Z',
      updatedBy: 'engineer@example.test',
      version: 2,
    },
  ]
  const realMembers = [{ projectId: 'p-1', userId: 'engineer@example.test', role: 'manager' as const }]

  function okClient(): ProjectDetailCloudClient {
    return {
      getProject: vi.fn(async () => ({ ok: true, value: realProject })),
      listProjectDrawings: vi.fn(async () => ({ ok: true, value: realDrawings })),
      listProjectMembers: vi.fn(async () => ({ ok: true, value: realMembers })),
      updateProject: vi.fn(async (_projectId, input) => ({
        ok: true,
        value: { ...realProject, ...input },
      })),
      createDrawing: vi.fn(async () => ({
        ok: true,
        value: {
          ...realDrawings[0]!,
          id: 'd-2',
          drawingNumber: 'DWG-002',
          name: '新規仮設道路計画図',
          drawingType: 'temporary-plan',
        },
      })),
    }
  }

  it('案件未選択時は空状態とホームへの導線を表示する', () => {
    const onNavigateHome = vi.fn()
    render(
      <ProjectDetailPage
        enableCloudData
        cloudApiClient={okClient()}
        onNavigateHome={onNavigateHome}
      />,
    )
    expect(screen.getByText('案件が選択されていません')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ホームへ戻る' }))
    expect(onNavigateHome).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('国道245号 道路拡幅工事')).not.toBeInTheDocument()
  })

  it('API から実案件・図面・メンバーを取得して表示する', async () => {
    render(
      <ProjectDetailPage
        enableCloudData
        projectId="p-1"
        cloudApiClient={okClient()}
        onOpenEditor={vi.fn()}
      />,
    )
    expect(await screen.findByText('本番実案件')).toBeInTheDocument()
    expect(screen.getAllByText(/P-REAL-001/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('DWG-001')).toBeInTheDocument()
    expect(screen.getByText('施工ヤード計画図')).toBeInTheDocument()
    expect(screen.getAllByText('engineer@example.test').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('管理者')).toBeInTheDocument()
    expect(screen.getByText(/活動履歴の取得は未実装/)).toBeInTheDocument()
    expect(screen.queryByText('国道245号 道路拡幅工事')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('DWG-001'))
    expect(screen.getByRole('button', { name: 'CAD編集で開く' })).toBeDisabled()
  })

  it('API エラー時はエラー表示になりサンプルへフォールバックしない', async () => {
    const failingClient: ProjectDetailCloudClient = {
      ...okClient(),
      getProject: vi.fn(async () => ({
        ok: false,
        error: { code: 'CD-AUTH-001', severity: 'error' as const, message: '認証情報がありません' },
      })),
    }
    render(
      <ProjectDetailPage enableCloudData projectId="p-1" cloudApiClient={failingClient} />,
    )
    expect(await screen.findByText(/案件データを取得できませんでした/)).toBeInTheDocument()
    expect(screen.getByText('認証情報がありません')).toBeInTheDocument()
    expect(screen.queryByText('国道245号 道路拡幅工事')).not.toBeInTheDocument()
  })

  it('案件編集は PATCH API を expectedVersion 付きで呼び出す', async () => {
    const client = okClient()
    render(<ProjectDetailPage enableCloudData projectId="p-1" cloudApiClient={client} />)
    await screen.findByText('本番実案件')

    await userEvent.click(screen.getByRole('button', { name: '案件を編集' }))
    fireEvent.change(screen.getByDisplayValue('本番実案件'), {
      target: { value: '本番実案件（更新）' },
    })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('本番実案件（更新）')).toBeInTheDocument()
    expect(client.updateProject).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ name: '本番実案件（更新）', expectedVersion: 3 }),
    )
  })

  it('図面作成は POST API を呼び出し、再取得した一覧へ反映する', async () => {
    const client = okClient()
    render(<ProjectDetailPage enableCloudData projectId="p-1" cloudApiClient={client} />)
    await screen.findByText('本番実案件')

    await userEvent.click(screen.getByRole('button', { name: '＋ 図面を作成' }))
    fireEvent.change(screen.getByDisplayValue('新規施工ヤード計画図'), {
      target: { value: '新規仮設道路計画図' },
    })
    await userEvent.click(screen.getByRole('button', { name: '作成' }))

    expect(await screen.findByText(/DWG-002 新規仮設道路計画図/)).toBeInTheDocument()
    expect(client.createDrawing).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ drawingNumber: 'DWG-002', name: '新規仮設道路計画図' }),
    )
    expect(client.listProjectDrawings).toHaveBeenCalledTimes(2)
  })
})

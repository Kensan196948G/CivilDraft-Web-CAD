import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ProjectDetailCloudPage,
  type ProjectDetailCloudClient,
} from '@/app/pages/ProjectDetailCloudPage'
import type {
  CloudDrawing,
  CloudProject,
  CloudProjectMember,
} from '@/infrastructure/cloud/civilDraftApiClient'

const PROJECT: CloudProject = {
  id: 'p-1',
  projectNumber: 'P-REAL-001',
  name: '本番実案件',
  clientName: 'テスト発注者',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  updatedBy: 'engineer@example.test',
  version: 2,
}

const DRAWING: CloudDrawing = {
  id: 'd-1',
  projectId: 'p-1',
  drawingNumber: 'DWG-001',
  name: '施工ヤード計画図',
  drawingType: 'temporary-yard-plan',
  status: 'active',
  updatedAt: '2026-08-09T00:00:00.000Z',
  updatedBy: 'engineer@example.test',
  version: 1,
}

const MEMBER: CloudProjectMember = {
  projectId: 'p-1',
  userId: 'engineer@example.test',
  role: 'manager',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

function makeClient(overrides: Partial<ProjectDetailCloudClient> = {}): ProjectDetailCloudClient {
  return {
    getProject: vi.fn(async () => ({ ok: true, value: PROJECT })),
    listProjectDrawings: vi.fn(async () => ({ ok: true, value: [DRAWING] })),
    listProjectMembers: vi.fn(async () => ({ ok: true, value: [MEMBER] })),
    listAuditLogs: vi.fn(async () => ({ ok: true, value: { auditLogs: [], total: 0 } })),
    updateProject: vi.fn(async () => ({
      ok: true,
      value: { ...PROJECT, name: '本番実案件（更新）', version: 3 },
    })),
    createDrawing: vi.fn(async () => ({
      ok: true,
      value: {
        ...DRAWING,
        id: 'd-2',
        drawingNumber: 'DWG-002',
        name: '新規仮設道路計画図',
        drawingType: 'temporary-plan',
      },
    })),
    ...overrides,
  }
}

describe('ProjectDetailCloudPage', () => {
  it('案件未選択時は空状態とホームへの導線を表示する', async () => {
    const onNavigateHome = vi.fn()
    render(<ProjectDetailCloudPage projectId={undefined} onNavigateHome={onNavigateHome} />)

    expect(screen.getByText('案件が選択されていません')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'ホームへ戻る' }))
    expect(onNavigateHome).toHaveBeenCalled()
  })

  it('API から実案件・図面・メンバーを表示する', async () => {
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={makeClient()} />)

    expect(await screen.findByText('本番実案件')).toBeInTheDocument()
    expect(screen.getByText('案件番号: P-REAL-001 ・ 発注者: テスト発注者 ・ 更新: 2026-08-10')).toBeInTheDocument()
    expect(screen.getByText('DWG-001')).toBeInTheDocument()
    expect(screen.getByText('施工ヤード計画図')).toBeInTheDocument()
    expect(screen.getAllByText('engineer@example.test').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('管理者')).toBeInTheDocument()
  })

  it('API 取得失敗時はサンプルを表示せずエラーを提示する', async () => {
    const client = makeClient({
      getProject: vi.fn(async () => ({
        ok: false,
        error: { code: 'CD-AUTH-001', severity: 'error' as const, message: '認証情報がありません' },
      })),
    })
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={client} />)

    expect(await screen.findByText(/案件データを取得できませんでした/)).toBeInTheDocument()
    expect(screen.getByText('認証情報がありません')).toBeInTheDocument()
    expect(screen.queryByText('国道245号 道路拡幅工事')).not.toBeInTheDocument()
  })

  it('最近のアクティビティを監査ログ API から表示する', async () => {
    const client = makeClient({
      listAuditLogs: vi.fn(async () => ({
        ok: true,
        value: {
          auditLogs: [
            {
              id: 'a-1',
              occurredAt: '2026-08-13T01:00:00.000Z',
              eventName: 'project.created',
              actorId: 'engineer@example.test',
              projectId: 'p-1',
              result: 'success' as const,
              correlationId: 'c-1',
            },
            {
              id: 'a-2',
              occurredAt: '2026-08-13T02:00:00.000Z',
              eventName: 'workflow.approve',
              actorId: 'approver@example.test',
              projectId: 'p-1',
              result: 'success' as const,
              correlationId: 'c-2',
            },
          ],
          total: 2,
        },
      })),
    })
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={client} />)

    expect(await screen.findByText('案件作成')).toBeInTheDocument()
    expect(screen.getByText('承認')).toBeInTheDocument()
    expect(screen.getByText('approver@example.test')).toBeInTheDocument()
    expect(client.listAuditLogs).toHaveBeenCalledWith({ projectId: 'p-1', limit: 10 })
  })

  it('活動履歴が無い場合は空状態を表示する', async () => {
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={makeClient()} />)
    expect(await screen.findByText('この案件の活動履歴はまだありません。')).toBeInTheDocument()
  })

  it('活動履歴の取得失敗時はエラーを表示する', async () => {
    const client = makeClient({
      listAuditLogs: vi.fn(async () => ({
        ok: false,
        error: { code: 'CD-AUTH-001', severity: 'error' as const, message: '監査ログを取得できません' },
      })),
    })
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={client} />)
    expect(await screen.findByText(/活動履歴を取得できませんでした/)).toBeInTheDocument()
    expect(screen.getByText(/監査ログを取得できません/)).toBeInTheDocument()
  })

  it('図面作成 API を呼び、再取得した一覧を表示する', async () => {
    const client = makeClient({
      listProjectDrawings: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, value: [DRAWING] })
        .mockResolvedValueOnce({
          ok: true,
          value: [DRAWING, { ...DRAWING, id: 'd-2', drawingNumber: 'DWG-002', name: '新規仮設道路計画図' }],
        }),
    })
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={client} />)
    await screen.findByText('本番実案件')

    await userEvent.click(screen.getByRole('button', { name: '＋ 図面を作成' }))
    const nameInput = screen.getByDisplayValue('新規施工ヤード計画図')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '新規仮設道路計画図')
    await userEvent.click(screen.getByRole('button', { name: '作成' }))

    await waitFor(() =>
      expect(client.createDrawing).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({ drawingNumber: 'DWG-002', name: '新規仮設道路計画図' }),
      ),
    )
    expect(await screen.findByText('図面詳細: DWG-002 新規仮設道路計画図')).toBeInTheDocument()
  })

  it('案件編集 API を expectedVersion 付きで呼び、更新後の案件名を表示する', async () => {
    const client = makeClient()
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={client} />)
    await screen.findByText('本番実案件')

    await userEvent.click(screen.getByRole('button', { name: '案件を編集' }))
    const nameInput = screen.getByDisplayValue('本番実案件')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '本番実案件（更新）')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(client.updateProject).toHaveBeenCalledWith(
        'p-1',
        expect.objectContaining({ name: '本番実案件（更新）', expectedVersion: 2 }),
      ),
    )
    expect(await screen.findByText('本番実案件（更新）')).toBeInTheDocument()
  })

  it('図面詳細では実図面の CAD 編集が無効化され理由を表示する', async () => {
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={makeClient()} />)
    await screen.findByText('DWG-001')

    await userEvent.click(screen.getByText('施工ヤード計画図'))
    const editButton = screen.getByRole('button', { name: 'CAD編集で開く' })
    expect(editButton).toBeDisabled()
    expect(
      screen.getByText(/実図面のCAD編集・共有保存は既存図面への改訂更新API（後続Issue）で対応予定です/),
    ).toBeInTheDocument()
  })

  it('図面一覧が空の場合は空状態を表示する', async () => {
    const client = makeClient({
      listProjectDrawings: vi.fn(async () => ({ ok: true, value: [] })),
    })
    render(<ProjectDetailCloudPage projectId="p-1" cloudApiClient={client} />)
    expect(await screen.findByText('該当する図面はありません。')).toBeInTheDocument()
    const table = screen.queryByRole('table')
    expect(table).toBeNull()
  })
})

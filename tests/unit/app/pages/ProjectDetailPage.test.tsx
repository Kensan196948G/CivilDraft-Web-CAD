import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectDetailPage } from '@/app/pages/ProjectDetailPage'

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

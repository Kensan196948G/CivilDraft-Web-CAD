import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewApprovalPage } from '@/app/pages/ReviewApprovalPage'

/** 監督員（supervisor）ロールへ切り替える。 */
async function switchToSupervisor() {
  await userEvent.click(screen.getByRole('button', { name: '監督員（supervisor）' }))
}

describe('ReviewApprovalPage', () => {
  it('初期状態は draft・Rev.1 で、照査依頼ボタンと空履歴を表示する', () => {
    render(<ReviewApprovalPage />)
    expect(screen.getByText('Rev.1')).toBeInTheDocument()
    expect(screen.getByText('編集中（draft）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '照査依頼' })).toBeInTheDocument()
    expect(screen.getByText('履歴はまだありません')).toBeInTheDocument()
  })

  it('engineer が照査依頼すると inReview へ遷移する', async () => {
    render(<ReviewApprovalPage />)
    await userEvent.click(screen.getByRole('button', { name: '照査依頼' }))
    expect(screen.getByText('照査中（inReview）')).toBeInTheDocument()
    expect(screen.queryByText('編集中（draft）')).not.toBeInTheDocument()
  })

  it('viewer は現状態のアクションがすべて不活性になる', async () => {
    render(<ReviewApprovalPage />)
    await userEvent.click(screen.getByRole('button', { name: '閲覧者（viewer）' }))
    // draft の唯一のアクション（照査依頼）は canEdit を持たない viewer では不活性。
    expect(screen.getByRole('button', { name: '照査依頼' })).toBeDisabled()
  })

  it('supervisor が照査依頼→照査完了→承認で approved まで進める', async () => {
    render(<ReviewApprovalPage />)
    await switchToSupervisor()
    await userEvent.click(screen.getByRole('button', { name: '照査依頼' }))
    await userEvent.click(screen.getByRole('button', { name: '照査完了' }))
    expect(screen.getByText('承認待ち（pendingApproval）')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '承認' }))
    expect(screen.getByText('承認済み（approved）')).toBeInTheDocument()
  })

  it('承認済みから新規改訂すると draft へ戻り改訂番号が増加する', async () => {
    render(<ReviewApprovalPage />)
    await switchToSupervisor()
    await userEvent.click(screen.getByRole('button', { name: '照査依頼' }))
    await userEvent.click(screen.getByRole('button', { name: '照査完了' }))
    await userEvent.click(screen.getByRole('button', { name: '承認' }))
    expect(screen.getByText('Rev.1')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '新規改訂' }))
    expect(screen.getByText('Rev.2')).toBeInTheDocument()
    expect(screen.getByText('編集中（draft）')).toBeInTheDocument()
  })

  it('前提未達の遷移（コメント無しの差戻し）はエラーメッセージを表示する', async () => {
    render(<ReviewApprovalPage />)
    await switchToSupervisor()
    await userEvent.click(screen.getByRole('button', { name: '照査依頼' }))
    // コメント未入力のまま差戻し → REVISION_COMMENT_REQUIRED。
    await userEvent.click(screen.getByRole('button', { name: '差戻し' }))
    expect(screen.getByRole('alert')).toHaveTextContent('差戻しにはコメントが必要です')
    // 遷移は成立していない（inReview のまま）。
    expect(screen.getByText('照査中（inReview）')).toBeInTheDocument()
  })

  it('アクション実行のたびに履歴が追記される', async () => {
    render(<ReviewApprovalPage />)
    await switchToSupervisor()
    await userEvent.click(screen.getByRole('button', { name: '照査依頼' }))
    expect(screen.queryByText('履歴はまだありません')).not.toBeInTheDocument()
    // 履歴テーブルに操作「照査依頼」・実行ロール「作成者」が記録される。
    const rows = screen.getAllByRole('row')
    // ヘッダ1行 + 履歴1行。
    expect(rows.length).toBe(2)
    expect(screen.getByRole('cell', { name: '作成者' })).toBeInTheDocument()
  })

  it('コメント付きの差戻しは returned へ遷移し、コメントが履歴に残る', async () => {
    render(<ReviewApprovalPage />)
    await switchToSupervisor()
    await userEvent.click(screen.getByRole('button', { name: '照査依頼' }))
    await userEvent.type(screen.getByLabelText('コメント / 理由'), '寸法未記入のため差戻し')
    await userEvent.click(screen.getByRole('button', { name: '差戻し' }))

    expect(screen.getByText('差戻し（returned）')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '寸法未記入のため差戻し' })).toBeInTheDocument()
    // 差戻し後は照査者ロールで記録される。
    expect(screen.getByRole('cell', { name: '照査者' })).toBeInTheDocument()
  })

  it('承認済みは内容が凍結表示になり、編集系の再提出アクションが現れない（§19.2）', async () => {
    render(<ReviewApprovalPage />)
    await switchToSupervisor()
    await userEvent.click(screen.getByRole('button', { name: '照査依頼' }))
    await userEvent.click(screen.getByRole('button', { name: '照査完了' }))
    await userEvent.click(screen.getByRole('button', { name: '承認' }))

    // 承認済みは内容変更不可（凍結）。
    expect(screen.getByText(/凍結（承認済み\/廃止は内容変更不可・§19.2）/)).toBeInTheDocument()
    // approved から可能なのは新規改訂・廃止のみで、照査依頼（再提出）は存在しない。
    expect(screen.getByRole('button', { name: '新規改訂' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '照査依頼' })).not.toBeInTheDocument()
  })
})

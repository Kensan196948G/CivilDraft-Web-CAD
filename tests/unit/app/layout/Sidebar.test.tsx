import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '@/app/layout/Sidebar'

describe('Sidebar', () => {
  it('デザイン正本のナビ構成（4セクション13項目）とブランドを表示する', () => {
    render(
      <Sidebar activeView="home" theme="light" implementedViews={['home', 'editor']} onNavigate={() => {}} onToggleTheme={() => {}} />,
    )
    expect(screen.getByText('CivilDraft')).toBeInTheDocument()
    expect(screen.getByText('土木施工図CAD')).toBeInTheDocument()
    for (const section of ['案件', '作図', '集計・照査', '出力・管理']) {
      expect(screen.getByText(section)).toBeInTheDocument()
    }
    for (const item of [
      'ホーム・案件一覧',
      '案件詳細',
      'CAD編集',
      '図面設定',
      '測点・座標一覧',
      '土木部材パレット',
      '数量集計',
      '縦横断管理',
      '施工ステップ',
      '図面比較',
      '照査・承認',
      '印刷・出力',
      'システム設定',
    ]) {
      expect(screen.getByText(item)).toBeInTheDocument()
    }
    expect(screen.getByText('山田 太郎')).toBeInTheDocument()
    expect(screen.getByText('作成者')).toBeInTheDocument()
  })

  it('CAD編集クリックでeditorへナビゲートし、未実装項目はdisabled', async () => {
    const onNavigate = vi.fn()
    render(
      <Sidebar activeView="home" theme="light" implementedViews={['home', 'editor']} onNavigate={onNavigate} onToggleTheme={() => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /CAD編集/ }))
    expect(onNavigate).toHaveBeenCalledWith('editor')
    expect(screen.getByRole('button', { name: /数量集計/ })).toBeDisabled()
  })

  it('テーマ切替ボタンはlight時「ダークモードに切替」、dark時「ライトモードに切替」', async () => {
    const onToggleTheme = vi.fn()
    const { rerender } = render(
      <Sidebar activeView="home" theme="light" implementedViews={['home', 'editor']} onNavigate={() => {}} onToggleTheme={onToggleTheme} />,
    )
    const toggle = screen.getByRole('button', { name: /ダークモードに切替/ })
    await userEvent.click(toggle)
    expect(onToggleTheme).toHaveBeenCalled()

    rerender(
      <Sidebar activeView="home" theme="dark" implementedViews={['home', 'editor']} onNavigate={() => {}} onToggleTheme={onToggleTheme} />,
    )
    expect(screen.getByRole('button', { name: /ライトモードに切替/ })).toBeInTheDocument()
  })
})

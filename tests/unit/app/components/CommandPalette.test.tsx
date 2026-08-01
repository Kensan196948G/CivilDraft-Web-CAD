import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette, type CommandPaletteItem } from '@/app/components/CommandPalette'
import { matchCommand } from '@/app/components/commandPaletteSearch'

const items: readonly CommandPaletteItem[] = [
  { id: 'tool-line', label: 'ツール: 線分', keywords: ['line'], icon: '╱', shortcut: '2', run: vi.fn() },
  { id: 'tool-rectangle', label: 'ツール: 矩形', keywords: ['rectangle'], icon: '▭', shortcut: '3', run: vi.fn() },
  { id: 'undo', label: '元に戻す', keywords: ['undo'], icon: '↩', shortcut: 'Ctrl+Z', run: vi.fn() },
  { id: 'cloud-save', label: '共有保存', keywords: ['save', 'cloud'], icon: '☁', run: vi.fn() },
]

describe('matchCommand（ファジー検索）', () => {
  it('空クエリは全件一致（スコア0）', () => {
    expect(matchCommand('', '線分')).toBe(0)
  })

  it('ラベル部分列一致でスコアを返す', () => {
    expect(matchCommand('線分', 'ツール: 線分')).not.toBeNull()
    expect(matchCommand('線', 'ツール: 線分')).not.toBeNull()
  })

  it('キーワード（英語名）でも一致する', () => {
    expect(matchCommand('line', 'ツール: 線分', ['line'])).not.toBeNull()
    expect(matchCommand('undo', '元に戻す', ['undo'])).not.toBeNull()
  })

  it('不一致は null', () => {
    expect(matchCommand('zzz', 'ツール: 線分', ['line'])).toBeNull()
  })

  it('順序を保った部分列でなければ一致しない', () => {
    expect(matchCommand('分線', 'ツール: 線分')).toBeNull()
  })
})

describe('CommandPalette', () => {
  it('open=false では何も表示しない', () => {
    render(<CommandPalette open={false} onClose={() => {}} items={items} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('open=true で候補一覧を表示し、入力を絞り込む', async () => {
    render(<CommandPalette open onClose={() => {}} items={items} />)
    const dialog = screen.getByRole('dialog', { name: 'コマンドパレット' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /ツール: 線分/ })).toBeInTheDocument()

    const input = screen.getByRole('combobox')
    await userEvent.type(input, 'undo')
    expect(screen.getByRole('option', { name: /元に戻す/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /ツール: 線分/ })).not.toBeInTheDocument()
  })

  it('↑/↓/Enter で候補を選択して実行し、パレットが閉じる', async () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} items={items} />)
    const input = screen.getByRole('combobox')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(items[1]!.run).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc で閉じる（実行しない）', () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} items={items} />)
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(items[0]!.run).not.toHaveBeenCalled()
  })

  it('クリックでも実行できる', async () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} items={items} />)
    await userEvent.click(screen.getByRole('option', { name: /共有保存/ }))
    expect(items[3]!.run).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disabled 候補は実行できない', async () => {
    const disabledRun = vi.fn()
    const disabledItems = [{ id: 'd', label: '無効', disabled: true, run: disabledRun }]
    render(<CommandPalette open onClose={() => {}} items={disabledItems} />)
    const option = screen.getByRole('option', { name: /無効/ })
    expect(option).toBeDisabled()
    await userEvent.click(option)
    expect(disabledRun).not.toHaveBeenCalled()
  })

  it('不一致クエリで空メッセージを表示する', async () => {
    render(<CommandPalette open onClose={() => {}} items={items} />)
    await userEvent.type(screen.getByRole('combobox'), '存在しないコマンド')
    expect(screen.getByText('該当するコマンドがありません')).toBeInTheDocument()
  })
})

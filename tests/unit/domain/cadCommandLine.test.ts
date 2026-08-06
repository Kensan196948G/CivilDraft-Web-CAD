import { describe, expect, it } from 'vitest'
import { CAD_COMMAND_HELP, parseCadCommand } from '@/domain/cadCommandLine'

describe('parseCadCommand（Issue #47）', () => {
  it('基本コマンドを解釈する', () => {
    expect(parseCadCommand('undo')).toEqual({ ok: true, command: { kind: 'undo' } })
    expect(parseCadCommand(' redo ')).toEqual({ ok: true, command: { kind: 'redo' } })
    expect(parseCadCommand('GRID ON')).toEqual({ ok: true, command: { kind: 'grid', visible: true } })
    expect(parseCadCommand('snap off')).toEqual({ ok: true, command: { kind: 'snap', enabled: false } })
    expect(parseCadCommand('selectall')).toEqual({ ok: true, command: { kind: 'selectAll' } })
    expect(parseCadCommand('clear')).toEqual({ ok: true, command: { kind: 'clearSelection' } })
    expect(parseCadCommand('?')).toEqual({ ok: true, command: { kind: 'help' } })
  })

  it('layer コマンドは名前を抽出する', () => {
    expect(parseCadCommand('layer 施工ヤード')).toEqual({
      ok: true,
      command: { kind: 'layer', name: '施工ヤード' },
    })
    expect(parseCadCommand('layer  ').ok).toBe(false)
  })

  it('空入力・不明コマンドはエラーを返す', () => {
    expect(parseCadCommand('').ok).toBe(false)
    expect(parseCadCommand('   ').ok).toBe(false)
    const unknown = parseCadCommand('foo bar')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.message).toContain('不明なコマンド')
  })

  it('ヘルプ一覧は非空でコマンドと説明を持つ', () => {
    expect(CAD_COMMAND_HELP.length).toBeGreaterThan(5)
    for (const item of CAD_COMMAND_HELP) {
      expect(item.command.length).toBeGreaterThan(0)
      expect(item.description.length).toBeGreaterThan(0)
    }
  })
})


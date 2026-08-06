import { describe, expect, it } from 'vitest'
import { escapeCsvCell } from '@/domain/csv/csvCell'

describe('escapeCsvCell（数式インジェクション対策）', () => {
  it('通常セルはダブルクォートで囲むだけ', () => {
    expect(escapeCsvCell('国道245号')).toBe('"国道245号"')
  })

  it('= + - @ で始まるセルはシングルクォートを前置して無害化する', () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"')
    expect(escapeCsvCell('+SUM(A1:A2)')).toBe('"\'+SUM(A1:A2)"')
    expect(escapeCsvCell('-1+2')).toBe('"\'-1+2"')
    expect(escapeCsvCell('@cmd')).toBe('"\'@cmd"')
  })

  it('タブ・改行で始まるセルも無害化する', () => {
    expect(escapeCsvCell('\t=1')).toBe('"\'\t=1"')
    expect(escapeCsvCell('\r\n=1')).toBe('"\'\r\n=1"')
  })

  it('内部のダブルクォートは二重化する', () => {
    expect(escapeCsvCell('a"b')).toBe('"a""b"')
  })
})

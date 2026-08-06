import { describe, expect, it } from 'vitest'
import { classifyMigrationFile, migrationAdvice } from '@/domain/migration/migrationAssistant'

describe('classifyMigrationFile（Issue #60）', () => {
  it('DXF は取込可能と判定する', () => {
    expect(classifyMigrationFile('drawing.dxf')).toEqual({
      format: 'dxf',
      supported: true,
      message: expect.stringContaining('取込可能'),
    })
  })

  it('DWG/JWW/SXF/SIMA は未対応と判定し、代替案を示す', () => {
    for (const name of ['plan.dwg', 'plan.jww', 'plan.sxf', 'plan.sima']) {
      const result = classifyMigrationFile(name)
      expect(result.supported).toBe(false)
      expect(result.message.length).toBeGreaterThan(10)
    }
    expect(classifyMigrationFile('plan.dwg').message).toContain('DXF')
  })

  it('未知の拡張子は判別不可メッセージを返す', () => {
    const result = classifyMigrationFile('data.xyz')
    expect(result.supported).toBe(false)
    expect(result.message).toContain('判別できません')
  })
})

describe('migrationAdvice（Issue #60）', () => {
  it('既知コードには具体的な対処提案を返す', () => {
    expect(migrationAdvice({ code: 'dxf-unsupported-entity', severity: 'warning', message: 'x' })).toContain('プリミティブ')
    expect(migrationAdvice({ code: 'dxf-xdata-stripped', severity: 'info', message: 'x' })).toContain('XDATA')
    expect(migrationAdvice({ code: 'dxf-empty', severity: 'error', message: 'x' })).toContain('空')
  })

  it('未知コードには汎用メッセージを返す', () => {
    expect(migrationAdvice({ code: 'unknown-code', severity: 'warning', message: 'テスト' })).toContain('テスト')
  })
})


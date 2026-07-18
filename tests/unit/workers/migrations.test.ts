import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readMigration(fileName: string): string {
  return readFileSync(join(process.cwd(), 'migrations', fileName), 'utf8')
}

describe('Neon migrations', () => {
  it('0001 は初期スキーマの主要テーブルとトランザクション境界を持つ', () => {
    const sql = readMigration('0001_initial_schema.sql')

    expect(sql).toMatch(/\bBEGIN;/)
    expect(sql).toMatch(/\bCOMMIT;/)
    for (const table of [
      'projects',
      'project_members',
      'drawings',
      'drawing_revisions',
      'drawing_contents',
      'quantity_items',
      'quantity_sources',
      'workflow_actions',
      'export_jobs',
      'audit_logs',
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`)
    }
  })

  it('0002 はWorkers API P0契約を前方互換で補強する', () => {
    const sql = readMigration('0002_api_contract_alignment.sql')

    expect(sql).toMatch(/\bBEGIN;/)
    expect(sql).toMatch(/\bCOMMIT;/)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS quantity_snapshots')
    expect(sql).toContain('quantity_version bigint NOT NULL DEFAULT 1')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS updated_by text')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS contribution_raw numeric')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS byte_size bigint')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS content_checksum text')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS created_by text')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS previous_hash text')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS entry_hash text')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS audit_logs_project_event_occurred_idx')
  })

  it('0002 は本番データを壊すDDLを含まない', () => {
    const sql = readMigration('0002_api_contract_alignment.sql')

    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/i)
  })

  it('0003 はR2スキップ決定に合わせてdrawing_contents/quantity_itemsのスキーマドリフトを解消する', () => {
    const sql = readMigration('0003_persistence_schema_drift_fix.sql')

    expect(sql).toMatch(/\bBEGIN;/)
    expect(sql).toMatch(/\bCOMMIT;/)
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS content jsonb')
    expect(sql).toMatch(/ALTER TABLE drawing_contents[\s\S]*ALTER COLUMN object_key DROP NOT NULL/)
    expect(sql).toMatch(/ALTER TABLE quantity_items[\s\S]*ALTER COLUMN name DROP NOT NULL/)
    expect(sql).toMatch(/ALTER TABLE quantity_items[\s\S]*ALTER COLUMN quantity DROP NOT NULL/)
  })

  it('0003 は本番データを壊すDDLを含まない（列削除・テーブル削除・データ削除なし）', () => {
    const sql = readMigration('0003_persistence_schema_drift_fix.sql')

    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)\b/i)
    expect(sql).not.toMatch(/\bTRUNCATE\b/i)
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/i)
  })
})

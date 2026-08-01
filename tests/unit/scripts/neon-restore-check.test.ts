import { describe, expect, it, vi } from 'vitest'
import {
  listBackupBranches,
  pickLatestBackupBranch,
  runRestoreCheck,
  verifyBranchReadable,
} from '../../../scripts/neon-restore-check.mjs'

describe('neon-restore-check.mjs（バックアップのリストア検証）', () => {
  it('backup-* ブランチのみを作成日時の降順で選ぶ', () => {
    const branches = [
      { id: 'b1', name: 'main', created_at: '2026-08-01T00:00:00Z' },
      { id: 'b2', name: 'backup-20260801-0000', created_at: '2026-08-01T00:00:00Z' },
      { id: 'b3', name: 'backup-20260801-1200', created_at: '2026-08-01T12:00:00Z' },
      { id: 'b4', name: 'backup-20260731-0000', created_at: '2026-07-31T00:00:00Z' },
    ]
    expect(listBackupBranches(branches).map((b) => b.id)).toEqual(['b3', 'b2', 'b4'])
    expect(pickLatestBackupBranch(branches)?.id).toBe('b3')
    expect(pickLatestBackupBranch([{ id: 'b1', name: 'main' }])).toBeUndefined()
  })

  it('verifyBranchReadable は read-only クエリの結果を集計する', async () => {
    const sqlMock = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join('?')
      if (text.includes('information_schema')) return [{ c: 12 }]
      if (text.includes('FROM projects')) return [{ c: 3 }]
      return []
    })
    const result = await verifyBranchReadable('postgres://user:secret@host/db', () => sqlMock)
    expect(result).toEqual({ connectable: true, publicTableCount: 12, projectsCount: 3 })
    expect(sqlMock).toHaveBeenCalledTimes(3)
  })

  it('接続失敗時は connectable=false を返す', async () => {
    const sqlFactory = () => async () => {
      throw new Error('connection refused')
    }
    const result = await verifyBranchReadable('postgres://user:secret@host/db', sqlFactory)
    expect(result.connectable).toBe(false)
    expect(result.errorMessage).toContain('connection refused')
  })

  it('runRestoreCheck は最新バックアップを検証し、接続 URI を結果に含めない', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/branches')) {
        return new Response(
          JSON.stringify({
            branches: [
              { id: 'b3', name: 'backup-20260801-1200', created_at: '2026-08-01T12:00:00Z' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/endpoints')) {
        return new Response(
          JSON.stringify({ endpoints: [{ id: 'ep-1', branch_id: 'b3' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/connection_uri')) {
        return new Response(
          JSON.stringify({ uri: 'postgres://user:secret@host/db' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const sqlMock = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join('?')
      if (text.includes('information_schema')) return [{ c: 12 }]
      if (text.includes('FROM projects')) return [{ c: 3 }]
      return []
    })
    const result = await runRestoreCheck({
      apiKey: 'test-key',
      projectId: 'project-1',
      fetchImpl: fetchMock,
      sqlFactory: () => sqlMock,
    })
    expect(result.ok).toBe(true)
    expect(result.backupBranch?.id).toBe('b3')
    expect(result.sqlCheck).toBe('passed')
    expect(result.readable.projectsCount).toBe(3)
    expect(JSON.stringify(result)).not.toContain('postgres://')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('バックアップブランチにエンドポイントが無い場合は SQL 検証をスキップして ok=true を返す', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/branches')) {
        return new Response(
          JSON.stringify({
            branches: [
              {
                id: 'b3',
                name: 'backup-20260801-1200',
                created_at: '2026-08-01T12:00:00Z',
                logical_size: 31776768,
                parent_id: 'br-main',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/endpoints')) {
        return new Response(JSON.stringify({ endpoints: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const sqlMock = vi.fn(async () => [])
    const result = await runRestoreCheck({
      apiKey: 'test-key',
      projectId: 'project-1',
      fetchImpl: fetchMock,
      sqlFactory: () => sqlMock,
    })
    expect(result.ok).toBe(true)
    expect(result.sqlCheck).toBe('skipped')
    expect(result.branchHealth.dataPresent).toBe(true)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('バックアップブランチが無い場合は ok=false を返す', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ branches: [{ id: 'b1', name: 'main' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const result = await runRestoreCheck({
      apiKey: 'test-key',
      projectId: 'project-1',
      fetchImpl: fetchMock,
      sqlFactory: () => async () => [],
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-backup-branch')
  })
})

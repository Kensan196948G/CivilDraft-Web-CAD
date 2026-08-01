import { describe, expect, it } from 'vitest'
import { backupBranchName, validateBackupBranchName } from '../../../scripts/neon-backup.mjs'

describe('neon-backup.mjs（Neon 週次バックアップ / ブランチ方式）', () => {
  it('バックアップブランチ名は backup-YYYYMMDD-HHMM 形式（UTC）で生成される', () => {
    const name = backupBranchName(new Date('2026-08-01T13:05:00Z'))
    expect(name).toBe('backup-20260801-1305')
    expect(validateBackupBranchName(name)).toBe(true)
  })

  it('不正なブランチ名を拒否する', () => {
    expect(validateBackupBranchName('backup-20260801')).toBe(false)
    expect(validateBackupBranchName('20260801-1305')).toBe(false)
    expect(validateBackupBranchName('backup-20260801-1305-extra')).toBe(false)
    expect(validateBackupBranchName('main')).toBe(false)
    expect(validateBackupBranchName('')).toBe(false)
  })
})

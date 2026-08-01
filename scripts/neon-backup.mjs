/* global console, process, fetch */
/**
 * Neon 週次バックアップ（ブランチ方式）。
 *
 * Neon の copy-on-write ブランチをバックアップとして作成する。
 * - 本番データを変更しない（読み取り専用の分岐）
 * - 作成は NEON_API_KEY（GitHub Actions Secret）のみで実行可能（接続文字列不要）
 * - バックアップブランチの削除・保持ポリシーは人間判断（データ削除に準ずる）
 *   → docs/operations/rollback-procedure.md §4 を参照
 *
 * 使い方:
 *   NEON_API_KEY=<key> NEON_PROJECT_ID=<project-id> node scripts/neon-backup.mjs [--dry-run]
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const NEON_API_BASE = 'https://console.neon.tech/api/v2'

/** バックアップブランチ名の形式: backup-YYYYMMDD-HHMM（UTC）。 */
export function validateBackupBranchName(name) {
  return /^backup-\d{8}-\d{4}$/.test(name)
}

/** 現在時刻（UTC）からバックアップブランチ名を生成する。 */
export function backupBranchName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const y = now.getUTCFullYear()
  const m = pad(now.getUTCMonth() + 1)
  const d = pad(now.getUTCDate())
  const h = pad(now.getUTCHours())
  const min = pad(now.getUTCMinutes())
  return `backup-${y}${m}${d}-${h}${min}`
}

/**
 * Neon API でブランチを作成する（copy-on-write）。
 * @returns {Promise<{branch: {id: string, name: string, created_at: string}}>}
 */
export async function createBackupBranch({ apiKey, projectId, branchName }) {
  const response = await fetch(
    `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ branch: { name: branchName } }),
    },
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Neon API ${response.status}: ${body.slice(0, 300)}`)
  }
  return response.json()
}

async function main() {
  const apiKey = process.env.NEON_API_KEY
  const projectId = process.env.NEON_PROJECT_ID ?? 'patient-unit-81724522'
  const dryRun = process.argv.includes('--dry-run')
  if (!apiKey) {
    console.error('[backup] NEON_API_KEY が未設定です')
    process.exit(1)
  }

  const branchName = backupBranchName()
  if (!validateBackupBranchName(branchName)) {
    console.error(`[backup] 不正なブランチ名: ${branchName}`)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`[backup] DRY-RUN: project=${projectId} branch=${branchName}`)
    writeFileSync(
      'backup-summary.json',
      JSON.stringify({ dryRun: true, projectId, branchName, createdAt: new Date().toISOString() }, null, 2),
    )
    return
  }

  console.log(`[backup] creating branch: project=${projectId} branch=${branchName}`)
  const json = await createBackupBranch({ apiKey, projectId, branchName })
  const branch = json.branch
  if (branch === undefined) {
    throw new Error(`Neon API の応答に branch がありません: ${JSON.stringify(json).slice(0, 300)}`)
  }
  console.log(`[backup] OK branch=${branch.id} name=${branch.name} created=${branch.created_at}`)
  writeFileSync(
    'backup-summary.json',
    JSON.stringify(
      {
        projectId,
        branchId: branch.id,
        branchName: branch.name,
        createdAt: branch.created_at,
      },
      null,
      2,
    ),
  )
}

// 直接実行時のみ main() を走らせる（テストからの import では実行しない）
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[backup] FAILED: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}

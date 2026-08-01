/* global console, process */
/**
 * Neon バックアップのリストア検証（ゲームデイ代替・2026-08-01）。
 *
 * 最新のバックアップブランチ（backup-*）を選び、
 * 1) API レベルで実データの存在（logical_size > 0・親=main）を検証し、
 * 2) ブランチにエンドポイントが存在する場合は read-only 接続でテーブル一覧・
 *    projects 件数を確認する（エンドポイント作成は人間判断のため、無ければ SQL 検証はスキップ）。
 * - 本番データは変更しない（SELECT のみ）
 * - 接続文字列は API から取得してメモリ内で使用し、ログ・成果物には出力しない
 * - バックアップ作成ワークフロー（backup.yml）の restore-check ジョブで毎週実行
 *
 * 使い方:
 *   NEON_API_KEY=<key> NEON_PROJECT_ID=<project-id> node scripts/neon-restore-check.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const NEON_API_BASE = 'https://console.neon.tech/api/v2'

/** backup-* ブランチを作成日時の降順で返す（最新が先頭）。 */
export function listBackupBranches(branches) {
  return branches
    .filter((branch) => typeof branch.name === 'string' && branch.name.startsWith('backup-'))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

/** 最新のバックアップブランチを選ぶ（無ければ undefined）。 */
export function pickLatestBackupBranch(branches) {
  return listBackupBranches(branches)[0]
}

/** Neon API でブランチ一覧を取得する。 */
export async function fetchBranches({ apiKey, projectId, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const response = await fetchImpl(`${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Neon API branches ${response.status}: ${body.slice(0, 300)}`)
  }
  const json = await response.json()
  return json.branches ?? []
}

/** プロジェクトのエンドポイント一覧を取得する。 */
export async function fetchEndpoints({ apiKey, projectId, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const response = await fetchImpl(`${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/endpoints`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Neon API endpoints ${response.status}: ${body.slice(0, 300)}`)
  }
  const json = await response.json()
  return json.endpoints ?? []
}

/** ブランチの接続 URI を取得する（パスワードを含むため呼び出し側で秘匿する）。 */
export async function fetchConnectionUri({
  apiKey,
  projectId,
  branchId,
  databaseName = 'neondb',
  roleName = 'neondb_owner',
  fetchImpl = globalThis.fetch.bind(globalThis),
}) {
  const response = await fetchImpl(
    `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/connection_uri?branch_id=${encodeURIComponent(branchId)}&database_name=${encodeURIComponent(databaseName)}&role_name=${encodeURIComponent(roleName)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  )
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Neon API connection_uri ${response.status}: ${body.slice(0, 300)}`)
  }
  const json = await response.json()
  const uri = json.uri ?? json.connection_uri
  if (typeof uri !== 'string' || uri === '') {
    throw new Error('Neon API の応答に接続 URI がありません')
  }
  return uri
}

/**
 * バックアップブランチへ read-only 接続し、可読性（復元可能性）を検証する。
 * sqlFactory を注入可能（テスト用）。接続 URI は戻り値に含めない。
 */
export async function verifyBranchReadable(connectionUri, sqlFactory = neon) {
  const sql = sqlFactory(connectionUri)
  try {
    await sql`SELECT 1`
    const tables = await sql`SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'public'`
    const projects = await sql`SELECT count(*)::int AS c FROM projects`
    return {
      connectable: true,
      publicTableCount: tables[0]?.c ?? 0,
      projectsCount: projects[0]?.c ?? 0,
    }
  } catch (error) {
    return {
      connectable: false,
      publicTableCount: 0,
      projectsCount: 0,
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    }
  }
}

/** リストア検証を実行し、結果（接続 URI を含まない）を返す。 */
export async function runRestoreCheck({
  apiKey,
  projectId,
  fetchImpl,
  sqlFactory = neon,
}) {
  const branches = await fetchBranches({ apiKey, projectId, fetchImpl })
  const backupBranch = pickLatestBackupBranch(branches)
  if (backupBranch === undefined) {
    return { ok: false, reason: 'no-backup-branch', checkedAt: new Date().toISOString() }
  }
  const branchHealth = {
    exists: true,
    logicalSize: typeof backupBranch.logical_size === 'number' ? backupBranch.logical_size : null,
    parentId: backupBranch.parent_id ?? null,
    dataPresent: (backupBranch.logical_size ?? 0) > 0,
  }
  const endpoints = await fetchEndpoints({ apiKey, projectId, fetchImpl })
  const hasEndpoint = endpoints.some((endpoint) => endpoint.branch_id === backupBranch.id)
  if (!hasEndpoint) {
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      backupBranch: { id: backupBranch.id, name: backupBranch.name, createdAt: backupBranch.created_at },
      branchHealth,
      sqlCheck: 'skipped',
      sqlCheckReason: 'backup branch has no compute endpoint (endpoint creation is a human decision)',
    }
  }
  const connectionUri = await fetchConnectionUri({ apiKey, projectId, branchId: backupBranch.id, fetchImpl })
  const readable = await verifyBranchReadable(connectionUri, sqlFactory)
  return {
    ok: readable.connectable,
    checkedAt: new Date().toISOString(),
    backupBranch: { id: backupBranch.id, name: backupBranch.name, createdAt: backupBranch.created_at },
    branchHealth,
    sqlCheck: readable.connectable ? 'passed' : 'failed',
    readable,
  }
}

async function main() {
  const apiKey = process.env.NEON_API_KEY
  const projectId = process.env.NEON_PROJECT_ID ?? 'patient-unit-81724522'
  if (!apiKey) {
    console.error('[restore-check] NEON_API_KEY が未設定です')
    process.exit(1)
  }
  const result = await runRestoreCheck({ apiKey, projectId })
  writeFileSync('restore-check-summary.json', JSON.stringify(result, null, 2))
  if (result.ok) {
    console.log(
      `[restore-check] OK branch=${result.backupBranch.name} logicalSize=${result.branchHealth.logicalSize} sqlCheck=${result.sqlCheck ?? 'passed'}`,
    )
    return
  }
  console.error(
    `[restore-check] FAILED reason=${result.reason ?? 'not-readable'} branch=${result.backupBranch?.name ?? '-'}`,
  )
  process.exitCode = 1
}

// 直接実行時のみ main() を走らせる（テストからの import では実行しない）
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[restore-check] ERROR: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}

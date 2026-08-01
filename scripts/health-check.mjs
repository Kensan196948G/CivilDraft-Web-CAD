/* global console, process */
/**
 * 本番合成監視（SLO 草案 2026-08-01）。
 *
 * 本番 URL に対してスモークチェックを実行し、SLO の入り口指標（可用性・認証fail-closed・
 * セキュリティヘッダー）を検証する。GitHub Actions（health-check.yml）が 30 分毎に実行し、
 * 失敗時は Issue を作成してアラートとする。
 *
 * 使い方:
 *   HEALTH_CHECK_URL=<base-url> node scripts/health-check.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DEFAULT_HEALTH_CHECK_URL = 'https://civildraft-web-cad.mirai-dx-platform.com'

/**
 * スモーク結果を SLO チェック項目に照らして検証し、問題リストを返す。
 * チェック項目:
 * - SPA: HTTP 200 かつ X-Content-Type-Options ヘッダーあり
 * - API: HTTP 401 かつ error.code = CD-AUTH-001（Access 未設定時の fail-closed 期待値）
 */
export function validateSmokeResults(results) {
  const issues = []
  if (results.spa.status !== 200) {
    issues.push(`SPA の HTTP ステータスが 200 ではありません（実際: ${results.spa.status}）`)
  }
  if (results.spa.headers['x-content-type-options'] === undefined) {
    issues.push('SPA に X-Content-Type-Options ヘッダーがありません')
  }
  if (results.api.status !== 401) {
    issues.push(`API の HTTP ステータスが 401 ではありません（実際: ${results.api.status}）`)
  }
  if (results.api.errorCode !== 'CD-AUTH-001') {
    issues.push(`API の error.code が CD-AUTH-001 ではありません（実際: ${results.api.errorCode ?? '(none)'}）`)
  }
  return issues
}

/**
 * 本番 URL に対してスモークチェックを実行する。
 * fetchImpl を注入可能（テスト用）。
 */
export async function runHealthCheck({
  baseUrl = DEFAULT_HEALTH_CHECK_URL,
  fetchImpl = globalThis.fetch.bind(globalThis),
}) {
  const cacheBust = Date.now()
  const spaResponse = await fetchImpl(`${baseUrl}/?hc=${cacheBust}`)
  const apiResponse = await fetchImpl(`${baseUrl}/api/v1/projects?hc=${cacheBust}`)

  let apiErrorCode
  try {
    const body = await apiResponse.json()
    apiErrorCode = body?.error?.code
  } catch {
    apiErrorCode = undefined
  }

  const results = {
    checkedAt: new Date().toISOString(),
    baseUrl,
    spa: {
      status: spaResponse.status,
      headers: Object.fromEntries(spaResponse.headers.entries()),
    },
    api: {
      status: apiResponse.status,
      errorCode: apiErrorCode,
    },
  }
  return { results, issues: validateSmokeResults(results) }
}

async function main() {
  const baseUrl = process.env.HEALTH_CHECK_URL ?? DEFAULT_HEALTH_CHECK_URL
  const { results, issues } = await runHealthCheck({ baseUrl })
  writeFileSync('health-summary.json', JSON.stringify({ ...results, issues }, null, 2))
  if (issues.length === 0) {
    console.log(`[health] OK checkedAt=${results.checkedAt} spa=${results.spa.status} api=${results.api.status}`)
    return
  }
  console.error(`[health] FAILED checkedAt=${results.checkedAt}`)
  for (const issue of issues) {
    console.error(`[health] - ${issue}`)
  }
  process.exitCode = 1
}

// 直接実行時のみ main() を走らせる（テストからの import では実行しない）
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[health] ERROR: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}

/* global console, process */
/**
 * 本番合成監視（SLO 草案 2026-08-01）。
 *
 * 本番 URL に対してスモークチェックを実行し、SLO の入り口指標（Access 保護・可用性・
 * 認証fail-closed・セキュリティヘッダー）を検証する。GitHub Actions（health-check.yml）が
 * 30 分毎に実行し、
 * 失敗時は Issue を作成してアラートとする。
 *
 * 使い方:
 *   HEALTH_CHECK_URL=<base-url> node scripts/health-check.mjs
 *
 * 検証レイヤー（2026-08-09 Access 有効化後の二層構成）:
 * - access: カスタムドメイン（本番）→ 302 + Location が cloudflareaccess.com
 *   （Access 保護が有効なこと）。302 でなく 200 の場合も「保護なし・公開」として許容する。
 * - spa/api: workers.dev（Access 非保護の配信面）で実体を検証:
 *   SPA 200 + セキュリティヘッダー、API 401 + CD-AUTH-001（fail-closed）。
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const DEFAULT_HEALTH_CHECK_URL = 'https://civildraft-web-cad.mirai-dx-platform.com'
export const DEFAULT_WORKERS_DEV_URL = 'https://civildraft-web-cad.kensan1969.workers.dev'

/**
 * スモーク結果を SLO チェック項目に照らして検証し、問題リストを返す。
 */
export function validateSmokeResults(results) {
  const issues = []
  // 1) Access 保護（カスタムドメイン）
  if (results.access.status !== 302 && results.access.status !== 200) {
    issues.push(`Access 保護の HTTP ステータスが 302/200 ではありません（実際: ${results.access.status}）`)
  }
  if (
    results.access.status === 302 &&
    (results.access.location === undefined || !results.access.location.includes('cloudflareaccess.com'))
  ) {
    issues.push('Access 保護のリダイレクト先が cloudflareaccess.com ではありません')
  }
  // 2) SPA（workers.dev）: HTTP 200 かつ X-Content-Type-Options ヘッダーあり
  if (results.spa.status !== 200) {
    issues.push(`SPA の HTTP ステータスが 200 ではありません（実際: ${results.spa.status}）`)
  }
  if (results.spa.headers['x-content-type-options'] === undefined) {
    issues.push('SPA に X-Content-Type-Options ヘッダーがありません')
  }
  // 3) API（workers.dev）: HTTP 401 かつ error.code = CD-AUTH-001（fail-closed）
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
  workersDevUrl = DEFAULT_WORKERS_DEV_URL,
  fetchImpl = globalThis.fetch.bind(globalThis),
}) {
  const cacheBust = Date.now()
  // Access 保護面（カスタムドメイン）: リダイレクトは追わず 302/Location を取得する。
  const accessResponse = await fetchImpl(`${baseUrl}/?hc=${cacheBust}`, { redirect: 'manual' })
  // 実体検証面（workers.dev）: Access 非保護のためヘッダー/API 応答を直接確認できる。
  const spaResponse = await fetchImpl(`${workersDevUrl}/?hc=${cacheBust}`)
  const apiResponse = await fetchImpl(`${workersDevUrl}/api/v1/projects?hc=${cacheBust}`)

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
    workersDevUrl,
    access: {
      status: accessResponse.status,
      location: accessResponse.headers.get('location') ?? undefined,
    },
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

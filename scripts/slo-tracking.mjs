#!/usr/bin/env node
/* global console, process, fetch */
/**
 * SLO 追跡スクリプト（GitHub Actions の Production Health Check 実績から稼働率を集計）。
 *
 * 計測対象: "Production Health Check" ワークフローの completed runs。
 * 集計期間: 直近 30 日 / 90 日（GitHub は run 履歴を最大 90 日保持）。
 * 出力: JSON（--json または既定で Markdown + JSON の両方）とサマリー。
 *
 * 使い方（GitHub Actions 内）:
 *   GITHUB_TOKEN=<token> GITHUB_REPOSITORY=owner/repo node scripts/slo-tracking.mjs --json
 *
 * ローカル実行時は GITHUB_TOKEN / GH_TOKEN が必要。秘密値は出力しない。
 */

const GITHUB_API = 'https://api.github.com'

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} が未設定です（GitHub Actions / ローカルでは GITHUB_TOKEN または GH_TOKEN を設定してください）`)
  }
  return value
}

async function ghFetch(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub API エラー ${response.status}: ${url}`)
  }
  return response.json()
}

async function resolveWorkflowId(owner, repo, workflowName, token) {
  const data = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows`, token)
  const workflow = data.workflows.find((entry) => entry.name === workflowName)
  if (!workflow) {
    throw new Error(`ワークフローが見つかりません: ${workflowName}`)
  }
  return workflow.id
}

async function listCompletedRuns(owner, repo, workflowId, token, maxPages = 10) {
  const runs = []
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await ghFetch(
      `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?status=completed&per_page=100&page=${page}`,
      token,
    )
    runs.push(...data.workflow_runs)
    if (runs.length >= data.total_count || data.workflow_runs.length === 0) break
  }
  return runs
}

function toEpochSeconds(iso) {
  return Math.floor(Date.parse(iso) / 1000)
}

function computeAvailability(runs, windowSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const inWindow = runs.filter((run) => now - toEpochSeconds(run.created_at) <= windowSeconds)
  const total = inWindow.length
  const success = inWindow.filter((run) => run.conclusion === 'success').length
  const failed = inWindow.filter((run) => run.conclusion === 'failure').length
  const other = total - success - failed
  const availability = total === 0 ? null : (success / total) * 100
  return { total, success, failed, other, availability }
}

function formatTable(label, metric) {
  const availability =
    metric.availability === null ? 'データなし' : `${metric.availability.toFixed(2)}%`
  return [
    `| ${label} | ${metric.total} | ${metric.success} | ${metric.failed} | ${metric.other} | ${availability} |`,
  ]
}

function buildReport(runs) {
  const day = 24 * 60 * 60
  return {
    generatedAt: new Date().toISOString(),
    workflow: 'Production Health Check',
    windows: {
      last30d: computeAvailability(runs, 30 * day),
      last90d: computeAvailability(runs, 90 * day),
    },
    note: 'GitHub Actions の cron 遅延・実行停止期間は計測対象外。SLO は内部運用目安（対外公開は人間決裁）。',
  }
}

async function main() {
  const repository = requiredEnv('GITHUB_REPOSITORY')
  const token = process.env.GITHUB_TOKEN ?? requiredEnv('GH_TOKEN')
  const [owner, repo] = repository.split('/')
  const workflowId = await resolveWorkflowId(owner, repo, 'Production Health Check', token)
  const runs = await listCompletedRuns(owner, repo, workflowId, token)
  const report = buildReport(runs)

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write('# SLO 集計レポート\n\n')
    process.stdout.write(`- 生成時刻: ${report.generatedAt}\n`)
    process.stdout.write(`- 対象ワークフロー: ${report.workflow}\n\n`)
    process.stdout.write('| 期間 | 実行数 | 成功 | 失敗 | その他 | 稼働率 |\n')
    process.stdout.write('| --- | --- | --- | --- | --- | --- |\n')
    process.stdout.write(`${formatTable('直近30日', report.windows.last30d).join('\n')}\n`)
    process.stdout.write(`${formatTable('直近90日', report.windows.last90d).join('\n')}\n\n`)
    process.stdout.write(`> ${report.note}\n`)
  }
}

main().catch((error) => {
  console.error(`[slo-tracking] ERROR: ${error.message}`)
  process.exit(1)
})

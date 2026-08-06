#!/usr/bin/env node
/* global console, process */
/**
 * 性能メトリクスと閾値の比較（Issue #63）。
 * - 閾値超過は warning として報告し exit 0（CI を fail させない）
 * - --require <file> で指定したメトリクスファイルが存在しない場合は exit 1
 *   （計測自体の欠落は問題として扱う）
 *
 * 使い方:
 *   node scripts/check-perf-thresholds.mjs --require tests/performance/results/perf-metrics.json
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const requiredFiles = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--require') {
    const file = argv[i + 1]
    if (!file) {
      console.error('❌ [PERF] --require にはファイルパスが必要です')
      process.exit(2)
    }
    requiredFiles.push(resolve(process.cwd(), file))
    i += 1
  }
}

const thresholdsPath = resolve(process.cwd(), 'tests/performance/thresholds.json')
if (!existsSync(thresholdsPath)) {
  console.error(`❌ [PERF] 閾値ファイルがありません: ${thresholdsPath}`)
  process.exit(1)
}
const thresholds = JSON.parse(readFileSync(thresholdsPath, 'utf8'))

let exitCode = 0
for (const file of requiredFiles) {
  if (!existsSync(file)) {
    console.error(`❌ [PERF] 必須メトリクスファイルがありません: ${file}`)
    exitCode = 1
    continue
  }
  const metrics = JSON.parse(readFileSync(file, 'utf8'))
  for (const [key, value] of Object.entries(metrics)) {
    const limit = thresholds[key]
    if (typeof limit !== 'number' || limit <= 0) continue
    if (typeof value !== 'number') continue
    const unit = /bytes$/i.test(key) ? 'bytes' : 'ms'
    const exceeded = value > limit
    if (exceeded) {
      console.warn(`⚠️ [PERF] 閾値超過: ${key} = ${value}${unit} / 上限 ${limit}${unit}（要調査）`)
    } else {
      console.log(`✅ [PERF] ${key} = ${value}${unit} / 上限 ${limit}${unit}`)
    }
  }
}

if (exitCode !== 0) process.exit(exitCode)
console.log('ℹ️ [PERF] 閾値超過は warning 扱い（ADR-0010）。履歴は GitHub Actions artifact で確認できます。')

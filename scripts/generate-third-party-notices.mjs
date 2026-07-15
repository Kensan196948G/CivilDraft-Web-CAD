/* global console */
/**
 * generate-third-party-notices.mjs
 *
 * 目的: 配布される runtime 依存（package.json の `dependencies` から到達可能な
 *       本番依存クロージャ）のライセンス表示を集約し、THIRD-PARTY-NOTICES.md を生成する。
 *       MIT/BSD/ISC/Apache 等の許諾表示（attribution）義務を満たすための証跡。
 *
 * 実行: npm run notices  （= node scripts/generate-third-party-notices.mjs）
 *
 * 設計判断:
 *  - 新規 devDependency 導入は禁止（Issue #12 制約）。license-checker 等は使わず、
 *    node_modules の package.json / LICENSE を Node 標準 API のみで走査する。
 *  - 対象は `dependencies` のみ。devDependencies（vite/eslint/vitest 等のビルド専用
 *    ツール）は配布物に含まれないため除外する。
 *  - 直接依存だけでなく、その本番依存クロージャ（transitive）も含める。バンドルされる
 *    サードパーティコードの許諾表示義務は推移的依存にも及ぶため。
 *  - パッケージ解決は node の解決規則に沿った walk-up 方式で行い、npm の hoist / nested
 *    どちらの配置でも見つける（`require.resolve` の exports 制約を回避するため自前実装）。
 *  - `npm sbom --omit dev` は npm 11.6.2 で dedupe 済みの react/react-dom を本番クロージャ
 *    から欠落させる不具合があるため、SBOM 出力には依存せず本スクリプトが独自に走査する。
 *  - copyleft（GPL/LGPL/AGPL/MPL 等）検出時は生成は継続しつつ stderr に警告を出す（報告）。
 *    リリース可否の最終判断は docs/operations/dependency-hygiene.md の手順で人間が行う。
 */
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = join(ROOT, 'THIRD-PARTY-NOTICES.md')

// copyleft ライセンスの識別子パターン（許諾表示だけでは足りず、配布条件に注意を要する系統）。
const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|CDDL|CPL|OSL|EUPL|SSPL|CC-BY-SA)\b/i
// LICENSE 系ファイル名の判定（LICENSE / LICENCE / COPYING、任意拡張子）。
const LICENSE_FILE = /^(licen[cs]e|copying)(\.\w+)?$/i

/**
 * node の解決規則に沿って name のパッケージディレクトリを探す。
 * fromDir から node_modules を辿って上位へ walk-up する（hoist/nested 両対応）。
 */
function resolvePackageDir(name, fromDir) {
  let dir = resolve(fromDir)
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** package.json の license フィールド（string / {type} / 旧 licenses[] 配列）を SPDX 文字列へ正規化。 */
function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license === 'object' && typeof pkg.license.type === 'string') {
    return pkg.license.type
  }
  if (Array.isArray(pkg.licenses)) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).filter(Boolean).join(' OR ') || 'UNKNOWN'
  }
  return 'UNKNOWN'
}

/** パッケージ配下の LICENSE 本文（あれば）を返す。 */
function licenseFileText(pkgDir) {
  const file = readdirSync(pkgDir).find((f) => LICENSE_FILE.test(f))
  if (file === undefined) return null
  return readFileSync(join(pkgDir, file), 'utf8').trim()
}

/** 参照 URL（repository or homepage）を取り出す。 */
function referenceUrl(pkg) {
  if (typeof pkg.repository === 'string') return pkg.repository
  if (pkg.repository && typeof pkg.repository.url === 'string') return pkg.repository.url
  if (typeof pkg.homepage === 'string') return pkg.homepage
  return ''
}

// --- 本番依存クロージャの BFS 収集 --------------------------------------------
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const directDeps = Object.keys(rootPkg.dependencies ?? {})

const collected = new Map() // "name@version" -> record
const visited = new Set()
const missing = [] // dependencies に宣言されているのに解決できなかったもの（異常）
const queue = directDeps.map((name) => ({ name, fromDir: ROOT, optional: false }))

while (queue.length > 0) {
  const { name, fromDir, optional } = queue.shift()
  const pkgDir = resolvePackageDir(name, fromDir)
  if (pkgDir === null) {
    if (!optional) missing.push(name)
    continue
  }
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const key = `${pkg.name}@${pkg.version}`
  if (visited.has(key)) continue
  visited.add(key)

  collected.set(key, {
    name: pkg.name,
    version: pkg.version,
    license: licenseOf(pkg),
    url: referenceUrl(pkg),
    text: licenseFileText(pkgDir),
  })

  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    queue.push({ name: dep, fromDir: pkgDir, optional: false })
  }
  // optionalDependencies はインストールされていれば配布されうるため辿る（未解決は無視）。
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
    queue.push({ name: dep, fromDir: pkgDir, optional: true })
  }
}

const records = [...collected.values()].sort((a, b) => a.name.localeCompare(b.name))
const copyleft = records.filter((r) => COPYLEFT.test(r.license))

// --- THIRD-PARTY-NOTICES.md 生成 ---------------------------------------------
const generatedAt = new Date().toISOString()
const lines = []
lines.push('# Third-Party Notices')
lines.push('')
lines.push('CivilDraft-Web-CAD は以下のサードパーティ製オープンソースソフトウェアを利用しています。')
lines.push('各パッケージの著作権とライセンス条項は原著作者に帰属します。')
lines.push('')
lines.push('> このファイルは `npm run notices`（`scripts/generate-third-party-notices.mjs`）で自動生成されます。')
lines.push('> 対象は配布される runtime 依存（`dependencies` の本番クロージャ）のみで、devDependencies は含みません。')
lines.push('> 手動編集は次回生成で失われます。再生成タイミングは `docs/operations/dependency-hygiene.md` を参照してください。')
lines.push('')
lines.push(`- 生成日時: ${generatedAt}`)
lines.push(`- 対象パッケージ数: ${records.length}`)
lines.push('')
lines.push('## ライセンスサマリー')
lines.push('')
lines.push('| パッケージ | バージョン | ライセンス |')
lines.push('|---|---|---|')
for (const r of records) {
  lines.push(`| ${r.name} | ${r.version} | ${r.license} |`)
}
lines.push('')
lines.push('## 各パッケージの許諾条項')
lines.push('')
for (const r of records) {
  lines.push(`### ${r.name}@${r.version}`)
  lines.push('')
  lines.push(`- ライセンス: ${r.license}`)
  if (r.url) lines.push(`- 参照: ${r.url}`)
  lines.push('')
  if (r.text) {
    lines.push('```')
    lines.push(r.text)
    lines.push('```')
    lines.push('')
  } else {
    lines.push('（パッケージ内に LICENSE ファイルが同梱されていません。上記ライセンス識別子を参照してください。）')
    lines.push('')
  }
}

writeFileSync(OUTPUT, lines.join('\n') + '\n', 'utf8')

// --- 標準出力への報告 ---------------------------------------------------------
console.log(`THIRD-PARTY-NOTICES.md を生成しました（${records.length} パッケージ）。`)
if (missing.length > 0) {
  console.error(`WARNING: dependencies に宣言されているが解決できませんでした: ${missing.join(', ')}`)
}
if (copyleft.length > 0) {
  console.error('==============================================================')
  console.error('WARNING: copyleft 系ライセンスを検出しました（要レビュー）:')
  for (const r of copyleft) console.error(`  - ${r.name}@${r.version}: ${r.license}`)
  console.error('リリース可否は docs/operations/dependency-hygiene.md の手順で判断してください。')
  console.error('==============================================================')
} else {
  console.log('copyleft 系（GPL/LGPL/AGPL/MPL 等）ライセンスは検出されませんでした。')
}

#!/usr/bin/env node
/* global console, process */
/**
 * SXF（P21）の基本構造検証（外部電子納品チェックシステムの前段）。
 *
 * 検証内容（試作レベルの構造チェックであり、完全適合の断定はしない）:
 * - ISO 10303-21 ヘッダーの存在
 * - FILE_DESCRIPTION / FILE_NAME / FILE_SCHEMA の存在
 * - エンティティ行の構文（#id=NAME(...)）
 * - TRIMMED_CURVE による円弧表現（試作エクスポータの約束事）
 * - 括弧バランス
 *
 * 使い方:
 *   node scripts/tools/validate-sxf.mjs <file.P21>
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ENTITY_RE = /^#\d+\s*=\s*[A-Za-z_][A-Za-z0-9_]*\(.*\);?$/

export function validateSxfP21(text) {
  const errors = []
  const lines = text.split(/\r?\n/)
  if (lines.length === 0 || !lines[0].includes('ISO-10303-21')) {
    errors.push('先頭行に ISO-10303-21 ヘッダーがありません')
  }
  const joined = text
  if (!joined.includes('FILE_DESCRIPTION')) errors.push('FILE_DESCRIPTION がありません')
  if (!joined.includes('FILE_NAME')) errors.push('FILE_NAME がありません')
  if (!joined.includes('FILE_SCHEMA')) errors.push('FILE_SCHEMA がありません')

  let entityCount = 0
  let trimmedCurveCount = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('/*')) continue
    if (trimmed.startsWith('#')) {
      if (!ENTITY_RE.test(trimmed)) {
        errors.push(`エンティティ行の構文が不正: ${trimmed.slice(0, 80)}`)
      } else {
        entityCount += 1
        if (trimmed.includes('TRIMMED_CURVE')) trimmedCurveCount += 1
      }
    }
  }
  if (entityCount === 0) errors.push('エンティティが1件もありません')

  const open = (joined.match(/\(/g) ?? []).length
  const close = (joined.match(/\)/g) ?? []).length
  if (open !== close) errors.push(`括弧バランスが不正（open=${open}, close=${close}）`)

  return {
    ok: errors.length === 0,
    errors,
    entityCount,
    trimmedCurveCount,
    note: '基本構造チェックであり、SXF 属性エンティティ・CAD 製図基準への完全適合は外部チェックシステムで検証すること。',
  }
}

function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: validate-sxf.mjs <file.P21>')
    process.exit(2)
  }
  const result = validateSxfP21(readFileSync(file, 'utf8'))
  for (const error of result.errors) console.error(`- ${error}`)
  console.log(
    `検証結果: ${result.ok ? 'OK' : 'NG'}（エンティティ ${result.entityCount} 件・TRIMMED_CURVE ${result.trimmedCurveCount} 件）`,
  )
  console.log(result.note)
  process.exit(result.ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}

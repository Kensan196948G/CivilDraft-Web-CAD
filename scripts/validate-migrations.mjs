/* global console, process */
/**
 * Migration static verifier.
 *
 * This intentionally does not connect to Neon or any production database.
 * It validates the repository SQL files for release-readiness guardrails:
 * transaction boundary, destructive DDL absence, table presence, FK targets,
 * and index target consistency.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'migrations')

const EXPECTED_TABLES = [
  'projects',
  'work_sections',
  'project_members',
  'master_items',
  'drawings',
  'drawing_revisions',
  'drawing_contents',
  'quantity_items',
  'quantity_sources',
  'workflow_actions',
  'export_jobs',
  'audit_logs',
]

const REQUIRED_INDEXES = [
  'drawings_project_status_idx',
  'drawing_revisions_drawing_created_idx',
  'drawing_revisions_status_updated_idx',
  'project_members_user_project_idx',
  'audit_logs_project_occurred_idx',
  'audit_logs_actor_occurred_idx',
  'export_jobs_status_created_idx',
]

const DESTRUCTIVE_PATTERNS = [
  /\bDROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|CONSTRAINT)\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i,
]

function stripComments(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message)
}

function validateBalancedParentheses(sql, file, failures) {
  let depth = 0
  for (const [index, char] of [...sql].entries()) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth < 0) {
      failures.push(`${file}: closing parenthesis without opener near offset ${index}`)
      return
    }
  }
  assert(depth === 0, `${file}: unbalanced parentheses depth=${depth}`, failures)
}

function validateSqlFile(file, sql) {
  const failures = []
  const stripped = stripComments(sql)
  const normalized = stripped.replace(/\s+/g, ' ').trim()

  assert(/\bBEGIN\s*;/.test(stripped), `${file}: missing BEGIN transaction`, failures)
  assert(/\bCOMMIT\s*;/.test(stripped), `${file}: missing COMMIT transaction`, failures)
  assert(
    normalized.indexOf('BEGIN;') < normalized.lastIndexOf('COMMIT;'),
    `${file}: BEGIN must appear before COMMIT`,
    failures,
  )

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    assert(!pattern.test(stripped), `${file}: destructive SQL pattern detected: ${pattern}`, failures)
  }

  validateBalancedParentheses(stripped, file, failures)

  const tableMatches = [...stripped.matchAll(/\bCREATE\s+TABLE\s+([a-z_][a-z0-9_]*)\s*\(/gi)]
  const tables = new Set(tableMatches.map((match) => match[1].toLowerCase()))
  for (const table of EXPECTED_TABLES) {
    assert(tables.has(table), `${file}: missing expected table ${table}`, failures)
  }

  const fkMatches = [...stripped.matchAll(/\bREFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/gi)]
  for (const match of fkMatches) {
    const target = match[1].toLowerCase()
    assert(tables.has(target), `${file}: foreign key references unknown table ${target}`, failures)
  }

  const indexMatches = [...stripped.matchAll(/\bCREATE\s+INDEX\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)\s*\(/gi)]
  const indexes = new Set(indexMatches.map((match) => match[1].toLowerCase()))
  for (const indexName of REQUIRED_INDEXES) {
    assert(indexes.has(indexName), `${file}: missing required index ${indexName}`, failures)
  }
  for (const match of indexMatches) {
    const table = match[2].toLowerCase()
    assert(tables.has(table), `${file}: index ${match[1]} targets unknown table ${table}`, failures)
  }

  assert(
    /\bCREATE\s+TABLE\s+audit_logs\b[\s\S]*?\bcorrelation_id\s+text\b/i.test(stripped),
    `${file}: audit_logs.correlation_id is required for request tracing`,
    failures,
  )
  assert(
    /\bCREATE\s+TABLE\s+drawing_contents\b[\s\S]*?\bcontent_checksum\s+text\s+NOT\s+NULL\b/i.test(stripped),
    `${file}: drawing_contents.content_checksum is required`,
    failures,
  )

  return failures
}

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort()

const failures = []
assert(migrationFiles.length > 0, 'migrations: no numbered SQL files found', failures)

for (const file of migrationFiles) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
  failures.push(...validateSqlFile(file, sql))
}

if (failures.length > 0) {
  console.error('Migration validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Migration validation passed (${migrationFiles.length} file(s)).`)

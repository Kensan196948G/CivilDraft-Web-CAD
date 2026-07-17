/* global console, process */
/**
 * High-confidence secret scanner.
 *
 * Values are never printed. Findings are reported as file:line:kind only.
 * This is intentionally conservative to avoid leaking secrets into CI logs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.vite'])
const SKIP_FILES = new Set(['package-lock.json', 'sbom/civildraft-sbom.cdx.json'])

const PATTERNS = [
  ['private-key', /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['database-url', /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"<>]+/i],
  ['assigned-secret', /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][^'"\s]{16,}['"]/i],
]

function isTextFile(path) {
  const sample = readFileSync(path)
  return !sample.includes(0)
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    const rel = relative(ROOT, path).replaceAll('\\', '/')
    if (SKIP_FILES.has(rel)) continue
    const stats = statSync(path)
    if (stats.isDirectory()) {
      yield* walk(path)
    } else if (stats.isFile()) {
      yield path
    }
  }
}

const findings = []
for (const path of walk(ROOT)) {
  if (!isTextFile(path)) continue
  const rel = relative(ROOT, path).replaceAll('\\', '/')
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    for (const [kind, pattern] of PATTERNS) {
      if (pattern.test(line)) {
        findings.push(`${rel}:${index + 1}:${kind}`)
      }
    }
  }
}

if (findings.length > 0) {
  console.error('High-confidence secret candidates found:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log('High-confidence secret scan passed (0 findings).')

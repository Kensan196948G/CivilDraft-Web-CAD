/* global console, process */
/**
 * Release-readiness audit runner.
 *
 * This command is intentionally local-only. It does not deploy, push, tag,
 * mutate secrets, or connect to production databases.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const npmCmd = isWindows ? 'npm.cmd' : 'npm'
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const noticesPath = join(rootDir, 'THIRD-PARTY-NOTICES.md')
const sbomPath = join(rootDir, 'sbom', 'civildraft-sbom.cdx.json')

const steps = [
  ['Lint', npmCmd, ['run', 'lint']],
  ['Typecheck', npmCmd, ['run', 'typecheck']],
  ['Migration static validation', npmCmd, ['run', 'migrations:check']],
  ['Vitest', npmCmd, ['test']],
  ['Production build', npmCmd, ['run', 'build']],
  ['Browser E2E', npmCmd, ['run', 'e2e']],
  ['Dependency audit', npmCmd, ['audit', '--audit-level=high']],
  ['SBOM generation', npmCmd, ['run', 'sbom']],
  ['Third-party notices generation', npmCmd, ['run', 'notices']],
]

function run(label, command, args, options = {}) {
  console.log(`\n== ${label} ==`)
  const result = isWindows
    ? spawnSync([command, ...args].join(' '), {
      stdio: 'inherit',
      shell: true,
      ...options,
    })
    : spawnSync(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    })
  if (result.error !== undefined) {
    console.error(`${label} failed to start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

for (const [label, command, args] of steps) {
  run(label, command, args)
}

console.log('\n== SBOM deterministic check ==')
const sbomBefore = readFileSync(sbomPath, 'utf8')
run('SBOM regeneration check', npmCmd, ['run', 'sbom'])
const sbomAfter = readFileSync(sbomPath, 'utf8')
if (sbomBefore !== sbomAfter) {
  console.error('sbom/civildraft-sbom.cdx.json changed when regenerated twice in the same audit run.')
  process.exit(1)
}
console.log('sbom/civildraft-sbom.cdx.json is deterministic for the current dependency set.')

console.log('\n== Third-party notices deterministic check ==')
const noticesBefore = readFileSync(noticesPath, 'utf8')
run('Third-party notices regeneration check', npmCmd, ['run', 'notices'])
const noticesAfter = readFileSync(noticesPath, 'utf8')
if (noticesBefore !== noticesAfter) {
  console.error('THIRD-PARTY-NOTICES.md changed when regenerated twice in the same audit run.')
  process.exit(1)
}
console.log('THIRD-PARTY-NOTICES.md is deterministic for the current dependency set.')

run('High-confidence secret scan', npmCmd, ['run', 'secret:scan'])

console.log('\nRelease audit completed. Production deployment, Git push, tags, secrets, and DB migrations remain human approval gates.')

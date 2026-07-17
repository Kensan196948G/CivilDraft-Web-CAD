/* global console, process */
/**
 * Generate a deterministic CycloneDX SBOM.
 *
 * `npm sbom` includes volatile metadata such as timestamp and serialNumber.
 * Normalize those fields so CI can detect real dependency drift.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const isWindows = process.platform === 'win32'
const npmCmd = isWindows ? 'npm.cmd' : 'npm'
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const outputPath = join(rootDir, 'sbom', 'civildraft-sbom.cdx.json')

const result = isWindows
  ? spawnSync(`${npmCmd} sbom --sbom-format cyclonedx --sbom-type application --omit optional`, {
    cwd: rootDir,
    encoding: 'utf8',
    shell: true,
  })
  : spawnSync(npmCmd, ['sbom', '--sbom-format', 'cyclonedx', '--sbom-type', 'application', '--omit', 'optional'], {
    cwd: rootDir,
    encoding: 'utf8',
    shell: false,
  })

if (result.error !== undefined) {
  console.error(`npm sbom failed to start: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  if (result.stderr) console.error(result.stderr)
  process.exit(result.status ?? 1)
}

const sbom = JSON.parse(result.stdout)
sbom.serialNumber = 'urn:uuid:00000000-0000-4000-8000-000000000000'
sbom.metadata = {
  ...sbom.metadata,
  timestamp: '1970-01-01T00:00:00.000Z',
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`)
console.log('sbom/civildraft-sbom.cdx.json を生成しました。')

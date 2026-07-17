export type PersistenceMode = 'memory' | 'neon-r2'

export interface ProductionPersistenceReadiness {
  readonly ready: boolean
  readonly missingBindings: readonly string[]
}

const PRODUCTION_BINDING_LABELS = [
  'CIVILDRAFT_NEON_CONNECTION',
  'CIVILDRAFT_R2_BUCKET',
] as const

/**
 * Fail closed: only explicit 'memory' / 'neon-r2' are accepted.
 * Unset or unrecognized values return undefined so the caller can refuse to
 * serve requests instead of silently falling back to the in-memory store
 * (misconfigured production would otherwise lose data without any signal).
 */
export function resolvePersistenceMode(value: unknown): PersistenceMode | undefined {
  if (value === 'neon-r2') return 'neon-r2'
  if (value === 'memory') return 'memory'
  return undefined
}

export function inspectProductionPersistenceReadiness(
  env: Readonly<Record<string, unknown>>,
): ProductionPersistenceReadiness {
  const missingBindings = PRODUCTION_BINDING_LABELS.filter((key) => env[key] === undefined)
  return {
    ready: missingBindings.length === 0,
    missingBindings,
  }
}

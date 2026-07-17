export type PersistenceMode = 'memory' | 'neon-r2'

export interface ProductionPersistenceReadiness {
  readonly ready: boolean
  readonly missingBindings: readonly string[]
}

const PRODUCTION_BINDING_LABELS = [
  'CIVILDRAFT_NEON_CONNECTION',
  'CIVILDRAFT_R2_BUCKET',
] as const

export function resolvePersistenceMode(value: unknown): PersistenceMode {
  return value === 'neon-r2' ? 'neon-r2' : 'memory'
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

import { NeonApiStore } from './neonApiStore'
import { R2ContentStore } from './r2ContentStore'
import type { ApiStore } from './apiStore'
import type { SqlClient } from './neonApiStore'
import type { R2BucketBinding } from './r2ContentStore'

export type PersistenceMode = 'memory' | 'neon-r2'

export interface ProductionPersistenceReadiness {
  readonly ready: boolean
  readonly missingBindings: readonly string[]
}

export interface NeonApiStoreWithR2 {
  readonly apiStore: ApiStore
  readonly neonStore: NeonApiStore
  readonly contentStore: R2ContentStore
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

/**
 * Create a NeonApiStore + R2ContentStore from Worker bindings.
 *
 * `sqlFactory` is the `neon()` function from `@neondatabase/serverless`.
 * The returned `apiStore` satisfies the `ApiStore` interface (Map-based).
 * `initialize()` is called automatically so callers can use the Maps
 * synchronously after awaiting this factory.
 *
 * Throws if required bindings are missing (caller should check readiness first).
 */
export async function createNeonApiStore(env: {
  readonly CIVILDRAFT_NEON_CONNECTION: string
  readonly CIVILDRAFT_R2_BUCKET: R2BucketBinding
  readonly sqlFactory?: (connectionString: string) => SqlClient
}): Promise<NeonApiStoreWithR2> {
  // Dynamic import so @neondatabase/serverless is only loaded in production paths
  const neonModule = await import('@neondatabase/serverless')
  const factory: (connectionString: string) => SqlClient = env.sqlFactory ?? neonModule.neon
  const sql = factory(env.CIVILDRAFT_NEON_CONNECTION)
  const neonStore = new NeonApiStore(sql)
  await neonStore.initialize()
  const contentStore = new R2ContentStore(env.CIVILDRAFT_R2_BUCKET)
  return { apiStore: neonStore, neonStore, contentStore }
}

/**
 * Create an R2ContentStore from an R2 bucket binding.
 * Thin factory that callers can use to instantiate the content store independently.
 */
export function createR2ContentStore(bucket: R2BucketBinding): R2ContentStore {
  return new R2ContentStore(bucket)
}

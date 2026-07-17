/**
 * Cloudflare Access JWT (Cf-Access-Jwt-Assertion) verification (#36).
 *
 * Second line of defense behind the Access proxy: verifies the RS256
 * signature against the team's JWKS and the iss/aud/exp/nbf claims.
 * Fail closed: any parse, fetch, or verification failure is a rejection.
 * The caller decides the HTTP mapping (401) and whether verification is
 * mandatory for the current persistence mode.
 */

export interface AccessJwtConfig {
  /** Access team domain, e.g. 'https://example.cloudflareaccess.com' (also the expected iss). */
  readonly teamDomain: string
  /** Access application AUD tag the token must be issued for. */
  readonly aud: string
}

export interface AccessJwtVerification {
  readonly ok: boolean
  /** Stable machine-readable reason for logs/audit. Never contains token material. */
  readonly reason: string
  /** Verified claims payload (only when ok). */
  readonly payload?: Readonly<Record<string, unknown>>
}

interface JsonWebKeyLike {
  readonly kid?: string
  readonly kty?: string
  readonly alg?: string
  readonly n?: string
  readonly e?: string
}

/** Allowed clock skew for exp/nbf comparison, in seconds. */
const CLOCK_SKEW_SECONDS = 60

/** JWKS cache TTL. Access rotates keys infrequently; a kid miss triggers refetch. */
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000

interface JwksCacheEntry {
  readonly fetchedAtMs: number
  readonly keys: readonly JsonWebKeyLike[]
}

const jwksCache = new Map<string, JwksCacheEntry>()

export function resolveAccessJwtConfig(
  env: Readonly<Record<string, unknown>>,
): AccessJwtConfig | undefined {
  const teamDomain = normalizeTeamDomain(env['CIVILDRAFT_ACCESS_TEAM_DOMAIN'])
  const aud = typeof env['CIVILDRAFT_ACCESS_AUD'] === 'string' ? env['CIVILDRAFT_ACCESS_AUD'].trim() : ''
  if (!teamDomain || !aud) {
    return undefined
  }
  return { teamDomain, aud }
}

function normalizeTeamDomain(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(trimmed)) return undefined
  return trimmed
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** base64url decode that never throws; returns undefined on malformed input. */
function tryBase64UrlToBytes(value: string): Uint8Array | undefined {
  try {
    return base64UrlToBytes(value)
  } catch {
    return undefined
  }
}

function decodeJsonSegment(segment: string): Record<string, unknown> | undefined {
  try {
    const text = new TextDecoder().decode(base64UrlToBytes(segment))
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return undefined
  } catch {
    return undefined
  }
}

async function loadJwks(
  certsUrl: string,
  injectedJwks: unknown,
  forceRefresh: boolean,
): Promise<readonly JsonWebKeyLike[] | undefined> {
  if (injectedJwks !== undefined) {
    return extractKeys(injectedJwks)
  }
  const cached = jwksCache.get(certsUrl)
  if (!forceRefresh && cached && Date.now() - cached.fetchedAtMs < JWKS_CACHE_TTL_MS) {
    return cached.keys
  }
  try {
    const response = await fetch(certsUrl)
    if (!response.ok) return cached?.keys
    const keys = extractKeys(await response.json())
    if (keys) {
      jwksCache.set(certsUrl, { fetchedAtMs: Date.now(), keys })
    }
    return keys ?? cached?.keys
  } catch {
    // Network failure: fall back to a stale cache if one exists (still signature-checked).
    return cached?.keys
  }
}

function extractKeys(jwks: unknown): readonly JsonWebKeyLike[] | undefined {
  if (jwks === null || typeof jwks !== 'object') return undefined
  const keys = (jwks as { keys?: unknown }).keys
  if (!Array.isArray(keys)) return undefined
  return keys.filter(
    (key): key is JsonWebKeyLike => key !== null && typeof key === 'object',
  )
}

async function importRs256Key(jwk: JsonWebKeyLike): Promise<CryptoKey | undefined> {
  if (jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    return undefined
  }
  try {
    return await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  } catch {
    return undefined
  }
}

function rejected(reason: string): AccessJwtVerification {
  return { ok: false, reason }
}

/**
 * Verify a Cf-Access-Jwt-Assertion token against the team JWKS.
 * `injectedJwks` bypasses the network fetch (tests and offline validation).
 */
export async function verifyAccessJwt(
  token: string,
  config: AccessJwtConfig,
  options: { readonly injectedJwks?: unknown; readonly nowEpochSeconds?: number } = {},
): Promise<AccessJwtVerification> {
  const segments = token.split('.')
  if (segments.length !== 3) {
    return rejected('malformed-token')
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string]
  const header = decodeJsonSegment(headerSegment)
  if (!header) return rejected('malformed-header')
  if (header['alg'] !== 'RS256') return rejected('unsupported-alg')
  const kid = typeof header['kid'] === 'string' ? header['kid'] : undefined

  const payload = decodeJsonSegment(payloadSegment)
  if (!payload) return rejected('malformed-payload')

  const certsUrl = `${config.teamDomain}/cdn-cgi/access/certs`
  let keys = await loadJwks(certsUrl, options.injectedJwks, false)
  let jwk = pickKey(keys, kid)
  if (!jwk && options.injectedJwks === undefined) {
    // Unknown kid can mean key rotation: refetch once before rejecting.
    keys = await loadJwks(certsUrl, undefined, true)
    jwk = pickKey(keys, kid)
  }
  if (!jwk) return rejected('unknown-kid')

  const cryptoKey = await importRs256Key(jwk)
  if (!cryptoKey) return rejected('invalid-jwk')

  // Decode the signature before calling verify: an invalid base64url signature
  // would otherwise throw synchronously while evaluating the verify() argument,
  // escaping the .catch() below and rejecting the whole request (would surface
  // as a bare 500 instead of a clean 401). Fail closed to 'malformed-signature'.
  const signatureBytes = tryBase64UrlToBytes(signatureSegment)
  if (!signatureBytes) return rejected('malformed-signature')

  const signatureValid = await crypto.subtle
    .verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signatureBytes.slice().buffer,
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    )
    .catch(() => false)
  if (!signatureValid) return rejected('invalid-signature')

  const now = options.nowEpochSeconds ?? Math.floor(Date.now() / 1000)
  const exp = payload['exp']
  if (typeof exp !== 'number' || exp + CLOCK_SKEW_SECONDS <= now) {
    return rejected('expired')
  }
  const nbf = payload['nbf']
  if (typeof nbf === 'number' && nbf - CLOCK_SKEW_SECONDS > now) {
    return rejected('not-yet-valid')
  }
  if (payload['iss'] !== config.teamDomain) {
    return rejected('issuer-mismatch')
  }
  const aud = payload['aud']
  const audValues = Array.isArray(aud) ? aud : [aud]
  if (!audValues.includes(config.aud)) {
    return rejected('audience-mismatch')
  }

  return { ok: true, reason: 'verified', payload }
}

function pickKey(
  keys: readonly JsonWebKeyLike[] | undefined,
  kid: string | undefined,
): JsonWebKeyLike | undefined {
  if (!keys || keys.length === 0) return undefined
  if (kid !== undefined) {
    return keys.find((key) => key.kid === kid)
  }
  // No kid in the header: only unambiguous single-key sets are acceptable.
  return keys.length === 1 ? keys[0] : undefined
}

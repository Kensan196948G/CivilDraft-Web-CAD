import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import worker, {
  createMemoryStore,
  handleRequest,
  type AssetFetcher,
  type WorkerEnv,
} from '@/workers/index'
import { resetRateLimitState } from '@/workers/rateLimit'

// 2026-08-01 リリース後監査で追加したハードニングの回帰テスト:
// 1) 全 API レスポンスへのセキュリティヘッダー付与
// 2) run_worker_first 時の SPA/アセット経路（ASSETS 転送 + ヘッダー）
// 3) Access JWT 検証済みペイロードの email を actorId として採用（ヘッダー偽装対策）

const TEAM_DOMAIN = 'https://civildraft.cloudflareaccess.com'
const AUD = 'aud-tag-civildraft-app'
const KID = 'test-key-1'
const AUTH_HEADER = 'Cf-Access-Jwt-Assertion'
const USER_HEADER = 'Cf-Access-Authenticated-User-Email'

function b64url(input: Uint8Array | string): string {
  const binary = typeof input === 'string' ? input : String.fromCharCode(...input)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let privateKey: CryptoKey
let jwks: { keys: Record<string, unknown>[] }

async function signJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' },
): Promise<string> {
  const headerSegment = b64url(JSON.stringify(header))
  const payloadSegment = b64url(JSON.stringify(payload))
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    ),
  )
  return `${headerSegment}.${payloadSegment}.${b64url(signature)}`
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: TEAM_DOMAIN,
    aud: [AUD],
    exp: now + 600,
    nbf: now - 60,
    iat: now,
    email: 'engineer@example.test',
    ...overrides,
  }
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  privateKey = keyPair.privateKey
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  jwks = { keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }
})

function testEnv(): WorkerEnv {
  return { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
}

function accessConfiguredEnv(): WorkerEnv {
  return {
    ...testEnv(),
    CIVILDRAFT_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CIVILDRAFT_ACCESS_AUD: AUD,
    CIVILDRAFT_ACCESS_JWKS: jwks,
  }
}

const EXPECTED_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy':
    "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
}

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(EXPECTED_SECURITY_HEADERS)) {
    expect(response.headers.get(name)).toBe(value)
  }
}

beforeEach(() => {
  resetRateLimitState()
})

describe('セキュリティヘッダー（2026-08-01 監査）', () => {
  it('認証エラー応答にもセキュリティヘッダーが付与される', async () => {
    const res = await handleRequest(new Request('https://api.example.com/api/v1/projects'), testEnv())
    expect(res.status).toBe(401)
    expectSecurityHeaders(res)
  })

  it('成功応答（JSON）にもセキュリティヘッダーが付与される', async () => {
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: {
          [AUTH_HEADER]: 'jwt-token',
          [USER_HEADER]: 'engineer@example.test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectNumber: 'P-001', name: '監査ヘッダー検証' }),
      }),
      testEnv(),
    )
    expect(res.status).toBe(201)
    expectSecurityHeaders(res)
  })

  it('run_worker_first 時: API 以外は ASSETS へ転送しヘッダーを付与する', async () => {
    const assets: AssetFetcher = {
      fetch: async () =>
        new Response('<!doctype html><title>SPA</title>', {
          status: 200,
          headers: { 'Content-Type': 'text/html', 'X-Custom': 'kept' },
        }),
    }
    const res = await worker.fetch(
      new Request('https://civildraft-web-cad.mirai-dx-platform.com/'),
      { ...testEnv(), ASSETS: assets },
      {} as never,
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('SPA')
    expect(res.headers.get('X-Custom')).toBe('kept')
    expectSecurityHeaders(res)
  })

  it('run_worker_first 時: API 経路は認証チェックを維持する（ASSETS へ転送しない）', async () => {
    const assets: AssetFetcher = {
      fetch: async () => new Response('unexpected', { status: 200 }),
    }
    const res = await worker.fetch(
      new Request('https://civildraft-web-cad.mirai-dx-platform.com/api/v1/projects'),
      { ...testEnv(), ASSETS: assets },
      {} as never,
    )
    expect(res.status).toBe(401)
  })
})

describe('actorId の JWT ペイロード採用（ヘッダー偽装対策）', () => {
  it('検証済み JWT の email が actorId になる（偽装ヘッダーより優先）', async () => {
    const token = await signJwt(validPayload())
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: {
          [AUTH_HEADER]: token,
          // Access プロキシを迂回した直接アクセスで任意に偽装されたヘッダー。
          [USER_HEADER]: 'attacker@example.test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectNumber: 'P-002', name: 'actor検証' }),
      }),
      accessConfiguredEnv(),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      project: { createdBy: string; updatedBy: string }
    }
    expect(body.project.createdBy).toBe('engineer@example.test')
    expect(body.project.updatedBy).toBe('engineer@example.test')
  })

  it('JWT に email がない場合でも偽装可能ヘッダーへはフォールバックしない（なりすまし対策）', async () => {
    // service token JWT（email なし・common_name あり）+ 偽装ヘッダーの組み合わせ。
    // 修正前はヘッダー値が actorId になり、任意ユーザーへのなりすましが成立していた。
    const token = await signJwt(validPayload({ email: undefined, common_name: 'ci-bot' }))
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: {
          [AUTH_HEADER]: token,
          [USER_HEADER]: 'victim@example.test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectNumber: 'P-003', name: 'actorフォールバック' }),
      }),
      accessConfiguredEnv(),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { project: { createdBy: string } }
    expect(body.project.createdBy).toBe('service-token:ci-bot')
    expect(body.project.createdBy).not.toBe('victim@example.test')
  })

  it('email も common_name もない JWT は sub 由来の identity になる（ヘッダー不使用）', async () => {
    const token = await signJwt(validPayload({ email: undefined, sub: 'user-uuid-123' }))
    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/projects', {
        method: 'POST',
        headers: {
          [AUTH_HEADER]: token,
          [USER_HEADER]: 'victim@example.test',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectNumber: 'P-004', name: 'sub由来identity' }),
      }),
      accessConfiguredEnv(),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { project: { createdBy: string } }
    expect(body.project.createdBy).toBe('subject:user-uuid-123')
  })
})

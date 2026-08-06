import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resolveAccessJwtConfig, verifyAccessJwt } from '@/workers/accessJwt'
import { createMemoryStore, handleRequest, type WorkerEnv } from '@/workers/index'
import { resetRateLimitState } from '@/workers/rateLimit'

const TEAM_DOMAIN = 'https://civildraft.cloudflareaccess.com'
const AUD = 'aud-tag-civildraft-app'
const KID = 'test-key-1'

function b64url(input: Uint8Array | string): string {
  const binary = typeof input === 'string' ? input : String.fromCharCode(...input)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let privateKey: CryptoKey
let jwks: { keys: Record<string, unknown>[] }

async function signJwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' },
  key: CryptoKey = privateKey,
): Promise<string> {
  const headerSegment = b64url(JSON.stringify(header))
  const payloadSegment = b64url(JSON.stringify(payload))
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
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

const config = { teamDomain: TEAM_DOMAIN, aud: AUD }

beforeEach(() => {
  resetRateLimitState()
})

describe('resolveAccessJwtConfig', () => {
  it('team domainとAUDが揃ったときだけ設定を返す（末尾スラッシュは正規化）', () => {
    expect(
      resolveAccessJwtConfig({
        CIVILDRAFT_ACCESS_TEAM_DOMAIN: `${TEAM_DOMAIN}/`,
        CIVILDRAFT_ACCESS_AUD: AUD,
      }),
    ).toEqual(config)
    expect(resolveAccessJwtConfig({ CIVILDRAFT_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN })).toBeUndefined()
    expect(resolveAccessJwtConfig({ CIVILDRAFT_ACCESS_AUD: AUD })).toBeUndefined()
    expect(resolveAccessJwtConfig({})).toBeUndefined()
  })

  it('https以外のteam domainは不正として拒否する', () => {
    expect(
      resolveAccessJwtConfig({
        CIVILDRAFT_ACCESS_TEAM_DOMAIN: 'http://civildraft.cloudflareaccess.com',
        CIVILDRAFT_ACCESS_AUD: AUD,
      }),
    ).toBeUndefined()
  })
})

describe('verifyAccessJwt', () => {
  it('正しい署名・iss・aud・期限のトークンを受理する', async () => {
    const token = await signJwt(validPayload())
    const result = await verifyAccessJwt(token, config, { injectedJwks: jwks })
    expect(result.ok).toBe(true)
    expect(result.payload?.['email']).toBe('engineer@example.test')
  })

  it('aud が文字列単体でも受理する', async () => {
    const token = await signJwt(validPayload({ aud: AUD }))
    const result = await verifyAccessJwt(token, config, { injectedJwks: jwks })
    expect(result.ok).toBe(true)
  })

  it('ペイロード改ざん（署名不一致）を拒否する', async () => {
    const token = await signJwt(validPayload())
    const [headerSegment, , signatureSegment] = token.split('.') as [string, string, string]
    const forged = `${headerSegment}.${b64url(JSON.stringify(validPayload({ email: 'attacker@example.test' })))}.${signatureSegment}`
    const result = await verifyAccessJwt(forged, config, { injectedJwks: jwks })
    expect(result).toMatchObject({ ok: false, reason: 'invalid-signature' })
  })

  it('期限切れトークンを拒否する', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signJwt(validPayload({ exp: now - 3600 }))
    const result = await verifyAccessJwt(token, config, { injectedJwks: jwks })
    expect(result).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('aud不一致を拒否する', async () => {
    const token = await signJwt(validPayload({ aud: ['other-app'] }))
    const result = await verifyAccessJwt(token, config, { injectedJwks: jwks })
    expect(result).toMatchObject({ ok: false, reason: 'audience-mismatch' })
  })

  it('iss不一致を拒否する', async () => {
    const token = await signJwt(validPayload({ iss: 'https://evil.cloudflareaccess.com' }))
    const result = await verifyAccessJwt(token, config, { injectedJwks: jwks })
    expect(result).toMatchObject({ ok: false, reason: 'issuer-mismatch' })
  })

  it('alg=none や RS256 以外を拒否する', async () => {
    const token = await signJwt(validPayload(), { alg: 'none', kid: KID, typ: 'JWT' })
    const result = await verifyAccessJwt(token, config, { injectedJwks: jwks })
    expect(result).toMatchObject({ ok: false, reason: 'unsupported-alg' })
  })

  it('未知のkidを拒否する（JWKS注入時は再取得しない）', async () => {
    const token = await signJwt(validPayload(), { alg: 'RS256', kid: 'rotated-away', typ: 'JWT' })
    const result = await verifyAccessJwt(token, config, { injectedJwks: jwks })
    expect(result).toMatchObject({ ok: false, reason: 'unknown-kid' })
  })

  it('JWT形式でない文字列を拒否する', async () => {
    const result = await verifyAccessJwt('jwt-token', config, { injectedJwks: jwks })
    expect(result).toMatchObject({ ok: false, reason: 'malformed-token' })
  })

  it('署名部が不正base64でも throw せず malformed-signature を返す（fail-closed回帰）', async () => {
    const token = await signJwt(validPayload())
    const [headerSegment, payloadSegment] = token.split('.') as [string, string, string]
    const forged = `${headerSegment}.${payloadSegment}.@@@invalid-base64@@@`
    // 修正前はここで verifyAccessJwt が同期throwし handleRequest ごと500になった
    const result = await verifyAccessJwt(forged, config, { injectedJwks: jwks })
    expect(result).toMatchObject({ ok: false, reason: 'malformed-signature' })
  })
})

describe('handleRequest への配線（二次防御）', () => {
  const AUTH_HEADER = 'Cf-Access-Jwt-Assertion'
  const USER_HEADER = 'Cf-Access-Authenticated-User-Email'

  function verifyingEnv(): WorkerEnv {
    return {
      CIVILDRAFT_API_MODE: 'memory',
      CIVILDRAFT_DEV_STORE: createMemoryStore(),
      CIVILDRAFT_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
      CIVILDRAFT_ACCESS_AUD: AUD,
      CIVILDRAFT_ACCESS_JWKS: jwks,
    }
  }

  function request(token: string): Request {
    return new Request('https://api.example.com/api/v1/projects', {
      method: 'GET',
      headers: { [AUTH_HEADER]: token, [USER_HEADER]: 'engineer@example.test' },
    })
  }

  it('Access設定ありでは正当なJWTのみ通す', async () => {
    const token = await signJwt(validPayload())
    const okRes = await handleRequest(request(token), verifyingEnv())
    expect(okRes.status).toBe(200)

    const badRes = await handleRequest(request('not-a-jwt'), verifyingEnv())
    expect(badRes.status).toBe(401)
    const body = (await badRes.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('CD-AUTH-001')
    expect(body.error.message).toBe('認証トークンの検証に失敗しました')
  })

  it('検証失敗の理由（reason）をクライアントへ漏らさない', async () => {
    const now = Math.floor(Date.now() / 1000)
    const expired = await signJwt(validPayload({ exp: now - 3600 }))
    const res = await handleRequest(request(expired), verifyingEnv())
    expect(res.status).toBe(401)
    const text = await res.text()
    expect(text).not.toContain('expired')
    expect(text).not.toContain('signature')
  })

  it('署名部が不正base64でも500にならず401で拒否する（fail-closed回帰・#36）', async () => {
    const token = await signJwt(validPayload())
    const [headerSegment, payloadSegment] = token.split('.') as [string, string, string]
    const forged = `${headerSegment}.${payloadSegment}.@@@invalid@@@`
    const res = await handleRequest(request(forged), verifyingEnv())
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string; message: string }; correlationId: string }
    expect(body.error.code).toBe('CD-AUTH-001')
    // 500ランタイム既定応答を迂回せず、correlationId付きの構造化エラーであること
    expect(typeof body.correlationId).toBe('string')
    expect(body.correlationId.length).toBeGreaterThan(0)
  })

  it('neon-r2モードではAccess検証設定なしで応答しない（fail-closed）', async () => {
    const env: WorkerEnv = {
      CIVILDRAFT_API_MODE: 'neon-r2',
      CIVILDRAFT_DEV_STORE: createMemoryStore(),
    }
    const res = await handleRequest(request('header-only-token'), env)
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('CD-SYS-002')
    expect(body.error.message).toContain('Cloudflare Access')
    // 環境変数名を応答へ露出しない（情報最小化）
    expect(body.error.message).not.toContain('CIVILDRAFT_ACCESS')
  })

  it('memoryモード＋Access設定なしは従来どおりヘッダー存在確認のみ（dev互換）', async () => {
    const env: WorkerEnv = {
      CIVILDRAFT_API_MODE: 'memory',
      CIVILDRAFT_DEV_STORE: createMemoryStore(),
    }
    const res = await handleRequest(request('header-only-token'), env)
    expect(res.status).toBe(200)
  })
})

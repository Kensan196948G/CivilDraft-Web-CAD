import { describe, expect, it } from 'vitest'
import {
  RATE_LIMIT_READ_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_WRITE_LIMIT,
  TokenBucketRateLimiter,
  checkRateLimit,
  isWriteMethod,
  resetRateLimitState,
} from '@/workers/rateLimit'

describe('TokenBucketRateLimiter', () => {
  it('読み取りバケットは上限まで許可し、超過は拒否して Retry-After 秒を返す', () => {
    const limiter = new TokenBucketRateLimiter({ readLimit: 2, writeLimit: 1, windowMs: 60_000 })
    const start = 1_000_000
    expect(limiter.check('user-a', 'read', start).allowed).toBe(true)
    expect(limiter.check('user-a', 'read', start + 1_000).allowed).toBe(true)
    const denied = limiter.check('user-a', 'read', start + 2_000)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it('書き込みバケットは書き込み上限で制限される', () => {
    const limiter = new TokenBucketRateLimiter({ readLimit: 5, writeLimit: 1, windowMs: 60_000 })
    const start = 2_000_000
    expect(limiter.check('user-a', 'write', start).allowed).toBe(true)
    expect(limiter.check('user-a', 'write', start + 1).allowed).toBe(false)
  })

  it('ウィンドウ経過後に再び許可される', () => {
    const limiter = new TokenBucketRateLimiter({ readLimit: 2, writeLimit: 1, windowMs: 60_000 })
    const start = 3_000_000
    limiter.check('user-a', 'read', start)
    limiter.check('user-a', 'read', start + 1)
    expect(limiter.check('user-a', 'read', start + 2).allowed).toBe(false)
    expect(limiter.check('user-a', 'read', start + 60_000).allowed).toBe(true)
  })

  it('ユーザーごと・種別ごとに独立したバケットを持つ', () => {
    const limiter = new TokenBucketRateLimiter({ readLimit: 1, writeLimit: 1, windowMs: 60_000 })
    const start = 4_000_000
    expect(limiter.check('user-a', 'write', start).allowed).toBe(true)
    expect(limiter.check('user-a', 'write', start + 1).allowed).toBe(false)
    expect(limiter.check('user-a', 'read', start + 1).allowed).toBe(true)
    expect(limiter.check('user-b', 'write', start + 1).allowed).toBe(true)
  })

  it('clear で状態が破棄され再び許可される', () => {
    const limiter = new TokenBucketRateLimiter({ readLimit: 1, writeLimit: 1, windowMs: 60_000 })
    const start = 5_000_000
    expect(limiter.check('user-a', 'read', start).allowed).toBe(true)
    expect(limiter.check('user-a', 'read', start + 1).allowed).toBe(false)
    limiter.clear()
    expect(limiter.check('user-a', 'read', start + 2).allowed).toBe(true)
  })

  it('バケット上限超過時は期限切れを掃除し、古いキーは破棄して新規キーを受け入れる', () => {
    const limiter = new TokenBucketRateLimiter({
      readLimit: 1,
      writeLimit: 1,
      windowMs: 60_000,
      maxBuckets: 2,
    })
    const start = 6_000_000
    limiter.check('a', 'read', start)
    limiter.check('b', 'read', start + 1)
    limiter.check('c', 'read', start + 2)
    expect(limiter.check('c', 'read', start + 3).allowed).toBe(false)
    // 'a' は破棄されているため再び許可される
    expect(limiter.check('a', 'read', start + 4).allowed).toBe(true)
  })
})

describe('isWriteMethod', () => {
  it('GET は読み取り、GET 以外は書き込みとして分類する', () => {
    expect(isWriteMethod('GET')).toBe(false)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(isWriteMethod(method)).toBe(true)
    }
  })
})

describe('既定リミッター', () => {
  it('既定値が設計どおり 120/30/60 秒である', () => {
    expect(RATE_LIMIT_READ_LIMIT).toBe(120)
    expect(RATE_LIMIT_WRITE_LIMIT).toBe(30)
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000)
  })

  it('resetRateLimitState で状態が初期化される', () => {
    resetRateLimitState()
    const start = Date.now()
    for (let i = 0; i < RATE_LIMIT_READ_LIMIT; i += 1) {
      expect(checkRateLimit('reset-user', 'GET', start).allowed).toBe(true)
    }
    expect(checkRateLimit('reset-user', 'GET', start + 1).allowed).toBe(false)
    resetRateLimitState()
    expect(checkRateLimit('reset-user', 'GET', start + 2).allowed).toBe(true)
  })
})

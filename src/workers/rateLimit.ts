/**
 * アプリ層レート制限（Issue #115 / docs/operations/rate-limiting-design.md）。
 *
 * Workers isolate 内のメモリベース token bucket により、Cloudflare Access を
 * 通過した認証済みユーザーであっても API を連打してコスト増大・可用性低下を
 * 招くことを防ぐ（CD-4b 対策の第一層）。
 *
 * 制約: isolate 単位のため複数 isolate 間では完全に共有されない。アカウント
 * 全体で共有される Rate Limiting binding は人間承認後に別途導入する（§3.2）。
 */

/** 読み取り系: ウィンドウあたり許可するリクエスト数（設計値・保守的）。 */
export const RATE_LIMIT_READ_LIMIT = 120
/** 書き込み系: ウィンドウあたり許可するリクエスト数（設計値・保守的）。 */
export const RATE_LIMIT_WRITE_LIMIT = 30
/** token bucket のウィンドウ幅（ms）。 */
export const RATE_LIMIT_WINDOW_MS = 60_000

/** バケット最大数。超過時は期限切れバケットから掃除する（メモリ枯渇防止）。 */
const MAX_BUCKETS = 10_000

export type RateLimitKind = 'read' | 'write'

export interface TokenBucketRateLimiterOptions {
  /** 読み取り系: ウィンドウあたり許可するリクエスト数。 */
  readonly readLimit: number
  /** 書き込み系: ウィンドウあたり許可するリクエスト数。 */
  readonly writeLimit: number
  /** ウィンドウ幅（ms）。 */
  readonly windowMs: number
  /** 保持バケット数の上限（既定 10,000）。 */
  readonly maxBuckets?: number
}

export interface RateLimitResult {
  readonly allowed: boolean
  /** 拒否時のみ: 次のリクエストまで待つ秒数（Retry-After 推奨値・切り上げ）。 */
  readonly retryAfterSeconds?: number
}

interface BucketState {
  readonly kind: RateLimitKind
  tokens: number
  lastRefillAtMs: number
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, BucketState>()
  private readonly readLimit: number
  private readonly writeLimit: number
  private readonly windowMs: number
  private readonly maxBuckets: number

  constructor(options: TokenBucketRateLimiterOptions) {
    this.readLimit = options.readLimit
    this.writeLimit = options.writeLimit
    this.windowMs = options.windowMs
    this.maxBuckets = options.maxBuckets ?? MAX_BUCKETS
  }

  check(key: string, kind: RateLimitKind, nowMs: number = Date.now()): RateLimitResult {
    const capacity = kind === 'read' ? this.readLimit : this.writeLimit
    if (capacity <= 0 || this.windowMs <= 0) {
      // 設定異常時は安全側（拒否）に倒し、無制限で通さない。
      return { allowed: false, retryAfterSeconds: 1 }
    }
    const bucketKey = `${key}:${kind}`
    let bucket = this.buckets.get(bucketKey)
    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        this.evictStaleBuckets(nowMs)
      }
      if (this.buckets.size >= this.maxBuckets) {
        // それでも溢れる場合は最も古いバケットを捨てて新規キーを優先する。
        const oldestKey = this.buckets.keys().next().value
        if (oldestKey !== undefined) {
          this.buckets.delete(oldestKey)
        }
      }
      bucket = { kind, tokens: capacity, lastRefillAtMs: nowMs }
      this.buckets.set(bucketKey, bucket)
    }

    const refillPerMs = capacity / this.windowMs
    const elapsedMs = Math.max(0, nowMs - bucket.lastRefillAtMs)
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedMs * refillPerMs)
    bucket.lastRefillAtMs = nowMs
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return { allowed: true }
    }
    const waitMs = (1 - bucket.tokens) / refillPerMs
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) }
  }

  clear(): void {
    this.buckets.clear()
  }

  private evictStaleBuckets(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.lastRefillAtMs >= this.windowMs) {
        this.buckets.delete(key)
      }
    }
  }
}

/** 本番 isolate で共有される既定リミッター。 */
const defaultRateLimiter = new TokenBucketRateLimiter({
  readLimit: RATE_LIMIT_READ_LIMIT,
  writeLimit: RATE_LIMIT_WRITE_LIMIT,
  windowMs: RATE_LIMIT_WINDOW_MS,
})

/** GET 以外（POST/PUT/PATCH/DELETE 等）は書き込み扱いにする（fail-safe）。 */
export function isWriteMethod(method: string): boolean {
  return method !== 'GET'
}

export function checkRateLimit(
  actorId: string,
  method: string,
  nowMs: number = Date.now(),
): RateLimitResult {
  return defaultRateLimiter.check(actorId, isWriteMethod(method) ? 'write' : 'read', nowMs)
}

/** テスト用: 既定リミッターの状態を破棄する。 */
export function resetRateLimitState(): void {
  defaultRateLimiter.clear()
}

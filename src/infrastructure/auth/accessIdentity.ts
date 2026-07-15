/**
 * Cloudflare Access の identity 取得層。
 *
 * 継承元: Civil-Draw の MSAL / Entra ID 直接統合（継承台帳 **discard**）。
 * discard 判定の理由と本実装の位置づけ:
 * - 継承元はブラウザ内で MSAL により Entra ID の OIDC フローを実行し、アプリ自身が
 *   アクセストークンの取得・更新・検証まで担っていた。攻撃対象領域が広く、トークン取扱いの
 *   責務がフロントエンドに集中していた。
 * - 本実装は Cloudflare Access モデルへ刷新する。JWT の検証はインフラ（Cloudflare エッジ）が
 *   行い、アプリは検証済みの identity を `/cdn-cgi/access/get-identity` から**読むだけ**にする。
 *   トークン検証ロジックをアプリから排除し、認証は境界（インフラ）へ寄せる。
 * - Cloudflare Access のテナント設定（Application 定義・IdP 連携・ポリシー・グループ）自体は
 *   人間の確認事項であり本タスクの対象外（Issue #13 本文に明記）。ロール規約は roles.ts 参照。
 *
 * infrastructure 層（詳細設計仕様書 §2.1）。domain には置かない。
 */
import type { Result, ValidationIssue } from '@/shared/types'

/** Cloudflare Access が identity を返すエンドポイント（同一オリジンの相対パス）。 */
export const ACCESS_IDENTITY_PATH = '/cdn-cgi/access/get-identity'

/**
 * Cloudflare Access から取得した利用者 identity（アプリが必要とする最小項目のみ）。
 * 生レスポンスには多数のフィールドがあるが、本アプリはこの範囲のみ利用する。
 */
export interface AccessIdentity {
  readonly email: string
  readonly name?: string
  /** IdP 種別・識別子（生レスポンスの idp が object の場合は type→id の順に文字列化）。 */
  readonly idp?: string
  /** IdP から連携されたグループ名の配列。ロール解決（roles.ts）の入力。 */
  readonly groups: readonly string[]
}

/**
 * 認証状態。anonymous は「未認証」を、その理由付きで表す。
 * - access-not-configured: 前段に Cloudflare Access が存在しない（ローカル/dev で 404）。
 * - not-logged-in: Access は存在するがセッションが無い/失効（401・403）。
 */
export type AuthState =
  | { readonly kind: 'authenticated'; readonly identity: AccessIdentity }
  | { readonly kind: 'anonymous'; readonly reason: 'access-not-configured' | 'not-logged-in' }

/** 生レスポンスの idp（string | {type?,id?}）を文字列へ正規化する。 */
function normalizeIdp(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.length > 0) return raw
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    if (typeof obj.type === 'string' && obj.type.length > 0) return obj.type
    if (typeof obj.id === 'string' && obj.id.length > 0) return obj.id
  }
  return undefined
}

/** 生レスポンスの groups（string[] | object[]）を string[] へ正規化する。 */
function normalizeGroups(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const g of raw) {
    if (typeof g === 'string') {
      if (g.length > 0) out.push(g)
      continue
    }
    if (typeof g === 'object' && g !== null) {
      const obj = g as Record<string, unknown>
      const value = obj.name ?? obj.email ?? obj.id
      if (typeof value === 'string' && value.length > 0) out.push(value)
    }
  }
  return out
}

/**
 * get-identity の生 JSON を AccessIdentity へ変換する。
 * email を欠く（authenticated として成立しない）場合は null を返す。
 */
function parseIdentity(raw: unknown): AccessIdentity | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const email = obj.email
  if (typeof email !== 'string' || email.length === 0) return null
  const name = typeof obj.name === 'string' ? obj.name : undefined
  const idp = normalizeIdp(obj.idp)
  return {
    email,
    ...(name !== undefined ? { name } : {}),
    ...(idp !== undefined ? { idp } : {}),
    groups: normalizeGroups(obj.groups),
  }
}

function fetchError(message: string): Result<AuthState, ValidationIssue> {
  return { ok: false, error: { code: 'ACCESS_IDENTITY_FETCH_FAILED', severity: 'error', message } }
}

function malformedError(message: string): Result<AuthState, ValidationIssue> {
  return { ok: false, error: { code: 'ACCESS_IDENTITY_MALFORMED', severity: 'error', message } }
}

/**
 * Cloudflare Access の identity を取得する。
 *
 * ステータスの解釈:
 * - 200: JSON を identity として解釈し authenticated（email 欠落・JSON 不正は error Result）。
 * - 404: anonymous('access-not-configured')。Access が前段に無い（ローカル/dev で検証可能）。
 * - 401 / 403: anonymous('not-logged-in')。Access はあるが未ログイン/失効。
 * - その他 (5xx 等): 想定外のためエラー Result（握り潰さない）。
 * - fetch 例外（ネットワーク障害）: エラー Result（握り潰さない）。
 *
 * @param fetchFn テスト・SSR 用に差し替え可能な fetch（既定は globalThis.fetch を束縛）。
 */
export async function fetchAccessIdentity(
  fetchFn: typeof fetch = (input, init) => globalThis.fetch(input, init),
): Promise<Result<AuthState, ValidationIssue>> {
  let response: Response
  try {
    response = await fetchFn(ACCESS_IDENTITY_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    return fetchError(`Cloudflare Access identity の取得に失敗しました（${String(err)}）。`)
  }

  const status = response.status
  if (status === 404) {
    return { ok: true, value: { kind: 'anonymous', reason: 'access-not-configured' } }
  }
  if (status === 401 || status === 403) {
    return { ok: true, value: { kind: 'anonymous', reason: 'not-logged-in' } }
  }
  if (status !== 200) {
    return fetchError(`Cloudflare Access identity が想定外のステータスを返しました（HTTP ${status}）。`)
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch (err) {
    return malformedError(`Cloudflare Access identity の JSON 解析に失敗しました（${String(err)}）。`)
  }

  const identity = parseIdentity(raw)
  if (identity === null) {
    return malformedError('Cloudflare Access identity に email が含まれていません。')
  }
  return { ok: true, value: { kind: 'authenticated', identity } }
}

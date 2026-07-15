/**
 * CivilDraft Workers API スケルトン（詳細設計仕様書 §25）。
 *
 * Phase 6 スケルトン段階の到達点:
 * - §25.2 のエンドポイント一覧をルーティング表として実装する。
 * - 一致した経路は全て HTTP 501（Not Implemented）＋ §25.3 準拠のエラー形式で返す。
 *   各ハンドラ本体（DB アクセス・認可・業務検証）は Phase 6 後続で実装する。
 * - §25.1 共通ヘッダーのうち Cloudflare Access の JWT（Cf-Access-Jwt-Assertion）の
 *   存在検証と X-Correlation-Id の伝播だけを実装する。
 *
 * 依存方針: @cloudflare/workers-types は導入しない（npm install 禁止）。素の Worker として
 * globalThis 前提の最小型を自前定義し、Request/Response/crypto は標準 lib DOM の範囲で使う。
 */

/** Workers 実行時に注入されるバインディング（Phase 6 後続で D1/KV/Neon 等を追加）。 */
export interface WorkerEnv {
  readonly [key: string]: unknown
}

/** Workers 実行コンテキストの最小型（waitUntil のみ使用想定）。 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/** §25.1 Cloudflare Access が付与する認証 JWT ヘッダー。 */
const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion'
/** §25.1 相関ID。未指定時はサーバー生成する。 */
const CORRELATION_ID_HEADER = 'X-Correlation-Id'

/** §28 エラーコード（本スケルトンで使用する範囲）。 */
const ERROR_CODES = {
  unauthenticated: 'CD-AUTH-001',
  notFound: 'CD-SYS-001',
  notImplemented: 'CD-SYS-001',
} as const

/** ルーティング表の1行。path テンプレートの `{param}` は任意の非スラッシュ列に一致する。 */
interface ApiRoute {
  readonly method: string
  readonly template: string
  readonly summary: string
  readonly pattern: RegExp
}

function compileTemplate(template: string): RegExp {
  const escaped = template
    .split('/')
    .map((segment) =>
      segment.startsWith('{') && segment.endsWith('}')
        ? '[^/]+'
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/')
  return new RegExp(`^${escaped}$`)
}

function route(method: string, template: string, summary: string): ApiRoute {
  return { method, template, summary, pattern: compileTemplate(template) }
}

/** §25.2 エンドポイント一覧。順序は仕様書の掲載順に一致させる。 */
export const API_ROUTES: readonly ApiRoute[] = [
  route('GET', '/api/v1/projects', '参加案件一覧'),
  route('POST', '/api/v1/projects', '案件作成'),
  route('GET', '/api/v1/projects/{projectId}', '案件取得'),
  route('PATCH', '/api/v1/projects/{projectId}', '案件更新'),
  route('GET', '/api/v1/projects/{projectId}/drawings', '図面一覧'),
  route('POST', '/api/v1/projects/{projectId}/drawings', '図面作成'),
  route('GET', '/api/v1/drawings/{drawingId}', '図面取得'),
  route('PATCH', '/api/v1/drawings/{drawingId}', '図面メタデータ更新'),
  route('POST', '/api/v1/drawings/{drawingId}/revisions', '新規改訂'),
  route('GET', '/api/v1/revisions/{revisionId}', '改訂メタデータ取得'),
  route('GET', '/api/v1/revisions/{revisionId}/content', '内容取得'),
  route('PUT', '/api/v1/revisions/{revisionId}/content', 'draft内容更新'),
  route('GET', '/api/v1/revisions/{revisionId}/quantities', '数量取得'),
  route('PUT', '/api/v1/revisions/{revisionId}/quantities', '数量スナップショット更新'),
  route('POST', '/api/v1/revisions/{revisionId}/workflow-actions', '提出・照査・承認等'),
  route('POST', '/api/v1/revisions/{revisionId}/exports', '出力作成'),
  route('GET', '/api/v1/exports/{exportId}', '出力状態・取得情報'),
  route('GET', '/api/v1/audit-logs', '監査検索'),
]

/** X-Correlation-Id を取得、なければ生成する（§25.1）。 */
function resolveCorrelationId(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER)
  if (provided && provided.trim() !== '') {
    return provided
  }
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) {
    return uuid
  }
  // crypto.randomUUID 非対応環境向けフォールバック（相関IDは一意性のみ要求）。
  return `cid-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

/** §25.3 ApiErrorResponse 形式でエラー応答を生成する。 */
function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
): Response {
  const body = {
    error: { code, message },
    correlationId,
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: correlationId,
    },
  })
}

/** メソッド＋パスに一致する §25.2 の経路を返す。 */
export function matchRoute(method: string, pathname: string): ApiRoute | undefined {
  return API_ROUTES.find((entry) => entry.method === method && entry.pattern.test(pathname))
}

/**
 * fetch ハンドラ本体。認証ヘッダー検証 → ルーティング → 501 スタブ応答。
 */
export async function handleRequest(request: Request): Promise<Response> {
  const correlationId = resolveCorrelationId(request)
  const url = new URL(request.url)

  // §25.1: Cloudflare Access の JWT が無ければ 401（CD-AUTH-001）。
  const accessJwt = request.headers.get(ACCESS_JWT_HEADER)
  if (!accessJwt || accessJwt.trim() === '') {
    return errorResponse(
      401,
      ERROR_CODES.unauthenticated,
      '認証情報（Cf-Access-Jwt-Assertion）がありません',
      correlationId,
    )
  }

  const matched = matchRoute(request.method, url.pathname)
  if (!matched) {
    return errorResponse(404, ERROR_CODES.notFound, '該当するエンドポイントがありません', correlationId)
  }

  // Phase 6 スケルトン: 全経路は未実装（後続で本体を実装する）。
  return errorResponse(
    501,
    ERROR_CODES.notImplemented,
    `${matched.method} ${matched.template}（${matched.summary}）は未実装です（Phase 6 後続で実装予定）`,
    correlationId,
  )
}

/**
 * Workers エントリポイント（module worker 形式）。env/ctx は本スケルトンでは未使用のため
 * 命名を `_` 始まりにして未使用警告を回避する。Phase 6 後続で env（バインディング）を使う。
 */
export default {
  fetch(request: Request, _env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request)
  },
}

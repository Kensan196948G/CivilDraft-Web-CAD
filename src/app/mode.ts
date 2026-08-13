/**
 * アプリケーションモード判定。
 * ?demo=1 は開発・展示用の明示的デモモード（本番ビルドでもサンプル表示を許可する）。
 *
 * 加えて、MVP/Prototype・Preview 用ホスト（workers.dev / civildraft-web-cad-mvp.
 * mirai-dx-platform.com）では、クエリ無しでもダミーデータを既定表示する。
 * 本番ドメイン（civildraft-web-cad.mirai-dx-platform.com）は実案件データのみを維持する。
 */
export const DEMO_DEFAULT_HOSTNAMES: readonly string[] = [
  'civildraft-web-cad-mvp.mirai-dx-platform.com',
]

/** MVP/Preview ホスト名かどうか（workers.dev は全サブドメインを対象）。 */
export function isDemoHostnameByDefault(hostname: string): boolean {
  return hostname.endsWith('.workers.dev') || DEMO_DEFAULT_HOSTNAMES.includes(hostname)
}

/** クエリとホスト名からデモ表示を判定する純粋関数（テスト用）。 */
export function isDemoRequested(search: string, hostname: string): boolean {
  return new URLSearchParams(search).has('demo') || isDemoHostnameByDefault(hostname)
}

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false
  return isDemoRequested(window.location.search, window.location.hostname)
}

/**
 * アプリケーションモード判定。
 * ?demo=1 は開発・展示用の明示的デモモード（本番ビルドでもサンプル表示を許可する）。
 */
export function isDemoMode(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')
}

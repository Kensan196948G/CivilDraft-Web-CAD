/**
 * vitest 共通セットアップ。
 * 継承元: Civil-Draw src/test/setup.ts（継承台帳 modify）。
 * jest-dom マッチャ登録と jsdom 欠落APIの補完を行う。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest globals:false では testing-library の自動クリーンアップが効かないため明示登録する
// （未登録だと前テストのDOMが残り「Found multiple elements」エラーになる）。
afterEach(() => {
  cleanup()
})

// jsdom は scrollIntoView を実装しない。全テスト共通でスタブする。
window.HTMLElement.prototype.scrollIntoView = function () {}

// JSDOM-001（継承元の知見）: Node の実験的 WebStorage が null-prototype の空オブジェクトを
// globalThis.localStorage に既定インストールすると、jsdom が自前の Storage を張らず
// `localStorage.clear is not a function` で落ちる。壊れたスタブを検出したら
// Map ベースの最小シムに差し替える（正常環境では no-op）。
function isUsableStorage(s: unknown): s is Storage {
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof (s as Storage).clear === 'function' &&
    typeof (s as Storage).getItem === 'function' &&
    typeof (s as Storage).setItem === 'function'
  )
}

function makeMemoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear() {
      m.clear()
    },
    getItem(key: string) {
      return m.has(key) ? (m.get(key) as string) : null
    },
    key(i: number) {
      return Array.from(m.keys())[i] ?? null
    },
    removeItem(key: string) {
      m.delete(key)
    },
    setItem(key: string, value: string) {
      m.set(key, String(value))
    },
  } as Storage
}

for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (!isUsableStorage((globalThis as Record<string, unknown>)[key])) {
    Object.defineProperty(globalThis, key, {
      value: makeMemoryStorage(),
      configurable: true,
      writable: true,
    })
  }
}

/* global URL, caches, fetch, self */
/* CivilDraft service worker（PWA・オフライン閲覧の基礎）
 * 方針:
 * - ビルド成果物（/assets/*）はキャッシュファースト（内容はハッシュ付きファイル名で不変）
 * - ナビゲーション（HTML）はネットワークファースト、オフライン時はキャッシュ済み index へフォールバック
 * - キャッシュ名にバージョンを含め、新デプロイ時に旧キャッシュを整理
 */
const CACHE_NAME = 'civildraft-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/'])).catch(() => undefined),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // API は Service Worker を経由しない（認証・キャッシュ制御を Workers 側に委ねる）。
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
    return
  }

  // ナビゲーション: ネットワーク優先 + オフラインフォールバック
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy))
        }
        return response
      })
      .catch(() => caches.match('/')),
  )
})

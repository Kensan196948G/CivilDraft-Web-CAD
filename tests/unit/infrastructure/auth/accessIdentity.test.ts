import { describe, expect, it, vi } from 'vitest'
import { ACCESS_IDENTITY_PATH, fetchAccessIdentity } from '@/infrastructure/auth/accessIdentity'

/** status と json() を制御するスタブ fetch。 */
function stubFetch(status: number, json: () => Promise<unknown>): typeof fetch {
  return () => Promise.resolve({ status, json } as unknown as Response)
}

describe('fetchAccessIdentity', () => {
  it('200 + 完全な identity → authenticated（各フィールドを正規化して保持）', async () => {
    const raw = {
      email: 'taro@example.co.jp',
      name: '土木 太郎',
      idp: { id: 'idp-1', type: 'azureAD' },
      groups: ['civildraft-engineer', { name: 'civildraft-viewer' }],
    }
    const result = await fetchAccessIdentity(stubFetch(200, () => Promise.resolve(raw)))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('authenticated')
    if (result.value.kind !== 'authenticated') return
    expect(result.value.identity).toEqual({
      email: 'taro@example.co.jp',
      name: '土木 太郎',
      idp: 'azureAD', // object → type を優先して文字列化
      groups: ['civildraft-engineer', 'civildraft-viewer'], // object 要素は name を採用
    })
  })

  it('200 + idp が文字列 / groups が string[] → そのまま保持', async () => {
    const raw = { email: 'a@b.com', idp: 'onetimepin', groups: ['g1', 'g2'] }
    const result = await fetchAccessIdentity(stubFetch(200, () => Promise.resolve(raw)))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'authenticated') throw new Error('expected authenticated')
    expect(result.value.identity.idp).toBe('onetimepin')
    expect(result.value.identity.groups).toEqual(['g1', 'g2'])
    expect(result.value.identity.name).toBeUndefined()
  })

  it('200 + email 欠落 → error Result（ACCESS_IDENTITY_MALFORMED）', async () => {
    const result = await fetchAccessIdentity(stubFetch(200, () => Promise.resolve({ name: 'no email' })))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('ACCESS_IDENTITY_MALFORMED')
    expect(result.error.severity).toBe('error')
  })

  it('200 + JSON 不正（json() が reject）→ error Result（握り潰さない）', async () => {
    const result = await fetchAccessIdentity(
      stubFetch(200, () => Promise.reject(new SyntaxError('Unexpected token < in JSON'))),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('ACCESS_IDENTITY_MALFORMED')
  })

  it('404 → anonymous(access-not-configured)（ローカル/dev で Access 前段なし）', async () => {
    const result = await fetchAccessIdentity(stubFetch(404, () => Promise.reject(new Error('no body'))))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ kind: 'anonymous', reason: 'access-not-configured' })
  })

  it('401 → anonymous(not-logged-in)', async () => {
    const result = await fetchAccessIdentity(stubFetch(401, () => Promise.reject(new Error('no body'))))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ kind: 'anonymous', reason: 'not-logged-in' })
  })

  it('403 → anonymous(not-logged-in)', async () => {
    const result = await fetchAccessIdentity(stubFetch(403, () => Promise.reject(new Error('no body'))))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ kind: 'anonymous', reason: 'not-logged-in' })
  })

  it('500 等の想定外ステータス → error Result（握り潰さない）', async () => {
    const result = await fetchAccessIdentity(stubFetch(500, () => Promise.reject(new Error('no body'))))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('ACCESS_IDENTITY_FETCH_FAILED')
    expect(result.error.message).toContain('500')
  })

  it('fetch 例外（ネットワーク障害）→ error Result（握り潰さない）', async () => {
    const throwing: typeof fetch = () => Promise.reject(new Error('network down'))
    const result = await fetchAccessIdentity(throwing)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('ACCESS_IDENTITY_FETCH_FAILED')
    expect(result.error.message).toContain('network down')
  })

  it('get-identity の正しいパスへ GET する', async () => {
    const spy = vi.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({ email: 'x@y.z', groups: [] }) } as unknown as Response))
    await fetchAccessIdentity(spy as unknown as typeof fetch)
    expect(spy).toHaveBeenCalledTimes(1)
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ACCESS_IDENTITY_PATH)
    expect(init.method).toBe('GET')
  })

  it('200 + groups 未指定 → groups は空配列（既定）', async () => {
    const result = await fetchAccessIdentity(stubFetch(200, () => Promise.resolve({ email: 'x@y.z' })))
    expect(result.ok).toBe(true)
    if (!result.ok || result.value.kind !== 'authenticated') throw new Error('expected authenticated')
    expect(result.value.identity.groups).toEqual([])
  })
})

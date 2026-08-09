import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { buildTsaRequest, requestTsaToken } from '../../../scripts/tools/tsa-request.mjs'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('RFC 3161 TSA リクエスト基盤', () => {
  it('SHA-256 ダイジェストから ContentInfo（id-ct-TSTInfo）DER を生成する', () => {
    const digest = new Uint8Array(createHash('sha256').update('test').digest())
    const request = buildTsaRequest(digest)
    const hex = toHex(request)
    // ContentInfo の OID: 1.2.840.113549.1.9.16.1.4（id-ct-TSTInfo）
    expect(hex).toContain('2a864886f70d0109')
    expect(hex).toContain('100104')
    expect(hex.startsWith('30')).toBe(true)
  })

  it('ダイジェスト長が 32 バイト以外はエラーにする', () => {
    expect(() => buildTsaRequest(new Uint8Array([1, 2, 3]))).toThrow(/32 バイト/)
  })

  it('TSA へ POST し TSR バイトを返す（fetch モック）', async () => {
    const fetchMock = vi.fn(async () => {
      const bytes = new TextEncoder().encode('mock-tsr')
      return new Response(bytes, {
        status: 200,
        headers: { 'content-type': 'application/timestamp-reply' },
      })
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    try {
      const request = buildTsaRequest(new Uint8Array(32))
      const result = await requestTsaToken('https://tsa.example.test', request)
      expect(result.status).toBe(200)
      expect(new TextDecoder().decode(result.bytes)).toBe('mock-tsr')
      expect(result.contentType).toContain('timestamp-reply')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://tsa.example.test',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/timestamp-query' }),
        }),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

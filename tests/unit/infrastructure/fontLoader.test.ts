import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  JAPANESE_FONT_PATH,
  clearFontCache,
  loadJapaneseFont,
} from '@/infrastructure/pdf/fontLoader'

afterEach(() => {
  clearFontCache()
})

function okResponse(bytes: Uint8Array): Response {
  return new Response(bytes.slice(), { status: 200 })
}

describe('loadJapaneseFont', () => {
  it('フォントを取得してUint8Arrayで返し、2回目はキャッシュを使う', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(okResponse(new Uint8Array([1, 2, 3]))))
    const first = await loadJapaneseFont(fetchFn)
    expect(first.ok && Array.from(first.value)).toEqual([1, 2, 3])
    const second = await loadJapaneseFont(fetchFn)
    expect(second.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith(JAPANESE_FONT_PATH)
  })

  it('HTTPエラーはPDF_FONT_UNAVAILABLEのerror Resultで返す（throwしない）', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })))
    const result = await loadJapaneseFont(fetchFn)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('PDF_FONT_UNAVAILABLE')
      expect(result.error.message).toContain('404')
    }
  })

  it('ネットワーク例外もerror Resultで返す（握り潰し・throwなし）', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('network down')))
    const result = await loadJapaneseFont(fetchFn)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('PDF_FONT_UNAVAILABLE')
      expect(result.error.message).toContain('network down')
    }
  })

  it('失敗後の再呼び出しは再取得を試みる（失敗をキャッシュしない）', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(okResponse(new Uint8Array([9])))
    const first = await loadJapaneseFont(fetchFn)
    expect(first.ok).toBe(false)
    const second = await loadJapaneseFont(fetchFn)
    expect(second.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

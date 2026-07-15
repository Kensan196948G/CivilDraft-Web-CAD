import { describe, expect, it } from 'vitest'
import {
  computeDocumentChecksum,
  sha256Hex,
  stableStringify,
} from '@/infrastructure/files/checksum'

describe('sha256Hex', () => {
  it('空文字列の既知ベクトルに一致する', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('"abc" の既知ベクトルに一致する', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('64バイト境界（ブロック跨ぎ）の入力でも正しい', () => {
    // 56バイト以上はパディングが次ブロックへ回る境界。
    const input = 'a'.repeat(1000)
    // 事前計算した既知値（SHA-256 of 1000×'a'）。
    expect(sha256Hex(input)).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    )
  })

  it('マルチバイト（UTF-8）を正しく扱う', () => {
    expect(sha256Hex('日本語')).toBe(
      '77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5',
    )
  })
})

describe('stableStringify', () => {
  it('オブジェクトのキーを昇順に固定する', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('undefined プロパティを省略する', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('非有限数を null 化する', () => {
    expect(stableStringify({ x: Number.POSITIVE_INFINITY })).toBe('{"x":null}')
  })

  it('配列の順序は保持する', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]')
  })
})

describe('computeDocumentChecksum', () => {
  it('キーの挿入順に依存せず同一ハッシュになる', () => {
    const a = { geometries: [], layers: [], meta: { x: 1, y: 2 } }
    const b = { meta: { y: 2, x: 1 }, layers: [], geometries: [] }
    expect(computeDocumentChecksum(a)).toBe(computeDocumentChecksum(b))
  })
})

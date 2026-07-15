/**
 * Checksum ユーティリティ（詳細設計仕様書 §22.1 `checksums` / §22.2 手順5）。
 *
 * `crypto.subtle.digest` は非同期のため、同期の serialize/parse シグネチャを保つには
 * 使えない。ここでは依存追加なしの純JS同期 SHA-256 を実装する（ブラウザ/Workers/Node
 * 共通で動作）。決定的なハッシュのため、document は安定シリアライズ（キー昇順）で
 * 文字列化してから入力する。
 */

/** SHA-256 ラウンド定数（最初の64素数の立方根の小数部）。 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/**
 * 文字列（UTF-8）の SHA-256 を小文字16進で返す。
 */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const bitLen = bytes.length * 8

  // パディング: 0x80 の後、長さ(64bit BE)が末尾8バイトに来るよう 0 埋め。
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6
  const buf = new Uint8Array(paddedLen)
  buf.set(bytes)
  buf[bytes.length] = 0x80
  const view = new DataView(buf.buffer)
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(paddedLen - 4, bitLen >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4)
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number
      const w2 = w[i - 2] as number
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0
    }

    let a = h[0] as number
    let b = h[1] as number
    let c = h[2] as number
    let d = h[3] as number
    let e = h[4] as number
    let f = h[5] as number
    let g = h[6] as number
    let hh = h[7] as number

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + (K[i] as number) + (w[i] as number)) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h[0] = ((h[0] as number) + a) >>> 0
    h[1] = ((h[1] as number) + b) >>> 0
    h[2] = ((h[2] as number) + c) >>> 0
    h[3] = ((h[3] as number) + d) >>> 0
    h[4] = ((h[4] as number) + e) >>> 0
    h[5] = ((h[5] as number) + f) >>> 0
    h[6] = ((h[6] as number) + g) >>> 0
    h[7] = ((h[7] as number) + hh) >>> 0
  }

  let out = ''
  for (let i = 0; i < 8; i++) {
    out += (h[i] as number).toString(16).padStart(8, '0')
  }
  return out
}

/**
 * 安定 JSON シリアライズ（オブジェクトのキーを昇順に固定）。
 * Checksum を再計算しても一致させるため、キー順・undefined 除去を決定的にする。
 * - undefined プロパティは JSON 同様に省略する
 * - 非有限数（NaN / Infinity）は JSON 同様 null 化する
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null'
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
    const body = keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')
    return `{${body}}`
  }
  return 'null'
}

/**
 * document 本体の Checksum（§22.1 `checksums.document`）を計算する。
 * 安定シリアライズ→SHA-256(hex)。serialize/parse 双方が同じ入力で同値を得る。
 */
export function computeDocumentChecksum(document: unknown): string {
  return sha256Hex(stableStringify(document))
}

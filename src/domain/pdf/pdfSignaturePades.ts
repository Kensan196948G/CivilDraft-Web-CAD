/**
 * PAdES-CMS detached 署名（.p7s）生成。
 *
 * 実装内容:
 * - RSA（RSASSA-PKCS1-v1_5 / SHA-256）秘密鍵（PKCS#8 PEM）で
 *   CMS SignedData（RFC 5652 / ETSI EN 319 122 相当の detached 署名）を
 *   純 TypeScript の DER エンコーダで構築する。
 * - signedAttrs には contentType / messageDigest / signingTime を含める
 *   （PAdES の署名属性として必須）。
 *
 * 正直な境界:
 * - 証明書（X.509）チェーンを含まないため、Adobe 等で「署名者証明書なし」と
 *   表示される。電子署名法上の真正な電子署名には認証局発行の証明書が必要。
 * - PDF 本体への ByteRange 埋め込みではなく、外部 .p7s（detached）形式。
 *   監査証跡・改ざん検知用途として提供し、埋め込み署名は別途導入を要する。
 */
import type { Result, ValidationIssue } from '@/shared/types'

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
} as const

// ---------------------------------------------------------------------------
// DER エンコーダ
// ---------------------------------------------------------------------------

function derLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length])
  const bytes: number[] = []
  let value = length
  while (value > 0) {
    bytes.unshift(value & 0xff)
    value >>>= 8
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function derTlv(tag: number, content: Uint8Array): Uint8Array {
  return new Uint8Array([tag, ...derLength(content.length), ...content])
}

const derNull = (): Uint8Array => new Uint8Array([0x05, 0x00])

function derOctet(bytes: Uint8Array): Uint8Array {
  return derTlv(0x04, bytes)
}

function derSeq(parts: readonly Uint8Array[]): Uint8Array {
  return derTlv(0x30, concat(parts))
}

function derSet(parts: readonly Uint8Array[]): Uint8Array {
  // CMS は SET OF を DER バイト列の昇順で要求する。
  const sorted = [...parts].sort((a, b) => compareBytes(a, b))
  return derTlv(0x31, concat(sorted))
}

function derContextExplicit(tag: number, content: Uint8Array): Uint8Array {
  return derTlv(0xa0 | tag, content)
}

function derInteger(value: number): Uint8Array {
  if (value <= 0) return new Uint8Array([0x02, 0x01, 0x00])
  const bytes: number[] = []
  let v = value
  while (v > 0) {
    bytes.unshift(v & 0xff)
    v >>>= 8
  }
  if ((bytes[0] ?? 0) & 0x80) bytes.unshift(0)
  return derTlv(0x02, new Uint8Array(bytes))
}

function derOid(oid: string): Uint8Array {
  const arcs = oid.split('.').map((part) => Number.parseInt(part, 10))
  const first = arcs[0] ?? 0
  const second = arcs[1] ?? 0
  const body: number[] = [first * 40 + second]
  for (const arc of arcs.slice(2)) {
    if (arc < 128) {
      body.push(arc)
    } else {
      const chunks: number[] = [arc & 0x7f]
      let value = arc >> 7
      while (value > 0) {
        chunks.unshift((value & 0x7f) | 0x80)
        value >>= 7
      }
      body.push(...chunks)
    }
  }
  return derTlv(0x06, new Uint8Array(body))
}

function derUtcTime(date: Date): Uint8Array {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const value =
    `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  return derTlv(0x17, new TextEncoder().encode(value))
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return a.length - b.length
}

// ---------------------------------------------------------------------------
// PEM / WebCrypto
// ---------------------------------------------------------------------------

function pemToDer(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function derToPem(der: Uint8Array, label: string): string {
  let binary = ''
  for (const byte of der) binary += String.fromCharCode(byte)
  const base64 = btoa(binary).replace(/(.{64})/g, '$1\n')
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----`
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return new Uint8Array(digest)
}

// ---------------------------------------------------------------------------
// CMS SignedData 構築
// ---------------------------------------------------------------------------

function algorithmIdentifier(oid: string): Uint8Array {
  return derSeq([derOid(oid), derNull()])
}

function buildSignedAttrs(contentDigest: Uint8Array, signedAt: Date): Uint8Array {
  const contentTypeAttr = derSeq([
    derOid(OID.contentType),
    derSet([derOctet(derOid(OID.data))]),
  ])
  const messageDigestAttr = derSeq([
    derOid(OID.messageDigest),
    derSet([derOctet(contentDigest)]),
  ])
  const signingTimeAttr = derSeq([
    derOid(OID.signingTime),
    derSet([derUtcTime(signedAt)]),
  ])
  // signedAttrs は [0] IMPLICIT ではなく EXPLICIT（context [0] の SET）。
  return derContextExplicit(0, derSet([contentTypeAttr, messageDigestAttr, signingTimeAttr]))
}

function buildSignerInfo(
  signedAttrs: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  // SignerIdentifier: issuerAndSerialNumber（証明書なしのため空 Name + serial 0）。
  const issuerAndSerial = derSeq([derSeq([]), derInteger(0)])
  const unsignedAttrsAbsent = new Uint8Array()
  return derSeq([
    derInteger(1), // version
    issuerAndSerial,
    algorithmIdentifier(OID.sha256),
    signedAttrs,
    algorithmIdentifier(OID.rsaEncryption),
    derOctet(signature),
    unsignedAttrsAbsent,
  ])
}

function buildSignedData(signerInfo: Uint8Array): Uint8Array {
  return derSeq([
    derInteger(1), // version
    derSet([algorithmIdentifier(OID.sha256)]), // digestAlgorithms
    derSeq([derOid(OID.data)]), // encapContentInfo（detached: eContent なし）
    derContextExplicit(0, new Uint8Array()), // certificates（空: 証明書なし）
    derSet([signerInfo]), // signerInfos
  ])
}

export interface PadesSignatureResult {
  /** CMS detached 署名（.p7s）の DER バイト列。 */
  readonly p7sBytes: Uint8Array
  readonly signerName: string
  readonly signedAt: string
  readonly sha256: string
}

/**
 * PDF バイト列へ PAdES-CMS detached 署名（.p7s）を生成する。
 * privateKeyPem は PKCS#8 RSA 秘密鍵（BEGIN PRIVATE KEY）。
 */
export async function createPadesDetachedSignature(input: {
  readonly pdfBytes: Uint8Array
  readonly privateKeyPem: string
  readonly signerName: string
  readonly signedAt?: Date
}): Promise<Result<PadesSignatureResult, ValidationIssue>> {
  try {
    if (input.signerName.trim() === '') {
      return {
        ok: false,
        error: { code: 'PADES_SIGNER_REQUIRED', severity: 'error', message: '署名者名を入力してください' },
      }
    }
    const keyDer = pemToDer(input.privateKeyPem)
    const keyBuffer = new ArrayBuffer(keyDer.byteLength)
    new Uint8Array(keyBuffer).set(keyDer)
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      keyBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const contentDigest = await sha256(input.pdfBytes)
    const signedAt = input.signedAt ?? new Date()
    const signedAttrs = buildSignedAttrs(contentDigest, signedAt)

    // RFC 5652 §5.4: signature は signedAttrs の DER エンコード全体を署名対象とする。
    const attrBuffer = new ArrayBuffer(signedAttrs.byteLength)
    new Uint8Array(attrBuffer).set(signedAttrs)
    const signature = new Uint8Array(
      await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, attrBuffer),
    )

    const signerInfo = buildSignerInfo(signedAttrs, signature)
    const signedData = buildSignedData(signerInfo)
    // ContentInfo: contentType=signedData, content=[0] EXPLICIT
    const contentInfo = derSeq([derOid(OID.signedData), derContextExplicit(0, signedData)])

    const sha256Hex = Array.from(contentDigest)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    return {
      ok: true,
      value: {
        p7sBytes: contentInfo,
        signerName: input.signerName.trim(),
        signedAt: signedAt.toISOString(),
        sha256: sha256Hex,
      },
    }
  } catch {
    return {
      ok: false,
      error: {
        code: 'PADES_SIGN_FAILED',
        severity: 'error',
        message: 'PAdES-CMS 署名の生成に失敗しました（PKCS#8 RSA 秘密鍵の PEM を確認してください）',
      },
    }
  }
}

// ---------------------------------------------------------------------------
// 検証用: DER 簡易パーサ（テスト・監査ツール向け）
// ---------------------------------------------------------------------------

export interface DerElement {
  readonly tag: number
  readonly value: Uint8Array
}

/** 先頭の 1 TLV を読み、残りとともに返す。 */
export function readDerElement(bytes: Uint8Array, offset = 0): { element: DerElement; next: number } {
  const tag = bytes[offset] ?? 0
  const lengthByte = bytes[offset + 1] ?? 0
  let length = 0
  let cursor = offset + 2
  if ((lengthByte & 0x80) !== 0) {
    const count = lengthByte & 0x7f
    for (let i = 0; i < count; i++) {
      length = length * 256 + (bytes[cursor + i] ?? 0)
    }
    cursor += count
  } else {
    length = lengthByte
  }
  return {
    element: { tag, value: bytes.slice(cursor, cursor + length) },
    next: cursor + length,
  }
}

/** DER シーケンス/セットの子要素列を返す（構造型タグ 0x30/0x31 用）。 */
export function readDerChildren(bytes: Uint8Array): readonly DerElement[] {
  const children: DerElement[] = []
  let offset = 0
  while (offset < bytes.length) {
    const { element, next } = readDerElement(bytes, offset)
    children.push(element)
    offset = next
  }
  return children
}

export { derToPem }

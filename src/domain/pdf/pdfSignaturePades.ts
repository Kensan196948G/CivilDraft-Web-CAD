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
  commonName: '2.5.4.3',
  sha256WithRsa: '1.2.840.113549.1.1.11',
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

function derContextImplicit(tag: number, content: Uint8Array): Uint8Array {
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

function derPrintableString(value: string): Uint8Array {
  return derTlv(0x13, new TextEncoder().encode(value))
}

function derBitString(content: Uint8Array): Uint8Array {
  // BIT STRING: 先頭に unused bits = 0
  return derTlv(0x03, new Uint8Array([0, ...content]))
}

function derBigInteger(bytes: Uint8Array): Uint8Array {
  let value = bytes
  while (value.length > 1 && value[0] === 0) value = value.slice(1)
  if ((value[0] ?? 0) & 0x80) value = new Uint8Array([0, ...value])
  return derTlv(0x02, value)
}

function derPublicKeyRsa(n: Uint8Array, e: Uint8Array): Uint8Array {
  return derSeq([derBigInteger(n), derBigInteger(e)])
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
  issuerDer: Uint8Array,
  serialDer: Uint8Array,
): Uint8Array {
  const issuerAndSerial = derSeq([issuerDer, serialDer])
  return derSeq([
    derInteger(1), // version
    issuerAndSerial,
    algorithmIdentifier(OID.sha256),
    signedAttrs,
    algorithmIdentifier(OID.rsaEncryption),
    derOctet(signature),
  ])
}

function buildSignedData(signerInfo: Uint8Array, certificates: readonly Uint8Array[]): Uint8Array {
  // certificates: [0] IMPLICIT CertificateSet（SET タグを付けず連結）。
  const certsField = certificates.length === 0
    ? derContextImplicit(0, new Uint8Array())
    : derContextImplicit(0, concat(certificates))
  return derSeq([
    derInteger(1), // version
    derSet([algorithmIdentifier(OID.sha256)]), // digestAlgorithms
    derSeq([derOid(OID.data)]), // encapContentInfo（detached: eContent なし）
    certsField,
    derSet([signerInfo]), // signerInfos
  ])
}

interface CmsBuildInput {
  readonly contentDigest: Uint8Array
  readonly signerName: string
  readonly signedAt: Date
  readonly privateKey: CryptoKey
  readonly certificate?: SelfSignedCertificate
}

async function buildPadesCmsBytes(input: CmsBuildInput): Promise<Uint8Array> {
  const signedAttrs = buildSignedAttrs(input.contentDigest, input.signedAt)
  const attrBuffer = new ArrayBuffer(signedAttrs.byteLength)
  new Uint8Array(attrBuffer).set(signedAttrs)
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', input.privateKey, attrBuffer),
  )
  const signerInfo = buildSignerInfo(
    signedAttrs,
    signature,
    input.certificate?.issuerDer ?? derSeq([]),
    input.certificate?.serialDer ?? derInteger(0),
  )
  const signedData = buildSignedData(
    signerInfo,
    input.certificate === undefined ? [] : [input.certificate.certificateDer],
  )
  return derSeq([derOid(OID.signedData), derContextExplicit(0, signedData)])
}

// ---------------------------------------------------------------------------
// 自己署名 X.509 証明書生成（PAdES のテスト/社内署名用）
// ---------------------------------------------------------------------------

export interface SelfSignedCertificate {
  readonly certificateDer: Uint8Array
  readonly issuerDer: Uint8Array
  readonly serialDer: Uint8Array
}

async function rsaPublicKeyDer(privateKey: CryptoKey): Promise<{ n: Uint8Array; e: Uint8Array }> {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') {
    throw new Error('RSA public key export failed')
  }
  const base64UrlToBytes = (value: string): Uint8Array => {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  return { n: base64UrlToBytes(jwk.n), e: base64UrlToBytes(jwk.e) }
}

function buildName(commonName: string): Uint8Array {
  return derSeq([derSet([derSeq([derOid(OID.commonName), derPrintableString(commonName)])])])
}

/** 自己署名証明書を生成する（署名アルゴリズム: sha256WithRSAEncryption）。 */
export async function generateSelfSignedCertificate(input: {
  readonly privateKey: CryptoKey
  readonly subjectName: string
  readonly notBefore: Date
  readonly notAfter: Date
}): Promise<SelfSignedCertificate> {
  const rsaPublic = await rsaPublicKeyDer(input.privateKey)
  const spki = derSeq([
    algorithmIdentifier(OID.rsaEncryption),
    derBitString(derPublicKeyRsa(rsaPublic.n, rsaPublic.e)),
  ])
  const serial = derInteger(Math.floor(Date.now() / 1000) % 0x7fffffff)
  const name = buildName(input.subjectName)
  const validity = derSeq([derUtcTime(input.notBefore), derUtcTime(input.notAfter)])
  const sigAlg = derSeq([derOid(OID.sha256WithRsa), derNull()])
  const version = derContextExplicit(0, derInteger(2))
  const tbs = derSeq([version, serial, sigAlg, name, validity, name, spki])

  const tbsBuffer = new ArrayBuffer(tbs.byteLength)
  new Uint8Array(tbsBuffer).set(tbs)
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', input.privateKey, tbsBuffer))
  const certificate = derSeq([tbs, sigAlg, derBitString(signature)])
  return { certificateDer: certificate, issuerDer: name, serialDer: serial }
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
      // 自己署名証明書の公開鍵（n/e）導出に必要なため extractable で読み込む。
      // 鍵は利用者が提供する自身の鍵であり、署名用途のみに使用する。
      true,
      ['sign'],
    )
    const contentDigest = await sha256(input.pdfBytes)
    const signedAt = input.signedAt ?? new Date()
    const contentInfo = await buildPadesCmsBytes({
      contentDigest,
      signerName: input.signerName,
      signedAt,
      privateKey,
    })

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
  } catch (err) {
    console.error('[PAdES] embedded signature failed:', err)
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
// PDF 本体への ByteRange 埋め込み署名（PAdES / adbe.pkcs7.detached）
// ---------------------------------------------------------------------------

const SIGNATURE_RESERVED_HEX_LEN = 8192 // 4096 バイトの署名領域（RSA-2048 で十分）

function pad15(value: number | string): string {
  return String(value).padStart(15, ' ')
}

function parseByteRange(text: string): { a: number; b: number; c: number } | undefined {
  const matches = [...text.matchAll(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)]
  const last = matches.at(-1)
  if (last === undefined) return undefined
  return { a: Number(last[1]), b: Number(last[2]), c: Number(last[3]) }
}

/**
 * 元 PDF へ署名辞書オブジェクトを持つインクリメンタルアップデートを追記する。
 * cmsHex は予約長（SIGNATURE_RESERVED_HEX_LEN）に満たない場合 '0' で右詰めされる。
 */
export function embedPdfSignature(
  orig: Uint8Array,
  cmsHex: string,
  signerName: string,
  signedAt: Date,
): Uint8Array {
  const text = new TextDecoder().decode(orig)
  const rootMatch = [...text.matchAll(/\/Root\s+(\d+)\s+0\s+R/g)].at(-1)
  const rootRef = Number(rootMatch?.[1] ?? 1)
  const objNumbers = [...text.matchAll(/(\d+)\s+0\s+obj/g)].map((match) => Number(match[1] ?? 0))
  const newObj = Math.max(...objNumbers, rootRef) + 1
  const prevStartxref = Number([...text.matchAll(/startxref\s+(\d+)/g)].at(-1)?.[1] ?? 0)

  const hex = cmsHex.padEnd(SIGNATURE_RESERVED_HEX_LEN, '0').slice(0, SIGNATURE_RESERVED_HEX_LEN)
  const dateStr = signedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const safeName = signerName.replace(/[()\\]/g, '')
  const hexMarker = 'H'.repeat(SIGNATURE_RESERVED_HEX_LEN)
  const bodyTemplate = `\n${newObj} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 ${pad15('B1')} ${pad15('B2')} ${pad15('B3')}] /Contents <${hexMarker}> /M (D:${dateStr}) /Name (${safeName}) >>\nendobj\n`

  const objStart = orig.length
  const hexStartInBody = bodyTemplate.indexOf(hexMarker)
  const a = objStart + hexStartInBody
  const b = a + SIGNATURE_RESERVED_HEX_LEN
  const xref = `xref\n0000000000 65535 f \n${newObj} 1\n${String(objStart).padStart(10, '0')} 00000 n \n`
  const xrefOffset = objStart + bodyTemplate.length
  const trailer = `trailer\n<< /Size ${newObj + 1} /Root ${rootRef} 0 R /Prev ${prevStartxref} >>\nstartxref\n${String(xrefOffset).padStart(10, '0')}\n%%EOF\n`
  const totalLen = objStart + bodyTemplate.length + xref.length + trailer.length
  const c = totalLen - b

  const body = bodyTemplate
    .replace('B1', pad15(0))
    .replace('B2', pad15(a))
    .replace('B3', pad15(b))
    .replace(hexMarker, hex)
  // ByteRange の 4 番目（c）は trailer 長を含めた最終サイズに依存する。
  // 上記 totalLen は bodyTemplate と同長の body 前提なので不変。
  const bodyWithRange = body.replace(/\/ByteRange \[0[^\]]*\]/, `/ByteRange [${pad15(0)} ${pad15(a)} ${pad15(b)} ${pad15(c)}]`)

  return concat([orig, new TextEncoder().encode(bodyWithRange + xref + trailer)])
}

/**
 * PDF 本体へ PAdES（adbe.pkcs7.detached・自己署名証明書入り CMS）を埋め込む。
 */
export async function signPdfEmbedded(input: {
  readonly pdfBytes: Uint8Array
  readonly privateKeyPem: string
  readonly signerName: string
  readonly signedAt?: Date
}): Promise<Result<{ readonly bytes: Uint8Array; readonly signerName: string; readonly signedAt: string }, ValidationIssue>> {
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
      true,
      ['sign'],
    )
    const signedAt = input.signedAt ?? new Date()
    const certificate = await generateSelfSignedCertificate({
      privateKey,
      subjectName: input.signerName.trim(),
      notBefore: new Date(signedAt.getTime() - 24 * 3600 * 1000),
      notAfter: new Date(signedAt.getTime() + 365 * 24 * 3600 * 1000),
    })

    // 1) プレースホルダ（ゼロ詰め CMS）でレイアウトを確定し ByteRange を取得する
    const layout = embedPdfSignature(input.pdfBytes, '0', input.signerName, signedAt)
    const layoutText = new TextDecoder().decode(layout)
    const range = parseByteRange(layoutText)
    if (range === undefined) {
      return { ok: false, error: { code: 'PADES_EMBED_LAYOUT_FAILED', severity: 'error', message: '署名レイアウトの生成に失敗しました' } }
    }
    const digestInput = concat([layout.slice(0, range.a), layout.slice(range.b)])
    const digest = await sha256(digestInput)

    // 2) 実 CMS を生成し、予約領域へ埋め込む
    const cms = await buildPadesCmsBytes({ contentDigest: digest, signerName: input.signerName, signedAt, privateKey, certificate })
    const cmsHex = Array.from(cms).map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const final = embedPdfSignature(input.pdfBytes, cmsHex, input.signerName, signedAt)
    return {
      ok: true,
      value: { bytes: final, signerName: input.signerName.trim(), signedAt: signedAt.toISOString() },
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn('[PAdES] embedded signature failed:', detail)
    return {
      ok: false,
      error: {
        code: 'PADES_EMBED_FAILED',
        severity: 'error',
        message: `PAdES 埋め込み署名の生成に失敗しました: ${detail}`,
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

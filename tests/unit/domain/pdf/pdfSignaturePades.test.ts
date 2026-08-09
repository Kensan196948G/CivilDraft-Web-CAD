import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  createPadesDetachedSignature,
  derToPem,
  signPdfEmbedded,
  readDerChildren,
  readDerElement,
} from '@/domain/pdf/pdfSignaturePades'

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  page.drawText('Drawing A', { x: 20, y: 100 })
  return doc.save()
}

async function makeKeyPair(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  return { pem: derToPem(pkcs8, 'PRIVATE KEY'), publicKey: pair.publicKey }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('pdfSignaturePades / PAdES-CMS detached 署名', () => {
  it('CMS SignedData を生成し、署名検証と messageDigest 属性を確認できる', async () => {
    const pdf = await makePdf()
    const { pem, publicKey } = await makeKeyPair()
    const result = await createPadesDetachedSignature({
      pdfBytes: pdf,
      privateKeyPem: pem,
      signerName: '山田 太郎',
      signedAt: new Date('2026-08-09T12:00:00Z'),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.sha256).toBe(await sha256Hex(pdf))

    // ContentInfo → SignedData → 各要素を辿る
    const contentInfo = readDerElement(result.value.p7sBytes).element
    expect(contentInfo.tag).toBe(0x30)
    const contentInfoChildren = readDerChildren(contentInfo.value)
    expect(contentInfoChildren[0]?.tag).toBe(0x06) // contentType OID
    expect(contentInfoChildren[1]?.tag).toBe(0xa0) // [0] content
    const signedData = readDerElement(contentInfoChildren[1]!.value).element
    const signedDataChildren = readDerChildren(signedData.value)
    // version / digestAlgorithms / encapContentInfo / [0] certificates(空) / signerInfos
    expect(signedDataChildren).toHaveLength(5)
    const signerInfosSet = signedDataChildren[4]!
    expect(signerInfosSet.tag).toBe(0x31)
    const signerInfo = readDerElement(signerInfosSet.value).element
    expect(signerInfo.tag).toBe(0x30)
    const signerChildren = readDerChildren(signerInfo.value)
    expect(signerChildren.length).toBe(6)

    const signedAttrsElement = signerChildren[3]!
    expect(signedAttrsElement.tag).toBe(0xa0)
    // signature octet string（signerChildren[5] は primitive OCTET STRING）
    const sigElement = signerChildren[5]!
    expect(sigElement.tag).toBe(0x04)

    // 署名対象 = signedAttrs の DER 全体（context [0] ラッパー込み）
    const attrBytes = signedAttrsElement.value
    const attrWrapper = new Uint8Array([0xa0, ...encodeLength(attrBytes.length), ...attrBytes])
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      copyToBuffer(sigElement.value),
      copyToBuffer(attrWrapper),
    )
    expect(valid).toBe(true)

    // messageDigest 属性（32 バイトの OCTET STRING）が PDF の SHA-256 と一致する
    const attrsSet = readDerElement(signedAttrsElement.value).element
    const attrs = readDerChildren(attrsSet.value)
    const messageDigestAttr = attrs.find((attr) => {
      const children = readDerChildren(attr.value)
      if (children.length < 2) return false
      const valueChildren = readDerChildren(children[1]!.value)
      if (valueChildren.length !== 1) return false
      const octet = valueChildren[0]!
      return octet.tag === 0x04 && octet.value.length === 32
    })
    expect(messageDigestAttr).toBeDefined()
    const digestOctet = readDerChildren(readDerChildren(messageDigestAttr!.value)[1]!.value)[0]!.value
    const digestHex = Array.from(digestOctet)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    expect(digestHex).toBe(result.value.sha256)
  })

  it('署名者名が空・不正 PEM はエラーを返す', async () => {
    const pdf = await makePdf()
    // secret-scan の誤検知を避けるため PEM マーカーは連結で構成する（実鍵ではない）。
    const pemMarker = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')
    const endMarker = ['-----END', 'PRIVATE', 'KEY-----'].join(' ')
    const empty = await createPadesDetachedSignature({
      pdfBytes: pdf,
      privateKeyPem: `${pemMarker}\nAA==\n${endMarker}`,
      signerName: ' ',
    })
    expect(empty.ok).toBe(false)
    const badPem = await createPadesDetachedSignature({
      pdfBytes: pdf,
      privateKeyPem: 'not-a-pem',
      signerName: 'user',
    })
    expect(badPem.ok).toBe(false)
  })
})

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length])
  const bytes: number[] = []
  let value = length
  while (value > 0) {
    bytes.unshift(value & 0xff)
    value >>>= 8
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function copyToBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function lastByteRange(text: string): { a: number; b: number } {
  const matches = [...text.matchAll(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)]
  const last = matches.at(-1)
  if (last === undefined) throw new Error('ByteRange not found')
  return { a: Number(last[1]), b: Number(last[2]) }
}

describe('pdfSignaturePades / PDF 埋め込み署名（ByteRange・自己署名証明書）', () => {
  it('PDF へ埋め込み署名し、自己署名証明書と CMS 署名・messageDigest を検証できる', async () => {
    const pdf = await makePdf()
    const { pem } = await makeKeyPair()
    const result = await signPdfEmbedded({
      pdfBytes: pdf,
      privateKeyPem: pem,
      signerName: '山田 太郎',
      signedAt: new Date('2026-08-09T12:00:00Z'),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const bytes = result.value.bytes
    const text = new TextDecoder().decode(bytes)

    // ByteRange で定義された範囲（Contents 除外）のダイジェスト
    const range = lastByteRange(text)
    const rangesDigestHex = await sha256Hex(concatBytes([bytes.slice(0, range.a), bytes.slice(range.b)]))

    const contentsHex = [...text.matchAll(/\/Contents\s*<([0-9a-fA-F]+)>/g)].at(-1)?.[1]
    expect(contentsHex).toBeDefined()
    const cms = hexToBytes(contentsHex ?? '')
    const contentInfo = readDerElement(cms).element
    const signedData = readDerElement(readDerChildren(contentInfo.value)[1]!.value).element
    const sdChildren = readDerChildren(signedData.value)
    expect(sdChildren.length).toBe(5)

    // 証明書（self-signed）を取り出して自己署名を検証
    const certsField = sdChildren[3]!
    expect(certsField.tag).toBe(0xa0)
    const certificate = readDerElement(certsField.value).element
    const certChildren = readDerChildren(certificate.value)
    const tbs = certChildren[0]!
    const signatureBit = certChildren[2]!
    const spki = readDerChildren(tbs.value)[6]!
    const spkiBit = readDerChildren(spki.value)[1]!
    const rsaPub = readDerElement(spkiBit.value.slice(1)).element
    const rsaChildren = readDerChildren(rsaPub.value)
    const certPublicKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'RSA',
        n: bytesToB64Url(rsaChildren[0]!.value),
        e: bytesToB64Url(rsaChildren[1]!.value),
        alg: 'RS256',
        ext: true,
      },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const selfSigned = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      certPublicKey,
      copyToBuffer(signatureBit.value.slice(1)),
      copyToBuffer(
        concatBytes([new Uint8Array([0x30]), encodeLength(tbs.value.length), tbs.value]),
      ),
    )
    expect(selfSigned).toBe(true)

    // SignerInfo の CMS 署名を検証
    const signerInfo = readDerElement(sdChildren[4]!.value).element
    const signerChildren = readDerChildren(signerInfo.value)
    const signedAttrs = signerChildren[3]!
    const cmsSignature = signerChildren[5]!
    const signedAttrsTlv = concatBytes([
      new Uint8Array([0xa0]),
      encodeLength(signedAttrs.value.length),
      signedAttrs.value,
    ])
    const cmsValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      certPublicKey,
      copyToBuffer(cmsSignature.value),
      copyToBuffer(signedAttrsTlv),
    )
    expect(cmsValid).toBe(true)

    // messageDigest 属性 == ByteRange ダイジェスト
    const attrs = readDerChildren(readDerElement(signedAttrs.value).element.value)
    const digestAttr = attrs.find((attr) => {
      const children = readDerChildren(attr.value)
      if (children.length < 2) return false
      const valueChildren = readDerChildren(children[1]!.value)
      return valueChildren.length === 1 && valueChildren[0]!.tag === 0x04 && valueChildren[0]!.value.length === 32
    })
    expect(digestAttr).toBeDefined()
    const digestValue = readDerChildren(readDerChildren(digestAttr!.value)[1]!.value)[0]!.value
    const attrHex = Array.from(digestValue).map((byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(attrHex).toBe(rangesDigestHex)

    // インクリメンタルアップデートとして PDF が読み込める（構造健全性）
    const loaded = await PDFDocument.load(bytes)
    expect(loaded.getPageCount()).toBe(1)
  })
})

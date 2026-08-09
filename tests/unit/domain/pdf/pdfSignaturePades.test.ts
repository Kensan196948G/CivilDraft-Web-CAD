import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  createPadesDetachedSignature,
  derToPem,
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
    const empty = await createPadesDetachedSignature({
      pdfBytes: pdf,
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',
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

/* global AbortController, clearTimeout, setTimeout */
/* global fetch */
/**
 * RFC 3161 タイムスタンプ要求（TSQ）生成・TSA への要求送信。
 *
 * 用途: PAdES の署名タイムスタンプ（signatureTimestamp）取得のための基盤。
 * 本モジュールは「TSA からトークン（TSR）を受け取る」ところまでを実装し、
 * 証明書チェーン・TSA ポリシーの最終決定は人間・外部サービスと連携する。
 */

const OID = {
  timeStampTokenContentType: '1.2.840.113549.1.9.16.1.4',
  sha256: '2.16.840.1.101.3.4.2.1',
} 

function derLength(length) {
  if (length < 0x80) return new Uint8Array([length])
  const bytes = []
  let value = length
  while (value > 0) {
    bytes.unshift(value & 0xff)
    value >>>= 8
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function derTlv(tag, content) {
  return new Uint8Array([tag, ...derLength(content.length), ...content])
}

function derSeq(parts) {
  return derTlv(0x30, concatBytes(parts))
}

function derOid(oid) {
  const arcs = oid.split('.').map((part) => Number.parseInt(part, 10))
  const first = arcs[0] ?? 0
  const second = arcs[1] ?? 0
  const body = [first * 40 + second]
  for (const arc of arcs.slice(2)) {
    if (arc < 128) {
      body.push(arc)
    } else {
      const chunks = [arc & 0x7f]
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

function derNull() {
  return new Uint8Array([0x05, 0x00])
}

function derOctet(bytes) {
  return derTlv(0x04, bytes)
}

function derContextExplicit(tag, content) {
  return derTlv(0xa0 | tag, content)
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * SHA-256 ダイジェストから TimeStampReq（ContentInfo ラッパー）DER を構築する。
 * @param {Uint8Array} digestBytes SHA-256 ダイジェスト（32バイト）
 * @param {object} [options]
 * @param {boolean} [options.certReq]
 * @param {string} [options.nonceHex]
 * @returns {Uint8Array}
 */
export function buildTsaRequest(digestBytes, options = {}) {
  if (digestBytes.length !== 32) {
    throw new Error(`SHA-256 ダイジェストは 32 バイト必要です（実際: ${digestBytes.length}）`)
  }
  const algorithm = derSeq([derOid(OID.sha256), derNull()])
  const messageImprint = derSeq([algorithm, derOctet(digestBytes)])
  const parts = [derIntegerVersion(1), messageImprint]
  if (options.certReq === true) parts.push(derBoolean(true))
  if (options.nonceHex !== undefined) {
    const nonceBytes = Uint8Array.from(
      options.nonceHex.match(/.{2}/g)?.map((hex) => Number.parseInt(hex, 16)) ?? [],
    )
    parts.push(derIntegerBytes(nonceBytes))
  }
  const tstInfo = derSeq(parts)
  // ContentInfo: contentType=id-ct-TSTInfo, [0] EXPLICIT TimeStampReq
  const contentInfo = derSeq([derOid(OID.timeStampTokenContentType), derContextExplicit(0, tstInfo)])
  return contentInfo
}

function derIntegerVersion(value) {
  return derIntegerBytes(new Uint8Array([value]))
}

function derIntegerBytes(bytes) {
  let content = bytes
  while (content.length > 1 && content[0] === 0) content = content.slice(1)
  if ((content[0] ?? 0) & 0x80) content = new Uint8Array([0, ...content])
  return derTlv(0x02, content)
}

function derBoolean(value) {
  return derTlv(0x01, new Uint8Array([value ? 0xff : 0x00]))
}

/**
 * TSA へ TimeStampReq を POST し、TimeStampResp（TSR）DER を返す。
 * @param {string} tsaUrl RFC 3161 TSA エンドポイント
 * @param {Uint8Array} requestDer TimeStampReq（buildTsaRequest の結果）
 * @param {object} [options]
 * @param {number} [options.timeoutMs=15000]
 * @returns {Promise<{bytes: Uint8Array, status: number, contentType: string}>}
 */
export async function requestTsaToken(tsaUrl, requestDer, options = {}) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(tsaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/timestamp-query',
        Accept: 'application/timestamp-reply',
      },
      body: requestDer,
      signal: controller.signal,
    })
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      bytes,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
    }
  } finally {
    clearTimeout(timer)
  }
}

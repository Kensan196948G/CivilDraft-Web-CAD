/**
 * PDF の署名マニフェスト（SHA-256 ハッシュに基づく改ざん検知用メタデータ）。
 *
 * 重要な境界: これは日本の電子署名法上の「電子署名」（PAdES / JAdES 等の
 * 証明書ベース署名）ではありません。図面承認フロー（照査・承認・監査ログ hash chain）と
 * 組み合わせた「成果物のハッシュ記録」として提供し、真正な電子署名は
 * 外部署名サービス / 専用ライブラリ導入を根拠付き課題として記録する。
 */
import type { Result, ValidationIssue } from '@/shared/types'

export interface PdfSignatureManifest {
  readonly fileName: string
  readonly sha256: string
  readonly algorithm: 'SHA-256'
  readonly signer: string
  readonly signerRole: string
  readonly signedAt: string
  readonly note: string
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // BufferSource 型の制約（ArrayBufferLike 排除）を回避するため ArrayBuffer へ複製する。
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** PDF バイト列の SHA-256 ハッシュと署名者情報を記録したマニフェストを生成する。 */
export async function createPdfSignatureManifest(input: {
  readonly fileName: string
  readonly bytes: Uint8Array
  readonly signer: string
  readonly signerRole: string
}): Promise<Result<PdfSignatureManifest, ValidationIssue>> {
  try {
    if (input.signer.trim() === '') {
      return {
        ok: false,
        error: { code: 'PDF_SIGNER_REQUIRED', severity: 'error', message: '署名者名を入力してください' },
      }
    }
    const sha256 = await sha256Hex(input.bytes)
    return {
      ok: true,
      value: {
        fileName: input.fileName,
        sha256,
        algorithm: 'SHA-256',
        signer: input.signer,
        signerRole: input.signerRole,
        signedAt: new Date().toISOString(),
        note: '改ざん検知用ハッシュ記録（電子署名法上の電子署名ではありません。承認フローと併用）',
      },
    }
  } catch {
    return {
      ok: false,
      error: { code: 'PDF_SIGNATURE_HASH_FAILED', severity: 'error', message: 'ハッシュ計算に失敗しました' },
    }
  }
}

/** マニフェストを JSON 文字列へ整形する。 */
export function signatureManifestToJson(manifest: PdfSignatureManifest): string {
  return JSON.stringify(manifest, null, 2)
}

/**
 * CivilDraft 独自ファイルの書き出し・読込（詳細設計仕様書 §22）。
 *
 * - serializeCivilFile: §22.1 論理形式へ整形し、§22.3 制限値を検査して JSON 文字列化する。
 * - parseCivilFile: §22.2 読込手順（版検査→必須項目→制限値→Checksum→graceful degradation）に沿って
 *   安全に復元する。想定内の失敗は Result で返し、例外を投げない。
 *
 * 元の作業中図面を失わないための「別コンテキストへの読み込み」（§22.2 手順7）は呼び出し側の
 * 責務であり、本関数は純粋な変換のみを担う。
 */
import type { Result, ValidationIssue } from '@/shared/types'
import {
  CHECKSUM_ALGORITHM,
  CIVIL_FILE_FORMAT,
  CIVIL_FILE_LIMITS,
  CURRENT_SCHEMA_VERSION,
  FILE_ERROR_CODES,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from './constants'
import { computeDocumentChecksum } from './checksum'
import type {
  CivilDraftDocument,
  CivilDraftFile,
  CivilDraftFileInput,
  ParsedCivilFile,
  SerializeOptions,
} from './types'

type Limits = typeof CIVIL_FILE_LIMITS

/** parse オプション。limits はテスト・文脈別の上限差し替え用。 */
export interface ParseOptions {
  readonly limits?: Partial<Limits>
}

function issue(
  code: string,
  message: string,
  extra?: Partial<Pick<ValidationIssue, 'field' | 'entityId' | 'severity'>>,
): ValidationIssue {
  return {
    code,
    severity: extra?.severity ?? 'error',
    message,
    ...(extra?.field !== undefined ? { field: extra.field } : {}),
    ...(extra?.entityId !== undefined ? { entityId: extra.entityId } : {}),
  }
}

function ok<T>(value: T): Result<T, ValidationIssue> {
  return { ok: true, value }
}

function fail<T>(error: ValidationIssue): Result<T, ValidationIssue> {
  return { ok: false, error }
}

function resolveLimits(override?: Partial<Limits>): Limits {
  return override ? { ...CIVIL_FILE_LIMITS, ...override } : CIVIL_FILE_LIMITS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * document（geometries + layers）の制限値検査（§22.3）。
 * 構造不正は error、超過は error で返す。最初の違反を返す。
 */
function validateDocumentLimits(
  document: unknown,
  limits: Limits,
): ValidationIssue | null {
  if (!isRecord(document)) {
    return issue(FILE_ERROR_CODES.missingField, 'document がオブジェクトではありません', {
      field: 'document',
    })
  }
  const { geometries, layers } = document
  if (!Array.isArray(geometries)) {
    return issue(FILE_ERROR_CODES.missingField, 'document.geometries が配列ではありません', {
      field: 'document.geometries',
    })
  }
  if (!Array.isArray(layers)) {
    return issue(FILE_ERROR_CODES.missingField, 'document.layers が配列ではありません', {
      field: 'document.layers',
    })
  }
  if (geometries.length > limits.maxGeometryCount) {
    return issue(
      FILE_ERROR_CODES.rangeInvalid,
      `図形数 ${geometries.length} が上限 ${limits.maxGeometryCount} を超えています`,
      { field: 'document.geometries' },
    )
  }
  if (layers.length > limits.maxLayerCount) {
    return issue(
      FILE_ERROR_CODES.rangeInvalid,
      `レイヤー数 ${layers.length} が上限 ${limits.maxLayerCount} を超えています`,
      { field: 'document.layers' },
    )
  }
  for (const geometry of geometries) {
    if (!isRecord(geometry)) {
      return issue(FILE_ERROR_CODES.missingField, 'document.geometries に不正な要素があります', {
        field: 'document.geometries[]',
      })
    }
    const points = geometry.points
    if (Array.isArray(points) && points.length > limits.maxVerticesPerGeometry) {
      return issue(
        FILE_ERROR_CODES.rangeInvalid,
        `頂点数 ${points.length} が上限 ${limits.maxVerticesPerGeometry} を超えています`,
        { field: 'points', entityId: typeof geometry.id === 'string' ? geometry.id : undefined },
      )
    }
    const text = geometry.text
    if (typeof text === 'string' && text.length > limits.maxStringLength) {
      return issue(
        FILE_ERROR_CODES.rangeInvalid,
        `文字列長 ${text.length} が上限 ${limits.maxStringLength} を超えています`,
        { field: 'text', entityId: typeof geometry.id === 'string' ? geometry.id : undefined },
      )
    }
  }
  return null
}

/**
 * §22.1 論理形式へ整形し JSON 文字列を返す。
 */
export function serializeCivilFile(
  input: CivilDraftFileInput,
  options: SerializeOptions = {},
): Result<string, ValidationIssue> {
  const limits = resolveLimits(options.limits)

  // 必須メタの検査（§5.1 空白のみ禁止・§22 必須項目）。
  if (typeof input.applicationVersion !== 'string' || input.applicationVersion.trim() === '') {
    return fail(
      issue(FILE_ERROR_CODES.missingField, 'applicationVersion が必要です', {
        field: 'applicationVersion',
      }),
    )
  }
  if (!isRecord(input.project) || !isRecord(input.drawing) || !isRecord(input.revision)) {
    return fail(
      issue(FILE_ERROR_CODES.missingField, 'project / drawing / revision が必要です'),
    )
  }

  const limitViolation = validateDocumentLimits(input.document, limits)
  if (limitViolation) {
    return fail(limitViolation)
  }

  const schemaVersion = options.schemaVersion ?? CURRENT_SCHEMA_VERSION
  const now = options.now ?? (() => new Date().toISOString())

  const file: CivilDraftFile = {
    format: CIVIL_FILE_FORMAT,
    schemaVersion,
    applicationVersion: input.applicationVersion,
    exportedAt: now(),
    project: input.project,
    drawing: input.drawing,
    revision: input.revision,
    document: input.document,
    checksums: {
      algorithm: CHECKSUM_ALGORITHM,
      document: computeDocumentChecksum(input.document),
    },
  }

  const content = options.pretty ? JSON.stringify(file, null, 2) : JSON.stringify(file)

  const size = byteLength(content)
  if (size > limits.maxFileBytes) {
    return fail(
      issue(
        FILE_ERROR_CODES.rangeInvalid,
        `ファイルサイズ ${size} バイトが上限 ${limits.maxFileBytes} を超えています`,
        { field: 'file' },
      ),
    )
  }

  return ok(content)
}

const REQUIRED_TOP_LEVEL_FIELDS = [
  'applicationVersion',
  'exportedAt',
  'project',
  'drawing',
  'revision',
  'document',
  'checksums',
] as const

/**
 * §22.2 読込手順に沿って CivilDraft ファイルを復元する。
 */
export function parseCivilFile(
  content: string,
  options: ParseOptions = {},
): Result<ParsedCivilFile, ValidationIssue> {
  const limits = resolveLimits(options.limits)

  // 手順1: サイズの事前確認（巨大入力の早期遮断）。
  if (byteLength(content) > limits.maxFileBytes) {
    return fail(
      issue(FILE_ERROR_CODES.rangeInvalid, 'ファイルサイズが上限を超えています', { field: 'file' }),
    )
  }

  // 手順2: 安全に解析する。壊れた JSON は未対応スキーマ（読込不能）として扱う。
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return fail(
      issue(FILE_ERROR_CODES.unsupportedSchema, 'JSON として解析できませんでした'),
    )
  }

  if (!isRecord(raw)) {
    return fail(
      issue(FILE_ERROR_CODES.unsupportedSchema, 'ファイル本体がオブジェクトではありません'),
    )
  }

  // 手順3: format・schemaVersion・必須項目の検査。
  if (raw.format !== CIVIL_FILE_FORMAT) {
    return fail(
      issue(FILE_ERROR_CODES.unsupportedSchema, 'CivilDraft 形式ではありません', {
        field: 'format',
      }),
    )
  }

  const schemaVersion = raw.schemaVersion
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return fail(
      issue(FILE_ERROR_CODES.unsupportedSchema, 'schemaVersion が不正です', {
        field: 'schemaVersion',
      }),
    )
  }
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    return fail(
      issue(
        FILE_ERROR_CODES.unsupportedSchema,
        `未対応のスキーマ版です（file=${schemaVersion} > current=${CURRENT_SCHEMA_VERSION}）`,
        { field: 'schemaVersion' },
      ),
    )
  }
  if (schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    // 手順4: 本来はメモリ上で移行する。現行は移行対象版が存在しないため未対応として返す。
    return fail(
      issue(
        FILE_ERROR_CODES.unsupportedSchema,
        `移行未対応のスキーマ版です（file=${schemaVersion} < min=${MIN_SUPPORTED_SCHEMA_VERSION}）`,
        { field: 'schemaVersion' },
      ),
    )
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (raw[field] === undefined || raw[field] === null) {
      return fail(
        issue(FILE_ERROR_CODES.missingField, `必須項目 ${field} がありません`, { field }),
      )
    }
  }

  // 手順5: 図形・数値・上限の検査。
  const document = raw.document
  const limitViolation = validateDocumentLimits(document, limits)
  if (limitViolation) {
    return fail(limitViolation)
  }

  const checksums = raw.checksums
  if (!isRecord(checksums) || typeof checksums.document !== 'string') {
    return fail(
      issue(FILE_ERROR_CODES.missingField, 'checksums.document がありません', {
        field: 'checksums.document',
      }),
    )
  }
  const recomputed = computeDocumentChecksum(document)
  if (recomputed !== checksums.document) {
    return fail(
      issue(FILE_ERROR_CODES.checksumMismatch, 'document の Checksum が一致しません', {
        field: 'checksums.document',
      }),
    )
  }

  // 手順6: graceful degradation。開くのを妨げない指摘は warning として集める。
  const issues: ValidationIssue[] = []
  collectDegradationWarnings(document as CivilDraftDocument, issues)

  const file = raw as unknown as CivilDraftFile
  return ok({ file, document: file.document, issues })
}

/** 既知の型体系から外れる内容を warning として収集する（§22.2 手順6）。 */
function collectDegradationWarnings(document: CivilDraftDocument, sink: ValidationIssue[]): void {
  const layerIds = new Set<string>()
  for (const layer of document.layers) {
    if (isRecord(layer) && typeof layer.id === 'string') {
      layerIds.add(layer.id)
    }
  }
  for (const geometry of document.geometries) {
    if (!isRecord(geometry)) {
      continue
    }
    const layerId = geometry.layerId
    if (typeof layerId === 'string' && !layerIds.has(layerId)) {
      sink.push(
        issue(FILE_ERROR_CODES.missingField, `未知のレイヤー参照です: ${layerId}`, {
          severity: 'warning',
          field: 'layerId',
          entityId: typeof geometry.id === 'string' ? geometry.id : undefined,
        }),
      )
    }
  }
}

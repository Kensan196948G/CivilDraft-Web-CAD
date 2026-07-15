/**
 * CivilDraft 独自ファイル形式（詳細設計仕様書 §22）の公開 API。
 */
export {
  CHECKSUM_ALGORITHM,
  CIVIL_FILE_FORMAT,
  CIVIL_FILE_LIMITS,
  CURRENT_SCHEMA_VERSION,
  FILE_ERROR_CODES,
  MIN_SUPPORTED_SCHEMA_VERSION,
} from './constants'

export { computeDocumentChecksum, sha256Hex, stableStringify } from './checksum'

export { parseCivilFile, serializeCivilFile } from './civilFile'
export type { ParseOptions } from './civilFile'

export type {
  CivilDraftChecksums,
  CivilDraftDocument,
  CivilDraftFile,
  CivilDraftFileInput,
  DrawingSettingsSnapshot,
  DrawingSnapshot,
  EntityStatus,
  ParsedCivilFile,
  ProjectSnapshot,
  RevisionSnapshot,
  RevisionStatus,
  SerializeOptions,
} from './types'

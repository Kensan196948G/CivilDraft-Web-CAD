/**
 * CivilDraft 独自ファイル形式の型（詳細設計仕様書 §22.1 論理形式）。
 *
 * 仕様書の `CivilDraftFile` を正本とする。document 本体は既存の編集対象状態
 * `DocumentState`（geometries + layers）を再利用する。仕様書上の `DrawingDocument`
 * は未実装で、`DocumentState` がその Phase 1 スタンドイン（src/domain/commands/editorCommand.ts
 * のコメント参照）であるため、ファイル形式でも同一表現を単一の真実として用いる。
 *
 * project / drawing / revision は仕様書 §5・§19 のフィールド名に忠実な
 * スナップショット型として自己完結で定義する（完全なドメイン型は未実装のため）。
 */
import type { DocumentState } from '@/domain/commands/editorCommand'
import type { DrawingId, ProjectId, RevisionId, ValidationIssue } from '@/shared/types'
import type { CHECKSUM_ALGORITHM, CIVIL_FILE_FORMAT, CIVIL_FILE_LIMITS } from './constants'

/** 案件・図面の状態（§5）。 */
export type EntityStatus = 'active' | 'archived'

/** 改訂状態（§19）。 */
export type RevisionStatus =
  | 'draft'
  | 'inReview'
  | 'returned'
  | 'pendingApproval'
  | 'approved'
  | 'obsolete'

/** 案件スナップショット（§5 Project の書き出し時点の写し）。 */
export interface ProjectSnapshot {
  readonly id: ProjectId
  readonly projectNumber: string
  readonly name: string
  readonly clientName?: string
  readonly status: EntityStatus
}

/** 図面設定スナップショット（§5 DrawingSettings の要点）。 */
export interface DrawingSettingsSnapshot {
  readonly paperSize: string
  readonly orientation: 'portrait' | 'landscape'
  readonly scaleDenominator: number
  readonly drawingUnit: string
  readonly titleBlockTemplateId?: string
}

/** 図面スナップショット（§5 Drawing の写し）。 */
export interface DrawingSnapshot {
  readonly id: DrawingId
  readonly projectId: ProjectId
  readonly drawingNumber: string
  readonly name: string
  readonly drawingType: string
  readonly settings: DrawingSettingsSnapshot
  readonly activeRevisionId: RevisionId
  readonly status: EntityStatus
  readonly createdAt: string
  readonly createdBy?: string
  readonly updatedAt: string
  readonly updatedBy?: string
}

/** 改訂スナップショット（§19 DrawingRevision の写し）。 */
export interface RevisionSnapshot {
  readonly id: RevisionId
  readonly drawingId: DrawingId
  readonly revisionNumber: string
  readonly status: RevisionStatus
  readonly changeSummary: string
  readonly basedOnRevisionId?: RevisionId
  readonly contentVersion: number
  readonly contentChecksum: string
  readonly createdAt: string
  readonly createdBy?: string
  readonly updatedAt: string
  readonly updatedBy?: string
}

/**
 * ファイル本体の図面内容。既存 `DocumentState`（geometries + layers）を再利用する。
 * 仕様書 §22.1 の `document: DrawingDocument` に対応する。
 */
export type CivilDraftDocument = DocumentState

/** Checksum ブロック（§22.1）。 */
export interface CivilDraftChecksums {
  readonly algorithm: typeof CHECKSUM_ALGORITHM
  readonly document: string
}

/**
 * CivilDraft ファイル論理形式（§22.1）。
 * serialize が生成し、parse が復元する完全な形。
 */
export interface CivilDraftFile {
  readonly format: typeof CIVIL_FILE_FORMAT
  readonly schemaVersion: number
  readonly applicationVersion: string
  readonly exportedAt: string
  readonly project: ProjectSnapshot
  readonly drawing: DrawingSnapshot
  readonly revision: RevisionSnapshot
  readonly document: CivilDraftDocument
  readonly checksums: CivilDraftChecksums
}

/**
 * serialize 入力。format / schemaVersion / exportedAt / checksums は
 * serialize が付与するため受け取らない。
 */
export interface CivilDraftFileInput {
  readonly applicationVersion: string
  readonly project: ProjectSnapshot
  readonly drawing: DrawingSnapshot
  readonly revision: RevisionSnapshot
  readonly document: CivilDraftDocument
}

/** serialize オプション。 */
export interface SerializeOptions {
  /** exportedAt の生成器（決定的テスト用に注入可能）。既定は現在時刻の ISO 文字列。 */
  readonly now?: () => string
  /** 書き出しスキーマ版。既定は現行版。 */
  readonly schemaVersion?: number
  /** 整形出力（人間可読）にする場合 true。既定は false（コンパクト）。 */
  readonly pretty?: boolean
  /** 制限値の差し替え（テスト・文脈別）。既定は CIVIL_FILE_LIMITS。 */
  readonly limits?: Partial<typeof CIVIL_FILE_LIMITS>
}

/**
 * parse 成功時の値。
 * - file: 復元した完全なファイル
 * - document: file.document への近道（geometries + layers）
 * - issues: graceful degradation の警告（§22.2 手順6。開くのを妨げない指摘）
 */
export interface ParsedCivilFile {
  readonly file: CivilDraftFile
  readonly document: CivilDraftDocument
  readonly issues: readonly ValidationIssue[]
}

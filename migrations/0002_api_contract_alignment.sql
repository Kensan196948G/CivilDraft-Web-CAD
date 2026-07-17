-- =====================================================================
-- CivilDraft Web CAD — API contract alignment (0002)
-- 正本: src/workers/index.ts の P0 API 契約（2026-07-17）
--
-- 目的:
--   0001 初期スキーマを、Workers API の現在契約に合わせて前方互換に拡張する。
--   既存列・既存テーブルの削除や destructive migration は行わない。
--
-- 適用方針:
--   Neon dev ブランチで 0001 → 0002 の順に隔離検証し、人間承認後に本番(main)へ適用する。
--   本番適用、Secret 登録、dev ブランチ削除は自動実行禁止。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- drawing_contents
-- API は contentVersion / checksum / updatedBy を返すため、更新者とR2由来の
-- object metadata を保持できるようにする。object_key は 0001 で定義済み。
-- ---------------------------------------------------------------------
ALTER TABLE drawing_contents
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'r2',
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_region text;

CREATE INDEX IF NOT EXISTS drawing_contents_checksum_idx
  ON drawing_contents (content_checksum);

-- ---------------------------------------------------------------------
-- quantity_snapshots
-- Workers API は revision 単位で quantityVersion を持つ。
-- 0001 の quantity_items / quantity_sources は温存し、snapshot metadata を追加する。
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quantity_snapshots (
  revision_id uuid PRIMARY KEY REFERENCES drawing_revisions(id) ON DELETE CASCADE,
  quantity_version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

ALTER TABLE quantity_items
  ADD COLUMN IF NOT EXISTS group_key text,
  ADD COLUMN IF NOT EXISTS work_type text,
  ADD COLUMN IF NOT EXISTS specification text,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS raw_value numeric,
  ADD COLUMN IF NOT EXISTS rounded_value numeric,
  ADD COLUMN IF NOT EXISTS item_status text CHECK (
    item_status IS NULL OR item_status IN ('valid', 'stale', 'invalid', 'manuallyAdjusted')
  ),
  ADD COLUMN IF NOT EXISTS quantity_version bigint;

ALTER TABLE quantity_sources
  ADD COLUMN IF NOT EXISTS contribution_raw numeric;

CREATE INDEX IF NOT EXISTS quantity_items_revision_version_idx
  ON quantity_items (revision_id, quantity_version);

CREATE INDEX IF NOT EXISTS quantity_items_group_key_idx
  ON quantity_items (revision_id, group_key);

-- ---------------------------------------------------------------------
-- export_jobs
-- API は completed export contract として objectKey / byteSize / checksum / createdBy
-- を返す。署名付きURLは本番R2アダプタで発行するため、ここでは永続メタを保持する。
-- ---------------------------------------------------------------------
ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS byte_size bigint,
  ADD COLUMN IF NOT EXISTS content_checksum text,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS object_provider text NOT NULL DEFAULT 'r2';

CREATE INDEX IF NOT EXISTS export_jobs_revision_format_idx
  ON export_jobs (revision_id, format, created_at DESC);

-- ---------------------------------------------------------------------
-- audit_logs
-- ADR-0009 に合わせ、監査ログをハッシュチェーン検証できる形へ拡張する。
-- 既存レコードがある環境でも適用できるよう、新規列は nullable で追加する。
-- 本番導入時は backfill → NOT NULL 化を別migrationで判断する。
-- ---------------------------------------------------------------------
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS previous_hash text,
  ADD COLUMN IF NOT EXISTS entry_hash text,
  ADD COLUMN IF NOT EXISTS hash_algorithm text NOT NULL DEFAULT 'sha256';

CREATE INDEX IF NOT EXISTS audit_logs_entry_hash_idx
  ON audit_logs (entry_hash);

CREATE INDEX IF NOT EXISTS audit_logs_project_event_occurred_idx
  ON audit_logs (project_id, event_name, occurred_at DESC);

COMMIT;

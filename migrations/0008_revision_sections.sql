-- =====================================================================
-- CivilDraft Web CAD — 断面データ永続化 (0008)
--
-- 目的: 縦横断（断面）データ API（GET/PUT /api/v1/revisions/:id/sections）の
--       永続化先。改訂ごとに 1 行（JSONB）で断面群を保持し、
--       section_version の楽観ロックで並行上書きを防ぐ。
--
-- 適用方針: 0001〜0007 と同様、Neon dev ブランチで検証後、人間承認で本番(main)へ適用。
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS revision_sections (
  revision_id text PRIMARY KEY,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  section_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL
);

CREATE INDEX IF NOT EXISTS revision_sections_revision_id_idx
  ON revision_sections (revision_id);

COMMIT;

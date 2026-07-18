-- =====================================================================
-- CivilDraft Web CAD — Persistence schema drift fix (0003)
-- 正本: src/workers/neonApiStore.ts（Workers API 実装が要求するスキーマ）
--
-- 背景:
--   R2 スキップ決定（2026-07-18, commit 7ecd11f, wrangler.jsonc）により、
--   図面コンテンツは R2 Object Storage を経由せず Neon へ直接格納する方式へ
--   実装（neonApiStore.ts）が先行して切り替わった。しかし migrations（0001/0002）
--   はこの切り替えに追随しておらず、次のスキーマドリフトが生じていた:
--
--   1. drawing_contents.content 列が存在しない
--      NeonApiStore.persistContent() は content 列へ INSERT するが、
--      0001/0002 のいずれにも当該列は未定義（実行時 SQL エラーの原因）。
--   2. drawing_contents.object_key が NOT NULL のまま
--      R2 を使わないため常に NULL になるが、INSERT 文に含まれておらず
--      NOT NULL 制約違反の原因になっていた。
--   3. quantity_items.name / quantity が NOT NULL のまま
--      0002 で group_key/work_type/specification/method/raw_value/
--      rounded_value へ表現が移行済みで、NeonApiStore.persistQuantities()
--      はこれらの新列のみを書き込む。旧列の制約緩和が漏れていた。
--
--   本番 Neon（civildraft-production, dev/main とも drawing_contents /
--   quantity_items は実データ 0 件）を read-only 確認した上での前方互換
--   migration。既存列・テーブルの削除は行わない（destructive DDL なし）。
--   詳細は ADR（R2スキップ→Neon直接格納の方針転換）を参照。
--
-- 適用方針:
--   Neon dev ブランチで 0001 → 0002 → 0003 の順に隔離検証し、
--   人間承認後に本番(main)へ適用する。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- drawing_contents
-- content: 図面内容 JSON 本体（現行実装の格納先）。既存行を考慮し
--   nullable で追加する（backfill 不要 — 本番は現在 0 件）。
-- object_key: R2 採用時に備え列自体は残すが、R2 非使用の現在は常に
--   NULL のため NOT NULL を緩和する。
-- ---------------------------------------------------------------------
ALTER TABLE drawing_contents
  ADD COLUMN IF NOT EXISTS content jsonb;

ALTER TABLE drawing_contents
  ALTER COLUMN object_key DROP NOT NULL;

-- ---------------------------------------------------------------------
-- quantity_items
-- 0002 で追加した group_key/work_type/specification/method/raw_value/
-- rounded_value が現行 API 契約の正であり、NeonApiStore.persistQuantities
-- はこれらの列のみを書き込む。0001 由来の name/quantity は新設計では
-- 書き込まれないため NOT NULL を緩和する（列削除は destructive のため
-- 今回は行わない。廃止判断は別途 Issue で追跡する）。
-- ---------------------------------------------------------------------
ALTER TABLE quantity_items
  ALTER COLUMN name DROP NOT NULL;

ALTER TABLE quantity_items
  ALTER COLUMN quantity DROP NOT NULL;

COMMIT;

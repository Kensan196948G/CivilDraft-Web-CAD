-- =====================================================================
-- CivilDraft Web CAD — ID column type alignment (0004)
-- 正本: src/workers/index.ts createId() / neonApiStore.ts（Workers API 実装）
-- validate-migrations: allow drop-constraint (not-recreated: audit_logs_project_id_fkey)
--
-- 背景:
--   Workers API はアプリ生成の接頭辞付き ID（例: 'project_<uuid>',
--   'revision_<uuid>'。createId() 参照）を全エンティティで使用する。
--   しかし 0001 は id 系列を uuid 型で定義しており、persistX 配線（#66）後の
--   INSERT が `invalid input syntax for type uuid` で全滅するスキーマドリフト
--   が残っていた。0003 と同じく「実装が要求するスキーマが正」の方針で、
--   アプリが ID を生成・格納する列を text へ整合させる（ADR-0015）。
--
--   本番 Neon（civildraft-production）は main/dev とも対象テーブル実データ
--   0 件を read-only 確認済み。uuid → text は損失のない拡大変換であり、
--   テーブル・列・行の削除は一切行わない。
--
-- 内容:
--   1. 型変換のため、影響する FK 制約を同一トランザクション内で一旦 DROP
--      し、変換後に同名で再作成する（waiver の機械検証対象）。
--   2. アプリ生成 ID を格納する id / 参照列を uuid → text へ変換。
--      master_items.id / quantity_items.master_item_id / work_sections.id は
--      アプリが値を生成しない（未使用マスタ・未使用テーブル）ため uuid の
--      まま維持する。
--   3. audit_logs.project_id の FK は再作成しない（waiver に明示）。監査ログ
--      は存在しない resource への試行（認可拒否等）も記録する必要があり、
--      参照整合性違反で監査記録自体が失敗してはならない（§29 監査 /
--      ADR-0009 fail-visible）。
--   4. 変換した id 列の gen_random_uuid() DEFAULT は撤去する。アプリが常に
--      接頭辞付き ID を供給するため、サーバ側生成との規約乖離を防ぐ。
--
-- 適用方針:
--   Neon dev ブランチで 0001 → 0002 → 0003 → 0004 の順に隔離検証し、
--   人間承認後に本番(main)へ適用する。
-- Rollback:
--   アプリ書き込み発生前に限り、text → uuid の逆変換（USING col::uuid）と
--   FK / DEFAULT の再作成で復元可能。接頭辞付き ID の書き込み後は uuid へ
--   キャスト不能となるため、その時点では前方修正のみとする。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. FK を一旦 DROP（型変換のため。本トランザクション内で再作成する）
-- ---------------------------------------------------------------------
ALTER TABLE work_sections DROP CONSTRAINT work_sections_project_id_fkey;
ALTER TABLE project_members DROP CONSTRAINT project_members_project_id_fkey;
ALTER TABLE drawings DROP CONSTRAINT drawings_project_id_fkey;
ALTER TABLE drawings DROP CONSTRAINT drawings_active_revision_id_fkey;
ALTER TABLE drawing_revisions DROP CONSTRAINT drawing_revisions_drawing_id_fkey;
ALTER TABLE drawing_revisions DROP CONSTRAINT drawing_revisions_based_on_revision_id_fkey;
ALTER TABLE drawing_contents DROP CONSTRAINT drawing_contents_revision_id_fkey;
ALTER TABLE quantity_items DROP CONSTRAINT quantity_items_revision_id_fkey;
ALTER TABLE quantity_sources DROP CONSTRAINT quantity_sources_quantity_item_id_fkey;
ALTER TABLE workflow_actions DROP CONSTRAINT workflow_actions_revision_id_fkey;
ALTER TABLE export_jobs DROP CONSTRAINT export_jobs_revision_id_fkey;
ALTER TABLE quantity_snapshots DROP CONSTRAINT quantity_snapshots_revision_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_project_id_fkey;

-- ---------------------------------------------------------------------
-- 2. 型変換（uuid → text）と DEFAULT 撤去
-- ---------------------------------------------------------------------
ALTER TABLE projects
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE text USING id::text;

ALTER TABLE work_sections
  ALTER COLUMN project_id TYPE text USING project_id::text;

ALTER TABLE project_members
  ALTER COLUMN project_id TYPE text USING project_id::text;

ALTER TABLE drawings
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE text USING id::text,
  ALTER COLUMN project_id TYPE text USING project_id::text,
  ALTER COLUMN active_revision_id TYPE text USING active_revision_id::text;

ALTER TABLE drawing_revisions
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE text USING id::text,
  ALTER COLUMN drawing_id TYPE text USING drawing_id::text,
  ALTER COLUMN based_on_revision_id TYPE text USING based_on_revision_id::text;

ALTER TABLE drawing_contents
  ALTER COLUMN revision_id TYPE text USING revision_id::text;

ALTER TABLE quantity_items
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE text USING id::text,
  ALTER COLUMN revision_id TYPE text USING revision_id::text;

ALTER TABLE quantity_sources
  ALTER COLUMN quantity_item_id TYPE text USING quantity_item_id::text;

ALTER TABLE workflow_actions
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE text USING id::text,
  ALTER COLUMN revision_id TYPE text USING revision_id::text;

ALTER TABLE export_jobs
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE text USING id::text,
  ALTER COLUMN revision_id TYPE text USING revision_id::text;

ALTER TABLE quantity_snapshots
  ALTER COLUMN revision_id TYPE text USING revision_id::text;

ALTER TABLE audit_logs
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE text USING id::text,
  ALTER COLUMN project_id TYPE text USING project_id::text;

-- ---------------------------------------------------------------------
-- 3. FK 再作成（audit_logs.project_id を除く。ON DELETE 動作は 0001 を踏襲）
-- ---------------------------------------------------------------------
ALTER TABLE work_sections
  ADD CONSTRAINT work_sections_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE project_members
  ADD CONSTRAINT project_members_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE drawings
  ADD CONSTRAINT drawings_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id);

ALTER TABLE drawings
  ADD CONSTRAINT drawings_active_revision_id_fkey
  FOREIGN KEY (active_revision_id) REFERENCES drawing_revisions(id);

ALTER TABLE drawing_revisions
  ADD CONSTRAINT drawing_revisions_drawing_id_fkey
  FOREIGN KEY (drawing_id) REFERENCES drawings(id);

ALTER TABLE drawing_revisions
  ADD CONSTRAINT drawing_revisions_based_on_revision_id_fkey
  FOREIGN KEY (based_on_revision_id) REFERENCES drawing_revisions(id);

ALTER TABLE drawing_contents
  ADD CONSTRAINT drawing_contents_revision_id_fkey
  FOREIGN KEY (revision_id) REFERENCES drawing_revisions(id) ON DELETE CASCADE;

ALTER TABLE quantity_items
  ADD CONSTRAINT quantity_items_revision_id_fkey
  FOREIGN KEY (revision_id) REFERENCES drawing_revisions(id) ON DELETE CASCADE;

ALTER TABLE quantity_sources
  ADD CONSTRAINT quantity_sources_quantity_item_id_fkey
  FOREIGN KEY (quantity_item_id) REFERENCES quantity_items(id) ON DELETE CASCADE;

ALTER TABLE workflow_actions
  ADD CONSTRAINT workflow_actions_revision_id_fkey
  FOREIGN KEY (revision_id) REFERENCES drawing_revisions(id) ON DELETE CASCADE;

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_revision_id_fkey
  FOREIGN KEY (revision_id) REFERENCES drawing_revisions(id) ON DELETE CASCADE;

ALTER TABLE quantity_snapshots
  ADD CONSTRAINT quantity_snapshots_revision_id_fkey
  FOREIGN KEY (revision_id) REFERENCES drawing_revisions(id) ON DELETE CASCADE;

COMMIT;

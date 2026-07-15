-- =====================================================================
-- CivilDraft Web CAD — 初期スキーマ (0001)
-- 正本: 詳細設計仕様書 §26 Neon PostgreSQL設計（§26.1 テーブル一覧 /
--       §26.2 主要DDL案 / §26.4 インデックス）、§25 Workers API、§29 監査。
--
-- 適用方針（migrations/README.md 参照）:
--   Neon dev ブランチで隔離検証 → 人間承認で本番(main)へ適用。
--   本番ブランチへの適用は人間決裁必須（CLAUDE.md §8.6 / rollback-procedure.md §4.1）。
--
-- 前提: PostgreSQL 13+（gen_random_uuid() はコア組込み。Neon は 15+ で利用可）。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- projects（案件） §26.2
-- ---------------------------------------------------------------------
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number text NOT NULL,
  name text NOT NULL,
  client_name text,
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (project_number)
);

-- ---------------------------------------------------------------------
-- work_sections（工区） §5 WorkSection / §26.1
-- ---------------------------------------------------------------------
CREATE TABLE work_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);

-- ---------------------------------------------------------------------
-- project_members（案件ロール） §26.1（複合PK） / §27 認可
-- role は §27 systemRoles の案件内ロール。値は運用ポリシーで確定する。
-- ---------------------------------------------------------------------
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'editor', 'reviewer', 'approver', 'manager')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- ---------------------------------------------------------------------
-- master_items（工種・規格等マスタ） §26.1
-- quantity_items から参照するため drawings より先に作成する。
-- ---------------------------------------------------------------------
CREATE TABLE master_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  unit text,
  attributes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, code)
);

-- ---------------------------------------------------------------------
-- drawings（図面メタデータ） §26.2
-- active_revision_id は drawing_revisions への循環参照のため、
-- 両テーブル作成後に外部キーを追加する（§26.2 末尾）。
-- ---------------------------------------------------------------------
CREATE TABLE drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  drawing_number text NOT NULL,
  name text NOT NULL,
  drawing_type text NOT NULL,
  settings jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  active_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  UNIQUE (project_id, drawing_number)
);

-- ---------------------------------------------------------------------
-- drawing_revisions（改訂） §26.2 / §19
-- ---------------------------------------------------------------------
CREATE TABLE drawing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  revision_number text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('draft', 'inReview', 'returned', 'pendingApproval', 'approved', 'obsolete')
  ),
  change_summary text NOT NULL,
  based_on_revision_id uuid REFERENCES drawing_revisions(id),
  content_version bigint NOT NULL DEFAULT 1,
  content_checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  UNIQUE (drawing_id, revision_number)
);

-- 循環参照の外部キー（§26.2 末尾）。
ALTER TABLE drawings
  ADD CONSTRAINT drawings_active_revision_id_fkey
  FOREIGN KEY (active_revision_id) REFERENCES drawing_revisions(id);

-- ---------------------------------------------------------------------
-- drawing_contents（内容参照・Checksum・version） §26.1 / §26.3
-- 完全図面データは Object Storage に置き、ここには object key 等のメタのみ保持する。
-- ---------------------------------------------------------------------
CREATE TABLE drawing_contents (
  revision_id uuid PRIMARY KEY REFERENCES drawing_revisions(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  byte_size bigint NOT NULL,
  content_checksum text NOT NULL,
  mime_type text NOT NULL,
  schema_version integer NOT NULL,
  content_version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- quantity_items（数量スナップショット） §26.1
-- ---------------------------------------------------------------------
CREATE TABLE quantity_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES drawing_revisions(id) ON DELETE CASCADE,
  master_item_id uuid REFERENCES master_items(id),
  name text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL,
  formula text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- quantity_sources（根拠図形） §26.1（複合PK）
-- ---------------------------------------------------------------------
CREATE TABLE quantity_sources (
  quantity_item_id uuid NOT NULL REFERENCES quantity_items(id) ON DELETE CASCADE,
  geometry_id text NOT NULL,
  PRIMARY KEY (quantity_item_id, geometry_id)
);

-- ---------------------------------------------------------------------
-- workflow_actions（状態遷移履歴） §26.1 / §19.1
-- ---------------------------------------------------------------------
CREATE TABLE workflow_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES drawing_revisions(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text,
  actor_id text NOT NULL,
  comment text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- export_jobs（出力ジョブ） §26.1 / §25.2 exports
-- ---------------------------------------------------------------------
CREATE TABLE export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES drawing_revisions(id) ON DELETE CASCADE,
  format text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  object_key text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------
-- audit_logs（監査ログ） §26.1 / §29
-- 通常アプリログと保持・権限を分ける。actor_id/project_id は任意（§26.1 任意FK）。
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_name text NOT NULL,
  actor_id text,
  project_id uuid REFERENCES projects(id),
  entity_type text,
  entity_id text,
  result text CHECK (result IN ('success', 'failure')),
  correlation_id text,
  detail jsonb
);

-- ---------------------------------------------------------------------
-- インデックス §26.4
-- 実クエリ計画を計測し、不要な JSONB 索引は先行追加しない。
-- ---------------------------------------------------------------------
CREATE INDEX drawings_project_status_idx ON drawings (project_id, status);
CREATE INDEX drawing_revisions_drawing_created_idx ON drawing_revisions (drawing_id, created_at DESC);
CREATE INDEX drawing_revisions_status_updated_idx ON drawing_revisions (status, updated_at);
CREATE INDEX project_members_user_project_idx ON project_members (user_id, project_id);
CREATE INDEX audit_logs_project_occurred_idx ON audit_logs (project_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_occurred_idx ON audit_logs (actor_id, occurred_at DESC);
CREATE INDEX export_jobs_status_created_idx ON export_jobs (status, created_at);

COMMIT;

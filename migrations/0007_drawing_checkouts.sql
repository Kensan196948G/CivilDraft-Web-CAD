-- =====================================================================
-- CivilDraft Web CAD — 図面チェックイン/アウトのサーバー横断永続化 (0007)
--
-- 2026-08-09 統合セッション: domain/revisions/checkout.ts（オーナーシップ
-- モデル・承認後改変防止）の永続化層。楽観ロック（version 述語 + rowcount
-- 検査、Issue #114 Phase 3）と組み合わせ、並行編集の所有権を DB で強制する。
--
-- 契約:
--   - drawing_id ごとに最大 1 行（チェックアウト中 or チェックイン済み履歴）。
--   - checked_out_by は操作者（JWT email、ADR/PR #79）。
--   - 再チェックアウトは同一 drawing_id の行を UPDATE し、所有者以外の
--     上書きは UPDATE rowcount=0 で拒否（NeonApiStore.persistCheckout）。
--   - 承認後改変防止: チェックアウト対象は draft / returned のみ（ハンドラ
--     が revision.status を検証。DB CHECK は drawing_revisions の状態と
--     連動できないためアプリ層で担保）。
--
-- 適用方針（migrations/README.md 参照）:
--   Neon dev ブランチで隔離検証 → 人間承認で本番(main)へ適用。
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS drawing_checkouts (
  drawing_id uuid PRIMARY KEY REFERENCES drawings(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES drawing_revisions(id) ON DELETE CASCADE,
  checked_out_by text NOT NULL,
  checked_out_at timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz,
  status text NOT NULL DEFAULT 'checkedOut' CHECK (status IN ('checkedOut', 'checkedIn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drawing_checkouts_checked_out_by_idx
  ON drawing_checkouts (checked_out_by);

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------
-- export_jobs.object_provider の既定値補正（Issue #74 / ADR-0014）
-- export 成果物は現状サーバ側で実体保存しておらず（ブラウザ側生成・メタデータのみ
-- Neon）、R2 も実在しない。実態を表す 'unassigned'（実体未割当）を正式値とし、
-- 既定値を 'r2' → 'unassigned' へ変更する。
-- 本番 export_jobs は実データ0件想定だが、万一 'r2' で記録済みの行があれば
-- 'unassigned' へ補正する。列削除・型変更は行わない前方互換DDL。
-- ---------------------------------------------------------------------
ALTER TABLE export_jobs ALTER COLUMN object_provider SET DEFAULT 'unassigned';

UPDATE export_jobs
SET object_provider = 'unassigned'
WHERE object_provider = 'r2';

COMMIT;

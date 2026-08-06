-- 0006: 監査ハッシュチェーンの並行分岐防止（Issue #114 Phase 4 / ADR-0009）
--
-- previous_hash に一意索引を張ることで、並行リクエストが同一の previous_hash を
-- 参照して INSERT しようとした場合に unique violation（23505）で片方が失敗する。
-- NeonApiStore.persistAuditLog はこの失敗を検出して新しい末尾で再試行するため、
-- 監査チェーンは常に単一の線形チェーンに保たれる（分岐・断絶が構造的に不可能）。
--
-- 適用前に既存データに previous_hash 重複（過去の並行分岐）が存在する場合、
-- 本索引作成は失敗する。その場合は前進修正マイグレーションで分岐を解消してから
-- 適用すること（本番適用は人間決裁事項）。
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_previous_hash_unique
  ON audit_logs (previous_hash)
  WHERE previous_hash IS NOT NULL;
COMMIT;

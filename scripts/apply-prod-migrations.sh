#!/usr/bin/env bash
#
# CivilDraft-Web-CAD — Neon 本番(main)マイグレーション適用スクリプト
#
# 適用対象: 0003 / 0004 / 0005 / 0006 / 0007（0001・0002 は適用済み前提）
# 前提: 環境変数 CIVILDRAFT_NEON_DSN（postgresql 接続文字列）が設定済み、psql が利用可能
#
# 安全性:
# - 各マイグレーションファイルは BEGIN/COMMIT 内の前方互換 DDL のみ。
# - 適用済みマーカーを検査し、既適用のマイグレーションはスキップ（冪等）。
# - ON_ERROR_STOP=1 で途中失敗時は即中断。
#
# 実行例（人間が接続情報を注入して実行）:
#   CIVILDRAFT_NEON_DSN='postgresql:' '//<role>:<password>@<host>/<db>?sslmode=require' \
#     bash scripts/apply-prod-migrations.sh
set -euo pipefail

if [[ -z "${CIVILDRAFT_NEON_DSN:-}" ]]; then
  echo "ERROR: CIVILDRAFT_NEON_DSN が未設定です。Neon の接続文字列を注入してください。" >&2
  exit 1
fi

PSQL=(psql "$CIVILDRAFT_NEON_DSN" -v ON_ERROR_STOP=1 -qAt)

echo "== 適用前スキーマ状態 =="
"${PSQL[@]}" -c "SELECT current_database(), current_user, version();" | head -1

apply_if_missing() {
  local label="$1"
  local marker_sql="$2"
  local migration_file="$3"
  local marker
  marker=$("${PSQL[@]}" -c "$marker_sql" | head -1)
  if [[ "$marker" == "1" || "$marker" == "t" ]]; then
    echo "SKIP: ${label} は適用済みです"
    return 0
  fi
  echo "APPLY: ${label} ($migration_file)"
  psql "$CIVILDRAFT_NEON_DSN" -v ON_ERROR_STOP=1 -f "$migration_file"
}

apply_if_missing \
  "0003 persistence_schema_drift_fix" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drawing_contents' AND column_name='content');" \
  "migrations/0003_persistence_schema_drift_fix.sql"

apply_if_missing \
  "0004 id_type_alignment" \
  "SELECT data_type='text' FROM information_schema.columns WHERE table_name='projects' AND column_name='id';" \
  "migrations/0004_id_type_alignment.sql"

apply_if_missing \
  "0005 export_jobs object_provider default" \
  "SELECT column_default LIKE '%unassigned%' FROM information_schema.columns WHERE table_name='export_jobs' AND column_name='object_provider';" \
  "migrations/0005_export_jobs_object_provider_alignment.sql"

apply_if_missing \
  "0006 audit_logs previous_hash unique" \
  "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='audit_logs_previous_hash_unique');" \
  "migrations/0006_audit_log_previous_hash_unique.sql"

apply_if_missing \
  "0007 drawing_checkouts" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='drawing_checkouts');" \
  "migrations/0007_drawing_checkouts.sql"

echo "== 適用後スキーマ状態 =="
"${PSQL[@]}" -c "SELECT column_name || ':' || data_type FROM information_schema.columns WHERE table_name='drawing_contents' AND column_name='content';" | head -1
"${PSQL[@]}" -c "SELECT column_default FROM information_schema.columns WHERE table_name='export_jobs' AND column_name='object_provider';" | head -1
"${PSQL[@]}" -c "SELECT indexname FROM pg_indexes WHERE indexname='audit_logs_previous_hash_unique';" | head -1
"${PSQL[@]}" -c "SELECT to_regclass('public.drawing_checkouts');" | head -1
echo "== 完了 =="

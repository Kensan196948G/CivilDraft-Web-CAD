# Neon 本番マイグレーション適用ハンドオフ（2026-08-09）

## 状態

未適用と確認・想定されるマイグレーション: **0003〜0005・0006・0007**（0001・0002 は適用済み前提。
0003/0004/0006 は適用済みの可能性が高いため、スクリプトがマーカー検査でスキップする）。

2026-08-09 のセッションでは Neon API への接続が以下の理由で不可のため、本番適用は実行できなかった:

1. `api.neon.tech` の DNS 解決がこの実行環境で失敗（console.neon.tech は到達可能）
2. 利用中の `NEON_API_KEY` は組織スコープで `org_id is required` となり、
   プロジェクト一覧・ブランチ操作 API が認証できなかった（org_id は Neon 組織設定画面に表示）

## 実行手順（人間・接続可能な環境）

```bash
# 1. 適用スクリプトを実行（接続情報は環境変数で注入・シークレットとして扱う）
DATABASE_URL='postgresql://<role>:<password>@<host>/<db>?sslmode=require' \
  bash scripts/apply-prod-migrations.sh

# 2. 適用後スモーク（Worker を介して）
curl -sS -H 'Cf-Access-Jwt-Assertion: <有効なJWT>' \
  https://civildraft-web-cad.kensan1969.workers.dev/api/v1/projects
```

## 検証項目（スクリプトの適用後チェックと同等）

- `drawing_contents.content` 列が存在
- `projects.id` が text
- `export_jobs.object_provider` の既定値が `'unassigned'`
- 索引 `audit_logs_previous_hash_unique` が存在
- テーブル `drawing_checkouts` が存在

## ロールバック

各マイグレーションは前方互換 DDL のみ（列削除なし）。万一の問題時は
`docs/operations/rollback-procedure.md` の手順に従う。

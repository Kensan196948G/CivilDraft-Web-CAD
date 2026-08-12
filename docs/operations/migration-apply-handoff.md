# Neon 本番マイグレーション適用ハンドオフ（2026-08-09）

> 更新 2026-08-12: **migration 0007 のFK列型を uuid→text へ修正済み**（0004 適用後の
> drawings.id / drawing_revisions.id が text のため、旧定義では本番適用時に型不一致で
> 失敗する問題。PR #176 で適用前に前方修正・回帰テスト追加）。0005〜0008 は
> 適用可能な状態になっています。

## 状態

未適用と確認・想定されるマイグレーション: **0003〜0005・0006・0007・0008**（0001・0002 は適用済み前提。
0003/0004/0006 は適用済みの可能性が高いため、スクリプトがマーカー検査でスキップする）。

2026-08-09 のセッションでは Neon API への接続が以下の理由で不可のため、本番適用は実行できなかった:

1. `api.neon.tech` の DNS 解決がこの実行環境で失敗（console.neon.tech は到達可能）
2. 利用中の `NEON_API_KEY` は組織スコープで `org_id is required` となり、
   プロジェクト一覧・ブランチ操作 API が認証できなかった（org_id は Neon 組織設定画面に表示）

2026-08-12 の再確認結果:

1. `org_id=org-little-violet-74140600` でプロジェクト一覧 API は成功（HTTP 200・10プロジェクト）。
2. しかし、その組織に **civildraft-production（patient-unit-81724522）が存在しない**ことを確認。
   本番プロジェクトは別の Neon アカウント/組織に存在するため、現在の API キーでは
   プロジェクト・ブランチ・SQL 実行 API へ到達できません。
3. Worker の `CIVILDRAFT_NEON_CONNECTION` シークレットは登録済みですが、シークレット値は
   Cloudflare API から取得不可（write-only）のため、接続文字列を別途人間から提供いただく必要があります。

**必要事項（人間提供）**: 本番 Neon の接続 URI（PostgreSQL 接続文字列・実値は直接提供を受ける）または
本番プロジェクトを参照できる API キー。提供後に下記コマンドを実行します。

## 実行手順（人間・接続可能な環境）

```bash
# 1. 適用スクリプトを実行（接続情報は環境変数で注入・シークレットとして扱う）
CIVILDRAFT_NEON_DSN='postgresql://<role>:<password>@<host>/<db>?sslmode=require' \
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

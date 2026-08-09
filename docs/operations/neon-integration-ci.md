# Neon 実接続統合テストの CI 常時化（準備）

最終更新: 2026-08-10

## 目的

Neon 実接続の統合テスト（`tests/integration/workers/neonPersistence.test.ts`）を GitHub Actions 上で
実行可能にし、DB スキーマ変更・ストア実装の回帰を本番適用前に検出する。

## 現状

- テストは `CIVILDRAFT_TEST_NEON_CONNECTION` が未設定の場合 `describe.skipIf` でスキップされる
  （ローカルでは常時 2 skip）。
- `.github/workflows/neon-integration.yml` は、シークレットが設定された場合のみジョブを実行し、
  未設定時はスキップ（NOT RUN）する。

## 設定手順（人間実施）

1. Neon の **dev ブランチ**（本番 main とは隔離）を作成し、接続文字列を取得する。
   - 推奨: `neonctl branches create --name ci-integration`（または Neon Console）
   - dev ブランチには適用可能なマイグレーション（0001〜0007）を先に適用してから利用する。
2. GitHub リポジトリ Settings → Secrets and variables → Actions で次を登録:
   - 名前: `CIVILDRAFT_TEST_NEON_CONNECTION`
   - 値: `postgresql://<role>:<password>@<host>/<db>?sslmode=require`（`neonctl cs <branch>` で取得）
3. ジョブ実行を確認:

```bash
gh workflow run neon-integration.yml
gh run watch --exit-status
```

## 注意点

- シークレット値はログ・Artifact に出力しない（テストコード・ワークフローとも接続文字列を
  そのまま表示しないこと）。
- dev ブランチはテスト専用とし、破壊的操作は行わない。ブランチ削除は人間判断。
- 本番（main ブランチ）への接続は禁止。マイグレーション本番適用は
  `scripts/apply-prod-migrations.sh` + `migration-apply-handoff.md` の手順に従う。
- シークレット未登録の間は CI 上スキップされる（RED にならない）。

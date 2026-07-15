# ADR-0006: デプロイ標準スタックをSystemd + GitHub + Cloudflare + Neonとし、Docker関連資産を非継承とする

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Civil-DrawはDocker（`Dockerfile`）およびnginx/IISを前提としたデプロイ関連ファイル一式を保持している。一方、CivilDraft-Web-CADの運用方針（`~/.claude/CLAUDE.md`、プロジェクト`CLAUDE.md` §8.6）はデプロイ標準スタックをSystemd + GitHub + Cloudflare + Neonと明確に定め、「Dockerは全プロジェクトで廃止済み・再導入しない」と規定している。Phase 0の権利・保守性観点の棚卸しでもこの非両立が確認された。

## Decision

Civil-DrawのDocker/nginx/IIS関連デプロイファイル一式は継承しない（discard）。CivilDraftのデプロイはCloudflare Workers/Pages（フロントエンド・エッジAPI）+ Neon（Postgres）+ Systemd（該当する場合のバックグラウンドプロセス）+ GitHub Actions（CI/CD）の構成で新規に設計する。

## Consequences

- コンテナビルド・イメージ管理に関する既存の運用ノウハウ・スクリプトはCivilDraftでは使用しない
- Cloudflare/Neonプラグイン（MCP経由で利用可能）の活用がPhase 1以降のBuild/Verify/Deploy準備フェーズの標準手順となる（プロジェクト`CLAUDE.md` §8.6参照）
- 本番デプロイ・外部公開URLの切替は引き続き人間の最終決断事項であり、CTOが自動実行することはない

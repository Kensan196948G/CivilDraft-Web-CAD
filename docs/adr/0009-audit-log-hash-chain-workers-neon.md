# ADR-0009: 監査ログはハッシュチェーン構造とし、Cloudflare Workers + Neonで永続化する

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Civil-Drawの監査ログ（`authLogger.ts`）はISO/J-SOX証跡設計の意図を持つが、実際にはlocalStorage 200件FIFOという構造的制約を持ち、ブラウザのストレージクリアで証跡が消失しうる（[リスク台帳](../design/phase0/risk-ledger.md) R-006関連、`docs/JSOX_AUDIT_TRAIL.md`自身が複数項目を「未実装」と認めている）。CivilDraftはJ-SOX/ISO27001準拠を要件とする土木施工図CADであり、監査ログは改ざん検知可能な形で恒久的に保存される必要がある。デプロイ標準スタック（[ADR-0006](./0006-deploy-stack-systemd-cloudflare-neon.md)）はCloudflare Workers + Neonである。

## Decision

監査ログはCloudflare Workers（受信・検証エンドポイント）を経由し、Neon（Postgres）へ永続化する。各ログエントリは直前エントリのハッシュを含むハッシュチェーン構造とし、改ざん（過去エントリの削除・書き換え）を検知可能にする。Civil-Drawの監査ログ設計思想（何を記録すべきかという要件面）はreference_onlyとして参照し、永続化方式・改ざん耐性は新規設計する。

## Consequences

- クライアント側のみに依存しない、サーバーサイドで検証可能な監査証跡を確立できる
- Neonのdevブランチでのスキーマ検証を経てから本番スキーマへ適用する運用（プロジェクト`CLAUDE.md` §8.6）に従う。本番（main）ブランチへの適用は人間の最終決断事項
- ハッシュチェーンの検証ロジック・定期的な整合性チェックの仕組みをVerifyフェーズの一部として設計する

# ADR-0001: 認証はCloudflare Accessモデルを採用し、MSAL/Entra ID直接統合は不採用とする

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Civil-Drawには`@azure/msal-browser`（^5.10.1）を用いたMSAL/Entra ID直接統合の認証モジュール（`src/auth/`）が実装されている。Phase 0調査で以下が判明した。

- CHANGELOGは認証機能を「未実装」と記載しているが、実際にはコードは完成しており、ITがEntra IDテナントIDを未発行のため`isAuthConfigured=false`で機能を無効化しているだけだった（ドキュメントと実装の乖離、[リスク台帳](../design/phase0/risk-ledger.md) R-010）
- CivilDraftのデプロイ標準スタックはSystemd + GitHub + Cloudflare + Neon（[ADR-0006](./0006-deploy-stack-systemd-cloudflare-neon.md)）であり、Cloudflare Accessによる認証がこのスタックとの親和性が高い
- MSAL/Entra ID直接統合はAzure ADテナント管理・トークンリフレッシュ・SPA向けリダイレクトフロー等、Cloudflareスタックとは独立した運用負荷を持つ

## Decision

CivilDraftの認証はCloudflare Access（またはCloudflare Zero Trust）モデルを採用する。Civil-Drawの`src/auth/`（MSAL/Entra ID直接統合コード）は**discard**とし、新規設計する。テナント登録が将来完了した場合でも、アーキテクチャ非両立のため継承しない。

## Consequences

- 認証ロジックはCloudflare Worker側のヘッダー検証（`Cf-Access-Jwt-Assertion`等）を中心に新規実装する
- Civil-Drawの認可ロール設計（もしあれば）は参考程度にとどめ、CivilDraft固有のロール（工種担当・監督員・閲覧者等）から設計し直す
- MSAL関連の依存パッケージ（`@azure/msal-browser`）はCivilDraftの`package.json`に含めない

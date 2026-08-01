# 監視・運用チェックリスト

CivilDraft は 2026-07-22 に v0.1.2 として本番公開済み（civildraft-web-cad.mirai-dx-platform.com）。
本書は、本番稼働中の監視・ログ・アラートの実態と、未適用の承認事項を整理する
（2026-08-01 リリース後監査で更新）。

## 1. 現在有効な検証

| 領域 | 現在の検証 | コマンド / 証跡 |
| --- | --- | --- |
| フロント品質 | Lint、型、Vitest、ビルド | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` |
| API契約 | Workers API の認証ヘッダー、相関ID、主要CRUD、監査ログ | `tests/unit/workers/index.test.ts` |
| DB | SQL静的検証、危険DDL検出、FK/索引/監査列確認 | `npm run migrations:check` |
| 依存/脆弱性 | npm audit high以上、SBOM、NOTICES | `npm audit --audit-level=high`, `npm run sbom`, `npm run notices` |
| 出力 | PDF/DXF/CSV、PDF日本語フォント | `tests/integration/pdfExport.test.ts`, `tests/integration/pdfJapaneseFont.test.ts` |
| 本番疎通 | SPA 200 / 無認証API 401 CD-AUTH-001（fail-closed） | スモークテスト（本番URL直接確認） |
| 本番エラー率 | Workers Invocations（GraphQL Analytics） | 直近48h エラー0件（2026-08-01 確認） |
| 本番DB整合 | Neon 全テーブル・FK孤立/重複・監査列・索引 | read-only SQL（2026-08-01 確認、全0件） |
| 監査完全性 | 監査ログ hash chain（entry_hash=SHA-256連鎖）と `GET /api/v1/audit-logs/verify` | Issue #61（2026-08-01 実装） |

## 1.1 リリース後監査で判明した未適用事項（2026-08-01）

| 項目 | 状態 | 対応 |
| --- | --- | --- |
| Workers Observability（ログ保持） | `wrangler.jsonc` に有効化設定を追加済み（PR 内）。**デプロイ後に有効化** | 本番デプロイ時に `settings.observability` を確認 |
| `pg_stat_statements`（スロークエリ監視） | Neon 本番未インストール（`pg_available_extensions` にあり） | 人間承認後に `CREATE EXTENSION pg_stat_statements`（本番DB設定変更） |
| Cloudflare Access ログ / ポリシー監査 | Secret（ACCESS_TEAM_DOMAIN/AUD）未登録のため未確認 | 人間による Access Application 設定と Secret 登録 |
| セキュリティヘッダー | Worker 応答への付与を実装済み（PR 内） | デプロイ後に本番ヘッダー確認 |
| CSP（Content-Security-Policy） | 未適用（フロント検証後に導入判断） | zone レベル Transform Rules で導入予定 |

## 2. 本番公開時に有効化する監視

| 領域 | 監視対象 | 推奨設定 | 承認 |
| --- | --- | --- | --- |
| Cloudflare Workers | 5xx率、CPU時間、例外、リクエスト数 | Workers Analytics + Error Logs | ☐ |
| Cloudflare Access | 認証失敗、許可外アクセス、ポリシー変更 | Access logs / Audit logs | ☐ |
| Neon PostgreSQL | 接続数、クエリ時間、エラー、ストレージ使用量 | Neon Metrics / slow query review | ☐ |
| Object Storage | PUT/GET失敗、署名URL失敗、容量 | Provider metrics | ☐ |
| アプリ監査 | 保存、承認、出力、認証、設定変更 | `audit_logs` ハッシュチェーン永続化 + `GET /api/v1/audit-logs/verify` による改ざん検知（Issue #61） | ☐（本番デプロイ後に確認） |
| CI/CD | quality/e2e/security/compliance失敗 | GitHub branch protection + required checks | ☐ |
| 本番合成監視 | SPA 200 / API 401 CD-AUTH-001 / セキュリティヘッダー | GitHub Actions `synthetic-monitoring.yml`（30分毎）+ 失敗時 Issue アラート | ✅ 導入済み（2026-08-01・2026-08-02 再登録・2026-08-02 真因修正） |
| DB バックアップ | 週次バックアップブランチ作成 | GitHub Actions `backup.yml`（毎週日曜 00:30 JST）+ Artifacts 90日 | ✅ 導入済み（2026-08-01） |

> **2026-08-02 障害記録**: `synthetic-monitoring.yml`（旧 `health-check.yml`）が push 誤トリガーで
> 0 秒失敗を繰り返していた事象は、GitHub Actions 側バグではなく、`--body` の複数行文字列の
> インデント崩れによる **YAML 構文エラー**が原因だった（workflow 名がパス名にフォールバックし、
> トリガー登録が破綻）。インデント修正に加え、CI に `scripts/validate-workflows.py`（全 workflow
> YAML の構文・必須キー検証）を追加し再発を防止する。

## 3. アラート基準案

| 重大度 | 条件 | 一次対応 |
| --- | --- | --- |
| Critical | 認証バイパス疑い、監査ログ書込失敗、DB破損疑い | 公開停止判断、人間承認、障害対応手順へ |
| High | Workers 5xx率が継続、DB接続エラー、出力ジョブ失敗多発 | 直近リリース差分確認、rollback判断 |
| Medium | PDF/DXF/CSV出力の一部失敗、性能劣化、CI赤転 | Issue化、前進修正 |
| Low | UI表示崩れ、文書差分、警告ログ増加 | Backlog化 |

## 3.1 SLO 草案（2026-08-01・合意前の内部目安）

| 指標 | 目標 | 計測 | アラート条件 |
| --- | --- | --- | --- |
| 可用性（SPA 配信） | 99.5%（月間） | 合成監視（30分毎）+ Workers Analytics | 連続2回失敗 |
| API 5xx 率 | < 1%（月間） | Workers Analytics（GraphQL） | 直近1時間で 5xx > 1% |
| 認証 fail-closed 正常性 | 100%（無認証リクエストは 401/503 を返す） | 合成監視（API error.code 検証） | 401 以外の応答 |
| セキュリティヘッダー | 100%（全応答に付与） | 合成監視 | ヘッダー欠落 |
| 監査ログ書込失敗 | 0 件 | API 500（監査flush失敗）・hash chain verify | 失敗検知時は Critical |
| バックアップ | 週1回以上成功 | `backup.yml` 実行結果 | 2週連続失敗 |

> SLO/SLA の対外公開・通知先の確定は人間決裁事項（§5）。上記は内部運用の目安。

## 4. ログ方針

- すべての API 応答に `X-Correlation-Id` を付与する。
- 監査対象イベントは、操作者、対象、結果、相関ID、時刻を保持する。
- Secret、接続文字列、Access JWT、生の個人情報をアプリログに出力しない。
- 本番接続後は `audit_logs` に前後ハッシュを追加し、改ざん検知を有効化する。

## 5. 公開前に残す承認事項

| 項目 | 理由 |
| --- | --- |
| 監視通知先 | 個人/チームの連絡先を含むため人間が決定 |
| SLO/SLA | 契約・運用責任に関わるため人間が決定 |
| Cloudflare/Neon/Object Storage の有料設定 | 課金変更に該当 |
| 本番ログ保持期間 | 法務・監査要件に関わる |

## 6. 関連文書

| 文書 | 用途 |
| --- | --- |
| `docs/operations/incident-response.md` | 障害対応 |
| `docs/operations/rollback-procedure.md` | 切り戻し |
| `docs/operations/release-procedure.md` | リリース手順 |
| `docs/adr/0009-audit-log-hash-chain-workers-neon.md` | 監査ログ永続化方針 |

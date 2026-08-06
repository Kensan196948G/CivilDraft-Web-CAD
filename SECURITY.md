# Security Policy

## 対象範囲

CivilDraft-Web-CAD（Cloudflare Workers API / SPA / Neon PostgreSQL / 監査ログ・認証基盤）。

## 脆弱性の報告

セキュリティ脆弱性を発見した場合は、GitHub の **Security Advisory（プライベート報告）** から報告してください。

- リポジトリ: https://github.com/Kensan196948G/CivilDraft-Web-CAD/security/advisories
- 報告内容: 影響を受けるバージョン・再現手順・想定影響・（可能なら）修正提案

公開Issue・PR・チャットに脆弱性の詳細（PoC・秘密情報）を記載しないでください。

## 対応方針

| 重大度 | 初期トリアージ目標 |
|---|---|
| Critical | 24時間以内 |
| High | 3営業日以内 |
| Medium | 10営業日以内 |
| Low | 30日以内 |

対応は「fail-closed 維持・最小変更・回帰テスト追加・通常PR経路」で行います。

## セキュリティ運用の現状

- API は認証 fail-closed（無認証 401 / 検証不能 503）
- 入力検証・ボディ上限・楽観ロック DB 強制・監査ハッシュチェーン
- セキュリティヘッダー5種・`npm audit` / secret scan / SBOM を CI で強制
- 詳細: `docs/operations/monitoring-readiness.md` / `docs/assessment/system-assessment-2026-08-03.md`


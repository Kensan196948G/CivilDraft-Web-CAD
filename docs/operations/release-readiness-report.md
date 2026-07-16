# リリース準備レポート

作成日: 2026-07-16

## 1. 判定

現時点のローカル検証では、フロントエンド、Workers API 検証実装、DBマイグレーション静的検証、
CI設定、運用文書、依存/ライセンス証跡はリリース判断に提出できる水準まで整備済み。
本番デプロイ、Git push、PRマージ、タグ作成、Secret設定、Neon本番適用、DNS変更は未実行。

## 2. 実行済みレビュー

| 種別 | 実施内容 | 結果 |
| --- | --- | --- |
| コード/設計レビュー | TODO、旧Phase表現、CI、DB、運用文書、Worker API、テストを横断確認 | 実装と文書の不整合を修正 |
| 独立レビュー | サブエージェントで完了条件に対する証跡ギャップを確認 | 本番DB/Storage/CI未反映を残ゲートとして明文化 |
| セキュリティレビュー | `npm run secret:scan` | 高信頼 secret 候補 0 |
| 依存監査 | `npm audit --audit-level=high` | high以上 0 |
| ライセンス確認 | `npm run notices` | 21パッケージ、copyleft系検出なし |
| DBレビュー | `npm run migrations:check` | 1 SQLファイル pass |

## 3. 品質ゲート結果

| ゲート | 結果 |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run migrations:check` | pass |
| `npm test` | pass: 97 files / 1060 tests |
| `npm run e2e` | pass: 2 tests |
| `npm run build` | pass |
| `npm audit --audit-level=high` | pass: 0 vulnerabilities |
| `npm run sbom` | pass |
| `npm run notices` | pass |
| `npm run secret:scan` | pass: high-confidence findings 0 |
| `npm run release:audit` | pass: 97 files / 1060 tests, 2 Playwright tests, build, audit, SBOM, NOTICES deterministic check, secret scan |

補足: `docs/operations/pre-release-checklist.md` は、Codex が完了できるローカル検証項目と
人間承認が必要な本番前ゲートを分離して更新済み。

## 4. WebUI確認

| 項目 | 値 |
| --- | --- |
| 起動コマンド | `npm run dev -- --host 0.0.0.0 --port 5174` |
| Local URL | `http://127.0.0.1:5174/` |
| LAN URL | `http://172.23.10.251:5174/` |
| 待受 | `0.0.0.0:5174` |
| 起動PID | `41532` |
| 停止方法 | `Stop-Process -Id 41532` |
| 応答確認 | Local / LAN ともに HTTP 200 |

## 5. GitHub状態

| 項目 | 確認結果 |
| --- | --- |
| Repository | `Kensan196948G/CivilDraft-Web-CAD` |
| Open PR | `#34 feat: CAD Editor.dc.htmlをCadEditorPageとして実装、Sidebarと統合` |
| Open Issue例 | `#33 CAD Editor画面をCAD Editor.dc.htmlモックアップに100%準拠実装` |
| Projects更新 | Project #44 README にローカル検証状況を反映済み |
| PR更新/CI | コード差分は未pushのため未実行 |

## 6. 残課題・リスク

| 領域 | 内容 | 対応方針 |
| --- | --- | --- |
| 本番DB | Neon本番ブランチ未適用 | 人間承認後、devブランチ検証から実施 |
| Object Storage | 図面/PDF恒久保管未接続 | 署名URL方式を承認後に接続 |
| Workers API | 現在はインメモリ検証実装 | DB/Storage/Secret接続は承認後 |
| 監視 | 外部監視・通知先・SLO未設定 | `monitoring-readiness.md` に従い公開時に決定 |
| バンドルサイズ | PDF/DXF/fontkit を遅延読み込み・手動チャンク化し、Vite warning なし | 継続的に `npm run build` で確認 |
| GitHub反映 | コード差分の push / PR 更新は未実行 | 人間承認後に commit/push し、PR #34 へ反映 |
| ブラウザE2E | Playwright スモークは導入済み。本番DB/Storage接続後の永続化・障害系E2Eは未実行 | 接続承認後に追加検証 |
| 本番障害系 | DB/Storage未接続のため本番相当障害系は未実行 | 接続承認後に追加検証 |

## 7. 本番デプロイ手順

1. PR差分と本レポートを人間が確認する。
2. `npm ci && npm run lint && npm run typecheck && npm run migrations:check && npm test && npm run e2e && npm run build && npm audit --audit-level=high` を再実行する。
3. `npm run sbom && npm run notices` を再実行し、差分を確認する。
4. Neon dev ブランチで `migrations/0001_initial_schema.sql` を適用検証する。
5. Cloudflare Access、Workers Secret、Object Storage、Neon接続を人間承認で設定する。
6. 人間が `npx wrangler deploy` を実行する。
7. 発行URLでホーム、CAD編集、PDF/DXF/CSV出力、監査ログ、認証を確認する。

## 8. ロールバック手順

1. 原因PRまたはリリースタグを特定する。
2. 原因が明確な場合は `git revert` で打ち消しPRを作成する。
3. 複数変更が絡む場合は直前タグを `git switch --detach <tag>` で確認し、再ビルドする。
4. DB接続後は Neon dev/main ブランチ差分と PITR 方針に従い、人間承認で復旧する。
5. 切り戻し後も `npm run lint && npm run typecheck && npm run migrations:check && npm test && npm run e2e && npm run build` を通す。

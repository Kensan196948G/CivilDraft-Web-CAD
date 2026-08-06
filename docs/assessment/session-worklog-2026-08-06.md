# CivilDraft-Web-CAD 本番完成セッション作業記録 (2026-08-06)

## 📌 目的

ユーザー指示（/goal）に基づき、リポジトリ全体を精査し、本番運用可能な状態まで完成させる。
完了条件: P0ゼロ / P1解消または管理可能な残課題化 / 選定機能の受入条件達成 / CI全緑 /
本番確認・rollback・監視・運用引継ぎ成立 / GO判定の提出。

## 🔧 初期環境・ベースライン検証（2026-08-06 JST）

| 検証項目 | 結果 |
|---|---|
| `npm run lint` | PASS（0エラー・1警告: react-refresh/only-export-components @ CadEditorPage.tsx:73） |
| `npm run typecheck` | PASS |
| `npm run migrations:check` | PASS（migration 5本） |
| `npm test` | PASS 113ファイル / 1300テスト（2 skip = Neon実接続統合・接続文字列未設定） |
| `npm run build` | 未実施（本セッション内で再実行予定） |
| GitHub CI | main最新push（2026-08-04）全ジョブSUCCESS / Production Health Check 30分毎 success継続 |
| ブランチ保護 | enforce_admins=true / required_approving_review_count=0 / 必須チェック4件 |
| gh auth | Kensan196948G（gist/read:org/repo/workflow） |
| wrangler | ログイン済み（Account 4f1e888469df7e0b896bb4e211b12633・CLOUDFLARE_API_TOKEN） |
| wrangler dry-run | PASS（ASSETS + CIVILDRAFT_API_MODE=neon-r2 binding確認） |

## 🗺️ Plugin / Skill / MCP 棚卸し（目的別対応表）

| 目的 | 利用手段 | 状態・制約 |
|---|---|---|
| GitHub（Issue/PR/CI/Projects） | gh CLI（repo/workflowスコープ）+ github MCP app | Projectsは read:project スコープ不足のため更新不可（既知の制約） |
| Cloudflare Workers（デプロイ/監視） | wrangler CLI + cloudflare skills | ログイン済み・deploy可能。Rate Limiting bindingは課金/インフラ変更のため人間承認必須（Issue #115） |
| Neon PostgreSQL | neon-postgres skill + scripts/neon-backup.mjs等 + read-only SQL | 接続文字列はSecret。実接続統合テストは環境変数未設定でskip |
| セキュリティ | codex-security skills + scripts/secret-scan.mjs | 必要時に使用 |
| デザイン | .design-sync / .ds-sync（Claude Design bundle） | UI変更時に既存トークン/規約を参照 |
| コード探索 | rg / git（codebase-memory-mcpは本環境に未接続のためAGENTS.md記載の優先順位は実用不能） | — |
| その他スキル | imagegen / wowerpoint等 | 本タスクに不適合のため未使用 |

## 📋 オープンIssue評価（2026-08-06時点・22件）

### P1

| Issue | 状態 | 本セッション方針 |
|---|---|---|
| #36 本番バックエンド接続 | ✅ ほぼ解消（本番デプロイ済み・JWT検証実装済み）。残: Access Secret登録・Access Application設定（人間決裁） | 証跡整理してクローズ判断・残課題は人間決裁キューへ |
| #37 CAD編集コア機能のUI配線 | ✅ 実装済みの可能性が高い（EDITING_TOOLS 9種+パラメータUI+Undo統合を確認） | 受入基準を検証し、充足ならクローズ |
| #38 文字・寸法・ハッチングUI | 🟡 文字/ハッチはUI実装済み・寸法は要検証 | 検証して残差分のみ対応 |
| #114 Neon永続化層の述語付きSQL再設計 | ❌ 未対応（High: 全件SELECT/楽観ロック未強制/監査チェーン並行分岐） | **委任実装（backend-persistence）** |
| #117 Ctrl+Z二重発火 | ❌ 未対応（リスナー二重登録をコード確認済み） | **委任実装（frontend-cad-ui）** |

### P2 / P3（主要）

| Issue | 方針 |
|---|---|
| #118 README/UI乖離 + DXF取込UI配線 | **委任実装（frontend-cad-ui）** |
| #45 Playwright E2E整備 | **委任実装（qa-perf-e2e）** |
| #63 大規模図面性能CI閾値 | **委任実装（qa-perf-e2e）** |
| #62 サンプルデータ除去 | 🟡 各画面で「サンプル」明示済み・HomePageはデモ台帳のまま。本番APIはAccess Secret待ちのため、実データ化は人間決裁後。デモ明示UIの最小改善をLeadで実施 |
| #115 Rate Limiting | 設計+アプリ層レート制限をLead検討。binding追加は人間承認必須のためバックログ |
| #116 数量明細state化 | 設計書+バックログ化（P2・構造変更） |
| #119 メンバー管理API | backend-persistence のスコープに含める（#114と同一ファイル群） |
| #120 キャンバスA11y | バックログ化（P3）※#117実装後に評価 |
| #23/#24/#25 幾何バグ系 | 調査・バックログ化（P2） |
| #26 バンドル最適化 / #38残 / #39/#40/#41/#43/#44/#46/#47/#58/#60 | バックログ化（P2/P3） |

## 🤖 委任構成（ファイル所有権を分離）

| エージェント | 担当Issue | 所有ファイル | 検証方法 | 停止条件 |
|---|---|---|---|---|
| backend-persistence | #114 + #119 | `src/workers/*`・`tests/unit/workers/*`・`docs/adr` | 対象テスト+全テスト/lint/typecheck/build | 同一原因2回・修復3回でBlocked報告 |
| frontend-cad-ui | #117 + #118 | `src/app/pages/CadEditorPage.tsx`・`src/app/canvas/CanvasStage.tsx`・関連テスト・README該当行 | 対象テスト+全テスト/lint/typecheck/build | 同上 |
| qa-perf-e2e | #45 + #63 | `tests/e2e/*`・`tests/performance/*`・`scripts/*`・`.github/workflows/ci.yml` | Playwright実行+CI用スクリプト単体検証 | 同上 |

Lead（/root）: 統合・レビュー・#62デモ明示・#115設計・文書/state同期・マージ/デプロイ/本番確認。

## 🔒 保護対象（ユーザー変更）

- `CLAUDE.md`（作業ツリー未コミット変更）
- `.claude/START_PROMPT.md`（同上）
- 既存worktree・ブランチ・タグ

上記は変更・コミット対象としない。作業は新規ブランチでのみ行う。


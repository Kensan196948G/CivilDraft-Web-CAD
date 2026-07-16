# リリース前チェックリスト

このチェックリストは、CivilDraft を公開判断に渡す前の最終確認用です。
Codex は準備と検証までを行い、公開、タグ付け、Secret 設定、本番DB接続は人間が実行します。

最終更新: 2026-07-16

## 1. Codex 検証済み項目

| 項目 | 確認内容 | 状態 | 証跡 |
| --- | --- | --- | --- |
| 画面 | ホーム、案件詳細、CAD編集、図面設定、測点、部材、照査・承認、印刷・出力、監査ログ、システム設定が操作できる | 完了 | `tests/unit/app/AppNavigation.test.tsx`、各ページテスト |
| CAD編集 | グリッド初期表示、パン、ズーム、選択、Undo/Redo、PDF/DXF/CSV出力、DXF取込が主要ケースで動く | 完了 | Canvas/Store/DXF/PDF/PrintExport の単体・結合テスト |
| ワークフロー | 照査依頼、照査、承認、差戻し、廃止が状態遷移として確認できる | 完了 | `tests/unit/app/pages/ReviewApprovalPage.test.tsx`、`tests/unit/domain/revisions/workflow.test.ts` |
| Workers API | `src/workers/index.ts` の検証APIが 501 を返さず、認証ヘッダー、相関ID、監査イベントを扱う | 完了 | `tests/unit/workers/index.test.ts` |
| 永続化境界 | 本番DB/Storage接続をまだ有効化していないことを確認する | 完了 | `wrangler.jsonc` は Static Assets のみ。本番DB/Storage binding なし |

## 2. 品質ゲート

| 項目 | コマンド | 合格条件 | 状態 |
| --- | --- | --- | --- |
| Lint | `npm run lint` | ESLint エラー 0 | 完了 |
| 型検査 | `npm run typecheck` | TypeScript エラー 0 | 完了 |
| テスト | `npm test` | Vitest 全件 pass | 完了: 97 files / 1062 tests |
| ブラウザE2E | `npm run e2e` | Playwright スモーク全件 pass | 完了: 2 tests |
| ビルド | `npm run build` | `dist/` 生成成功 | 完了: Vite chunk warning なし |
| マイグレーション静的検証 | `npm run migrations:check` | SQL構造・FK・索引・危険DDLチェック成功 | 完了 |
| 依存監査 | `npm audit --audit-level=high` | high 以上 0 件 | 完了 |
| 高信頼 secret scan | `npm run secret:scan` | 高信頼 secret 候補 0 件 | 完了 |
| リリース一括監査 | `npm run release:audit` | ローカル品質ゲート、Playwright E2E、SBOM/NOTICES決定性チェック、secret scan が完走 | 完了 |

## 3. 成果物

| 項目 | コマンド / 確認先 | 状態 |
| --- | --- | --- |
| SBOM | `npm run sbom` | 完了 |
| サードパーティ表記 | `npm run notices` | 完了、copyleft 系検出なし |
| README | 実装状態、API状態、制限事項が最新 | 完了 |
| 運用文書 | `docs/operations/*` が現在の構成と矛盾しない | 完了 |
| 監視準備 | `docs/operations/monitoring-readiness.md` に公開時の監視・通知・SLO未決事項を明示 | 完了 |
| Static Assets 設定 | `wrangler.jsonc` が `dist/` 配信のみを定義している | 完了 |
| GitHub Projects | Project #44 README に進捗と残ゲートを反映 | 完了 |

## 4. 未実行の追加ゲート

以下は現時点で未実行です。本番公開の最終判断では、人間承認のもとで実施可否を決めます。

| 項目 | 状態 | 理由 |
| --- | --- | --- |
| 本番永続化E2E | 未実行 | Playwright スモークは導入済み。本番DB/Storage接続後の永続化・障害系は未検証 |
| 本番相当DB適用 | 未実行 | Neon dev/main への接続とマイグレーション適用は人間承認が必要 |
| 本番Storage障害系 | 未実行 | Object Storage 未接続のため、署名URL/保存失敗系は接続後に検証 |
| GitHub Actions 実行 | 未実行 | ローカル差分は未pushのため、PR #34 にはまだ反映していない |

## 5. 本番前の人間決裁

以下は Codex が自動完了しない境界です。公開判断時に人間が実行・承認します。

| 境界 | 人間確認 |
| --- | --- |
| `git commit` / `git push` / tag / release | 未実行 |
| PR #34 更新、CI success、レビュー承認 | 未実行 |
| `wrangler login` / Cloudflare リソース作成 | 未実行 |
| Workers API の本番経路有効化 | 未実行 |
| Neon PostgreSQL 接続とマイグレーション適用 | 未実行 |
| Workers Secret / Access ポリシー設定 | 未実行 |
| 外部公開 URL / カスタムドメイン切替 | 未実行 |

## 6. 最終判定

ローカル検証、成果物生成、文書更新、GitHub Projects 更新は完了。
ただし、本番相当DB/Storage障害系、PR反映後のGitHub Actions は未実行。
本番デプロイ直前判定に進むには、人間承認のもとで未実行ゲートの扱いを確定する。

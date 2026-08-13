# Changelog

本プロジェクトの変更履歴（Keep a Changelog 形式）。詳細は各PR・README・`docs/assessment/` を参照。

## [Unreleased]

### 改善
- 2026-08-13: MVP 用の詳細ダミーデータ 10 件を実装（`src/app/demoProjects.ts`）
  - 架空案件 10 件（進行中 3 / 照査待ち 2 / 承認待ち 2 / 承認済み 2 / 差戻し 1）に、図面・メンバー・アクティビティ・住所/電話/契約金額等を詳細定義
  - ホーム（一覧・検索・KPI・ステータス分布・最近開いた図面）と案件詳細が同一データを参照し、案件行クリックで各案件の詳細へ遷移
  - 空図面（0件）・差戻し・照査滞留（3日以上）・非公開金額など、正常系・境界・代表的な異常系を確認可能
  - 人名・会社・住所・電話・メールはすべて架空値（住所「架空・デモ用」・電話「00-0000-0000（デモ用）」・メール `@example.jp`）
  - データ整合性テスト追加（10件・ID一意・メンバー参照整合・ステータス内訳・最近図面の導出）
- 2026-08-13: MVP完成セッション（詳細は `docs/assessment/session-worklog-20260813.md`）
  - 照査・承認画面の実改訂データ連携（`GET /api/v1/revisions/{id}` → `POST workflow-actions`。最終認可はサーバー側・Access JWT）
  - クライアント `submitWorkflowAction` メソッド追加（`CloudWorkflowAction*` 型・往復テスト）
  - 案件詳細（実データ版）の「最近のアクティビティ」を監査ログ API（`GET /api/v1/audit-logs?projectId=`）へ接続
  - ホームに案件ステータス分布チャート（KPI 可視化・`role="img"` + `aria-label`）
  - テスト 8 件追加（計 1555 pass / 2 skip）
  - `docs/operations/mvp-preview.md`（公開 URL・デモ手順・MVP サブドメイン追加手順）新設、README の CI 実態・公開 URL を実態同期
- 2026-08-13: MVP/Prototype サブドメイン `civildraft-web-cad-mvp.mirai-dx-platform.com` を追加（ユーザー承認）
  - Cloudflare Workers custom domain attach（`PUT /accounts/{account_id}/workers/domains`・Worker `civildraft-web-cad`・DNS プロキシレコード自動生成）
  - 実測: SPA 200 / `?demo=1` 200 / `/api/health` 401 `CD-AUTH-001`（fail-closed）
  - Cloudflare Access 適用は「Access policy 変更」のため人間承認待ち（`state.json` pending item・`docs/operations/mvp-preview.md` 実測記録）
- 2026-08-12: 総合評価・改善（詳細は `docs/assessment/comprehensive-evaluation-2026-08-12.md`）
  - **重大修正: migration 0007 のFK列型を uuid→text へ修正**（0004適用後のスキーマと不一致で本番適用時に失敗する問題。適用前のため前方修正で対応）
  - ハッシュベースURLルーティング（`#/<view>`・editorセッション/projectId保持）でブックマーク・戻る/進む・deep link対応
  - モバイルサイドバーa11y（Escape閉じ・背面オーバーレイ・フォーカス復帰）
  - react-refresh警告解消（`DEFAULT_CLOUD_DRAFT_SESSION`を`cloudDraftSession.ts`へ分離）
  - README・architecture overview・operations manual の実態同期（Access本番適用・Neon接続済み等）
  - アクティブナビ項目へ `aria-current="page"` を付与
- 503 fail-closed 応答の本文を汎用文言化（binding名・環境変数名を非開示）
- CI: GitHub Actions を commit SHA 固定（checkout/setup-node/upload-artifact v4 系）
- CI: カバレッジ閾値ゲート導入（lines 85% / stmts 85% / funcs 80% / branches 75%）
- `CONTRIBUTING.md` / `SECURITY.md` / `CHANGELOG.md` 新設
- ライセンス選定の判断資料 `docs/operations/license-decision.md` 追加（選定は人間決裁）

## [v0.1.19] - 2026-08-06

### 🚀 本番デプロイ（Worker Version `aa76014d`・commit `95bdb68`）

### 追加
- #119: プロジェクトメンバー管理API（GET/POST/PATCH/DELETE・manager認可・最後のmanagerガード・監査記録）
- #118: DXF取込UI配線（ヘッダー「📥 取込」・Undo可能な1操作）
- #45/#63: PlaywrightライフサイクルE2E・性能ベンチマーク・CI閾値監視・DXF取込ゴールデン/10k性能E2E
- #124: ホーム画面のデモデータ明示バナー

### 修正
- #117: Ctrl+Z/Y二重発火解消（リスナー一元化）
- #114: Neon永続化層の述語付きSQL再設計（Phase1 スコープ付きロード / Phase2 リビジョン読み取りSQL-first / Phase3 楽観ロックDB強制 / Phase4 監査ハッシュチェーン直列化（migration 0006））
- #129: PDF出力メタデータ決定性（CI flaky解消）
- #36/#37/#38/#40: 受入基準充足を証跡付きでクローズ

## [v0.1.18] - 2026-08-04

### 追加・修正
- 図面健全性チェック第二弾（Issue #59）: 未接続数量/stale数量/未対応DXF要素/デフォルトレイヤー配置/未承認改訂の5チェック
- actorId偽装対策・リクエストボディ上限・依存更新（PR #113）
- Worker Version `a959db6f` として本番デプロイ

## [v0.1.17] - 2026-08-02

### 追加
- コマンドパレット（Ctrl/Cmd+K・WAI-ARIA combobox）・Delete削除・数字キーツール切替（#47）
- 合成監視workflowのYAML構文エラー修正＋workflow検証をCIへ追加

## [v0.1.16] - 2026-08-02

### 追加
- キーボードショートカット（Ctrl/Cmd+Z/Y・Esc）・ツールバーA11y

## [v0.1.15] - 2026-08-02

### 追加
- 図面健全性チェック（Issue #59 第一弾）: 不明レイヤー/用紙外/非表示レイヤー検出

## [v0.1.14] - 2026-08-02

### 修正
- 線種のDXF往復強化（linetype(6)・lock/frozenフラグ(70)）

## [v0.1.13] - 2026-08-02

### 追加
- Neonバックアップのリストア検証（restore-check）

## [v0.1.12] - 2026-08-01

### 追加
- 本番合成監視（30分毎ヘルスチェック・失敗時Issueアラート）＋SLO草案

## [v0.1.11] - 2026-08-01

### 追加
- Neon週次バックアップ自動化（ブランチ方式・Artifacts 90日）

## [v0.1.10] - 2026-08-01

### 追加
- 監査ログのフィルタ＋カーソルページング（#85）

## [v0.1.9] - 2026-08-01

### 追加
- 工種別レイヤーテンプレート5種（#40）

## [v0.1.8] - 2026-08-01

### 追加
- 数量⇔図形連動第二弾（図形クリック→明細ハイライト・#42完了）

## [v0.1.7] - 2026-08-01

### 追加
- 数量⇔図形連動第一弾（明細→根拠図形ハイライト）

## [v0.1.6] - 2026-08-01

### 修正
- ロック済みレイヤーの編集禁止を全経路で強制（#40）

## [v0.1.5] - 2026-08-01

### 追加
- 監査画面のAPI接続・hash chain検証表示（#61完了）

## [v0.1.4] - 2026-08-01

### 追加
- 監査ログhash chain実装（ADR-0009）

## [v0.1.3] - 2026-08-01

### 修正・追加
- object_provider='unassigned'（#74）・actorId JWT採用（偽装対策）・セキュリティヘッダー5種・Workers Observability有効化

## [v0.1.2] - 2026-07-22

### 修正
- quantity_items削除同期漏れ（#73）

## [v0.1.1] - 2026-07-22

### 追加
- persistX複合書き込み5種の単一トランザクション化（#68）

## [v0.1.0] - 2026-07-15

### 初期リリース
- Web CAD 基盤（作図・編集・Undo/Redo・空間索引・自動保存・PDF/DXF/CSV出力・Worker API・認証・監査ログ）

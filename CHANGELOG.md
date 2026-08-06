# Changelog

本プロジェクトの変更履歴（Keep a Changelog 形式）。詳細は各PR・README・`docs/assessment/` を参照。

## [Unreleased]

### 改善
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


# Changelog

本プロジェクトの変更履歴（Keep a Changelog 形式）。詳細は各PR・README・`docs/assessment/` を参照。

## [Unreleased]

### 修正
- 2026-08-14: 作図中に印刷・出力など他画面へ移動して戻ると作図内容が消える問題を修正
  - 同一図面の再マウント（シードキー一致）では既読込内容を保持し、別図面を開いた場合のみ置換するように改善

### 追加
- 2026-08-14: 作図機能の正常性E2Eを追加（`tests/e2e/drafting-correctness.spec.ts`）
  - 新規作図: ガイド線・線分/円/矩形の描画・Undo/Redo・ガイド線切替・DXF出力（LINE/CIRCLE）・自動保存→復元
  - 作図編集: 案件図面の読込・追記・Undo・レイヤー切替・DXF出力
  - dev と本番ビルド（`playwright.prod.config.ts`）の両方で実行

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `c7021c57`・main `2c9702c`）

- 図形描画の最終根因（RulerをKonva Stage内に配置していた）を修正した #208 を `npx wrangler deploy` で本番反映
- dev / 本番ビルド両方の Browser E2E で、図形読込・ガイド線・ページ/Konvaコンソールエラーゼロを実ブラウザ検証
- 実測: MVP/workers.dev は SPA 200（新規作図/作図編集・ガイド線を含む新バンドル）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `a4244ab6` へ rollback 可能

### 修正 / 追加
- 2026-08-14: サイドバーとKonva登録の最終対応
  - サイドバーを全セクション初期展開に変更し、「CAD作図/CAD編集」を「新規作図/作図編集」へリネーム（作図導線が見えない問題を解消）
  - `registerKonvaNodes` で Konva Core のレジストリへ形状クラスを明示代入（副作用importだけに頼らない保険）
  - Service Worker v2 のfetchハンドラを修正（ナビゲーションはSWを介さず、FetchEventのnetwork errorを解消）
  - E2EにKonva系コンソールエラー検出を追加

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `a4244ab6`・main `c0a1986`）

- Service Worker v2（HTML非キャッシュ）とE2E内容検証（#206）を `npx wrangler deploy` で本番反映
- 実測: MVP/workers.dev は `sw.js` v2 配信（HTMLキャッシュなし）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `965335d9` へ rollback 可能

### 修正
- 2026-08-14: Service Workerの旧バンドル配信を防止し、E2Eで図形投入を直接検証
  - `public/sw.js` を v2 へ更新: HTMLはキャッシュしない（`Cache-Control: no-store` を尊重）。ハッシュ付きアセットのみキャッシュ。旧キャッシュはactivate時に削除
  - E2Eに「デモ図面を読み込みました（図形N件）」「新規図面のガイド線を表示しました（図形4件）」の表示検証を復元（シード実行と描画状態を実ブラウザで確認）

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `965335d9`・main `5e2fa71`）

- Konvaノード登録・bufferCanvas競合・CSP・ヘッダー折返し修正（#204）を `npx wrangler deploy` で本番反映
- dev / 本番ビルド両方の Browser E2E で、案件→図面→CAD編集で開く・CAD作図ガイド線・左パネル折りたたみを実ブラウザ検証（ページエラーゼロ）
- 実測: MVP/workers.dev は SPA 200（`Cache-Control: no-store`・CSPにCloudflare Insights許可）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `c8fafc4a` へ rollback 可能

### 修正 / 追加
- 2026-08-14: 本番ビルドで図形が描画されない問題を修正（Konvaノード登録）
  - 本番ビルドでKonvaのLine/Text等が未登録になり図形が描画されない問題に対し、使用形状モジュールを副作用importで明示登録（`src/app/canvas/registerKonvaNodes.ts`）
  - 本番ビルド専用のPlaywright E2E（`playwright.prod.config.ts`）とCI実行を追加し、ページエラーゼロを検証
  - CSPの`script-src`へCloudflare Insights（`static.cloudflareinsights.com`）を追加しビーコン遮断エラーを解消
  - CAD編集ヘッダーを折り返し対応（縦長ウィンドウでボタンが切れないように）

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `c8fafc4a`・main `15eb150`）

- HTMLの `Cache-Control: no-store` 強制化と本番実図面のCAD編集有効化（#201/#202）を `npx wrangler deploy` で本番反映
- 実測: MVP/workers.dev の HTML 応答が `no-store, no-cache, must-revalidate`・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `f13828f3` へ rollback 可能

### 修正 / 追加
- 2026-08-14: キャッシュ起因の旧バンドル表示と本番実図面のCAD編集を解消
  - WorkerのSPA index.html応答に `Cache-Control: no-store` を付与し、デプロイ後に古いバンドルが残らないようにした（ハッシュ付きJS/CSSは従来キャッシュを維持）
  - 本番（実案件）の図面詳細で、改訂のある図面は「CAD編集で開く」を有効化し、改訂IDを含むセッションでCAD編集へ遷移（改訂が無い図面のみ無効＋理由表示）

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `32570629`・main `982c2ba`）

- ガイド線全モード表示・左ツールパネル折りたたみ整理（#199）を `npx wrangler deploy` で本番反映
- Browser E2E 3件（案件→図面→CAD編集で開く / CAD作図ガイド線・切替 / 左パネル折りたたみ）が実ブラウザで成功
- 実測: MVP/workers.dev は SPA 200（新バンドル）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `2b26488a` へ rollback 可能

### 修正 / 追加
- 2026-08-14: 新規作図ガイド線の全モード表示と左パネル整理
  - 新規作図（blank）はデモ表示か否かに関わらずガイド線を初期表示（本番ドメインのCAD作図でも同様）。ガイド線を視認しやすい実線・太線へ変更
  - CAD編集/CAD作図の左ツールパネルを折りたたみ式セクションに整理（作図・編集/編集/レイヤーは既定表示、スナップ/コマンドライン/土木部材は折りたたみ）
  - E2E追加: 案件→図面→CAD編集で開くで図形読込、CAD作図でガイド線表示・切替、左パネル折りたたみ（CI Browser E2Eで実ブラウザ検証）

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `2b26488a`・main `d6bcc96`）

- 図面選択時の置換修正・新規作図ガイド線（#197）を `npx wrangler deploy` で本番反映
- 実測: MVP/workers.dev は SPA 200（新バンドルにガイド線表示・切替を確認）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `188149b7` へ rollback 可能

### 修正 / 追加
- 2026-08-14: 図面選択時の表示と新規作図のガイド線
  - 案件図面（`P-DEMO-*`）や新規作図（`NEW-*`）は、既に読み込まれた内容があっても対象図面のサンプル図形へ置換するよう修正（別図面を選択しても前の図面が残る問題を解消）
  - 新規作図（blank）にグリッド内のガイド線（水平線・垂直線・枠・注記）を投入。専用レイヤー「ガイド線」に配置し、ヘッダーの「ガイド線」ボタンとレイヤーパネルから表示/非表示を設定可能

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `188149b7`・main `6f7758b`）

- CAD編集の図形全体表示・シード上書き防止・ヘッダーずれ修正（#195）を `npx wrangler deploy` で本番反映
- 実測: MVP/workers.dev は SPA 200（新バンドル配信）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `c17f6d1c` へ rollback 可能

### 修正
- 2026-08-14: CAD編集の表示不具合を修正
  - サンプル図形（mm座標）投入後に `zoomFit` で全体表示し、「CAD編集で開く」で図形が画面外になって空に見える問題を解消
  - デモモードのシードがホームの復元候補など既に読み込まれた内容を上書きしないようガード
  - ヘッダーの「図面」セレクトを右側グループへ移動し幅を制限、案件名・図面名に省略表示を追加して上部レイアウトのずれを是正

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `c17f6d1c`・main `9dd7756`）

- 案件テーマ別サンプル2DデータとSVGプレビュー（#193）を `npx wrangler deploy` で本番反映
- 実測: MVP/workers.dev は SPA 200（共有チャンク `demoDrawingContents-*.js` に10テーマの図形生成、図面詳細にプレビュー）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `07840345` へ rollback 可能

### 追加
- 2026-08-14: 案件の内容に応じたサンプル2Dデータの投入・表示
  - `DemoProject.theme`（10テーマ: 道路拡幅/ポンプ場/植栽・舗装/調整池/雨水幹線/橋脚/歩道/護岸/法面/トンネル坑口）を追加し、`createDemoDrawingContent` が案件番号・テーマ・図面名に応じた図形を生成
  - CAD編集での初期表示も案件コンテキスト（テーマ・図面名）を反映
  - `DemoDrawingPreview`（SVG）を新設し、案件詳細の図面詳細でエディタを開かずにサンプル2Dデータをプレビュー表示

### 🚀 本番デプロイ（2026-08-14 JST・Worker Version `07840345`・main `13f946e`）

- CAD作図ナビ・デモ図面切替・デモ時の編集権限修正（#191）を `npx wrangler deploy` で本番反映
- 実測: MVP/workers.dev は SPA 200（新バンドルに CAD作図 / 新規図面 / デモ図面を開く セレクト）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `9fd0bc87` へ rollback 可能

### 追加
- 2026-08-14: サイドバー「作図」に「CAD作図」を追加し、新規作図・既存図面編集を実装
  - 「CAD作図」→ 新規図面（空白）のCAD編集画面を開く。CAD編集画面ヘッダーの「図面」セレクトでデモ10案件・59図面の切替が可能
  - 図面切替は `CloudDraftSession` を再構築して図面種別ごとのサンプル図形を再読込（`src/app/pages/cloudDraftSession.ts` の `createNewDraftSession` / `src/app/demoDrawingContents.ts` の `blank` 種別）
  - **修正**: デモ表示（MVP/Preview URL・`?demo=1`）では Access 未ログインでもロールを engineer に解決し、「CAD編集で開く」等の編集導線・編集系サイドナビを表示（本番ドメインは従来どおり viewer フォールバック）

### 🚀 本番デプロイ（2026-08-13・Worker Version `9fd0bc87`・main `434e1e5`）

- 図面ごとのダミー図形（#189）を `npx wrangler deploy` で本番反映
- 実測: MVP/workers.dev は SPA 200（CadEditorPage チャンクに種別5系統の図形生成を含む）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `ec55b342` へ rollback 可能

### 追加
- 2026-08-13: 図面ごとのダミー図形を追加（`src/app/demoDrawingContents.ts`）
  - デモ案件の図面を CAD エディタで開くと、種別ごとのサンプル図形（線/矩形/円/円弧/ポリライン/寸法/文字/引出線/ハッチ/シンボル・種別コード5種）を初期表示
  - 施工ヤード図・仮設計画図・土工断面図・数量根拠図・汎用サンプルの5系統、図面番号から決定的にバリエーション生成
  - 図面番号単位の再投入防止（利用者の作図内容を保持）・整合性テスト追加

### 🚀 本番デプロイ（2026-08-13・Worker Version `ec55b342`・main `ef88ada`）

- ユーザー承認済みの `npx wrangler deploy` で、MVP 用ダミーデータ 10 件（#186）と MVP/Preview URL での既定デモ表示（#187）を本番反映
- 同時に #183-#186（照査・承認の実 API 結線 / 案件活動履歴 / ホーム KPI チャート）も反映
- 実測: MVP/workers.dev は SPA 200（10 件のデモデータを含む新バンドル）・`/api/health` 401 fail-closed、本番ドメインは 302 → Cloudflare Access（保護維持）
- 直前バージョン `2fa2cd25`（v0.1.25）へ rollback 可能

### 改善
- 2026-08-13: MVP/Preview URL でダミーデータ10件を既定表示（`src/app/mode.ts`）
  - MVP サブドメイン `civildraft-web-cad-mvp.mirai-dx-platform.com` と workers.dev ではクエリ無しでデモ表示
  - 本番ドメイン `civildraft-web-cad.mirai-dx-platform.com` は実案件データのみを維持（挙動変更なし）
  - HomePage / ProjectDetailPage のデモ判定を共有ヘルパー `isDemoMode()` へ統一、判定テスト追加
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

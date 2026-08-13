# 🚀 MVP / Prototype 確認URLとデモ手順

関係者レビュー用の MVP/Prototype 環境・URL の分離方針と、架空ダミーデータによる操作・評価手順を定義する。

## 1. URL 構成

| 用途 | URL | 状態 |
| --- | --- | --- |
| 本番 | `https://civildraft-web-cad.mirai-dx-platform.com` | 稼働中。Cloudflare Access で保護（未認証は 302 → Access ログイン）。実案件データのみ表示（サンプル非表示） |
| プレビュー（暫定） | `https://civildraft-web-cad.kensan1969.workers.dev` | SPA 表示可（HTTP 200）。API は認証 fail-closed（401 `CD-AUTH-001`）のため、ブラウザ内デモ・ローカル保存の確認に限定 |
| MVP/Prototype（計画） | `https://civildraft-web-cad-mvp.mirai-dx-platform.com` | カスタムドメイン追加（公開 DNS 変更）は人間承認待ち。手順は §2 |

> 本番 URL は既存サブドメイン＋規定ドメイン、MVP 用は `civildraft-web-cad-mvp` サブドメイン＋同一ドメインとして分離する方針。

## 2. MVP 用サブドメイン追加手順（人間承認後に実施）

目的: `civildraft-web-cad-mvp.mirai-dx-platform.com` を本番とは識別できるレビュー導線として公開する。

前提: zone `mirai-dx-platform.com` が本番 Worker と同一の Cloudflare アカウント（Account ID `4f1e888469df7e0b896bb4e211b12633`）に存在すること。

### 案A（同一 Worker へのカスタムドメイン追加・推奨）

1. Cloudflare ダッシュボードで Worker `civildraft-web-cad` にカスタムドメイン `civildraft-web-cad-mvp.mirai-dx-platform.com` を追加（または `wrangler.jsonc` の `routes` に追記）。
2. 対応する DNS レコード（プロキシ有効）を作成。
3. 既存の `civildraft-web-cad` と同様に Cloudflare Access Application を適用し、レビュー関係者のみへアクセスを限定（本番と同じポリシーを流用するか、より狭い許可リストを設定）。
4. 検証: SPA 200 → 未認証 API 401 → Access ログイン後に主要画面・API をスモーク。

### 案B（独立 Worker による完全分離）

1. 新規 Worker（例 `civildraft-web-cad-mvp`）を作成し、`CIVILDRAFT_API_MODE` を `memory` にして本番 DB・Secrets から完全分離。
2. 同サブドメインを新 Worker へ紐付け。本番データに一切触れないレビュー環境が欲しい場合に選択。

注意:

- 公開 DNS・カスタムドメイン変更は人間の明示承認を要する（AGENTS.md / CLAUDE.md の境界）。本リポジトリから Cloudflare API への CLI token は存在するが、DNS 変更の自律実行は行わない。
- 課金対象リソースの新規作成（案B）は費用判断の提示後に人間承認を得る。
- Secrets（Access・Neon 接続文字列）の値は表示・再掲しない。

## 3. デモモード（架空ダミーデータ）での確認手順

### ローカル起動

```bash
npm ci
npm run dev
# → http://localhost:5173/#/home?demo=1
```

本番ビルド（`dist/` 配信・workers.dev）でも `?demo=1` を付与するとデモ表示になる（画面上部に「⚠️ デモ表示」バナーが出る）。

### 主なデモ導線（正常系）

1. ホーム: 架空案件一覧（検索・全件表示）・KPI カード（進行中/照査待ち/承認待ち/復旧候補）・案件ステータス分布チャート
2. 案件作成: 「＋ 新規案件・図面」→ 案件・図面作成 → 案件詳細
3. CAD 編集: 作図（線/矩形/円/ポリライン等）・レイヤー・グリッド・Undo/Redo・DXF 取込/出力・自動保存（IndexedDB）復旧
4. 数量・断面・測量: サンプル断面の読込・切土/盛土面積と平均断面法土量・測点 CSV
5. 照査・承認: デモロール切替（工種担当/監督員/閲覧者）で draft → 照査依頼 → 照査 → 承認 → 新規改訂。差戻し時のコメント必須エラー（異常系）も確認可
6. 出力・管理: PDF（日本語フォント）/DXF/CSV/Excel 出力・電子納品チェック・監査ログ一覧/ハッシュチェーン検証/HTML 出力

### ダミーデータの出所（再生成可能・実在情報不使用）

| データ | 定義場所 |
| --- | --- |
| 架空案件・最近の図面・お知らせ | `src/app/pages/HomePage.tsx`（`PROJECTS` / `RECENT_DRAWINGS` / `NOTICES`） |
| デモ作図図形 | `src/app/demoData.ts`（`createDemoDrawingGeometries`） |
| サンプル断面（No.0〜No.80） | `src/app/pages/CrossSectionPage.tsx`（`SAMPLE_SECTIONS`） |
| デモ改訂（Rev.1 draft） | `src/app/pages/ReviewApprovalPage.tsx`（`createInitialRevision`） |

- 人物名・会社名・案件名・金額・位置情報はすべて架空値。seed/fixture はコード定数としてリポジトリ管理（Secrets なし）。
- デモデータは検証後も削除せず保持する（本番モードでは非表示・実データのみ表示する設計。Issue #62/#169）。

## 4. 実データ（本番）での照査・承認の確認手順

2026-08-13 の MVP 完成セッションで、照査・承認画面が実改訂 API へ接続された。

1. Access ログイン後、案件詳細 → 図面 → CAD 編集（共有保存）で実改訂を開く。
2. サイドバー「集計・照査」→「照査・承認」へ移動。開いている改訂の `revisionId` が引き継がれ、`GET /api/v1/revisions/{id}` で実状態を表示する。
3. 照査依頼・照査・承認・差戻し・廃止・編集再開を実行すると `POST /api/v1/revisions/{id}/workflow-actions` が呼ばれる。最終認可はサーバー側（Access JWT の actorId と案件メンバーロール）で行われる。
4. 前提未達（コメント必須・Checksum 不一致等）はドメイン層の事前チェックとサーバー検証の両方で拒否され、理由が画面に表示される。

前提: Neon migration 0001〜0004 は本番適用済み。0005〜0008 の本番適用は人間実施待ち（`docs/operations/migration-apply-handoff.md`）。

## 5. 既知制約

- workers.dev は Cloudflare Access の保護外（SPA は公開・API は 401 fail-closed）。レビュー用途に限定し、公開 URL として周知しない。
- Neon 実接続の結合テスト 2 件は CI で接続文字列未登録のため skip（`CIVILDRAFT_TEST_NEON_CONNECTION` 登録は人間）。
- ローカル環境では Chromium 起動が制限される場合があるため、ブラウザ E2E は GitHub Actions CI（Browser E2E ジョブ・必須チェック）で確認する。

# Civil-Draw → CivilDraft-Web-CAD 統合完了報告書

作成: 2026-08-09（金曜開発枠）

## 1. 統合対象と結果

| 項目 | 内容 |
| --- | --- |
| 統合元 | Kensan196948G/Civil-Draw（HEAD ad76b9b、336 commits、Issue 272、PR 167、Release 5、MIT） |
| 統合先 | Kensan196948G/CivilDraft-Web-CAD（本リポジトリ） |
| 移行台帳 | docs/migration/civil-draw-migration-ledger.md（必須 37 機能を実装単位で突合・100% 判定済み） |
| アーカイブ | docs/migration/civil-draw-archive/（git bundle・Issue/PR/Release/commit 全量） |

## 2. 本セッションの実装

### CAD 作図・編集（Civil-Draw 5 ツール統合 + 残ツール）
- 円弧（3 点: 中心/半径/終角）、楕円、スプライン、引出線、改訂雲（CloudGeometry 新設）、平行2線（MLineGeometry 新設）の対話ツール
- 測距・面積（measure）、配列複写（array）、尺度変更（scale）の編集ツール
- 全幾何エンジン（bbox/transform/scale/array/snap/offset/quantity）・Canvas 描画・PDF 描画・DXF 出力へ新 2 型を一貫適用
- テスト 246 件（対象ファイル）+ 全体 1438 pass

### 電子納品
- 国土交通省「工事完成図書の電子納品等要領（令和5年3月版）」+「電子納品等運用ガイドライン【土木工事編】（令和5年3月版）」を一次情報として実装
- 標準 10 フォルダ・管理ファイル案内・命名規則（半角英数・禁則文字）・形式チェック・管理項目一覧 CSV・人による最終確認必須ゲート
- 適合の自動断定はしない（UI・文書に明記）

### PDF 編集・署名
- 結合 / 分割 / 回転 / 透かし / **墨消し（テキスト演算子の物理削除＋黒矩形）** / SHA-256 署名マニフェスト / **PDF/A-1b 指向メタデータ付与** / **PAdES-CMS detached 署名（.p7s・DER/SHA-256・署名検証テスト付き）**
- 制約を UI と本報告書に明記: PDF/A は自己宣言（ICC 未埋め込み・verapdf 等での認証要）、PAdES は証明書チェーンなし・PDF 本体への ByteRange 埋め込み未対応、画像内文字の墨消しは専用ツール要
- **SXF(P21) 試作エクスポータ**（AP202 サブセット・LINE/POLYLINE/CIRCLE・`FILE_SCHEMA('SXF')`）を印刷・出力画面へ追加（電子納品チェックシステムでの検証必須の警告付き）

### チェックイン/アウト
- ドメイン（acquire/release・承認後改変防止） + エディタ UI
- **migration 0007（`drawing_checkouts`）** と Worker API（`PUT/DELETE /api/v1/drawings/{drawingId}/checkout`）を実装。DB の rowcount 検査で他ユーザー上書きを 409 で拒否し、楽観ロック（expectedVersion + 409）と併用。チェックアウト/チェックインは監査ログへ記録
- クライアント（`CivilDraftApiClient.updateCheckout`）とエディタのチェックアウト/チェックインボタンを配線（共有保存後の図面 ID でサーバー操作、未接続時はローカルモードへフォールバック）

## 3. 未採用判断（要約）

MSAL 認証・Docker デプロイ・スナップショット Undo・raw 座標・型なし ID・localStorage 監査などは ADR-0001〜0016 の根拠で廃止/再設計。詳細は移行台帳「廃止候補」表。

## 4. テスト・CI・品質

| 検証 | 結果 |
| --- | --- |
| npm test | 1444+ pass / 2 skip（Neon 実接続のみ。続報セッションで PDF/検査/署名/チェックアウト系テストを追加） |
| npm run lint | 0 error（既知 warning 1） |
| npm run typecheck | pass |
| npm run build | pass（vendor 分離・コード分割維持） |
| CI（PR） | 実装ブランチ push 後に実行（本報告書時点で確認予定） |

## 5. デプロイ・監視

- 本番: civildraft-web-cad.mirai-dx-platform.com（v0.1.21、Worker 稼働・API 401 fail-closed）
- 合成監視・バックアップ・リストア検証は既存（backup.yml / synthetic-monitoring.yml）
- 本セッションの変更はブランチ・PR 経由でマージ後に次版デプロイ（デプロイは人間実行が基本方針）

## 6. 残課題

1. migration 0003〜0005・**0007（drawing_checkouts）** 本番適用（人間承認）
2. Cloudflare Access binding 登録（人間操作）
3. SXF(P21) 完全適合（円弧 TRIMMED_CURVE・SXF 属性エンティティ・CAD 製図基準）・PDF/A 認証（ICC 埋め込み・verapdf 検証）
4. PAdES の証明書チェーン（認証局発行）と PDF 本体への ByteRange 埋め込み署名
5. 画像内文字の墨消し（専用ツール要）
6. Neon 検証ブランチ・不要 worktree の削除（人間判断）

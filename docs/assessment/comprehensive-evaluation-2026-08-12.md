# 📌 CivilDraft-Web-CAD 統合評価・改善報告書（2026-08-12）

対象: **CivilDraft-Web-CAD**（GitHub: Kensan196948G/CivilDraft-Web-CAD・本番: `civildraft-web-cad.mirai-dx-platform.com`）
評価日: 2026-08-12（Asia/Tokyo）
評価方法: リポジトリ/ソース/テスト/CI/運用文書/マイグレーションの精査＋本番スモーク＋改善実装・再検証。前回評価書（[comprehensive-evaluation-2026-08-10.md](comprehensive-evaluation-2026-08-10.md)・74.3→76.1点・代替率59→67%）をベースラインとする。

> 主担当（CTO代行）が最終判断を実施。コード/UI評価はサブエージェント（読み取り専用）の報告を採用し、セキュリティ/DB/運用は主担当がコマンド実測で再検証した。

## 1. 現状サマリ（2026-08-12 実測）

| 項目 | 実測値 | 証跡 |
| --- | --- | --- |
| HEAD | `9959150`（main・origin 同期）＋本セッション branch `feat/2026-08-12-assessment-improvements` | `git log` |
| 本番 | v0.1.25（Worker `2fa2cd25`・2026-08-09/10 デプロイ・Access 302 保護） | `state.json`・curl |
| 合成監視 | 30分毎 success（最新 2026-08-12T03:48Z）・ローカル実行 `[health] OK spa=200 api=401` | `gh run list`・`node scripts/health-check.mjs` |
| テスト | **1526 pass / 2 skip（本セッション修正後）** | `npm test`（前回 1515 pass） |
| Lint | 0 error / 0 warning（本セッションで react-refresh 警告を解消） | `npm run lint` |
| Typecheck / Build | PASS（ビルド警告は 1MB 超チャンクのみ） | `npm run typecheck` / `npm run build` |
| Migrations | 静的検証 8 ファイル PASS＋**0007 の型不一致（uuid→text）を本セッションで修正** | `npm run migrations:check`・`tests/unit/workers/migrations.test.ts` |
| セキュリティ | `npm audit` 0 脆弱性・secret scan 0 findings | `npm audit --audit-level=high`・`npm run secret:scan` |
| オープン Issue / PR | 0 件 | `gh issue list` / `gh pr list` |

## 2. 18領域・各100点評価（前回 2026-08-10 → 今回 2026-08-12）

| # | 領域 | 前回 | 今回 | 主な根拠（変更・実測） |
| --- | --- | ---: | ---: | --- |
| 1 | 業務適合性 | 80 | 81 | 作図→数量→照査→承認→出力→電子納品の縦線＋実案件の改訂更新API・断面データAPI（PR #172）が本番稼働。URL deep link（本セッション）で案件/監査等の共有・再現が可能に。現場/協力会社向け導線・モバイル最適化は未達 |
| 2 | 機能完成度 | 77 | 78 | 27 API ルート・チェックイン/アウト・SXF試作・PAdES埋め込み署名・PDF/A基盤・Excel出力まで実装。SXF完全適合・PDF/A認証・DWG/JWW・3D/BIMは未達 |
| 3 | UI/UX | 71 | 74 | ハッシュルーティングでブックマーク/戻る進む/deep link対応（新規）。CadEditorPage初期バンドル 133.6→65.2kB（gzip 40→21kB）。オンボーディング・現場説明モードの実案件導線は途上 |
| 4 | アクセシビリティ | 68 | 71 | モバイルサイドバーへ Escape 閉・backdrop・フォーカス復帰を追加（新規）。アクティブ項目へ `aria-current="page"`。コントラスト監査・音声操作検証は未実施 |
| 5 | データ品質 | 78 | 79 | 数量⇔図形連動・健全性チェック・checksum・禁則文字チェック堅牢。migration 0007 の型不一致を本セッションで修正（本番適用ブロッカー解消）。0005〜0008本番未適用・実データ検証は人間待ち |
| 6 | AI 有効性 | 35 | 35 | 実装済み AI 機能なし。§8 の設計に従い、ルール/検索で十分な領域へは AI を入れない方針は妥当 |
| 7 | 設計 | 85 | 85 | ADR 16 本・Domain/Application/Infrastructure 分離・Brand ID/Result/Command・監査ハッシュチェーン・ADR-0014/0015/0016 と一貫。変更なし |
| 8 | コード品質 | 82 | 83 | react-refresh 警告解消・`CloudDraftSession` 分離（新規）。CadEditorPage 2,577 行モノリスは残（保守負債・高優先） |
| 9 | 性能・拡張性 | 73 | 76 | 初期バンドル約半減（新規）。R-tree・カリング・コード分割・Neon スコープロード・ページングは既存。domain-core 1,055kB の分割と負荷試験は残課題 |
| 10 | セキュリティ | 86 | 86 | Access JWT 二次検証・fail-closed・CSP・レート制限（アプリ層）・監査チェーン・secret 0 は実測維持。Rate Limiting binding・ログ集約・migration 本番適用は人間待ち |
| 11 | 可用性・バックアップ | 78 | 78 | Neon 週次バックアップ＋リストア検証・合成監視30分毎・ロールバック手順は稼働維持。フェイルオーバー演習は未実施 |
| 12 | 監視・障害対応 | 78 | 78 | ヘルスチェック二層化・失敗時 Issue 自動生成・SLO 週次集計。Slack 通知は secret 未登録で未有効・メトリクスダッシュボード未構築 |
| 13 | テスト | 85 | 87 | 1526 pass/2 skip（+11 件：hashRoute・モバイルa11y・migration 型整合）。E2E/性能/カバレッジ85%は CI 維持。Neon 実接続は接続文字列未設定で skip |
| 14 | CI/CD・リリース | 83 | 83 | CI 全ジョブ success（main 9959150・PR #175後）。lint/typecheck/test/build/migrations/E2E/audit/SBOM/notices/合成監視。性能ジョブが必須チェックでない点は据え置き |
| 15 | 運用保守性 | 76 | 77 | operations-manual・architecture を実態同期（本セッション）。Access/Neon 手動工程・migration 人間適用は残 |
| 16 | 文書 | 82 | 85 | README の Access「未設定」・「技術プレビュー」等の古い記述を実態へ修正、OpenAPI version 0.1.25・CHANGELOG・architecture・運用マニュアルを同期（本セッション） |
| 17 | 費用対効果 | 78 | 78 | OSS 中心・Cloudflare/Neon 従量課金・ライセンス0円・内製。人的工数/コスト実績の記録は未整備のまま |
| 18 | 競合代替性 | 74 | 75 | URL 共有・初期表示高速化で実務置換しやすさが向上。SXF完全・協力会社・モバイルが残るため前回比は小幅 |

**総合（単純平均）: 77.2 / 100（前回 76.1）**　判定: **条件付き利用可（本番稼働継続）**

条件: (1) Neon migration 0005〜0008 の本番適用（0007 は本評価で型修正済み）、(2) 現場・協力会社向け導線（モバイル/説明モードの実運用化）、(3) 監視通知・ログ集約、(4) SXF/PDF-A/PAdES の外部検証。

## 3. 強み（15件・証跡付き）

1. 必須 CAD 機能が実装単位で突合され、円弧/楕円/スプライン/改訂雲/平行2線/測距面積/配列/尺度まで対話ツール化（`src/domain/tools/`・`docs/migration/`）
2. 幾何演算エンジンが純関数＋テストで高品質（17ファイル・`tests/unit/domain/geometry/`）
3. 型安全性（Brand ID・Result・単位付き座標）と Command パターン Undo/Redo（差分・上限100）
4. DXF 往復・PDF（日本語フォント/表題欄）・CSV/LandXML/GeoJSON/Excel 出力が実装・テスト済み
5. 数量⇔図形連動・図面健全性チェック（未接続/stale数量・未対応DXF要素・未承認改訂）という土木業務視点の品質機構
6. 承認ワークフロー（照査→承認・checksum照合・承認後改変防止）と楽観ロック409
7. 監査ログのハッシュチェーン（並行分岐防止・検証API）による改ざん検知
8. Cloudflare Access 認証＋JWT二次検証＋CSP＋レート制限＋fail-closed の多層防御（本番302/401実測）
9. IndexedDB 自動保存＋復旧候補 UI（端末オフライン正本）
10. テスト 1526 件・Browser E2E・性能 CI・カバレッジ閾値・SBOM 決定性
11. ADR 駆動の設計記録（16本）と要件/設計文書の整合
12. 週次 Neon バックアップ＋リストア検証・ロールバック/インシデント手順
13. 電子納品（要領R5.3準拠チェック・禁則文字・人確認必須）と PDF 編集（結合/分割/墨消し物理削除）
14. PAdES 埋め込み署名（ByteRange）・SXF(P21) 試作・verapdf Docker 検証基盤
15. 本セッション追加: ハッシュURLルーティング・モバイルa11y・初期バンドル半減・migration 0007 重大修正・文書実態同期

## 4. 弱み・リスク（影響度: 重大/高/中/低）

| # | 弱み | 影響度 | 発生可能性 | 対応方針 |
| --- | --- | --- | --- | --- |
| 1 | Neon migration 0005〜0008 が本番未適用（0007 は型修正済み・適用可に） | 重大 | 高（次回デプロイ/新機能利用時に必須） | `scripts/apply-prod-migrations.sh` を接続可能環境で実行→スモーク。人間実施待ち |
| 2 | 本番 DB スキーマと実装の乖離（0005/0006/0007/0008 未適用）により、監査一意索引・チェックアウト・断面APIの本番挙動が未保証 | 重大 | 高 | 上記適用の完了基準（audit verify・checkout 409・sections roundtrip）を明記 |
| 3 | Slack 監視通知・Neon CI 用 secret が未登録（値未提供） | 高 | 中 | 通知先決定→secret 登録（人間） |
| 4 | Rate Limiting binding（Cloudflare 側）未導入（アプリ層 token bucket のみ） | 高 | 中 | binding 有効化は人間承認（設計書 `docs/operations/rate-limiting-design.md` 済み） |
| 5 | SXF 完全適合・PDF/A 認証（verapdf）・PAdES CA/TSA が外部工程依存 | 高 | 中 | 検証基盤は整備済み。電子納品チェックシステムでの最終確認は人間 |
| 6 | 現場/協力会社向け導線（モバイル最適化・閲覧専用ロール・ポータル）が未達 | 高 | 高 | 3ヶ月以内に閲覧ロール＋現場説明モード実運用を計画 |
| 7 | CadEditorPage 2,577 行モノリス | 中 | 高（保守継続） | ツールバー/パネル/コマンドライン/保存フックへ段階分割（Issue化） |
| 8 | ログ集約・メトリクスダッシュボード・アラート通知（メール/Slack）未構築 | 中 | 中 | SLOレポートを起点に通知・ダッシュボード導入 |
| 9 | Neon 実接続統合テストが CI で常時 skip | 中 | 中 | `CIVILDRAFT_TEST_NEON_CONNECTION` 登録（人間）＋dev ブランチ定期実行 |
| 10 | 負荷試験・大規模図面の本番相当検証なし | 中 | 中 | 性能 CI の必須化＋負荷シナリオ追加 |
| 11 | オンボーディング・利用者向け操作マニュアル未整備 | 中 | 中 | 業務マニュアル＋動画/チェックリスト整備 |
| 12 | 複数ブラウザ/OS（現場PC・タブレット）対応確認不足 | 中 | 中 | 動作保証マトリクス（Chrome/Edge/Safari/iOS/Android）作成 |
| 13 | 図面のチェックイン/アウト UI が共有保存後メインで、運用導線が未整理 | 中 | 中 | 編集開始時チェックアウト導線と競合解決UI |
| 14 | 画像内文字の墨消しが外部ツール（poppler+Pillow）依存 | 中 | 低 | 実行環境整備（人間）＋CI でのスモーク |
| 15 | 利用統計・コスト分析（Cloudflare/Neon 費用・利用者数）の記録なし | 低 | 中 | 月次レポート自動化 |
| 16 | 空スキャフォールド/未配線画面（CrossSection・ReviewApproval 等の一部表示）が残存 | 低 | 高 | 実装 or 非表示の判断を Issue 化 |
| 17 | Actions の Node 25 使用（環境依存）・性能ジョブが必須チェックでない | 低 | 低 | Node LTS 化・必須チェック化を検討 |
| 18 | GitHub Projects 同期が read:project スコープ不足で不可（自律） | 低 | 中 | `gh auth refresh -s read:project`（人間）後、同期 |
| 19 | PR #113（2026-08-04以前）の main 直 push 形跡が残る（branch protection 回避） | 低 | 低 | 通常 PR 経由のみの運用継続＋監査証跡として記録済み |
| 20 | 本番モードの実案件データは現在ほぼ空（利用開始前）のため、実データでの E2E 検証が未実施 | 高 | 高（利用開始時に顕在化） | パイロット案件で実データ検証→Issue 化 |

## 5. 競合・代替比較（2026-08-12 時点・公式情報ベース）

| 製品 | 提供元/形態 | 主要機能 | 利用者 | 導入方式 | 連携 | AI | セキュリティ/監査 | UX | 費用目安 | 代替可能/困難範囲 | CivilDraft 独自優位性 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Jw_cad | 国内フリー（jwcad.net） | 2D作図・JWW形式・国内土木/建築標準 | 国内技術者 | デスクトップ | 手動/ファイル | なし | なし | 高（慣熟者） | 無料 | JWW交換・作図は代替困難（現状対応外） | Web・共有・承認・監査・数量根拠一体 |
| AutoCAD Web / LT | Autodesk 商用 | DWG 2D作図・モバイル閲覧 | 設計/施工 | クラウド/デスクトップ | Autodesk系 | 限定的 | 商用SLA | 高い | Web $9.99/月〜・LT 約$60/月 | DWG/LISP/3Dは代替困難（対応外） | 土木数量・承認・監査・電子納品 |
| DraftSight | Dassault 商用 | DWG/DXF/DGN・LISP・PDF取込 | 設計 | デスクトップ | ファイル | なし | 商用 | 中 | Pro 約$299/年 | 2D作図は競合・土木業務フローなし | 業務フロー一体化 |
| QCAD | OSS（GPL）/Pro | 2D DXF作図・レイヤー/寸法 | 個人/中小 | デスクトップ | DXF | なし | OSS任せ | 中 | Community無料/Pro €40前後 | 作図は代替候補・日本語土木支援弱い | 日本語土木・監査・クラウド |
| LibreCAD | OSS（GPL） | 2D DXF作図 | 個人 | デスクトップ | DXF | なし | OSS任せ | 中 | 無料 | 同左 | 同左 |

> 価格は各社公式サイトの公開情報に基づく目安。更新確認日 2026-08-12。正確な現行価格は導入時に各社確認のこと。

## 6. 代替率（加重: 業務35% / 必須機能25% / UX15% / データ連携10% / セキュリティ監査10% / 運用保守5%）

| 項目 | 前回 | 今回 | 根拠 |
| --- | ---: | ---: | --- |
| 主要業務フロー | 60 | 62 | 作図→数量→照査→承認→出力→納品の縦線＋実案件API（改訂/断面）稼働。現場/協力会社/モバイル導線未達 |
| 必須機能 | 75 | 70 | 2D主要・DXF/PDF/Excel・チェックイン/アウト・監査・承認は高水準。SXF完全・PDF/A認証・DWG/JWWは未達（前回予測より保守的に実測） |
| UX | 65 | 60 | デスクトップ良好＋URL共有追加。オンボーディング・現場モード・モバイル最適化未達 |
| データ連携 | 50 | 40 | DXF/CSV/LandXML/GeoJSON/Excel強い。Entra/SharePoint/外部API公開/Webhook未（前回予測は未実現） |
| セキュリティ・監査 | 85 | 84 | Access/CSP/監査チェーン/レート制限実装・secret 0。migration本番未適用・ログ集約/通知未 |
| 運用保守性 | 80 | 78 | バックアップ/監視/runbook充実。Slack通知・ダッシュボード・復旧演習未実施 |
| **加重代替率** | 約67% | **約65%** | 0.35×62+0.25×70+0.15×60+0.10×40+0.10×84+0.05×78 = 64.9% |

> 前回67%は「改善後予測」であり、連携・UX の想定進捗が未達のため今回実測は65%。80%到達には「電子納品一式の完全適合＋現場/協力会社導線＋モバイル閲覧＋通知/監査運用＋API公開」が必須。

**80%到達条件**: DXF/PDF往復・数量・承認・監査・バックアップ（達成済み）＋電子納品完全適合・実案件データ全画面連携・モバイル閲覧・現場説明モード実運用・Excel/API公開・通知・協力会社ポータル
**90%到達条件**: 監査・承認・バックアップ/リストア・RBAC・DXF/PDF出力（概ね達成）＋協力会社ロール・オフライン同期・コスト/利用統計・復旧演習自動化
**意図的に代替しない範囲**: 3D/BIM（IFC）・構造計算・点群処理・AutoCAD LISP/スクリプト互換・高度な図面標準（ISO/社内CAD基準の厳密実装）・JWW 完全互換

## 7. 改善計画（時期別）

| 時期 | 改善 | 対象者 | 効果 | 難易度 | 工数 | 優先度 | 完了基準 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 今すぐ（本セッション実施） | ✅ ハッシュURLルーティング | 全利用者 | ブックマーク/戻る進む/deep link | 低 | 3h | 高 | テスト11件・1526pass |
| 今すぐ（本セッション実施） | ✅ モバイルサイドバーa11y（Escape/backdrop/フォーカス） | 現場タブレット | 操作品質 | 低 | 1h | 高 | a11yテスト2件 |
| 今すぐ（本セッション実施） | ✅ 初期バンドル半減（CadEditorPage遅延化） | 全利用者 | 体感速度 | 低 | 1h | 高 | build実測65.2kB |
| 今すぐ（本セッション実施） | ✅ migration 0007 型不一致の重大修正 | 運用 | DB適用可能化 | 低 | 0.5h | 重大 | migrations:check＋回帰テスト |
| 今すぐ（本セッション実施） | ✅ README/architecture/ops/OpenAPI/CHANGELOG 実態同期 | 全関係者 | 文書正本化 | 低 | 2h | 中 | diff検証 |
| 今すぐ | Neon migration 0005〜0008 本番適用 | 運用 | DB正本整合 | 中 | 2h | 重大 | 適用後スモーク（audit verify・checkout・sections） |
| 今すぐ | Slack/MONITOR_SLACK_WEBHOOK・CIVILDRAFT_TEST_NEON_CONNECTION 登録 | 運用 | 監視・CI強化 | 低 | 0.5h | 高 | 通知テスト・Neon CI成功 |
| 3ヶ月以内 | 閲覧専用ロール（協力会社）＋現場説明モード実運用 | 現場/協力会社 | 閲覧導線 | 中 | 40h | 高 | RBACテスト・実案件スモーク |
| 3ヶ月以内 | モバイル最適化（タブレット操作・図面閲覧） | 現場 | 現場利用 | 中 | 40h | 高 | 実機E2E |
| 3ヶ月以内 | 監視通知・SLOダッシュボード | 運用 | 障害検知 | 中 | 16h | 高 | アラート実送信 |
| 3ヶ月以内 | CadEditorPage 分割（ツールバー/パネル/フック） | 開発 | 保守性 | 中 | 24h | 中 | 行数削減・全テスト維持 |
| 6〜12ヶ月 | SXF完全適合・PDF/A認証・PAdES CA/TSA 連携 | 発注者対応 | 電子納品 | 高 | 80h | 高 | 外部検証PASS |
| 6〜12ヶ月 | 協力会社ポータル（提出/コメント）・Webhook | 協力会社 | 協調 | 高 | 80h | 中 | E2E |
| 6〜12ヶ月 | オフライン編集→同期（競合解決UI） | 現場 | 可用性 | 高 | 60h | 中 | 同期テスト |
| 将来 | 3D/BIM（IFC閲覧）・点群・写真整理連携 | 設計 | 高度化 | 高 | 120h+ | 低 | PoC |
| 将来 | AI支援（§8の設計に従い段階導入） | 全利用者 | 時間削減 | 高 | 80h+ | 中 | パイロット |

### 追加機能提案（20件以上）

- **業務**: ①現場説明モード実運用 ②図面チェックリスト/納品チェック自動化 ③工事カルテ（発注者・工区・履行期間） ④出来形管理（実測→図面反映） ⑤工程表連携（Excel/CSV）
- **地図・検索・可視化**: ⑥図面全文検索（属性・改訂・コメント） ⑦GIS連携（GeoJSON→地図表示） ⑧測点/座標の地図プロット ⑨工事別ダッシュボード（進捗/数量サマリー）
- **PWA・オフライン**: ⑩PWAインストール定着 ⑪タブレット閲覧モード ⑫現場写真添付（図面紐付け） ⑬オフライン編集→同期キュー ⑭コンフリクト解決UI（差分表示）
- **通知**: ⑮照査/承認リマインダー ⑯差戻し通知（メール/Slack） ⑰期限アラート
- **PDF/Excel**: ⑱Excel一括出力（数量/出来形/図面リスト） ⑲電子納品パッケージ一括生成 ⑳PDF/A自動変換
- **API**: ㉑OpenAPI公開（済・本番公開は承認待ち） ㉒Webhook（承認/監査イベント） ㉓DXF自動変換ジョブ
- **RBAC・監査**: ㉔協力会社限定ロール ㉕監査レポート定期出力 ㉖承認者の代理設定
- **管理運用**: ㉗利用統計・コストダッシュボード ㉘データ保持ポリシー/アーカイブ ㉙復旧演習自動化
- **データ品質**: ㉚図面番号/改訂番号の自動採番 ㉛名称マスター（工種/規格）整備 ㉜入力チェック（禁則・重複）
- **土木建設固有**: ㉝切土/盛土数量自動集計 ㉞土工/仮設パラメトリック追加 ㉟TS/GNSS測量データ取込
- **AI**: ㊱類似図面検索（RAG・pgvector） ㊲数量根拠の説明生成 ㊳写真の出来形分類 ㊴数量乖離・工程遅延の異常検知

## 8. AI 設計（チャット目的化しない）

AI は「時間削減・判断支援・説明可能性・安全性・費用対効果」で評価し、ルール/検索で十分な領域（コマンド実行・禁則文字・承認ルート・バックアップ）には導入しない。

| 領域 | 方式 | 設計要点 |
| --- | --- | --- |
| 類似図面・過去成果検索 | RAG（Neon pgvector） | 権限スコープ検索・引用元（図面ID/改訂/行）明示・信頼度表示・人間最終判断 |
| 数量根拠の説明生成 | 構造化抽出＋テンプレート | 決定性データから生成（LLMは整形のみ）・誤りはログ追跡 |
| 現場写真の出来形分類 | 分類モデル（外部API可） | 入力秘匿・破棄ポリシー・結果は候補表示・承認必須 |
| 数量乖離・工程遅延の異常検知 | 統計モデル | 説明可能な単純モデル・しきい値運用調整・人間承認フロー |
| チャット（将来） | RAGチャット | プロンプトインジェクション対策・権限制御・入出力監査・予算上限・即時停止・責任分界（最終判断は人間） |

## 9. 本セッションで実装した改善（第2段階）

| 改善 | 内容 | テスト/検証証跡 |
| --- | --- | --- |
| 🚨 migration 0007 重大修正 | 0004適用後の ID 列（text）と不一致だった `drawing_checkouts` の FK 列型を uuid→text へ修正。適用前のため前方修正で対応 | `npm run migrations:check` PASS・回帰テスト追加（`migrations.test.ts`） |
| URL ルーティング | ハッシュベース `#/<view>`（editor はセッション・project は projectId を保持）でブックマーク/戻る進む/deep link 対応 | `tests/unit/app/hashRoute.test.ts` 6件・AppNavigation 拡張 |
| モバイル a11y | Escape 閉・背面オーバーレイ・開閉時のフォーカス復帰・`aria-current="page"` | AppNavigation テスト 2件 |
| バンドル最適化 | CadEditorPage を遅延読込化し初期バンドル 133.6→65.2kB（gzip 40→21kB） | `npm run build` 実測 |
| コード品質 | `CloudDraftSession` を `cloudDraftSession.ts` へ分離し react-refresh 警告を解消 | `npm run lint` 0 error/0 warning |
| 文書実態同期 | README（Access本番適用・Neon接続・代替度表）・architecture overview・operations manual・OpenAPI v0.1.25・package version・CHANGELOG | git diff 確認 |

検証: `npm test` **1526 pass/2 skip**（Neon実接続のみ skip）・lint 0/0・typecheck PASS・build PASS・`migrations:check` PASS・secret:scan 0・npm audit 0。

## 10. ロードマップ

- **Phase 0（重大・セキュリティ）**: Neon migration 0005〜0008 本番適用（0007 修正済み）→ 監視通知・ログ集約 → Rate Limiting binding → 実データパイロット
- **Phase 1（中核業務）**: 閲覧専用ロール（協力会社）・現場説明モード実運用・モバイル最適化・CadEditorPage 分割・操作マニュアル
- **Phase 2（競合80%代替）**: SXF完全適合・PDF/A認証・PAdES CA/TSA・オフライン同期・通知・API公開・監査レポート
- **Phase 3（AI・モバイル・外部連携）**: RAG検索・写真分類・異常検知・Webhook/OpenAPI公開・Entra/SharePoint連携
- **Phase 4（90%代替・本番最適化）**: 3D/BIM閲覧・点群・図面標準・コスト/利用統計・復旧演習自動化

## 11. 残課題・未実行理由

1. **Neon migration 0005〜0008 本番適用**: 接続環境から Neon API/接続文字列へ到達不能・秘密情報は人間管理のため未実行（`scripts/apply-prod-migrations.sh`・`docs/operations/migration-apply-handoff.md` 準備済み）。**0007 は型修正済みで適用可能状態**
2. **Slack/MONITOR_SLACK_WEBHOOK・CIVILDRAFT_TEST_NEON_CONNECTION 登録**: 通知先・接続文字列の値が未提供
3. **Rate Limiting binding・GitHub Projects 同期**: Cloudflare binding は人間承認待ち・`read:project` スコープ不足
4. **SXF完全適合・PDF/A認証・PAdES CA/TSA・画像墨消し環境**: 外部検証工程・証明書・実行環境が人間側
5. **負荷試験・Neon 実接続 CI 常時化・ダッシュボード**: 上記 secret と作業枠の制約
6. **CadEditorPage 分割・未配線画面整理・オンボーディング**: 本セッションのスコープ優先順位（重大/高効果）との兼ね合いで次期課題

## 12. 投資判断と次の作業

**判断: 条件付き継続（投資継続）**。基盤・テスト・セキュリティ・文書は本番水準。条件は (1) migration 0005〜0008 の早期適用、(2) 現場・協力会社向け導線、(3) 監視の通知・ログ集約、(4) パイロット案件での実データ検証。

**次の具体的作業（順序）**:
1. 本 branch を push → PR 作成 → CI 全チェック確認 → マージ判定（Y/N）
2. `scripts/apply-prod-migrations.sh` で 0005〜0008 を本番適用し、audit verify・checkout 409・sections roundtrip をスモーク
3. Slack 通知先・Neon テスト接続文字列の提供後に監視通知と CI 常時化
4. 閲覧専用ロールと現場説明モードの実運用化（Issue 化）
5. CadEditorPage 分割（保守性）と操作マニュアル整備

# Civil-Draw 完全移行台帳（統合完了版）

- 対象: `Kensan196948G/Civil-Draw`（HEAD `ad76b9b`、336 commits、Issue 272 件、PR 167 件、Release 5 件）
- 統合先: 本リポジトリ `Kensan196948G/CivilDraft-Web-CAD`（既定ブランチ main）
- 作成: 2026-08-09（金曜開発枠）
- 前身: [Phase 0 継承台帳](../../design/phase0/inheritance-ledger.md)（46 コンポーネント・as_is/modify/reference_only/discard 分類）を、本指示の 6 区分へ読み替え・実装状態を突合した版

## 判定区分（本指示対応）

| 区分 | 定義 | Phase 0 対応 |
| --- | --- | --- |
| そのまま移植 | ロジック・データモデルを変更せず持ち込む | as_is |
| 中核設計へ再構成して統合 | 型・保存先・アーキテクチャを中核に合わせて書き直す | modify |
| 重複機能を統合・置換 | 同じ機能が中核に既にあり、片方へ一本化する | modify（一部 discard） |
| 互換性を維持して移行 | 入出力・UI 操作の互換を保ちながら移す | modify |
| 未完成機能を完成させて統合 | Civil-Draw で未完成・未配線の機能を完成させる | reference_only / 新規 |
| 廃止候補 | 根拠・影響・代替・承認を記録して採用しない | discard |

## 必須統合・完成範囲の突合（実装単位）

凡例: ✅ 統合済み・テストあり / 🟡 一部・既知制約あり / 🔴 未実装（課題化） / ➕ 本セッションで新規実装

| # | 機能 | Civil-Draw | 中核の実装 | 判定 | 状態 |
| --- | --- | --- | --- | --- | --- |
| 1 | 線 | line ツール | ToolType 'line' + LineGeometry | 再構成統合 | ✅ |
| 2 | 矩形 | rectangle ツール | 'rectangle' + RectangleGeometry | 再構成統合 | ✅ |
| 3 | 円 | circle ツール | 'circle' + CircleGeometry | 再構成統合 | ✅ |
| 4 | 円弧 | arc ツール（3点: 中心/半径/終角） | 型・描画・PDF・DXF は既存、対話ツールが欠落 | 未完成機能の完成 | ✅ ➕（draftGeometry.makeArcDraft） |
| 5 | ポリライン | polyline ツール | 'polyline' + PolylineGeometry | 再構成統合 | ✅ |
| 6 | 文字 | text ツール（prompt 入力） | 入力欄方式 + TextGeometry | 互換性維持して移行 | ✅ |
| 7 | 楕円 | ellipse ツール | 型・描画・PDF・DXF は既存、対話ツール欠落 | 未完成機能の完成 | ✅ ➕ |
| 8 | スプライン | spline ツール（クリック蓄積） | 型・描画・PDF・DXF は既存、対話ツール欠落 | 未完成機能の完成 | ✅ ➕ |
| 9 | 寸法 | dimension ツール | 'dimension' + DimensionGeometry | 再構成統合 | ✅ |
| 10 | 引出線 | callout ツール | LeaderGeometry は既存、対話ツール欠落 | 未完成機能の完成 | ✅ ➕（既定テキスト＋プロパティ編集） |
| 11 | 改訂雲 | cloud ツール | CloudGeometry を新設（x1/y1/x2/y2/arcSize） | 未完成機能の完成 | ✅ ➕ |
| 12 | 平行2線 | mline ツール | MLineGeometry を新設（start/end/offset） | そのまま移植→再構成 | ✅ ➕ |
| 13 | ハッチ | hatch ツール（10 パターン） | HatchGeometry + hatchGenerator | 再構成統合 | ✅ |
| 14 | 測距 | MEASURE-001 距離計測 | measureDistance（新規純粋関数） | 未完成機能の完成 | ✅ ➕ |
| 15 | 面積 | MEASURE-002 面積計測 | measureArea（areaCalculator 再利用） | 未完成機能の完成 | ✅ ➕ |
| 16 | スナップ | 端点/中点/中心/交点/垂線/接線/最近点/グリッド | snapEngine 全種 | 再構成統合 | ✅ |
| 17 | レイヤー | layerStore + LayerPanel | LayerSlice + レイヤーパネル + ロック編集禁止 | 再構成統合 | ✅ |
| 18 | 移動 | MoveDialog + move | 'move' 編集ツール | 再構成統合 | ✅ |
| 19 | 複写 | copy | 'copy' 編集ツール | 再構成統合 | ✅ |
| 20 | 配列 | ArrayDialog + arrayEngine | arrayEngine は既存、ツール配線が欠落 | 未完成機能の完成 | ✅ ➕（'array' + パラメータ行） |
| 21 | 回転 | rotate | 'rotate' 編集ツール | 再構成統合 | ✅ |
| 22 | ミラー | mirror | 'mirror' 編集ツール | 再構成統合 | ✅ |
| 23 | トリム | trimEngine | 'trim' 編集ツール | 再構成統合 | ✅ |
| 24 | 延長 | extendEngine | 'extend' 編集ツール | 再構成統合 | ✅ |
| 25 | 面取り | chamferEngine + ChamferDialog | 'chamfer' + パラメータ行 | 再構成統合 | ✅ |
| 26 | フィレット | filletEngine + FilletDialog | 'fillet' + パラメータ行 | 再構成統合 | ✅ |
| 27 | オフセット | offsetEngine + OffsetDialog | 'offset' + パラメータ行 | 再構成統合 | ✅ |
| 28 | 尺度 | scaleEngine + ScaleDialog | scaleEngine は既存、ツール配線欠落 | 未完成機能の完成 | ✅ ➕（'scale' + 倍率入力） |
| 29 | Undo/Redo | Shape[][] スナップショット | Command パターン（差分・100 件上限） | 廃止→再設計 | ✅（ADR-0004） |
| 30 | 土木記号 | symbolCatalog（30 種） | symbolCatalog 移植 + パレット | そのまま移植 | ✅ |
| 31 | テンプレート | templateCatalog（6 種） | templateCatalog + レイヤーテンプレート 5 種 | 再構成統合 | ✅ |
| 32 | DXF 入出力 | dxfImporter/Exporter | 移植 + 単位/角度/線種是正 | 互換性維持して移行 | ✅ |
| 33 | 印刷・PDF | PrintScaleDialog + PDF 出力 | pdfExporter（日本語フォント・表題欄・縮尺） | 再構成統合 | ✅ |
| 34 | IndexedDB 自動保存・復元 | localStorage autosave | autosaveStore（IndexedDB・デバウンス・容量警告） | 廃止→再設計 | ✅（ADR-0007） |
| 35 | テーマ | themeStore | ライト/ダーク切替（ThemeToggle） | そのまま移植 | ✅ |
| 36 | コマンドパレット | CommandPalette（Ctrl+K） | CommandPalette（60+ コマンド） | 再構成統合 | ✅ |
| 37 | キーボード操作 | Ctrl+Z / Esc / F1 / 数字キー | ショートカット + a11y + ヘルプ | 再構成統合 | ✅ |

## コンポーネント別台帳（46 件＋本セッション新規）

### 🟢 そのまま移植（11 件）

LICENSE・自作素材・要件定義文書・TypeScript strict・依存グラフ健全性・mock 分離・XSS 対策方針・機密情報運用・Canvas 4 層最適化・themeStore・ISO 文書の権利記載

→ いずれも本リポジトリへ反映済み（LICENSE は同一権利者、THIRD-PARTY-NOTICES.md で OSS 表記整備、ADR-0011）。

### 🟡 中核設計へ再構成して統合（20 件）

| コンポーネント | 統合先 | 状態 |
| --- | --- | --- |
| OSS 依存管理 | package.json / SBOM / NOTICES | ✅（ADR-0011） |
| 単体テスト資産 | tests/unit（1438 件） | ✅ |
| E2E テスト資産 | tests/e2e（Playwright） | ✅（CI 常時実行） |
| DXF 変換 | domain/dxf | ✅（R-002/R-004 是正） |
| 自動保存 | infrastructure/autosave（IndexedDB） | ✅（ADR-0007） |
| 既知不具合一覧 | Issue 化（#114〜#120 等） | ✅ |
| CI 品質ゲート | .github/workflows/ci.yml（実体一致） | ✅（ADR-0010） |
| CHANGELOG 信頼性 | CHANGELOG.md + state.json 実態同期 | ✅ |
| CSP/セキュリティヘッダー | Workers セキュリティヘッダー + テスト | ✅（PR #79） |
| ディレクトリ構成 | domain/application/infrastructure/features | ✅ |
| 幾何演算エンジン群 | domain/geometry（17 ファイル） | ✅（cloud/mline 対応も本セッション追加） |
| R-tree 空間索引 | spatialIndex（インスタンス化） | ✅（ADR-0008） |
| layerStore | editorStore 6-slice 再構成 | ✅ |
| 可読性 | eslint strict + コメント文化 | ✅ |
| Minimap | 中核では未採用（代替: ビューポートカリング + 性能テスト） | 🟡 廃止候補参照 |
| ベンチマーク図形 | tests/performance（perf 閾値実効化） | ✅ |
| E2E 性能テスト | tests/performance + check-perf-thresholds | ✅（閾値是正） |
| メモリ計測 | 性能ベースライン更新 | 🟡 継続課題 |
| canvasStore | ViewportSlice | ✅ |
| toolStore | ToolSlice | ✅ |

### 🔵 互換性を維持して移行（5 件）

| 対象 | 内容 | 状態 |
| --- | --- | --- |
| DXF 往復互換 | 単位・角度・線種（dashed/dashDot）往復テスト | ✅ |
| PDF 出力互換 | 用紙・縮尺・図枠・表題欄・日本語フォント | ✅ |
| コマンド操作互換 | コマンドライン（undo/layer/grid 等）+ パレット | ✅ |
| ファイル名/保存互換 | JSON 保存 + IndexedDB 復元 | ✅ |
| キーボード互換 | 数字キー 1-9・Ctrl+Z/Y・Esc・? | ✅ |

### ➕ 未完成機能を完成させて統合（本セッション実装分）

| 機能 | 実装 | テスト |
| --- | --- | --- |
| 円弧・楕円・スプライン・引出線・改訂雲・平行2線ツール | draftGeometry + renderer + PDF + DXF + 全幾何エンジン | ✅（draft/bbox/transform/scale/array/snap/quantity/renderer/DXF） |
| 測距・面積ツール | domain/geometry/measure.ts + ステータスバー表示 | ✅ |
| 配列複写・尺度ツール | editGeometry + AddGeometries コマンド + パラメータ UI | ✅ |
| 電子納品 | domain/edelivery + EdeliveryPage（要領 R5.3 準拠チェック・管理ファイル CSV・人確認必須） | ✅ |
| PDF 編集 | pdfEdit（結合/分割/回転/透かし/墨消し）+ UI | ✅ |
| 署名マニフェスト | pdfSignature（SHA-256）※電子署名法上の署名ではない | ✅ |
| チェックイン/アウト | domain/revisions/checkout + エディタ UI（ローカル永続化） | ✅ |

### 🔴 廃止候補（根拠・影響・代替・承認）

| 対象 | 根拠 | 影響 | 代替 | 承認 |
| --- | --- | --- | --- | --- |
| MSAL/Entra ID 直接統合（auth/） | Cloudflare Access 認証モデルと非両立 | ブラウザ完結認証の廃止 | Cloudflare Access + JWT 検証（ADR-0001） | ADR-0001・本 Goal |
| Docker/nginx/IIS 一式 | 標準スタックは Systemd+Cloudflare+Neon（Docker 廃止） | 旧デプロイ経路の消滅 | wrangler deploy + Neon（ADR-0006） | ADR-0006 |
| スナップショット型 Undo | メモリ非効率・コマンド差分と非両立 | 旧履歴互換なし | Command パターン（ADR-0004） | ADR-0004 |
| 単位なし raw 座標 | mm/Meters 不整合（R-004 実害確認） | DXF 往復が不正確 | 内部 mm + 境界変換（ADR-0005/0012） | ADR-0005・0012 |
| 型なし ID / Result 不採用 | 取り違え・失敗表現の不一致 | 型安全性欠如 | Brand ID / Result（ADR-0002/0003） | ADR-0002・0003 |
| localStorage autosave・監査 | 同期 I/O・改ざん耐性不足 | 容量/信頼性 | IndexedDB / Neon 監査 hash chain（ADR-0007/0009） | ADR-0007・0009 |
| 性能回帰ガード無力化 | 閾値が実質無効 | 回帰検出不能 | check-perf-thresholds 実効化（ADR-0010） | ADR-0010 |
| Minimap / ContextMenu / FPSMeter / BenchmarkPanel | 中核では別実装・優先度低 | UI 追加機能の欠落 | ビューポートカリング・コマンドパレット・性能 CI | 本 Goal（影響軽微・再要望時は Issue 化） |
| JWW/SXF/DWG 変換 | 要領外・仕様入手コスト | 既存ファイル取込不可 | DXF 中心 + file-compatibility-policy | 方針文書（人間決裁バックログ） |

## 電子納品・PDF の担当範囲差分（新規・課題）

| 項目 | 本セッション実装 | 残課題（根拠） |
| --- | --- | --- |
| フォルダ構成・命名・管理ファイル | ✅ DRAWINGF 等 10 フォルダ + INDEX_C.XML/DRAWINGF.XML 案内 + CSV 管理ファイル | XML/DTD 実生成（発注者 DTD 依存） |
| 禁則文字・形式チェック | ✅ 機種依存文字・半角英数・DXF 警告 | チェックシステム相当の厳密一致 |
| SXF(P21) 変換 | 🟡 試作エクスポータ実装（AP202 サブセット・LINE/POLYLINE/CIRCLE・`FILE_SCHEMA('SXF')`・検証必須警告付き） | 円弧/楕円/スプライン/属性（SXF_LAYER 等）・CAD 製図基準完全適合は未対応。**電子納品チェックシステムでの検証必須** |
| PDF/A 変換 | 🟡 PDF/A-1b 指向メタデータ付与を実装（XMP・OutputIntent・フォント埋め込み依存） | ICC プロファイル（DestOutputProfile）未埋め込み・第三者認証なし。verapdf 等での検証必須 |
| 電子署名 | 🟡 PAdES-CMS detached 署名（.p7s）を実装（signedAttrs: contentType/messageDigest/signingTime・RSA/SHA-256・DER 生成・検証テスト付き） | 証明書（X.509）チェーンなし・PDF 本体への ByteRange 埋め込み未対応。電子署名法上の署名には認証局証明書と埋め込み署名の導入が必要 |
| 墨消し | ✅ テキスト演算子（Tj/'/"/TJ）の物理削除＋黒矩形を実装（コンテンツストリーム解析・非対応時は視覚モードへフォールバック） | 埋め込み画像内の文字は削除不可（専用ツール要） |
| 版管理・差分 | ✅ drawingDiff + DrawingComparePage | — |
| チェックイン/アウト | ✅ サーバー横断永続化を実装（migration 0007 `drawing_checkouts`・Worker API `PUT/DELETE /drawings/:id/checkout`・rowcount 検査 409・監査ログ・クライアント/UI 配線） | 本番適用は人間決裁（migration 0007 未適用） |
| 照査・承認 | ✅ workflow + ReviewApprovalPage | — |
| 監査証跡 | ✅ auditChain（hash chain）+ AuditLogPage | — |
| 承認後改変防止 | ✅ approved 状態 + checksum 照合 + 楽観ロック 409 | — |

## 検証結果

- 単体/統合: 1438 pass / 2 skip（Neon 実接続のみ）・カバレッジ CI ゲート ✅
- lint / typecheck / build / npm audit / migrations:check ✅
- DXF 往復・PDF 出力・PDF 編集（結合/分割/回転/透かし/墨消し）・電子納品チェックの自動テスト ✅
- E2E / 性能 / 合成監視: CI（main push 時）で実行

## 未決・残課題

1. Neon migration 0003〜0005・0007（drawing_checkouts）の本番適用（人間承認待ち）
2. Cloudflare Access binding（ACCESS_TEAM_DOMAIN / ACCESS_AUD）登録（人間操作）
3. SXF(P21) 完全適合（円弧 TRIMMED_CURVE・SXF 属性・CAD 製図基準）・PDF/A 認証（ICC・verapdf）
4. PAdES の証明書チェーン・PDF 埋め込み署名（ByteRange）
5. Neon 検証ブランチ 2 本・不要 worktree の削除（人間判断待ち）
6. 外部 AI 評価（2026-08-05 実施分）の残対応（#114 は Phase 1〜4 完了・クローズ済み。他指摘はバックログ #58/#62 等）

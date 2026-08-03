# 📋 システム開発プロジェクト総合評価 (2026-08-03)

対象: **ArcSphere-Civil-Twin** (`90ec9ec`) / **CivilDraft-Web-CAD** (`7679c7b`)
評価者: システム開発評価責任者 (CTO / PM / アーキテクト / セキュリティ / SRE / QA / UX 統合視点)
方法: リポジトリ全体調査 + ローカル実行検証 (install / build / typecheck / lint / unit test / audit / secret scan) + ソースコード精査 (両リポジトリ計 4 監査パス)

---

## 📌 1. エグゼクティブサマリー

| 項目 | ArcSphere Civil Twin | CivilDraft-Web-CAD |
|---|---|---|
| 総合得点 | **73 / 100** | **65 / 100** |
| 判定 | 検証・限定運用可。本番前に High 3 件の修正必須 → **本セッションで 3 件修正済み** | デモ/PoC 上位水準。永続化層の再設計が本番の前提 |
| 完成度 | 約 80% | 約 60% |
| 競合代替率 | 約 50% | 約 40% |
| デモ可能か | **Yes** | **Conditional** (CAD 編集はデモ可、DXF 取込に UI なし) |
| 本番リリース可能か | **Conditional** (修正の本番反映 + 監視整備後) | **No** (High 4 件未解決のまま実運用不可) |

両プロジェクトとも「READMEだけ立派」な типのプロジェクトでは**なく**、テスト・CI・運用文書が実体を伴う。検証実測: ArcSphere backend **pytest 909 件 green** / frontend **vitest 153 件 green**、CivilDraft **vitest 1,287 件 green**、両者 tsc / eslint / build すべて green、secret 混入 0 件。

一方で、両者とも「実装済みだが本番で成立しない箇所」が要所にあり、それが今回の主要な発見である:

- **ArcSphere**: SSE が全テナントへ配信 (High)、パスワード変更で既存セッションが残存 (High)、監査 action 名が VARCHAR(20) 超過で PG 上で黙って欠落 (High) — **3 件とも本セッションで修正・テスト追加済み**
- **CivilDraft**: 全 API リクエストで DB 全テーブル SELECT、楽観ロックが SQL 未強制、レート制限なし、actorId ヘッダー偽装余地 (High) — **actorId とボディ上限は本セッションで修正済み**、残り 2 件は設計変更を要するため Issue 化推奨

---

## 📌 2. プロジェクトの目的と現状理解

### ArcSphere Civil Twin
- **目的**: 土木建設向け 3D デジタルツイン SaaS。点群 (LAS/LAZ)・BIM/CIM (IFC)・地形を単一 3D ワークスペースで統合管理
- **想定ユーザー**: 建設会社・発注者・設計コンサルの PM / 技術者 / 監督員
- **構成**: FastAPI (Python 3.12, 113 ファイル/14.2k LOC) + React 18/Three.js (88 ファイル/12.3k LOC) + Postgres (Neon) + MinIO/S3 + Redis/ARQ。docker-compose / Helm / systemd の 3 経路
- **フェーズ**: v1.0 リリース後の本番安定化 (Phase 3)。本番 URL 稼働中 (Cloudflare Access 全面保護)
- **データ正本**: Neon Postgres (alembic 28→29 migration) + S3 (tileset)。**注意: 本番 DB head (`s9t0u1v2w3x4`) はリポジトリ head より 3 migration 遅れ** (state.json 記載、要本番適用承認)

### CivilDraft-Web-CAD
- **目的**: 土木向け Web 2D CAD (作図・DXF 入出力・数量計算・帳票・承認ワークフロー)
- **構成**: Vite/React 19 + Konva SPA (143 ファイル/28.8k LOC) + Cloudflare Worker (1,791 行) + Neon Postgres。R2 は ADR-0014 でスキップ
- **フェーズ**: v0.1.16 本番デプロイ済み (Cloudflare Access 保護)。migration 0001–0004 本番適用済み、0005 は人間承認待ち
- **データ正本**: 図形データは IndexedDB (autosave) が常用正本、明示的「共有保存」時のみ Neon。この二重正本は ADR-0014 で意図された設計だが、利用者に分かりにくい

### 未確認事項 (推測で断定しない)
- 両システムとも**本番環境の実挙動は未確認** (Cloudflare Access 越しの検証は本セッション権限外)
- ArcSphere の点群/BIM 実変換 (py3dtiles / ifcopenshell) は「CI で実行されない」ことを確認 — 実データでの変換品質は**未確認**
- CivilDraft の Neon 実接続統合テストは `CIVILDRAFT_TEST_NEON_CONNECTION` 未設定のため**ローカル/CI とも常時 skip**
- GitHub Projects の状態は本セッションから未接続・不明

---

## 📌 3. 調査範囲と実行した検証

| 検証 | ArcSphere | CivilDraft |
|---|---|---|
| 依存インストール | ✅ pip (Py3.12 venv) / npm ci | ✅ npm ci |
| 型チェック | ✅ tsc 0 エラー | ✅ tsc 0 エラー |
| lint | ✅ ruff 0 / eslint 0 エラー (警告16) | ✅ eslint 0 エラー (警告1) |
| 単体テスト | ✅ **pytest 909 passed** / **vitest 153 passed** | ✅ **vitest 1,287 passed** (2 skip) |
| ビルド | ✅ vite build 成功 | ✅ tsc -b + vite build 成功 |
| 依存脆弱性 | ⚠️ FE 4 件 (下記) / BE は CI の pip-audit 依存 | ⚠️ 2 件 (dev 依存 jsdom→undici のみ) |
| secret 混入 | ✅ grep 精査で実 secret 0 (プレースホルダのみ) | ✅ secret-scan 0 件 |
| migration 検証 | ✅ alembic 単一 head 確認 (29 本) | ✅ validate-migrations 5 件 pass |
| E2E / PostgreSQL 統合 | ➖ 未実行 (CI 専用構成。再実行: `npx playwright test` / `pytest tests/postgres`) | ➖ 未実行 (再実行: `npm run e2e`) |
| 負荷試験 | ➖ 未実行 (CI main ブランチ限定 locust) | ➖ 該当なし |

依存脆弱性の内訳 (ArcSphere FE): vite 5.4.21 (High/dev server限定・本番影響なし)、esbuild (Moderate/dev限定)、**react-router-dom 6.30.4 (Moderate open-redirect — 唯一の runtime 該当、要更新)**。

---

## 📌 4. 総合得点とリリース判定

### ArcSphere Civil Twin: 73 / 100 — 「検証・限定運用可能、本番前に重要改善が必要」

| 領域 (配点) | 得点 | 短評 |
|---|---:|---|
| プロダクト価値・要件適合 (10) | 8.0 | 目的・ユーザー・ロードマップ明確。ADR 5 本と実装が一致 |
| 機能完成度・デモ品質 (12) | 8.6 | 機能は本物だが変換バックエンドの既定が stub、ビューアにランダム placeholder 幾何 |
| UX・A11y (8) | 5.2 | aria 55 箇所・ローディング/エラー状態あり。テーマ変数化 50%・パネル RBAC 表示バグ |
| コード品質・設計 (10) | 8.2 | authz 一元化・TOCTOU 対応 refresh・fail-closed 設計。TODO 0 |
| データ・API (8) | 6.0 | migration 29 本線形 + PG parity テスト。10 エンドポイントにページネーション欠落、N+1 1 箇所 |
| セキュリティ (12) | 7.4* | High 3 件 (**本セッションで修正済**)。CSP が SPA 文書に届かない等 Medium 複数残 |
| テスト・QA (10) | 7.4 | 909+153+E2E8。カバレッジゲート 70% 実効。変換系はモックのみ・SQLite が PG 問題を隠す実例あり |
| CI/CD (8) | 6.6 | 9 ジョブ・action SHA 固定・trivy/pip-audit/bandit ブロッキング。タグ push リリースが弱い環 |
| 運用・信頼性 (8) | 5.4 | runbook 3 本・バックアップ実証・healthcheck timer。メトリクス/アラート/ログ集約なし (自己申告) |
| 性能・コスト (5) | 3.0 | クラッシュ検出 O(n²)/リクエスト内、10 分ポーリングループ |
| ドキュメント・DX (5) | 4.3 | README/CHANGELOG/runbook 充実。独立 API 仕様書なし |
| ガバナンス (4) | 2.8 | 監査 35 アクション + scrub + 保持フロア。改ざん耐性なし (ハッシュ連鎖/署名/WORM 不在) |

*セキュリティ得点は修正後評価。修正前は 6.2 相当 → 総合 72 点。

### CivilDraft-Web-CAD: 65 / 100 — 「デモ/PoC 水準 (上位)」

| 領域 (配点) | 得点 | 短評 |
|---|---:|---|
| プロダクト価値・要件適合 (10) | 8.0 | 要件定義/基本設計/詳細設計 3 文書 (計 3,100 行) が実在し実装がこれを引用 |
| 機能完成度・デモ品質 (12) | 7.0 | CAD 中核 (描画8種・編集9種・undo/redo・数量計算・PDF/DXF/CSV 出力) は本物。**円弧ツールなし・スナップ未配線・DXF 取込 UI なし**・5 ページがメモリ内デモ |
| UX・A11y (8) | 4.4 | コマンドパレットは WAI-ARIA 準拠。**キャンバス層 aria ゼロ**・6 ページ aria ゼロ・**Ctrl+Z 二重発火バグ** |
| コード品質・設計 (10) | 7.5 | brand 型/Result 型/Command パターン一貫。dead code (snap/array/scale) と空スキャフォールド 20+ dirs |
| データ・API (8) | 4.4 | SQL 完全パラメータ化・トランザクション使用。**全リクエスト全テーブル SELECT・楽観ロック DB 未強制** |
| セキュリティ (12) | 7.8* | JWT 検証は模範的・fail-closed 徹底・secret 衛生良好。actorId 偽装 (**修正済**)・ボディ上限 (**修正済**)・レート制限なし残 |
| テスト・QA (10) | 7.0 | 1,287 件は域内最良。E2E 2 本のみ・Neon 統合常時 skip・カバレッジ閾値なし |
| CI/CD (8) | 5.8 | 4 ジョブ + SBOM 決定性ゲート + workflow YAML 検証。必須チェック 2/4・action がタグ参照 |
| 運用・信頼性 (8) | 5.6 | 30 分毎合成監視 + 自動 Issue・週次バックアップ + リストア実証は同規模で異例の充実。CSP 未配備 |
| 性能・コスト (5) | 2.3 | R-tree/カリングは実装済みだが描画パス無メモ化・API が全データ材料化 |
| ドキュメント・DX (5) | 3.6 | ADR 15 本・runbook 9 本。README が存在しない UI ボタンを記載 (取込📥/出力📤/📄)・ADR 0001–0011 が Proposed のまま |
| ガバナンス (4) | 2.6 | 監査ハッシュ連鎖 (ADR-0009) は設計良好だが**並行書込みで分岐し改ざん検出が機能不全**。SBOM/ライセンスは強い |

*修正後評価。修正前は 6.6 相当 → 総合 63 点。

**判定原則**: 高得点でも Critical 1 件以上あれば本番不可。両プロジェクトとも Critical (即時の情報漏えい/データ損失が無条件成立) は検出されなかったが、High が残存する CivilDraft は本番非推奨。

---

## 📌 5. 領域別評価 (要点)

各領域の詳細な根拠は §7〜§13 に記載。ここでは両者の対比のみ:

- **設計文化**: 両者とも例外的に良い。ArcSphere は「攻撃レビューの傷跡」(TOCTOU-safe refresh rotation、SAVEPOINT 監査、PgBouncer search_path 修正) が随所にあり、CivilDraft は ADR 駆動 + 機械検証ゲート (migration validator、SBOM 決定性、workflow YAML 検証) が根付いている。
- **共通の病理**: どちらも「テスト環境と本番環境の乖離」が最重要バグの温床。ArcSphere は SQLite テストが PG の VARCHAR 制約違反を隠し、CivilDraft は Neon 統合テスト skip が楽観ロック未強制を隠した。
- **ドキュメント過剰申告**: ArcSphere は僅少 (既知の制限を README に明記する文化)。CivilDraft は README が未実装 UI を記載しており要修正。

---

## 📌 6. 実装済み・部分実装・未実装・未確認の一覧

### ArcSphere
| 状態 | 項目 |
|---|---|
| ✅ 実装済 (検証可) | JWT RS256 + refresh 回転 + 再利用検知 / TOTP 2FA / OAuth (GitHub・Google) / セッション管理 / プロジェクト RBAC (owner/admin/editor/viewer) / 共有リンク + 署名付き tiles proxy / レイヤー・計測・CRS 変換 (pyproj) / Issue + BCF 2.1 入出力 / コメント・視点 / CDE ドキュメント (ISO 19650-lite 状態機械) / PDF 帳票 4 種 (日本語フォント) / 監査 35 アクション + CSV / SSE / webhook (SSRF ピン留め + HMAC) / outbox / 3D Tiles 実ロード |
| 🟡 部分実装 | 点群/BIM 変換 — 実装は本物 (laspy+py3dtiles / ifcopenshell) だが**既定が stub・CI 上モックのみ・prod_check は WARN 止まり** / クラッシュ検出 (重心距離 MVP、自己申告) / ビューアの placeholder 幾何 (tileset なしレイヤーに Math.random 表示) |
| ❌ 未実装 | メトリクス・アラート・ログ集約 / 監査ログ改ざん耐性 / レート制限の Redis 共有 / frontend への CSP 配布 |
| ❓ 未確認 | 本番実挙動 / 実データでの変換品質 / 負荷特性 (locust は 5 users/30s のみ) |

### CivilDraft
| 状態 | 項目 |
|---|---|
| ✅ 実装済 (検証可) | 描画 8 ツール + 編集 9 操作 (trim/extend/offset/fillet/chamfer 含む) / undo/redo (Command パターン・100 履歴) / レイヤー + 工種テンプレート / R-tree 空間索引 + ビューポートカリング / DXF import (13 エンティティ・単位系・ACI 色) + export / PDF 出力 (pdf-lib・日本語フォント) / 数量計算 (延長/周長/面積/個数/体積) + CSV (数式注入対策) / 図面健全性チェック 3 規則 / コマンドパレット (ARIA 準拠) / Worker API 19 ルート + Access JWT 完全検証 + 監査ハッシュ連鎖 + fail-closed |
| 🟡 部分実装 | 数量↔属性連携 (method/unit を図形種別から推測、revisionId='current' 固定) / 承認ワークフロー (ロール切替がデモ用トグル) / 監査ページ (API 不達時サンプル行へフォールバック) |
| ❌ 未実装 (実装済みだが未配線含む) | **スナップ (587 行実装済・未配線)** / **DXF 取込 UI (importer 1,164 行実装済・呼出しゼロ)** / 配列複写・尺度変更 (実装済・未配線) / 円弧ツール / メンバー・ロール管理 API (全プロジェクトが単独ユーザー) / レート制限 / CSP / 案件管理・システム設定等 5 ページの永続化 |
| ❓ 未確認 | 本番 Access secrets (ACCESS_TEAM_DOMAIN/AUD) 登録状態 — 未登録なら本番 API は全 503 (state.json 上「要人間確認」のまま) / Neon 実接続経路 |

---

## 📌 7. 強み

| 強み | 根拠 | 利用者への価値 | さらに伸ばす方法 |
|---|---|---|---|
| ArcSphere: 認可の一元化と網羅 | `authz.py` に集約、全プロジェクト系エンドポイントで get_project_access + テナント束縛を確認 (IDOR 検出ゼロ) | データ分離の信頼性 | authz テストの網羅を CI ゲート化 |
| ArcSphere: 実証済みバックアップ/運用 | `make backup-neon` 実動検証、runbook 3 本、healthcheck timer、鍵ローテ手順書がコードから参照される | 障害時復旧の現実性 | リストア訓練の定期化 (四半期) |
| ArcSphere: CI の実効性 | 9 ジョブ、action SHA 固定、bandit/pip-audit/trivy ブロッキング、alembic downgrade 往復検証 | リグレッション防止 | npm audit をブロッキング化 |
| CivilDraft: Access JWT 検証 | alg 固定/kid 再取得/iss/aud/exp/nbf/skew — 模範実装 (`accessJwt.ts`) | 認証境界の堅牢性 | JWKS 陳腐化上限の追加 |
| CivilDraft: 機械検証ゲート文化 | migration validator (破壊 DDL ブロックリスト+waiver 機構)、SBOM 決定性 diff、workflow YAML 検証、合成監視+自動 Issue | 「文書だけの品質」を排除 | カバレッジ閾値を同じ思想で追加 |
| CivilDraft: CAD ドメインの型設計 | brand ID 型、Result 型、Command パターン、mm/deg/Y-down 基準の一貫適用 | 拡張時の安全性 | 未配線資産 (snap 等) の配線で即機能増 |
| 両者: テストの量と質 | 実測 909+153 / 1,287 全 green、fail-closed 経路のテスト多数 | 変更容易性 | 本番相当 (PG/Neon) 統合の常時実行化 |

## 📌 8. 弱み・問題

| 弱み・問題 | 根拠 (file:line) | 影響 | 重要度 | 推奨対応 |
|---|---|---|---|---|
| AS-1: SSE 全テナント配信 | `broadcast.py:30-37`, `events.py` (旧) | 認証済み任意ユーザーへ他社の project_id/model 名/tileset URL 漏えい | **High** | ✅ **修正済** (可視プロジェクトフィルタ + fail-closed + テスト 3 件) |
| AS-2: パスワード変更でセッション残存 | `auth.py:284-290` (旧) | 盗難 refresh トークンが変更後も最長 30 日有効 | **High** | ✅ **修正済** (change-password / totp-disable で全セッション失効 + 回帰テスト 2 件) |
| AS-3: 監査 action の silent drop | `models/audit_event.py:36` VARCHAR(20) vs 26 字アクション | PG 本番で `document.status_change` 等の証跡が黙って欠落 (CDE の存在意義に直撃) | **High** | ✅ **修正済** (String(64) + migration `x2y3z4a5b6c7` + 静的スキャン回帰テスト 3 件) |
| AS-4: CSP が SPA 文書に届かない | `middleware/security.py:21` の nonce 機構が inert、`frontend/Dockerfile` 素の nginx、`ingress.yaml:44-51` | XSS 防御層の不在 (AS-6 と複合) | Medium | frontend nginx conf に CSP 追加 (B 分類) |
| AS-5: レート制限がプロセスローカル | `rate_limit.py:19` (Redis 参照なし) vs `main.py:83` の主張 | 多レプリカで実効制限が N 倍に希釈 | Medium | Redis バックエンド実装 (B) |
| AS-6: トークンを localStorage 永続化 | `authStore.ts:27-88` | XSS 時に 30 日アカウント乗っ取り (AS-2 修正で緩和済) | Medium | httpOnly cookie 化検討 (B) |
| AS-7: ボディ上限 1 MiB と 500 MB アップロードの矛盾 | `body_limit.py:28` 免除パスなし vs `models.py:67` | 既定設定では 1 MiB 超アップロードが全て 413 | Medium | アップロードパスの免除リスト追加 (A/B) |
| AS-8: /docs・/openapi.json が K8s で公開 | `ingress.yaml:32-43` | API 全容の情報開示 (Cloudflare Access で現状緩和) | Medium | 本番 docs_url=None (A) |
| AS-9: 監査改ざん耐性なし | ハッシュ連鎖/署名/append-only 権限なし | DB 書込権限者が証跡を無痕跡改変可 | Medium | ハッシュ連鎖 or 外部ログ転送 (C) |
| CD-1: 全リクエスト全テーブル SELECT | `index.ts:255-274`, `neonApiStore.ts:448-561` (`SELECT *` ×10・無 LIMIT) | データ増に線形比例する全 API 劣化、単独ユーザーで DoS 可能、全テナント内容が毎リクエスト isolate 経由 | **High** | 述語付き SQL への段階置換 (B — 設計変更。Issue 化) |
| CD-2: 楽観ロックが DB 未強制 | `neonApiStore.ts:568-616` `ON CONFLICT DO UPDATE` に `WHERE version=` なし | 並行編集で silent lost update (428/409 契約が実質無効) | **High** | version 述語 + rowcount 検査 (B — CD-1 と同時に。Issue 化) |
| CD-3: actorId ヘッダー偽装 | `index.ts:1632-1640` (旧) | service token 保持者が任意ユーザーへなりすまし | **High** | ✅ **修正済** (検証済クレームのみ採用 + テスト 2 件) |
| CD-4: ボディサイズ・レート制限なし | `index.ts:1203` (旧)、レート制限は全域不在 | 認証済み 1 ユーザーで容量/コスト DoS | **High** | ✅ **ボディ 64 MiB 上限修正済** (413 + テスト 2 件)。レート制限は Workers Rate Limiting binding 要 (C — 課金/インフラ変更) |
| CD-5: 監査ハッシュ連鎖が並行で分岐 | `neonApiStore.ts:688-704` (リクエストローカル tail 参照) | 正常並行トラフィックが「改ざん」と判定され検出機能が無効化 | Medium-High | previous_hash の DB 側直列化 (B) |
| CD-6: Ctrl+Z 二重発火 | `CanvasStage.tsx:110-139` + `CadEditorPage.tsx:752-810` の二重 window listener | 1 回の undo で 2 コマンド巻戻し。テキスト入力中も図形 undo | Medium (UX 上は High 級) | リスナー統合 (A — 次セッション推奨) |
| CD-7: README と実 UI の乖離 | README の取込📥/出力📤/📄 ボタン記載 vs `CadEditorPage.tsx` に不存在 | デモ・評価時の信頼毀損 | Medium | README 修正 + DXF 取込 UI 配線 (A/B) |
| CD-8: メンバー管理 API 不在 | `API_ROUTES` にメンバー CRUD なし | reviewer/approver ロールが到達不能 = 職務分離が机上 | Medium | メンバー管理エンドポイント追加 (B) |
| CD-9: キャンバス A11y ゼロ | `src/app/canvas/*.tsx` に role/aria/tabIndex なし | キーボード/AT ユーザーが作図領域に到達不能 | Medium | フォーカス管理 + ライブリージョン (B) |

## 📌 9. Critical および High リスク

**Critical: 0 件** (無条件で成立する情報漏えい・データ損失は検出されず。両システムとも Cloudflare Access が外周を保護)

**High: 7 件 → 5 件修正済み・2 件残存** (CD-1, CD-2 — いずれも CivilDraft 永続化層の同一根本原因「リクエスト毎全材料化 + メモリ内並行制御」。個別パッチではなく述語付き SQL への設計変更として一括対処すべき)

## 📌 10. セキュリティ評価 (OWASP ASVS/Top 10 準拠観点)

| 観点 | ArcSphere | CivilDraft |
|---|---|---|
| 認証/セッション | ◎ RS256・回転・再利用検知・2FA (AS-2 修正済) | ◎ Access JWT 完全検証 (CD-3 修正済) |
| 認可/IDOR | ◎ 全エンドポイント確認・検出ゼロ (SSE のみ High → 修正済) | ○ メンバーシップ認可一貫・拒否も監査。ただしメンバー管理 API 不在 |
| インジェクション | ◎ raw SQL ゼロ・ilike パラメータ化・XXE 対策 (defusedxml) | ◎ タグ付きテンプレート一貫・連結ゼロ |
| XSS | ○ nonce CSP 実装済みだが SPA 文書に未配達 (AS-4) | ○ シンク不検出 (innerHTML 等ゼロ)。CSP は zone 委譲のまま未適用 |
| SSRF | ◎ webhook の IP ピン留め + メタデータ遮断は模範実装 | ➖ 外部 URL 取得機能なし |
| ファイルアップロード | ○ モデル系は堅牢。document は拡張子 allowlist なし (Low) | ➖ サーバー側アップロードなし (ボディ上限は修正済) |
| レート制限/DoS | △ プロセスローカル・XFF 偽装余地 (K8s) | ✗ 不在 (CD-4 残) + CD-1 増幅 |
| secrets | ◎ 実 secret 混入なし・prod_check が既定値を FAIL | ◎ 混入なし・scan 自動化 |
| 監査 | ○ 35 アクション + scrub + strict fail-closed (AS-3 修正済)。改ざん耐性なし | ○ ハッシュ連鎖設計は良いが並行分岐 (CD-5) |
| 依存 | ○ pip-audit/trivy ブロッキング。BE ロックファイルなし (供給網リスク)・react-router-dom 要更新 | ○ audit ゲートあり。dxf-parser (低活動・攻撃対象ファイル解析) は要監視 |

## 📌 11. UX・デモ品質評価

- **ArcSphere**: デモ **Yes**。`make demo` 導線・14 パネル各個 ErrorBoundary・ローディング/空状態/エラー実装 (setError 119 箇所)・モバイル対応。ただし (1) tileset のないレイヤーがランダム幾何で「動いて見える」— デモで誤解を生むため説明必須、(2) Documents/Audit パネルの操作可否がグローバルロールで判定される表示バグ、(3) 監査 CSV export が存在しない localStorage キーを読み常に 401 (`AuditLogPanel.tsx:102`)。
- **CivilDraft**: デモ **Conditional**。CAD 編集・数量・PDF/CSV/DXF 出力・健全性チェック・コマンドパレットは実演可能で見栄えも良い。ただし DXF **取込**は UI が存在せずデモ不能 (README 記載と矛盾)、スナップなしの作図は CAD 利用者の期待と乖離、Ctrl+Z 二重発火は実演中に露見しやすい。

## 📌 12. コード・設計・テスト評価 (要約)

- 両者とも TODO/FIXME ゼロ運用。ArcSphere は残課題を README「既知の制限」へ、CivilDraft は ADR/risk-ledger へ集約する文化で、コード内地雷は少ない。
- ArcSphere の設計上の白眉: 認可一元化 (`authz.py`)・fail-closed 監査 (`strict=True` 9 操作)・outbox パターン。負債: 10 分 asyncio ポーリングループ (`models.py:466`)、documents の N+1、ページネーション欠落 10 エンドポイント。
- CivilDraft の設計上の白眉: ドメイン層の純度 (799 domain テスト)・DXF ラウンドトリップ統合テスト。負債: 空スキャフォールド 20+ ディレクトリが構造を偽装、実装済み未配線コード 4 群 (配線すれば即機能になる「凍結資産」)、Worker 永続化層のアーキテクチャ (CD-1/2/5 の根本)。
- テストの盲点は両者共通で「本番相当データストアでの並行・制約検証」。ArcSphere は PG parity テストを持つ分だけ先行。

## 📌 13. 運用・リリース準備評価 (要約)

- ArcSphere: バックアップ実証・runbook・healthcheck・冪等プロビジョニングと、**中規模 SaaS 相当の運用基盤**。欠落はメトリクス/アラート/ログ集約 (runbook-monitoring.md 自身が「未整備」と申告) と、リリースタグが CI 未通過ブランチから発行可能な点。
- CivilDraft: 30 分毎合成監視 (fail-closed 認証まで検証) + 自動 Issue 起票 + 週次バックアップ/リストア訓練 workflow は同規模プロジェクトとして突出。欠落は本番 Access secrets の登録確認 (未登録なら API 全停止のまま) とデプロイの完全手動性。

## 📌 14. 競合製品比較と現在の代替率

### ArcSphere Civil Twin (比較対象: 公開情報ベース。規模差は歴然のため「中小規模案件の日常ユースケース」に限定した代替率)

| 機能領域 | 本PJ | Autodesk Construction Cloud | Bentley iTwin | Cesium ion | Trimble Connect | 重要度 | 現在の代替率 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 3D 閲覧・統合 (点群+BIM+地形) | ○ | ◎ | ◎ | ◎ | ◎ | 40% | 50% |
| 課題管理・BCF 連携 | ○ | ◎ | ○ | ✗ | ○ | (核) | 70% |
| 変換パイプライン実運用 | △ (stub 既定) | ◎ | ◎ | ◎ | ○ | (核) | 30% |
| UX・導入容易性 | ○ | ○ | △ | ○ | ○ | 15% | 60% |
| API・外部連携 | ○ (REST+webhook+SSE) | ◎ | ◎ | ◎ | ○ | 10% | 45% |
| セキュリティ・権限・監査 | ○ | ◎ | ◎ | ○ | ○ | 15% | 65% |
| 運用・信頼性 | △ | ◎ | ◎ | ◎ | ◎ | 10% | 45% |
| ドキュメント・サポート | ○ | ◎ | ○ | ○ | ○ | 10% | 55% |

**加重代替率: 約 50%**。対象外とした大規模製品固有機能: 契約・原価管理、数千種の外部連携、24h 有人サポート (中小案件の日常利用には必須でないため。影響: エンタープライズ調達では選外となる)。

### CivilDraft-Web-CAD (比較対象: AutoCAD LT / BricsCAD Lite / ARES Standard / Jw_cad)

| 機能領域 | 本PJ | AutoCAD LT | BricsCAD | ARES | Jw_cad | 重要度 | 現在の代替率 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 作図・編集コア | △ (円弧/スナップ/ブロック欠) | ◎ | ◎ | ◎ | ◎ | 40% | 30% |
| DXF 互換 | △ (取込 UI なし) | ◎ | ◎ | ◎ | ○ | (核) | 35% |
| 数量計算・土木特化 | ○ (差別化点) | △ | △ | △ | ○ | (核) | 70% |
| UX・導入容易性 (Web・インストール不要) | ○ | △ | △ | ○ | △ | 15% | 60% |
| API・外部連携 | △ | ○ | ○ | ○ | ✗ | 10% | 30% |
| セキュリティ・権限・監査 (SaaS 承認フロー) | ○ (差別化点) | ✗ | △ | △ | ✗ | 15% | 60% |
| 運用・信頼性 | ○ | ◎ | ○ | ○ | ○ | 10% | 50% |
| ドキュメント・サポート | △ | ◎ | ○ | ○ | ○ | 10% | 40% |

**加重代替率: 約 40%**。注: 「承認ワークフロー + 監査証跡 + 数量計算の一体化」は比較 4 製品のいずれも持たない固有価値であり、代替率競争より差別化軸の深耕が合理的。

## 📌 15. 80〜90% 代替へ到達するための不足機能

**ArcSphere (50%→85% への経路)**: ①変換パイプラインの実運用化 (stub 既定廃止 + 実データ E2E + prod_check FAIL 化) ②大容量アップロード成立 (AS-7) ③断面・出来形などの土木計測拡張 ④メトリクス/アラート整備 ⑤2D 図面 (DXF) オーバーレイ — CivilDraft との統合が近道。

**CivilDraft (40%→80% への経路)**: ①スナップ配線 (実装済・XS) ②円弧ツール ③DXF 取込 UI (実装済 importer の配線・S) ④ブロック/シンボル参照 ⑤印刷尺度・線幅出力の精密化 ⑥永続化層再設計 (CD-1/2) — ①③は「未配線資産の配線」だけで到達できる最安の代替率向上策。

## 📌 16. 推奨追加機能 (上位のみ・実装可能性検証済み)

| 機能名 | 解決する課題 | 対象ユーザー | 期待効果 | 工数 | 優先度 | MVP範囲 |
|---|---|---|---|---|---|---|
| CD: スナップ配線 + 円弧ツール | CAD としての基本操作性 | 作図者 | 代替率 +10pt | S | P1 | 端点/中点/交点スナップ + 3 点円弧 |
| CD: DXF 取込 UI | 既存図面資産の活用 (最頻ユースケース) | 全ユーザー | 代替率 +8pt | S | P1 | ファイル選択→importer→レイヤーマッピング確認ダイアログ |
| AS: 変換パイプライン実運用化 | 「デジタルツイン」の中核価値 | 全ユーザー | stub 排除で商用信頼性 | M | P1 | conversion extras 導入手順の CI 検証 + 実サンプル E2E 1 本 |
| AS: メトリクス + アラート | 障害の受動検知 | 運用者 | MTTR 短縮 | M | P2 | /metrics (Prometheus) + Cloudflare 通知 1 経路 |
| CD: メンバー・ロール管理 API + UI | 職務分離の実効化 | 管理者 | 承認フローの本番成立 | M | P2 | project_members CRUD + 権限テスト |
| AS+CD: 図面⇔3D 連携 (CivilDraft 図面を ArcSphere にオーバーレイ) | 2D/3D 分断 | 両製品ユーザー | 独自の統合価値 | L | P3 | DXF→gis レイヤー変換 1 方向 |

## 📌 17. 優先順位付き改善バックログ

| ID | 改善内容 | 優先度 | 効果 | 工数 | 分類 | 完了条件 |
|---|---|---|---|---|---|---|
| 1 | AS-1/2/3 セキュリティ修正 | P1 | High 3 件解消 | S | A | ✅ 本セッション完了 (テスト 8 件追加・全 suite green) |
| 2 | CD-3/4 actorId + ボディ上限 | P1 | High 2 件解消 | S | A | ✅ 本セッション完了 (テスト 4 件追加・全 suite green) |
| 3 | CD-1/2/5 永続化層再設計 (述語付き SQL + version WHERE + hash 直列化) | P1 | High 2 件 + Medium 1 件解消・性能根治 | L | B | 全リクエストの SELECT が述語付き・並行書込みテスト green |
| 4 | CD-6 Ctrl+Z 二重発火修正 | P1 | 主要 UX バグ解消 | XS | A | keydown リスナー一本化 + jsdom テスト |
| 5 | AS-7 アップロードパスのボディ上限免除 | P1 | 500MB アップロード成立 | S | A | multipart パス免除 + DoS テスト維持 |
| 6 | AS: react-router-dom 更新 / CD: README 実 UI 同期 | P2 | 脆弱性/信頼性 | XS | A | audit green / README 記載と UI 一致 |
| 7 | AS-4 CSP を SPA 文書へ配布 | P2 | XSS 防御成立 | S | B | curl で CSP ヘッダー確認 |
| 8 | CD: スナップ配線 + DXF 取込 UI | P2 | 代替率 +18pt | S×2 | B | E2E で取込→編集→出力 |
| 9 | AS-5 レート制限 Redis 化 / CD-4 残 (Workers Rate Limiting) | P2 | DoS 耐性 | M / C | B/C | 多プロセスで上限一定 |
| 10 | AS-8 本番 /docs 無効化・AS: BE ロックファイル導入 | P3 | 露出/供給網 | XS/S | A | — |
| 11 | AS-9 監査改ざん耐性 / CD-8 メンバー管理 | P3 | ガバナンス | M | B/C | — |
| 12 | 対応不要: CD の R2 導入 (ADR-0014 で意図的スキップ)・AS の Codecov 復活 (削除理由が正当) | — | — | — | 6 | — |

## 📌 18. 30/60/90 日ロードマップ

- **30 日 (安定化)**: バックログ #3 の設計 + 実装着手、#4/#5/#6 完了、ArcSphere 本番 DB への migration 追随 (3 本 + 今回の `x2y3z4a5b6c7`) を承認プロセス経由で適用、CD 本番 Access secrets 登録確認
- **60 日 (信頼性)**: #3 完了 + Neon 統合テスト常時実行化、#7/#8 完了、AS メトリクス/アラート MVP、E2E 拡充 (CD: 2→10 本、AS: 認可境界系を追加)
- **90 日 (成長)**: CD 円弧/ブロック着手、AS 変換パイプライン実運用化 + 実データ E2E、両製品の必須チェック/branch protection をコード化 (rulesets)

## 📌 19. 直ちに実装可能な項目 (A 分類) — 本セッション実施分

| 実施 | リポジトリ | 内容 | 検証 |
|---|---|---|---|
| ✅ | ArcSphere | SSE テナントフィルタ (`events.py` 全面改修、60s TTL 可視集合、fail-closed) | 新規テスト 3 件 + 既存 SSE 系 13 件 green |
| ✅ | ArcSphere | change-password / totp-disable で全セッション失効 | 新規回帰テスト 2 件 + 認証系 20 件 green |
| ✅ | ArcSphere | audit action String(64) + migration + EXPECTED_HEAD 更新 + 静的スキャン回帰テスト | 新規テスト 3 件 + 監査系 29 件 green、alembic 単一 head 確認 |
| ✅ | CivilDraft | actorId を検証済みクレームのみに (service token は `service-token:<common_name>`) | 更新テスト 1 + 新規 1 件、worker 系 111 件 green |
| ✅ | CivilDraft | JSON ボディ 64 MiB 上限 (Content-Length + 実測の二段、413) | 新規テスト 2 件 green |

## 📌 20. 最終判定と次に実行すべき上位 5 項目

1. **CivilDraft 永続化層の再設計 (バックログ #3)** — 残存 High の唯一の根本対処。これなしに本番利用者を増やしてはならない
2. **ArcSphere 本番への migration 追随適用** — リポジトリと本番 DB の乖離 (4 migration) は今回の監査修正 (AS-3) が本番で効かないことを意味する。承認手順書経由で適用
3. **CD-6 Ctrl+Z 二重発火 + README/UI 乖離の解消** — 数時間で終わりデモ信頼性が大きく改善
4. **AS-7 アップロード上限矛盾の解消** — 現行既定では製品の中核機能 (500MB モデルアップロード) が成立していない
5. **未配線資産の配線 (CD スナップ / DXF 取込 UI)** — 最小工数で競合代替率を最も動かす

### 最終回答

- **現在の完成度**: ArcSphere **80%** / CivilDraft **60%**
- **現在の競合代替率**: ArcSphere **約 50%** / CivilDraft **約 40%**
- **デモ可能か**: ArcSphere **Yes** / CivilDraft **Conditional**
- **本番リリース可能か**: ArcSphere **Conditional** (修正の本番反映 + 監視整備後に可) / CivilDraft **No** (CD-1/2 解消まで)
- **最大の強み**: ArcSphere = 実証された認可・監査・運用基盤 / CivilDraft = ADR 駆動の機械検証ゲート文化と CAD ドメイン型設計
- **最大の弱み**: ArcSphere = テスト環境 (SQLite/モック) が本番 (PG/実変換) の欠陥を隠す構造 / CivilDraft = リクエスト毎全 DB 材料化の永続化アーキテクチャ
- **最優先の改善項目**: ArcSphere = 本番 migration 追随 + 変換パイプライン実運用化 / CivilDraft = 永続化層の述語付き SQL 化 (CD-1/2/5 一括)
- **推奨する次の開発フェーズ**: ArcSphere = **本番硬化 (Production Hardening)** — 新機能凍結で監視・実変換・上限矛盾を解消 / CivilDraft = **基盤修正 (Foundation Fix)** — 永続化再設計と未配線資産の配線を新機能より優先

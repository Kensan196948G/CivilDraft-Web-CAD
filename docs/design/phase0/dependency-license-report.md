# Phase 0 依存関係・ライセンスレポート（SBOM要約）

対象: `Civil-Draw`（Kensan196948G/Civil-Draw、HEAD `ad76b9b`）。要件定義書§22の品質成果物「SBOM」、§19 R-009への対応。

## 直接依存（package.jsonベース、35件）

### dependencies（本番、10件）

| パッケージ | バージョン | ライセンス | 備考 |
| --- | --- | --- | --- |
| @azure/msal-browser | ^5.10.1 | MIT | 認証モジュールごとdiscard（[ADR-0001](../../adr/0001-auth-cloudflare-access-not-msal-browser.md)）。CivilDraftでは非採用 |
| dxf-parser | ^1.1.2 | MIT | modify継承。単位変換アダプタで包む |
| dxf-writer | ^1.18.4 | MIT | modify継承。setUnits('Meters')と実値mmの不整合を修正 |
| konva | ^9.3.22 | MIT | as_is継承。4層分離最適化と共に継続利用 |
| nanoid | ^5.1.9 | MIT | as_is継承想定（ID生成そのものは継続、Brand型でラップ） |
| rbush | ^4.0.1 | MIT | as_is継承。R-tree空間索引の中核。インスタンス化可能な設計へ変更 |
| react | ^18.3.1 | MIT | modify（バージョン鮮度: 現行最新は19.2.7系、1メジャー遅れ） |
| react-dom | ^18.3.1 | MIT | reactと同様 |
| react-konva | ^18.2.14 | MIT | as_is継承 |
| zustand | ^4.5.7 | MIT | modify（バージョン鮮度: 現行最新は5.0.14系、store分割設計は改修） |

### devDependencies（開発、25件）

全て MIT または Apache-2.0（`typescript-eslint`, `@vitejs/plugin-react`等含む）。npm view個別確認済み、コピーレフト系（GPL/LGPL/AGPL）混入なし。バージョン一覧は `Civil-Draw/package.json` 参照。

## 間接依存（package-lock.json全解決、389件）

`package-lock.json`（lockfileVersion 3）が保持する全パッケージのlicenseフィールドを機械集計。

| ライセンス | 件数 | コピーレフト |
| --- | --- | --- |
| MIT | 313 | 否 |
| Apache-2.0 | 24 | 否 |
| ISC | 20 | 否 |
| MPL-2.0等その他許容的ライセンス | 残余（32件） | 否 |
| GPL/LGPL/AGPL系 | **0** | — |

**結論**: コピーレフト系ライセンスの混入は確認されなかった。公開・配布上のブロッカーなし（R-009: 裏付け・良好）。

## npm audit（2026-07-15実測）

| 重大度 | 件数 | 内訳 | 本番影響 |
| --- | --- | --- | --- |
| critical | 0 | — | — |
| high | 2 | vite（直接依存）、ws（間接依存） | package-lock.json上devDependency専用ツリー、`vite build`成果物には非混入 |
| moderate | 1 | js-yaml | 同上 |
| low | 1 | @babel/core | 同上 |

4件全てdevDependencyツリー内に限定されており、本番distバンドルへの混入は確認されなかった。`docs/SECURITY_AUDIT.md`は2026-07-15時点で既にstale（この実測結果を反映していない）。

## フォント・素材・シンボル

土木記号・アイコン・テンプレートは全て自作SVG/座標配列ベース。外部フォント・アイコンフォント・商用素材への依存はゼロ。

## 未整備事項（Phase 1で対応、[ADR-0011](../../adr/0011-dependency-license-hygiene.md)）

- NOTICE / THIRD-PARTY-NOTICES ファイルが存在しない → プロジェクト開始時から自動生成する仕組みを導入
- `package-lock.json` と `pnpm-lock.yaml` の二重ロックファイル管理 → 単一ロックファイル（pnpm-lock.yamlのみ等）に統一
- 正式なCycloneDX/SPDX形式SBOMは未生成（本レポートは手動集計による要約）。CivilDraft側のCI構築時に `npm sbom` または `cyclonedx-npm` をCIパイプラインへ組み込み、コミット毎に自動生成する

## 参照

- [継承台帳](./inheritance-ledger.md)
- [リスク台帳](./risk-ledger.md)（R-009）
- [ADR-0011: 依存関係ライセンス衛生](../../adr/0011-dependency-license-hygiene.md)

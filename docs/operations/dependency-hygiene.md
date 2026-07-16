# 📋 依存関係ライセンス衛生・SBOM 運用手順

CivilDraft-Web-CAD の依存関係に対するライセンス衛生（copyleft 混入防止）と、
SBOM（Software Bill of Materials）・サードパーティ表示（THIRD-PARTY-NOTICES）の
生成・維持手順を定める。Issue #12 対応。

## 📌 目的

- 配布物（ブラウザにバンドルされる runtime 依存）に **copyleft 系ライセンスが混入していない**
  ことを継続的に確認する。
- MIT/BSD/ISC/Apache 等の **許諾表示（attribution）義務**を満たす証跡（THIRD-PARTY-NOTICES.md）を保つ。
- サプライチェーン監査・脆弱性スキャンの入力となる **SBOM**（CycloneDX 形式）をリリース証跡として保持する。

## 🔧 生成物と生成コマンド

| 生成物 | コマンド | 内容 | コミット |
|---|---|---|---|
| `sbom/civildraft-sbom.cdx.json` | `npm run sbom` | CycloneDX 1.5 形式。依存グラフ**全体**（本番+開発）を列挙 | ✅ する |
| `THIRD-PARTY-NOTICES.md` | `npm run notices` | 配布 runtime 依存（`dependencies` の本番クロージャ）のライセンス一覧＋許諾条項 | ✅ する |

- `npm run sbom` … `npm sbom`（npm 10+ 標準機能）を使用。新規 devDependency は導入していない。
- `npm run notices` … `scripts/generate-third-party-notices.mjs`（Node 標準 API のみの自作スクリプト）。
  `node_modules` の `package.json` / `LICENSE` を走査する。新規 devDependency は導入していない。

> `sbom/` ディレクトリはコミット済みの生成物により常に存在する。万一空クローンで
> `npm run sbom` がリダイレクト先不在で失敗する場合は `mkdir -p sbom` を先に実行する。

## 🔁 いつ再生成するか

| タイミング | 実行 | 理由 |
|---|---|---|
| 依存の追加・更新・削除時（`package.json` / `package-lock.json` 変更時） | `npm run sbom` と `npm run notices` の両方 | 依存グラフとライセンス一覧を最新化する |
| リリース前（タグ付け前） | `npm run sbom` と `npm run notices` の両方 | リリース証跡として最新状態を固定する |

- 再生成後は **差分をレビューしコミットする**。依存に変化がなくても SBOM の
  `metadata.timestamp` / `serialNumber` は毎回変わる（`npm sbom` の仕様）。これは想定内。
- `THIRD-PARTY-NOTICES.md` は決定的出力とし、依存に変化がなければ再生成しても差分が出ない。
  CI の `git diff --exit-code THIRD-PARTY-NOTICES.md` はこの前提で drift を検出する。

## 🔐 確認観点（レビュー時チェックリスト）

1. **copyleft 混入チェック（最重要）**
   - `npm run notices` の標準エラー出力に
     `WARNING: copyleft 系ライセンスを検出しました` が出ていないこと。
   - 検出パターン: `GPL / LGPL / AGPL / MPL / EPL / CDDL / CPL / OSL / EUPL / SSPL / CC-BY-SA`。
   - 検出された場合は **リリースを止め**、法務観点で当該依存の要否・代替を検討する（下記「エスカレーション」）。
2. **UNKNOWN ライセンスの有無**
   - サマリー表に `UNKNOWN` があれば、当該パッケージの LICENSE を手動確認して分類する。
3. **`dependencies` 解決漏れの有無**
   - `WARNING: dependencies に宣言されているが解決できませんでした` が出ていないこと
     （出た場合は `npm ci` で node_modules を復元してから再実行）。
4. **SBOM の妥当性**
   - `bomFormat: CycloneDX`、`components` が非空であること。

### コピーレフト検出時のエスカレーション

`npm run notices` は生成を継続しつつ **報告のみ**を行う（生成物は常に更新される）。
copyleft を検出した場合の可否判断は自動化せず、以下の順で人間が判断する。

1. 当該依存が **直接依存か推移的依存か**を `npm ls <pkg>` で確認する。
2. デュアルライセンス（例: `MIT OR GPL-3.0`）であれば許諾側を選択できるか確認する。
3. 代替パッケージ、または当該機能の内製化を検討する。
4. 判断結果を Issue に記録する。

## 🗺️ 現状のライセンス調査結果（2026-07-16 時点）

### 直接依存（`dependencies`）10 件

| パッケージ | ライセンス |
|---|---|
| react | MIT |
| react-dom | MIT |
| konva | MIT |
| react-konva | MIT |
| zustand | MIT |
| rbush | MIT |
| dxf-parser | MIT |
| dxf-writer | MIT |
| pdf-lib | MIT |
| @pdf-lib/fontkit | MIT |

### 本番依存クロージャ（推移的依存を含む）21 件

`react` / `react-dom` / `konva` / `react-konva` / `zustand` / `rbush` / `dxf-parser` /
`dxf-writer` / `pdf-lib` / `@pdf-lib/fontkit` に加え、推移的依存として
`scheduler` / `react-reconciler` / `its-fine` / `loglevel` / `quickselect` /
`@pdf-lib/standard-fonts` / `@pdf-lib/upng` / `pako` / `tiny-inflate` /
`@types/react-reconciler`（2 バージョン）を含む。

- ライセンス構成: **MIT 中心、ISC × 1（quickselect）、MIT AND Zlib × 1（pako）**。
- **copyleft 系ライセンスは 0 件**。ISC は MIT と同等の許諾型ライセンスであり問題ない。
- devDependencies（vite / eslint / vitest / typescript 等のビルド専用ツール）は
  配布物に含まれないため THIRD-PARTY-NOTICES の対象外。

### ロックファイル統一状況

- ロックファイルは `package-lock.json` 単一。`pnpm-lock.yaml` / `yarn.lock` は存在しない。
  パッケージマネージャは npm に統一されている。

### 既知の注意点: `npm sbom --omit dev` の欠落

- npm 11.6.2 の `npm sbom --omit dev` は、dedupe 済みの `react` / `react-dom` / `scheduler`
  を本番クロージャから **欠落させる**（フルツリー出力には正しく含まれる）。
- このため:
  - SBOM は `--omit dev` を使わず **フルツリー**を出力する（`npm run sbom`）。
  - THIRD-PARTY-NOTICES は `npm sbom` に依存せず、`generate-third-party-notices.mjs` が
    `dependencies` から **独自に本番クロージャを BFS 走査**する（react/react-dom/scheduler を正しく捕捉）。

## ⚙️ CI 組み込み

`.github/workflows/ci.yml` の `compliance` ジョブで次を実行する。

- `npm run sbom` で CycloneDX SBOM を生成し、CI artifact として保存する。
- `npm run notices` で `THIRD-PARTY-NOTICES.md` を再生成する。
- `git diff --exit-code THIRD-PARTY-NOTICES.md` で、配布表記の未コミット差分を検出する。

SBOM は timestamp/serialNumber が毎回変わりうるため、drift 検出対象にはせず artifact 保存に留める。
SBOM を用いた追加脆弱性スキャン（CycloneDX 対応スキャナ）は、導入ツールと許可ポリシーを人間承認後に追加する。

## 🔗 関連

- 生成スクリプト: `scripts/generate-third-party-notices.mjs`
- npm scripts: `package.json`（`sbom` / `notices`）
- Issue #12（依存関係ライセンス衛生・SBOM 自動生成） / Issue #17（CI 構造課題）

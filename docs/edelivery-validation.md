# 電子納品の外部検証工程（SXF / PDF/A）

最終更新: 2026-08-10

## 位置づけ

CivilDraft の SXF（P21）出力と PDF/A 指向メタデータは **自己宣言** です。
本稿の工程は「外部検証の準備・実行」であり、**適合の自動断定はしない**。
最終判断は発注者の電子納品要領（対象工種・発注者）と検査職員・電子納品チェックシステムによる。

## 1. 事前生成

```bash
# PDF/A 指向サンプル生成（verapdf 検証用）
node scripts/tools/generate-pdfa-sample.mjs sample-pdfa.pdf

# SXF(P21) の基本構造チェック（試作レベル）
node scripts/tools/validate-sxf.mjs civildraft.P21
```

## 2. PDF/A 検証（verapdf）

1. verapdf を導入（Java が必要。公式: https://verapdf.org/software/ の
   `verapdf-installer.zip` を対話インストール）。
2. 検証実行:

```bash
scripts/tools/verify-pdfa.sh sample-pdfa.pdf
# または
VERAPDF_BIN=<verapdf のパス> scripts/tools/verify-pdfa.sh sample-pdfa.pdf
```

verapdf バイナリ未導入でも **Docker（verapdf/cli）** があれば `verify-pdfa.sh` が自動で使用する:

```bash
docker pull verapdf/cli:latest
scripts/tools/verify-pdfa.sh sample-pdfa.pdf
```

3. `isValid`・validationReport を確認し、警告の原因を記録する。
4. 機械検証合格でも、発注者の電子納品要領と検査職員の確認を必須とする。

### 実行記録（2026-08-10）

- ツール: verapdf 1.30.2（Docker イメージ `verapdf/cli:latest`・Docker 実行）
- 検証対象: `generate-pdfa-sample.mjs` が生成するサンプル
  （`scripts/tools/assets/DejaVuSans.ttf` 埋め込み・公式 sRGB2014 ICC 同梱）
- 結果: **PDF/A-1b 適合**（`isCompliant="true"`・passedRules=129 / failedRules=0 / failedChecks=0）
- 備考: 埋め込みフォントに日本語サブセット OTF（NotoSansJP）を使用した場合、
  pdf-lib のサブセット幅情報と verapdf の検証が 6.3.6（グリフ幅整合）で非適合になることを確認。
  適合サンプルには TTF（DejaVu Sans・Bitstream Vera ライセンス）を使用する。
  `FONT_FILE=<ttf> node scripts/tools/generate-pdfa-sample.mjs` で差し替え可能。

## 3. SXF（P21）の外部チェック

1. 対象発注者の電子納品要領を一次情報（国交省・自治体ホームページ等）で確認し、
   要求 SXF 版（AP202 等）と属性エンティティ要件を特定する。
2. 電子納品チェックシステム（発注者指定）で `civildraft.P21` を検証する。
3. 不合格項目（属性エンティティ・CAD 製図基準・円弧表現等）を記録し、
   `src/domain/edelivery/sxfP21.ts` へ Issue 化して実装する。

現状の未対応・課題は `docs/sxf-conformance.md` に整理済み。

## 4. 記録事項

| 項目 | 記録先 |
| --- | --- |
| 検証日時・バージョン（アプリ/ツール） | PR・リリースノート・本ファイル |
| verapdf レポート（mrr/xml） | 納品資料フォルダ（リポジトリ外） |
| 電子納品チェック結果 | 発注者指示の帳票 |
| 適合判断 | 人間（検査職員・発注者） |

## 5. 自動化の境界

- CI では構造チェック（`validate-sxf.mjs`）と生成スクリプトのみを実行できる。
- verapdf・電子納品チェックシステムは外部ツールのため、人間環境で実行し結果を記録する。

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

3. `isValid`・validationReport を確認し、警告の原因を記録する。
4. 機械検証合格でも、発注者の電子納品要領と検査職員の確認を必須とする。

> 2026-08-10 時点: 実行環境では verapdf のヘッドレス導入が対話型インストーラのため
> 未実施（Java は利用可）。導入手順は上記のとおり。

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

# PDF/A 適合検証（verapdf）

最終更新: 2026-08-10

## 位置づけ

CivilDraft の PDF/A-1b 指向メタデータは **自己宣言** であり、適合を自動断定しない。
`scripts/tools/verify-pdfa.sh` で verapdf による機械検証を行い、**人間による最終確認**を
必須とする（電子納品方針: `docs/assessment/comprehensive-evaluation-2026-08-10.md` §残課題）。

## 実装状況

- XMP メタデータ（pdfaid part=1 / conformance=B）: `src/domain/pdf/pdfA.ts`
- OutputIntent（GTS_PDFA1）: 同ファイル
- DestOutputProfile: **公式 sRGB2014 ICC プロファイル**（ICC Color Registry 配布・
  `src/domain/pdf/assets/srgb-icc.icc`・`src/domain/pdf/srgbIcc.ts` に base64 同梱）

## verapdf インストール（例）

```bash
# Debian/Ubuntu 等の例（公式配布は https://verapdf.org/software/ を参照）
curl -fsSL -o /tmp/verapdf.zip https://software.verapdf.org/releases/1.25.122/verapdf-installer.zip
unzip /tmp/verapdf.zip -d /tmp/verapdf-installer
cd /tmp/verapdf-installer && ./verapdf-install.sh
```

## 実行

```bash
scripts/tools/verify-pdfa.sh output.pdf
# または
VERAPDF_BIN=/opt/verapdf/verapdf scripts/tools/verify-pdfa.sh output.pdf
```

終了コード: 0 = 検証実行成功（適合有無はレポートの `isValid` を確認） / 2 = 引数エラー /
3 = verapdf 未インストール。

## 判定手順

1. レポートの `isValid` と `validationReport` を確認する。
2. 警告（非致死）があれば原因（フォント埋め込み・透過・注釈等）を記録する。
3. 機械検証合格でも、発注者の電子納品要領（対象工種・発注者）と検査職員の確認を必須とする。

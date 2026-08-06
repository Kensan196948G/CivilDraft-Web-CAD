# ファイル互換方針（Issue #43）

作成日: 2026-08-06
状態: 方針確定（JWW/SXF/DWG は調査・バックログ）

## 1. 方針

1. **正本は内部 Geometry モデル**（詳細設計仕様書 §6・ADR-0012/0013）とし、入出力は変換層で吸収する。
2. 当面の交換形式は **DXF（R12 互換ベース）+ PDF + CSV** とし、JWW/SXF/DWG は追加しない
   （後述の理由によりバックログ）。
3. 未対応要素は黙って捨てず、`ValidationIssue`（警告/情報）として利用者へ提示する
   （取込・健全性チェック `unsupported-dxf` と連携）。
4. 単位は内部 mm に統一し、入出力時に `$INSUNITS` 等で変換する（R-002/R-004 実績）。
5. 変換は「往復で意味論を保証しない」方針。合成図形（hatch/dimension/symbol）は
   プリミティブへ分解されるため、往復前後の差分は図面比較（DrawingComparePage）で確認する。

## 2. 対応状況（実装ベース）

| 形式 | 取込 | 出力 | 対応要素 | 制約 |
|---|---|---|---|---|
| DXF | ✅ | ✅ | LINE/CIRCLE/ARC/ELLIPSE/POLYLINE/TEXT/HATCH・レイヤー（色・線種・lock/frozen）・$INSUNITS | R12互換・XDATA除去・合成図形の分解・spline/rectangle型変化 |
| PDF | - | ✅ | 全描画要素＋日本語フォント（NotoSansJPサブセット） | 印刷向け（編集不可） |
| CSV | ✅ | ✅ | 測点・数量 | 数式インジェクション対策済み |
| JWW | ❌ | ❌ | - | 下記バックログ |
| SXF | ❌ | ❌ | - | 下記バックログ |
| DWG | ❌ | ❌ | - | ODA等のライセンス・コスト判断が必要 |

## 3. 追加形式の判断基準（人間決裁）

### JWW / SXF
- JWW は独自バイナリ/テキスト混在、SXF は国交省標準（SXF P21 等）。仕様書の入手と
  変換検証データの確保が必要。需要が確認でき次第、調査Issueとして起票する。

### DWG
- Autodesk 非公開形式のため ODA（Open Design Alliance）ライブラリ等の契約が前提。
  ライセンス・コスト・法的判断を要するため**人間決裁必須**。
- 代替: ユーザー環境で DWG→DXF 変換（AutoCAD等）を前提とし、当方では DXF 受領を標準とする。

## 4. 移行アシスタント（Issue #60）

取込時に「変換可否・失われる要素・代替表現・修正候補」を一覧提示する UI を将来実装する。
現状の `unsupported-dxf` チェックと取込 issues がその基盤。詳細設計はバックログ。

## 5. 関連

- `src/domain/dxf/dxfImporter.ts` / `dxfExporter.ts`（変換実装）
- `tests/integration/editorFlow.test.ts`（非可逆仕様の文書化）
- `docs/operations/production-deployment.md`


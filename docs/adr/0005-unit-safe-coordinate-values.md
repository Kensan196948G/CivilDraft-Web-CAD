# ADR-0005: 座標・寸法値は単位タグ付き値型（LengthValue等）で扱う

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Civil-Drawの座標・寸法は単位なしの素の`number`型として扱われている。Phase 0調査で`dxfExporter.ts`がDXFヘッダーで`setUnits('Meters')`を宣言しながら、実際の座標値はmm前提のまま無変換で出力しているという具体的な不整合バグを確認した（[リスク台帳](../design/phase0/risk-ledger.md) R-004、顕在化）。土木図面は測点（IP/BP/EP等）・縦断・横断で複数の単位系（m、mm、‰勾配等）が混在するため、単位なしnumberでの座標表現は誤変換・誤表示のリスクが恒常的に存在する。詳細設計仕様書§4.2は`LengthValue`/`AreaValue`/`VolumeValue`等の単位タグ付き値型を既に定義している。

## Decision

CivilDraftの座標・寸法・数量に関わる値は全て詳細設計仕様書§4.2の単位タグ付き値型（`LengthValue`等）で扱う。素のnumberによる座標表現は継承しない（discard）。DXF入出力（dxf-parser/dxf-writer）の境界では、単位タグ付き値型と外部ライブラリの単位系との変換を専用アダプタ層に集約する。

## Consequences

- 単位の取り違えによるバグ（Civil-Drawで確認された`setUnits('Meters')`とmm座標の不整合と同種のもの）を型システムで防止しやすくなる
- `dxf-writer`の`setUnits()`呼び出しが座標値を内部的に自動スケーリングするかどうかは未確認（[性能ベースライン](../design/phase0/performance-baseline.md)のopen_questions）であり、実装時にライブラリ挙動を確認してからアダプタ層の変換ロジックを確定する
- 幾何演算エンジン群（modify対象）は単位タグ付き値型を入出力とするようインターフェースを調整する

# ADR-0002: 全エンティティIDにBrand&lt;T,B&gt;による公称型付けを導入する

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Civil-Drawでは案件ID・図面ID・図形IDなどが全て素の`string`型（`nanoid`生成）として扱われており、TypeScriptの構造的型付けの下ではコンパイラが異なる種類のIDの取り違えを検出できない（例: `ProjectId`を`DrawingId`が必要な箇所に渡してもコンパイルエラーにならない）。詳細設計仕様書§4.1は`Brand<T,B>`によるIDの公称型付け（`ProjectId`/`DrawingId`/`RevisionId`/`GeometryId`/`LayerId`/`SurveyPointId`/`QuantityItemId`/`ConstructionStepId`）を既に定義している。Phase 0のID型設計方針の棚卸しでは、この不採用状態がR-001（既存データモデルへの依存）の筆頭適用例と判定された。

## Decision

CivilDraftの全エンティティIDは詳細設計仕様書§4.1の`Brand<T,B>`パターンで公称型付けする。Civil-Drawの素の`string`ID設計は継承しない（discard）。IDの生成自体（`nanoid`）はas_isで継続し、生成結果をBrand型でラップする。

## Consequences

- 型レベルでID種別の取り違えを防止でき、レビュー・テストで発見すべきバグの一部をコンパイル時に検出できる
- 既存の（新規実装される）API境界・永続化層でBrand型⇔string間の変換関数を一貫して用意する必要がある
- `nanoid`は引き続き依存パッケージとして利用する

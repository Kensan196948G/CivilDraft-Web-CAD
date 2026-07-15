# ADR-0013: 図形派生生成のID発番方針（crypto.randomUUID + コンテキスト注入）

- Status: Accepted
- Date: 2026-07-15
- 関連: ADR-0002（Brand ID型）、Issue #5（幾何演算エンジン群の移植）

## Context

継承元Civil-Drawの幾何演算エンジン（trimEngine / filletEngine / chamferEngine / offsetEngine /
arrayEngine / scaleEngine / dimensionEngine）は、派生図形の生成時にエンジン関数の内部で
`nanoid()` を直接呼んでIDを発番していた。この設計には次の問題がある。

1. ドメイン関数にID発番という副作用が埋め込まれ、同一入力から同一出力が得られない
   （テストが非決定的になり、スナップショット比較やプロパティベーステストを阻害する）
2. `nanoid` という外部依存が増える（監査対象・サプライチェーン面積の増加）
3. `GeometryBase` が要求する `createdAt` / `updatedAt` の取得（`new Date()`）にも同種の問題がある

## Decision

1. ID発番はWeb標準の `crypto.randomUUID()` を採用する。Node.js 24+（本プロジェクトのengines指定）
   と全モダンブラウザに内蔵されており、依存追加なしで122bitのランダム性を持つ。
   `nanoid` は導入しない。
2. 図形を新規生成するエンジン関数は `GeometryCreationContext`（`newId()` と `now()` を持つ）を
   省略可能な最終引数として受け取る。省略時は `defaultCreationContext`
   （crypto.randomUUID + `new Date().toISOString()`）を用いる。
3. テストは決定的なコンテキスト（連番ID・固定タイムスタンプ）を注入し、出力を完全一致で検証する。

```typescript
// 本番呼び出し（既定コンテキスト）
const result = trimLine(target, cutter, clickPoint)

// テスト呼び出し（決定的コンテキスト）
const ctx = { newId: () => 'test-1' as GeometryId, now: () => '2026-07-15T00:00:00.000Z' }
const result = trimLine(target, cutter, clickPoint, ctx)
```

## Consequences

- ID長はnanoid既定の21文字からUUIDの36文字へ増えるが、DXF出力・永続化のいずれでも
  実害はない（DXFハンドルは別途変換層で採番する）
- 将来、短いIDや衝突検査付き採番が必要になった場合も、`GeometryCreationContext` の
  実装差し替えだけで対応でき、エンジン側の変更は不要
- ストア層（zustand導入後）はアプリ起動時に単一の既定コンテキストを共有すればよい

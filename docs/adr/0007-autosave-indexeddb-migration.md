# ADR-0007: 自動保存はlocalStorageからIndexedDBへ移行する

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Civil-Drawの自動保存機構（`autosave.ts`）はlocalStorageのみを使用しており、以下の問題をPhase 0調査で確認した（[リスク台帳](../design/phase0/risk-ledger.md) R-006、顕在化）。

- localStorageは容量上限が小さく（ブラウザ依存だが概ね5〜10MB程度）、大規模図面データでは容量超過（QuotaExceededError）が発生しうる
- 容量超過時、現行実装は例外を握りつぶしており、`docs/FUNCTION_CHECK.md`が主張する「警告表示」動作と実装が矛盾している
- 監査ログ（authLogger.ts）もlocalStorage 200件FIFOという同様の構造的制約を持つ

詳細設計仕様書§2のディレクトリ構成は`src/infrastructure/`層でのIndexedDB利用を想定している。

## Decision

CivilDraftの自動保存・下書き永続化はIndexedDBへ移行する。localStorageは小容量の設定値・UI状態等の用途に限定し、図面データ本体の永続化には使用しない。移行に伴い、容量超過時の失敗はResult型（[ADR-0003](./0003-result-type-for-expected-failures.md)）で表現し、UIへ確実に伝播させる。

## Consequences

- IndexedDBのトランザクション・スキーマバージョニングの設計が新規に必要になる
- 容量超過時のユーザー体験（警告表示、古い下書きの整理提案等）を実装レベルで担保できるようになる
- 監査ログの永続化先は[ADR-0009](./0009-audit-log-hash-chain-workers-neon.md)（Workers + Neon）と役割分担する（ローカル下書き vs. 監査証跡の恒久保存）

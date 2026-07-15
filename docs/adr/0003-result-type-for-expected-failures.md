# ADR-0003: 予期される失敗の表現にResult&lt;T,E&gt;を採用し、例外送出と分離する

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Civil-Drawはバリデーション失敗・DXFパースエラー・保存失敗などの「予期される失敗」を主にJavaScript例外（`throw`）または`undefined`/`null`返却で表現しており、呼び出し側が失敗ケースを型システム上で網羅的に扱う仕組みがない。詳細設計仕様書§4.2は`Result<T,E>`判別共用体型と`ValidationIssue`型を既に定義している。autosave.tsがQuotaExceededError等の例外を握りつぶす実装（[リスク台帳](../design/phase0/risk-ledger.md) R-006）は、この設計方針不在が引き起こす典型的な不具合パターンである。

## Decision

CivilDraftでは「呼び出し元が回復可能な、予期される失敗」は全て`Result<T,E>`で表現し、例外送出は「回復不能なプログラミングエラー」に限定する。DXFパース、バリデーション、永続化（IndexedDB書き込み等）はResult型を返すインターフェースとして新規設計する。Civil-Drawの現行エラー表現方針は継承しない（discard）。

## Consequences

- 呼び出し側は`Result`の判別（`ok`/`error`）を型システムにより強制され、エラーケースの握り潰しがコンパイル時に検出されやすくなる
- 既存のtry/catchベースのコード（DXF変換ロジック等、modify対象）はResult型を返すようラッパーで包み直す
- UIコンポーネントはResult型のerrorケースをユーザー向けメッセージへ変換する統一的な仕組みを持つ

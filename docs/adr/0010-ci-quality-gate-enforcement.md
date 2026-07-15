# ADR-0010: CI品質ゲートは名ばかりステップを禁止し、実効性を機械的に検証する

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Phase 0調査でCivil-Drawの品質保証体制において、文書と実装の乖離がR-010関連として複数箇所で反復顕在化した（[リスク台帳](../design/phase0/risk-ledger.md)参照）。

- `ci.yml`の"Lint"ステップが実際にはeslintを実行していない
- E2E性能回帰テストの閾値がcommit `1f93474`で`avgFps>25/50`から`minFps>1`へ実質無力化されていた（[性能ベースライン](../design/phase0/performance-baseline.md)）
- SECURITY_AUDIT.mdのCSPヘッダー記載とnginx.conf実装の間に差異がある
- CHANGELOGのバージョン記載と実際のpackage.json/gitタグが不整合

これらは個別のバグではなく、「品質ゲートが名目上は存在するが実効性を検証する仕組みがない」という構造的パターンである。

## Decision

CivilDraftのCI品質ゲート（lint/test/build/security scan）は、各ステップが実際にチェック対象コードへ作用していることをレビュー時に確認する。具体的には、(1) 新規CIステップ導入時にわざと失敗するコードで一度red化を確認する、(2) 性能・カバレッジ等の閾値変更はPRレビューで明示的に指摘・承認するルールとする、(3) `docs/`配下のセキュリティ・性能・変更履歴に関する記述は、対応する実装・設定ファイルとの整合をVerifyフェーズで機械的または目視で確認してから更新する。

## Consequences

- CI設定変更のレビューコストが増加するが、「動いているように見えて実は無力化されたゲート」という再発防止になる
- Gate-2b（ultrareview）・CodeRabbit・Codexレビューの各ツールの指摘対応ルール（プロジェクト`CLAUDE.md` §8.5, §11）と合わせて、多層的な検証体制を構築する
- ドキュメント（README、SECURITY_AUDIT等）の更新基準（プロジェクト`CLAUDE.md` §17）を、実装変更のPRと同一PR内で更新することを原則とする

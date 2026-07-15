# ADR-0011: 依存関係ライセンスはSBOM自動生成とNOTICEファイル維持で衛生管理する

## Status

Proposed（Phase 0棚卸し由来、2026-07-15）

## Context

Phase 0の[依存関係・ライセンスレポート](../design/phase0/dependency-license-report.md)により、Civil-Drawの389解決パッケージにコピーレフト系ライセンスの混入がないことを確認した（R-009: 裏付け・良好）。一方で、以下の運用上の負債を確認した。

- NOTICE / THIRD-PARTY-NOTICESファイルが存在しない
- `package-lock.json`と`pnpm-lock.yaml`が両方存在する二重ロックファイル管理状態
- 正式なCycloneDX/SPDX形式のSBOMは生成されておらず、本レポートも手動集計による要約に留まる

## Decision

CivilDraftではパッケージマネージャをいずれか一つに統一し（ロックファイルの二重管理を解消）、CI（GitHub Actions）にSBOM自動生成ステップ（`npm sbom`または`cyclonedx-npm`等）を組み込む。生成されたSBOMはビルド成果物として保存し、NOTICEファイルは依存関係の変更時に自動更新される仕組みとする。

## Consequences

- 依存関係のライセンス状態が継続的に可視化され、将来的な依存追加時のライセンス逸脱をCIで検知できる
- パッケージマネージャ統一は既存の`package-lock.json`/`pnpm-lock.yaml`のいずれかを廃止する作業を伴う（Phase 1スキャフォールド作成時に決定）
- [ADR-0010](./0010-ci-quality-gate-enforcement.md)のCI品質ゲート強化方針と統合し、SBOM生成もCIの実効性検証対象に含める

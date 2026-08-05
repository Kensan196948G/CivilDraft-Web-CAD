# Architecture Decision Records (ADR)

CivilDraft-Web-CADのアーキテクチャ上の重要判断を記録する。詳細設計仕様書§2のディレクトリ構成（`docs/adr/`）に準拠。

## フォーマット

各ADRは軽量テンプレート（Title / Status / Context / Decision / Consequences）に従う。Statusは以下のいずれか。

| Status | 意味 |
| --- | --- |
| Proposed | Phase 0調査に基づく提案。Phase 1着手時にAccepted/Rejectedへ確定 |
| Accepted | 採用が確定し、実装に反映される |
| Superseded by ADR-XXXX | 後続のADRにより置き換えられた |

## 一覧（Phase 0棚卸し由来、2026-07-15）

| ID | タイトル | 関連リスク | Status |
| --- | --- | --- | --- |
| [0001](./0001-auth-cloudflare-access-not-msal-browser.md) | 認証はCloudflare Accessモデルを採用し、MSAL/Entra ID直接統合は不採用とする | R-001 | Proposed |
| [0002](./0002-nominal-id-brand-types.md) | 全エンティティIDにBrand&lt;T,B&gt;による公称型付けを導入する | R-001 | Proposed |
| [0003](./0003-result-type-for-expected-failures.md) | 予期される失敗の表現にResult&lt;T,E&gt;を採用し、例外送出と分離する | R-001 | Proposed |
| [0004](./0004-command-pattern-undo-redo.md) | Undo/RedoはCommandパターンで再実装し、全スナップショット方式を廃止する | R-001 | Proposed |
| [0005](./0005-unit-safe-coordinate-values.md) | 座標・寸法値は単位タグ付き値型（LengthValue等）で扱う | R-001, R-004 | Proposed |
| [0006](./0006-deploy-stack-systemd-cloudflare-neon.md) | デプロイ標準スタックをSystemd + GitHub + Cloudflare + Neonとし、Docker関連資産を非継承とする | — | Proposed |
| [0007](./0007-autosave-indexeddb-migration.md) | 自動保存はlocalStorageからIndexedDBへ移行する | R-006 | Proposed |
| [0008](./0008-spatial-index-per-drawing-instance.md) | 空間索引（R-tree）はグローバルシングルトンではなく描画インスタンス単位で保持する | R-005 | Proposed |
| [0009](./0009-audit-log-hash-chain-workers-neon.md) | 監査ログはハッシュチェーン構造とし、Cloudflare Workers + Neonで永続化する | R-006 | Proposed |
| [0010](./0010-ci-quality-gate-enforcement.md) | CI品質ゲートは名ばかりステップを禁止し、実効性を機械的に検証する | R-010 | Proposed |
| [0011](./0011-dependency-license-hygiene.md) | 依存関係ライセンスはSBOM自動生成とNOTICEファイル維持で衛生管理する | R-009 | Proposed |

全11件はPhase 0 Dynamic Workflow（6観点棚卸し、Run ID `wf_946d1dda-951`）のsynthesis段階が出力した`adr_recommendations`に基づく。詳細な判断根拠は各ADR本文および[継承台帳](../design/phase0/inheritance-ledger.md)・[リスク台帳](../design/phase0/risk-ledger.md)を参照。

## 一覧（Phase 1実装中の追加ADR）

Phase 0棚卸し由来ではなく、Phase 1の実装過程で個別に発生した判断を記録したもの。

| ID | タイトル | 関連 | Status |
| --- | --- | --- | --- |
| [0012](./0012-internal-coordinate-baseline.md) | 内部座標基準（長さ単位・軸・角度正方向・許容差）を確定する | Issue #5 | Accepted |
| [0013](./0013-geometry-id-generation.md) | 図形派生生成のID発番方針（crypto.randomUUID + コンテキスト注入） | ADR-0002, Issue #5 | Accepted |
| [0014](./0014-neon-direct-content-storage.md) | 図面内容の永続化先をNeon直接格納（`drawing_contents.content`）とし、R2は任意の共有ストレージ拡張点とする | ADR-0006, ADR-0009, Issue #36 | Accepted |
| [0015](./0015-id-text-alignment.md) | エンティティIDはアプリ生成の接頭辞付き文字列を正とし、DBのID列はtext型へ整合する | ADR-0002, ADR-0014, Issue #66 | Accepted |
| [0016](./0016-neon-sql-first-redesign.md) | Neon永続化層をSQLファーストへ再設計する（述語付きSELECT・楽観ロック・監査チェーン直列化） | ADR-0009, ADR-0014, Issue #114 | Proposed |

## 参照

- [Phase 0概要](../design/phase0/README.md)
- 詳細設計仕様書§2（ディレクトリ構成）、§4（型システム）

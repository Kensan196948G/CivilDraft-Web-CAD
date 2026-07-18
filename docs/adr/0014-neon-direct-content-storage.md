# ADR-0014: 図面内容の永続化先をNeon直接格納（`drawing_contents.content`）とし、R2は任意の共有ストレージ拡張点とする

- Status: Accepted
- Date: 2026-07-18
- 関連: ADR-0006（デプロイ標準スタック）、ADR-0009（監査ログ・Workers+Neon永続化）、Issue #36（永続化アダプタ実装）

## Context

Issue #36（Cloudflare Workers + Neon永続化アダプタの実装）着手時点の設計は、図面内容（描画データ本体）をR2 Object Storageへ格納し、Neonの`drawing_contents`テーブルにはR2オブジェクトキー（`object_key`）等のメタデータのみを保持する構成だった。`migrations/0001_initial_schema.sql`の`drawing_contents.object_key`が`NOT NULL`制約を持つのは、この前提を反映したものである。

しかし実装（`src/workers/neonApiStore.ts`、Issue #36時点の既存コード）は、この前提から先行して離れ、`drawing_contents.content jsonb`列への直接書き込みへ切り替わっていた。この切り替えにmigrationsが追随せず、次の2つの実害が本番調査（read-only）で判明した。

1. **スキーマバージョンスキュー**: 本番Neon（`civildraft-production`）は`0001`+`0002`のみ適用済みで`content`列が存在しないのに対し、デプロイ済みのCloudflare Workerコードは`content`列へのINSERTを前提としていた。共有保存（PUT content/quantities）を呼び出すと、本番では列不存在エラーで失敗する状態だった。
2. **R2自体が本番で利用不可**: 本番Cloudflareアカウントで R2 が無効化されており（APIエラーコード10042）、R2バケットが実在しない。commit `7ecd11f`（「R2スキップ決定」）により、R2を経由せずNeonへ直接保存する方針転換は事実上決定されていたが、ADRとして正式に記録されていなかった。

対象テーブル（`drawing_contents`、`quantity_items`）は本番で実データ0件であることを確認済みであり、方針を確定するタイミングとして技術的な障害はない。

## Decision

1. 図面内容（`drawing_contents.content` jsonb）はNeonへ直接格納する方式を正式な永続化方式として採用する。
2. R2（`CIVILDRAFT_R2_BUCKET` binding）は必須構成から外し、将来の共有ストレージ用途（大容量添付ファイル等）向けの任意拡張点として残す。`inspectProductionPersistenceReadiness`（`src/workers/persistence.ts`）の本番readiness判定から`CIVILDRAFT_R2_BUCKET`を除外し、必須bindingは`CIVILDRAFT_NEON_CONNECTION`のみとする。
3. `migrations/0003_persistence_schema_drift_fix.sql`で、実装が先行していたスキーマドリフトを解消する前方互換DDL（`drawing_contents.content`列追加、`drawing_contents.object_key`/`quantity_items.name`/`quantity`のNOT NULL緩和）を用意する。列削除・テーブル削除・データ削除は行わない。
4. `object_key`列は削除せず残置する。将来R2（またはその他の外部オブジェクトストレージ）を採用する場合の移行経路を塞がないため。
5. migration `0003`が本番Neon mainへ適用されるまでの暫定措置として、共有保存API（PUT `/api/v1/revisions/{id}/content`・`/quantities`）は`neon-r2`モードにおいて`isSharedSaveRoute`判定でfail-closedに503を返す（`src/workers/index.ts`）。スキーマ不整合下で保存が暗黙に失敗し、ユーザーに成功したように見えてしまう事態を防ぐための二次防御であり、GET系読み取りには影響しない。

## Consequences

- R2バケット作成・課金設定・Secret登録が、本番公開（Phase 1）の必須経路から外れる。デプロイ手順書（`docs/operations/production-deployment.md`）§4.1でも任意化を反映済み。
- 大容量ファイルは当面Neonの`jsonb`列に格納される。列サイズ上限・書き込みパフォーマンスへの影響は、将来的な監視・検討課題として残る（本ADRのスコープ外）。
- 本番Neon mainへのmigration `0003`適用、および対応するWorker再デプロイの実行は、人間承認後に実施する。本ADRはコード・migrationの方針決定を記録するものであり、本番適用の実行そのものを承認するものではない。
- fail-closed措置（`isSharedSaveRoute`）は`0003`本番適用完了後に撤去可能な暫定コードであり、恒久的な仕様ではない。撤去判断は`0003`適用・Worker再デプロイと同じ変更セットで行う。
- ADR-0006（デプロイ標準スタック、Status: Proposed）とは独立した決定だが、同スタック上での永続化方式を具体化するものとして位置づけられる。

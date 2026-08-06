# ADR-0016: Neon永続化層のSQLファースト再設計（述語付きSELECT・楽観ロック・監査チェーン直列化）

| 項目 | 値 |
| --- | --- |
| Status | Proposed（Issue #114 着手判断のための設計） |
| 関連 | ADR-0009（監査ハッシュチェーン）、ADR-0014（Neon直接格納）、Issue #36 / #61 / #63 / #68 / #114 |
| 決定日 | 2026-08-06 |

## Context

現行 `NeonApiStore`（src/workers/neonApiStore.ts）は **write-through cache** 型で、API リクエスト毎に以下の問題を持つ。

### 1. リクエスト毎の全件ロード（システム評価 CD-1）

`resolveStore()`（src/workers/index.ts）は neon-r2 モードでリクエスト毎に
`createNeonApiStore()` → `initialize()` を実行し、**11 本の全件 SELECT** で
全テーブルをメモリ上の Map/配列へロードする。

```sql
SELECT * FROM projects
SELECT * FROM project_members
SELECT * FROM drawings
SELECT * FROM drawing_revisions
SELECT * FROM drawing_contents
SELECT * FROM quantity_snapshots
SELECT * FROM quantity_items
SELECT * FROM quantity_sources
SELECT * FROM workflow_actions ORDER BY occurred_at
SELECT * FROM export_jobs
SELECT * FROM audit_logs ORDER BY occurred_at
```

- 述語・索引・ページングを一切利用しないため、データ量・リクエスト数に比例して
  レイテンシ/転送量/コストが線形増加する。
- `drawing_contents.content` は図面 JSON 本体を保持するため、図面一覧やプロジェクト
  取得リクエストでも全図面内容が毎回転送される。
- 監査ログ検証（GET /audit-logs/verify）も全件ロード後にハッシュ検証する構成。

### 2. Map ベース同期参照（システム評価 CD-2）

全ハンドラが `store.projects.get(...)` / `store.drawings.values()` 等の
**同期 Map 参照**に依存している。Neon の述語・ORDER BY・LIMIT・JOIN を
SQL 側で活用する余地がなく、将来のページング（Issue #85 で実装済みの
カーソル方式も監査ログのみ）や大規模図面性能（Issue #63）の前提を満たせない。

### 3. 楽観ロック未強制（システム評価 CD-5）

全更新系は `INSERT ... ON CONFLICT (id) DO UPDATE SET ... version = EXCLUDED.version`
の**無条件上書き**。`projects.version` / `drawings.version` /
`drawing_revisions.content_version` / `drawing_contents.content_version` /
`quantity_snapshots.quantity_version` は存在するが、期待バージョンの検証を
行わないため、並行編集は last-write-wins となりデータが失われる。

### 4. 監査ハッシュチェーンの並行分岐（ADR-0009 / Issue #61）

`persistAuditLog()` はメモリ配列 `this.auditLogs` の末尾から previous_hash を取る。
リクエスト毎に store が再生成され、並行リクエストでは「自分がロードした末尾」を
基準にするため、チェーンが分岐・断絶し得る（末尾 2 件が同一 previous_hash を持つ、
あるいは previous_hash 不一致で verify が broken になる）。

## Decision

Neon 永続化層を **SQL-first リポジトリ**へ再設計する。
`ApiStore`（Map ベース契約）は memory/dev モード専用とし、neon-r2 モードは
クエリ結果を直接レスポンスへ渡す構造へ移行する。

移行は破壊的変更を避けるため以下のフェーズで行う。

### Phase 1: スコープ付きロード + 述語付き SELECT（即効・低リスク）

`initialize()` の全件ロードを廃止し、リクエストの必要サブセットのみを
述語付きでロードする。現行ハンドラ構造（Map 参照）は維持するため、
`resolveStore()` が dispatch 前にリクエストのスコープ（projectId / revisionId）を
解決して必要なテーブルのみロードする方式へ変更する。

代表クエリ:

```sql
SELECT id, project_number, name, client_name, status, created_at, created_by,
       updated_at, updated_by, version
  FROM projects
 WHERE id = $1;

SELECT id, project_id, drawing_number, name, drawing_type, settings, status,
       active_revision_id, created_at, created_by, updated_at, updated_by, version
  FROM drawings
 WHERE project_id = $1
 ORDER BY drawing_number;

SELECT id, drawing_id, revision_number, status, change_summary,
       based_on_revision_id, content_version, content_checksum,
       created_at, created_by, updated_at, updated_by
  FROM drawing_revisions
 WHERE id = $1;

SELECT revision_id, content, byte_size, content_checksum, mime_type,
       schema_version, content_version, updated_at, storage_provider
  FROM drawing_contents
 WHERE revision_id = $1;

SELECT revision_id, quantity_version, updated_at, updated_by
  FROM quantity_snapshots
 WHERE revision_id = $1;

SELECT id, revision_id, group_key, work_type, specification, method, unit,
       raw_value, rounded_value, status
  FROM quantity_items
 WHERE revision_id = $1
 ORDER BY id;

SELECT id, quantity_item_id, geometry_id, contribution_raw
  FROM quantity_sources
 WHERE quantity_item_id = ANY($1::text[])
 ORDER BY id;

SELECT id, revision_id, action, from_status, to_status, actor_id, comment, occurred_at
  FROM workflow_actions
 WHERE revision_id = $1
 ORDER BY occurred_at;

SELECT id, revision_id, format, status, object_key, byte_size, content_checksum,
       error_code, created_at, created_by, completed_at, object_provider
  FROM export_jobs
 WHERE revision_id = $1
 ORDER BY created_at;

SELECT id, occurred_at, event_name, actor_id, project_id, entity_type, entity_id,
       result, correlation_id, detail, previous_hash, entry_hash, hash_algorithm
  FROM audit_logs
 WHERE project_id IS NOT DISTINCT FROM $1
   AND ($2::text IS NULL OR event_name = $2)
 ORDER BY occurred_at DESC, id DESC
 LIMIT $3 OFFSET $4;
```

監査ログ検証は全件取得のままだが、検証専用エンドポイントに限定し、
`ORDER BY occurred_at, id` の 1 クエリ（ページングなし）へ整理する。

### Phase 2: 全ハンドラの SQL-first 化

- `NeonApiStore` に async クエリメソッド（`getProject(id)` / `listDrawings(projectId)` /
  `getRevision(id)` / `getContent(revisionId)` / `getQuantities(revisionId)` /
  `listAuditLogs(filter)` 等）を追加し、index.ts のハンドラを async 参照へ書き換える。
- neon-r2 モードでは Map を一切保持せず、memory モードのみ従来の Map 契約を維持する。
- この時点で `SELECT *` を全て排除し、明示列へ統一する。

### Phase 3: 楽観ロック強制

- 更新系フックへ `expectedVersion`（projects/drawings は `version`、
  revisions は `content_version`、contents は `content_version`、
  quantities は `quantity_version`）を渡す。
- `UPDATE ... WHERE id = $1 AND version = $expected` の rowCount=0 を
  **409 CONFLICT**（`ERROR_CODES` 追加）として扱う。
- 新規作成は version=1 で INSERT し、再試行はクライアントの再読込に委ねる。
- 複合フック（#68）は単一トランザクション内で同様にガードする。

### Phase 4: 監査ハッシュチェーンの DB 直列化

- 追記を単一トランザクション内で行い、末尾を DB 側で確定する:

```sql
BEGIN;
SELECT entry_hash
  FROM audit_logs
 ORDER BY occurred_at DESC, id DESC
 LIMIT 1
 FOR UPDATE;
-- 取得した entry_hash を previous_hash として INSERT
COMMIT;
```

- より高頻度になる場合は `pg_advisory_xact_lock(固定キー)` による
  排他直列化へ移行する（同一キーで並行追記を直列化）。
- `audit_logs(occurred_at, id DESC)` インデックスを migration 0006 で追加する。
- verify エンドポイントは DB 上の実チェーンを検証し、メモリ上の末尾依存を撤去する。

## Consequences

### Positive

- リクエスト毎の全件ロード・全図面内容転送が廃止され、レイテンシ/コストが
  データ量に依存しなくなる。
- 索引・述語・ORDER BY/LIMIT を利用でき、監査ログのページングや
  大規模図面性能（Issue #63）の前提が整う。
- 楽観ロックにより並行編集の上書き消失を検出（409）できる。
- 監査ハッシュチェーンが並行リクエスト下でも分岐せず、改ざん検知が実質化する。

### Negative / Risk

- index.ts の全ハンドラを同期 Map 参照から async SQL 参照へ書き換える
  大規模リファクタになる（Phase 2 が最大コスト）。
- memory モードと neon-r2 モードの動作差が広がるため、両モードの
  ユニット/結合テストを維持する必要がある（fake SqlClient での SQL キャプチャ +
  Neon 実接続 roundtrip、既存の `CIVILDRAFT_TEST_NEON_CONNECTION` スキップ方式を踏襲）。
- 楽観ロック導入後、クライアント側の stale データ送信が 409 になるため、
  SPA 側の再読込 UX（エラーメッセージ）追加が必要。
- パフォーマンス回帰防止のため、Phase 2 完了時点でリクエスト毎の
  クエリ数・レイテンシの CI 閾値（Issue #63）を設定する。

## 実装順序（Issue #114 への落とし込み）

1. Phase 1: `NeonApiStore` にスコープ付きロードを実装し、`resolveStore()` を
   スコープ解決型へ変更（#114 本体）。
2. Phase 2: ハンドラの SQL-first 化（#114 と併行、または後続 Issue に分割）。
3. Phase 3: 楽観ロック + 409（後続 Issue に分割し、API 契約変更として明示）。
4. Phase 4: 監査チェーン直列化 + migration 0006（#61 の並行堅牢化として分割）。

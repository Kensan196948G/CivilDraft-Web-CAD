# 🐘 Neon PostgreSQL マイグレーション

CivilDraft Web CAD の Neon PostgreSQL スキーマ定義（詳細設計仕様書 §26）。
SQL ファイルは**定義のみ**であり、本リポジトリからの自動適用は行わない。

## 📋 ファイル一覧

| ファイル | 内容 | 正本 |
| --- | --- | --- |
| `0001_initial_schema.sql` | 初期スキーマ（projects / work_sections / project_members / drawings / drawing_revisions / drawing_contents / quantity_items / quantity_sources / workflow_actions / export_jobs / master_items / audit_logs、索引一式） | 詳細設計仕様書 §25・§26・§29 |
| `0002_api_contract_alignment.sql` | Workers API P0契約に合わせた前方互換拡張（quantity_snapshots、quantityVersion、Exportメタ、R2メタ、監査ハッシュチェーン列、索引追加） | `src/workers/index.ts`・ADR-0009 |

命名規約: `NNNN_説明.sql`（4桁連番・前方互換で追記）。適用済み番号は巻き戻さない。

## 🔁 適用手順（Neon dev ブランチで検証 → 人間が本番適用）

> DB スキーマ変更は**人間決裁必須**。本番(main)ブランチへの適用・dev ブランチ削除は
> データ削除に準ずる人間承認事項（CLAUDE.md §8.6、`docs/operations/rollback-procedure.md` §4.1）。

1. **dev ブランチ作成**: Neon で main から dev ブランチを分岐する（`create_branch`）。
2. **隔離検証**: dev ブランチ上で `0001_initial_schema.sql` → `0002_api_contract_alignment.sql` の順に適用し（`run_sql` / `prepare_database_migration`）、
   テーブル・制約・索引が作成されることを確認する（`describe_branch` / `get_database_tables`）。
3. **実行計画確認（任意）**: 主要クエリを `explain_sql_statement` で確認し、§26.4 索引の妥当性を検証する。
4. **差分確認**: `compare_database_schema` で main との差分を確認する。
5. **人間承認 → 本番適用**: 上記が問題なければ、**人間が** main ブランチへ適用する
   （`complete_database_migration` を含む本番適用は自動実行禁止）。
6. **接続文字列**: アプリ側の接続情報（Secret）の登録・変更も人間決裁事項。

## ✅ リポジトリ内検証

本番DBへ接続しない静的検証として、次を実行する。

```bash
npm run migrations:check
```

この検証では、以下を確認する。

- `BEGIN` / `COMMIT` のトランザクション境界
- 破壊的DDL（`DROP` / `TRUNCATE` / `DELETE FROM` 等）が含まれないこと
- 期待テーブル、外部キー参照先、必須索引がSQL内で整合していること
- 監査ログの相関ID、図面内容のChecksum列が存在すること

実DB上の適用検証は、上記の静的検証に加えて Neon dev ブランチで行う。

## ↩️ ロールバック

- サーバー永続データが未導入の段階では、切り戻しは「コード（Git）の revert」で行う
  （`docs/operations/rollback-procedure.md` §3・§4）。
- DB 導入後は、Neon dev ブランチ検証、前進修正、PITR/ブランチ復旧を組み合わせる。
  詳細は `rollback-procedure.md` §4.1 に記載する。
- 前進修正を原則とし、破壊的な down マイグレーションは安易に実行しない。

## ⚠️ 注意

- `gen_random_uuid()` は PostgreSQL 13+ のコア組込み（Neon 15+ で利用可）。追加拡張は不要。
- `drawings.active_revision_id` は `drawing_revisions` への循環参照のため、
  テーブル作成後に `ALTER TABLE ... ADD CONSTRAINT` で外部キーを付与する（§26.2）。
- 完全な図面データは Object Storage に置き、DB には object key・サイズ・Checksum・MIME・
  schemaVersion のみ保持する（§26.3、`drawing_contents`）。
- `0002_api_contract_alignment.sql` は既存列や既存テーブルを削除しない前方互換migration。
  本番データが入った後に NOT NULL 化や backfill が必要な場合は、別migrationとして人間承認後に実施する。

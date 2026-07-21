# ADR-0015: エンティティIDはアプリ生成の接頭辞付き文字列を正とし、DBのID列はtext型へ整合する

- Status: Accepted
- Date: 2026-07-21
- 関連: ADR-0002（nominal ID brand types）、ADR-0013（図形ID発番方針）、ADR-0014（Neon直接格納）、Issue #66（persistX配線・恒久対応）、migration `0004_id_type_alignment.sql`

## Context

Workers API（`src/workers/index.ts`）は、全エンティティのIDをアプリ側で生成する。`createId(prefix)`は`project_<uuid>`・`drawing_<uuid>`・`revision_<uuid>`のような**接頭辞付き文字列**を返し、レスポンス契約・監査ログ・クライアント（IndexedDB autosave含む）まで一貫してこの形式が流通している。接頭辞は障害調査時のID種別即識別に有効であり、ADR-0002のnominal brand型とも整合する。

一方、`migrations/0001_initial_schema.sql`は詳細設計仕様書§26のDDL案に従い、ID列を`uuid`型（`DEFAULT gen_random_uuid()`）で定義していた。Issue #66のpersistX配線を実装して実接続検証を行った結果、接頭辞付き文字列は`uuid`型へキャスト不能であり、**全書き込みが`invalid input syntax for type uuid`で失敗する**スキーマドリフトが確定した（0003が扱ったドリフトとは別系統の、型レベルのドリフト）。

選択肢は2つあった。

1. **アプリをDBへ合わせる**: `createId`を裸のUUIDへ変更する。
2. **DBをアプリへ合わせる**: ID列を`text`へ変換する（migration 0004）。

案1はWorkerだけでなくクライアント資産（autosaveデータ・テスト・監査ログの実績値）まで波及し、接頭辞による可読性も失う。案2は本番・devとも対象テーブル実データ0件の現時点なら損失のない拡大変換（uuid→text）で完結する。0003で確立した「実装が要求するスキーマが正本」の原則にも一致する。

## Decision

1. エンティティIDの正本は**アプリ生成の接頭辞付き文字列**（`createId`）とする。DB側での自動発番は行わない（変換列の`gen_random_uuid()` DEFAULTは撤去）。
2. migration `0004_id_type_alignment.sql`で、アプリがIDを生成・格納する全列を`uuid`→`text`へ変換する。型変換に必要なFK制約は同一トランザクション内でDROP→同名再作成する（`validate-migrations`のwaiver機構で機械検証）。
3. アプリが値を生成しない列（`master_items.id`、`quantity_items.master_item_id`、`work_sections.id`）は`uuid`のまま維持する。
4. `audit_logs.project_id`のFKは**再作成しない**。監査ログは存在しないresourceへの試行（認可拒否等）も記録する必要があり、参照整合性違反で監査記録自体が失敗してはならない（§29監査・ADR-0009 fail-visibleの原則）。
5. 併せて、driver型正規化を`neonApiStore.ts`で確定する: bigint/numericは文字列で返り得るため`toNumber()`、timestamptzはDateで返り得るため`toIsoString()`でAPI契約（number / ISO 8601文字列）へ正規化する。jsonbパラメータ（`content`・`settings`・`detail`）は`JSON.stringify` + `::jsonb`キャストで直列化を確定させる（pg系ドライバのトップレベル配列→Postgres配列リテラル化の罠の回避）。

## Consequences

- Issue #66のpersistX配線が実スキーマ上で成立する。Neon検証ブランチ（`verify-pr67-migrations-0003-0004`）で0001→0004適用後、persist→別インスタンスreloadの完全一致をroundtrip結合テスト（`tests/integration/workers/neonPersistence.test.ts`）で確認済み。
- uuid型の内部最適化（16バイト格納・uuid演算子）は失われるが、現行スケール（案件・図面単位のCRUD）では実害がない。将来大規模化した場合の再評価は妨げない（textからの移行はデータ変換を伴う）。
- Rollback: アプリ由来の接頭辞付きIDが書き込まれる前に限り、text→uuidの逆変換で復元可能。書き込み後はキャスト不能のため前方修正のみとする（migration 0004ヘッダに明記）。
- `validate-migrations.mjs`に「DROP CONSTRAINTは明示waiver＋同一ファイル内再作成の機械検証」の許可経路が追加された。waiverなしのDROP CONSTRAINTは従来どおり拒否される。

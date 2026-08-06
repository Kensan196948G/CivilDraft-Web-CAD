# レート制限設計（Issue #115）

作成日: 2026-08-06
状態: **設計確定・アプリ層実装推奨 / Cloudflare binding は人間承認待ち**

## 1. 目的

認証済みユーザーによるリクエスト連打（コスト増大・可用性低下・DoS相当）を防ぐ。
対象は Workers API（`src/workers/index.ts`）の認証必須API全域、特に書き込み系
（POST/PUT/PATCH/DELETE）を優先する。

## 2. 脅威モデル

- 攻撃者は Cloudflare Access を通過した正規ユーザー（または漏えいした JWT）であり、
  API を連打して Workers の実行時間・リクエスト数を消費する。
- 現状バインディングなし・アプリ層制限なしのため、単一ユーザーで無制限に呼び出せる。
- データ経路（Neon）は fail-closed だが、認証済み経路では DB コストも増加し得る。

## 3. 設計方針（2層）

### 3.1 アプリ層レート制限（自律実装可能・無課金）

- Workers の isolate 内にメモリベースの token bucket を実装する
  （`src/workers/rateLimit.ts` 新規）。
- キー: `actorId + ルート種別（read/write）`。
- 初期値（保守的）:
  - 読み取り系: 120 req / 60秒 / ユーザー
  - 書き込み系: 30 req / 60秒 / ユーザー
- 超過時: `429 Too Many Requests` + 構造化 JSON（`CD-RATE-LIMITED`）+ `Retry-After` ヘッダー。
- 制約: isolate 単位・複数 isolate では完全な共有にならない（緩和策として
  Cloudflare binding が正解）。**正規ユーザーの誤ブロックを防ぐため、初期値は高めに設定**。

### 3.2 Cloudflare Workers Rate Limiting binding（本番強化・人間承認必須）

- `wrangler.jsonc` に `unsafe.bindings` の `ratelimit`（または標準 Rate Limiting
  Rules）を追加し、アカウント全体・全 isolate で共有される制限をかける。
- 閾値・ウィンドウは本番トラフィック実績が無いため、上記初期値と同じ値から開始し、
  監視結果に基づき調整する。
- **課金/インフラ変更に該当するため、binding 追加・本番反映は人間の明示承認を得てから**
  （プロジェクト CLAUDE.md §8.6 / Issue #115 の注意書きどおり）。

## 4. 受入条件

- [x] 設計方針・対象・閾値・超過時応答が本ドキュメントに定義された
- [ ] アプリ層 token bucket が実装され、429 応答のユニットテストがある
- [ ] binding 設定の追加と staging/preview での動作確認（人間承認後）
- [ ] 本番反映（人間承認後）

## 5. 関連

- Issue #115
- `docs/assessment/system-assessment-2026-08-03.md` §8 CD-4b
- `docs/operations/monitoring-readiness.md` §3 アラート基準


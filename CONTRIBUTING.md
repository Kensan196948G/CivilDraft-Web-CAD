# Contributing

CivilDraft-Web-CAD へのコントリビューションガイドです。

## 開発フロー

1. **Issue 駆動**: 変更は対応する GitHub Issue を起点とします（Issue なしの作業は原則禁止）。
2. **ブランチ/WorkTree**: `main` へ直接 push せず、目的が分かるブランチで作業します。
   並行作業時は `git worktree add` で専用 WorkTree を切り、担当ファイルを分離します。
3. **実装**: 既存の設計規約（下記）に従い、画面・API・テスト・文書を同じ変更単位で整えます。
4. **検証**: 以下のゲートを全て通過させます。
   - `npm run lint`（0 errors）
   - `npm run typecheck`
   - `npm run migrations:check`
   - `npm test`（対象テスト + 全体）
   - `npm run build`
   - `npm run secret:scan`
   - 変更に応じて `npm run e2e` / `npm run perf`
5. **PR**: Draft PR を作成し、CI 全チェック green を確認後に Ready へ。PR 本文には
   目的・変更内容・対象外・影響範囲・テスト結果・セキュリティ確認・migration/データ影響・
   デプロイ/rollback 方法・残課題を記載します。
6. **マージ**: プロジェクト方針（AGENTS.md / CLAUDE.md）に従います。
   人間決裁必須事項（Secrets・本番migration・課金・法的判断）は PR に含めません。

## コード規約

- 型安全: brand 型（`src/shared/types/brand.ts`）と Result 型（`src/shared/types/result.ts`）を活用。
- 操作の可逆性: 編集操作は Command パターン（`src/domain/commands/`）で Undo/Redo 可能に。
- 設計判断: 新たな技術判断は ADR（`docs/adr/`）へ記録してから実装。
- 単位・座標: 内部は mm・度・Y-down を基準（ADR-0005/0012）。変換は domain/units に集約。
- 秘密情報: `.env`・接続文字列・トークンをコード/ログ/PR/テストへ含めない。
- 日本語: 会話・文書は日本語、コードコメントは英語可。

## テスト方針

- 単体（domain/infrastructure/app）・統合（Neon 実接続は環境変数未設定時 skip）・E2E（Playwright）を使い分けます。
- 異常系・境界値・権限不足・外部障害（fail-closed）を必ず含めます。
- カバレッジ閾値（`npm run test:coverage`）を維持・改善します。

## 環境セットアップ

```bash
npm ci
npm run dev
```

- Node.js 24+ / npm 10+（`.nvmrc` 参照）
- 本番デプロイ: `npx wrangler deploy`（権限・承認プロセスは `docs/operations/production-deployment.md`）


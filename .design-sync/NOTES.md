# design-sync NOTES

このリポジトリは Storybook を持たない `shape: package` の design-sync 対象。
以下は `.design-sync/config.json` と `.design-sync/entry.ts` から参照される背景説明と、
再同期（re-sync）時に踏みやすい落とし穴の記録。

## `overrides/bundle.mjs`（esbuild フォーク）

標準の `lib/bundle.mjs` に対し2点フォークしている（`config.json` の `libOverrides.bundle.mjs` に要約あり）：

1. **`tsconfigPathsPlugin` の拡張子探索**: 候補チェックが素の `existsSync()` だったため、
   ディレクトリ（例: `src/domain/sections/index.ts` のようなバレルディレクトリ `@/domain/sections`）
   が `/index.ts` 候補より先にマッチしてしまっていた。`statSync().isFile()` を要求するよう修正。
2. **esbuild のデフォルト `resolveExtensions`**: `.tsx` を `.ts` より先に試すため、
   裸 import `./editorStoreContext` が本リポジトリの意図的な React Fast Refresh 分割
   （`editorStoreContext.ts` = Context 値、`EditorStoreContext.tsx` = Provider コンポーネント）
   と大小文字違いで衝突していた。これは命名ミスではなく標準的な Vite/React Fast Refresh
   パターンであり、直すべきはリポジトリ側ではなくバンドラの解決順。

## `entry.ts`（合成 re-export バレル）

このリポジトリはアプリケーションであり公開パッケージではない（`dist/` も
`node_modules/civildraft-web-cad` への自己インストールも存在しない）ため、
コンバータが自動発見できるエントリがない。`.design-sync/entry.ts` がその代替。

- `EditorStoreProvider` / `createEditorStore` は named export のみ再エクスポート
  （`export *` にしない）。`editorStore.ts` の非コンポーネント識別子まで
  バンドルの export surface に持ち込まないため。
- `createAutosaveStore` も同じ理由で再エクスポート。`CadEditorPage` /
  `DrawingComparePage` / `HomePage` は `AutosaveStore` インスタンスを prop に取るため、
  プレビュー側は実 IndexedDB に依存せず `createAutosaveStore` の IDBFactory なしフォールバック
  （`MemoryAutosaveStore`）でインメモリに構築する。
- `EditorStoreContext.tsx` は拡張子を明示。`bundle.mjs` の `.ts` 優先修正は小文字側
  （`../editorStoreContext`）の衝突は解決するが、この大文字始まりの import は逆に
  ひっくり返してしまう（esbuild が `EditorStoreContext.ts` を大小文字無視でまず探し、
  実ファイルの小文字パスにマッチしてから、リテラル大小文字のパス読み込みで失敗する）ため、
  拡張子探索を完全に迂回する明示指定が必要だった。

## Re-sync risks（次回再同期時に見落としやすい点）

- **Sidebar の新規ナビ項目**: `src/app/layout/Sidebar.tsx` の `NAV_SECTIONS` に項目を足したら、
  `componentSrcMap` と `entry.ts` の再エクスポート一覧も同時に更新すること。
- **EditorStoreContext の大小文字衝突**: 今後 `xxxContext.ts` / `XxxContext.tsx` のような
  同名ペアを追加する場合、同じ esbuild 解決順の罠を踏む。`entry.ts` で明示拡張子を使う
  パターンを踏襲すること。
- **AutosaveStore を prop に取るコンポーネント**: プレビューを著者する場合は
  `createAutosaveStore` のインメモリフォールバックを使う（実 IndexedDB 依存を避ける）。
- **このプロジェクトへの初回アップロード**: `projectId`（`20a7f505-602b-46a6-97b9-ec199d123566`）は
  以前のセッションで pin 済みだったが、`list_files` が空・`_ds_sync.json` が 404 で、
  実際にアップロードが完了したことは一度もなかった。よって今回が実質的な初回搬入であり、
  リモートアンカーなしの「full scope」検証・全14コンポーネント一括書き込みとなる。

## 既知の制限: このマシンの Chromium SIGTRAP（2026-07-15）

このマシン（Linux 6.17）はヘッドレス Chromium/Chrome を一切起動できない
（起動直後に `signal=SIGTRAP` でクラッシュ。カーネル/サンドボックス起因と推測され、
Playwright MCP・chrome-devtools MCP でも既知— Claude memory `chrome-mcp-sigtrap.md` 参照）。
この design-sync run でも同一クラッシュを2箇所で再現した：

- `package-validate.mjs` の render-check（`[RENDER_SKIPPED]`）
- `package-capture.mjs` のスクリーンショット採点（`chromium.launch()` at line 100 で同一クラッシュ）

**対応（ユーザー明示承認済み・2026-07-15）**: `--no-render-check` で render-check を
警告扱いに降格して続行。capture 側には同等の回避フラグが存在しないため、
既に著者済みの3プレビュー（`PartsPalettePage` / `ReviewApprovalPage` / `Sidebar`）は
**採点未実施のまま明示的に deferred**（SKILL.md の合格条件「authored and graded good
*or explicitly deferred by the user*」に該当）として今回のアップロードに含めた。
残り11コンポーネント（`CadEditorPage` 含む）は floor card（未著者・仕様どおりの合格）。

再同期時の TODO: Chromium が正常起動するマシン上で `--no-render-check` なしの
フル再検証（render-check + capture 採点）を一度実行し、この3プレビューの
`pendingGrade` を正式に解消すること。

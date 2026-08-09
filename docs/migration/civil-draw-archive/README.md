# Civil-Draw アーカイブ（リポジトリ削除に先立つ保存一式）

対象: `Kensan196948G/Civil-Draw`（private・MIT・既定ブランチ main）

最終 commit: `ad76b9b1056571d55591291729b3c9d99ffd0374`
（2026-06-13 `feat(demo): WebUI デモ環境（モックデータ）+ Docker常駐公開 + README非エンジニア向け刷新 (#271)`）

## 保存物

| ファイル | 内容 |
| --- | --- |
| `civil-draw.git.bundle` | 全履歴（336 commits・全ブランチ）の git bundle。`git clone civil-draw.git.bundle` で復元可能 |
| `git-history.txt` | 全 commit 一覧（SHA・日時・サブジェクト） |
| `issues.json` | Issue 272 件（open 2 / closed 270）の完全エクスポート |
| `prs.json` | Pull Request 167 件の完全エクスポート |
| `releases.json` | Release 5 件（v0.99-rc3 ほか）の本文・アセット一覧 |
| `repo.json` | リポジトリメタデータ（作成日・最終 push・ライセンス等） |

## 復元手順

```bash
git clone docs/migration/civil-draw-archive/civil-draw.git.bundle civil-draw-restored
```

Issue/PR の復元は GitHub API 再作成または CSV/JSON 参照で行う（GitHub には再インポート API が無いため）。

## 削除後も追跡可能なもの

- 機能実装: 本リポジトリ（CivilDraft-Web-CAD）に統合済み
- 移行判定: `../civil-draw-migration-ledger.md`
- 統合経緯: `../civil-draw-integration-report.md`
- 削除判定: `../civil-draw-deletion-checklist.md`
- Phase 0 棚卸し: `../../design/phase0/`

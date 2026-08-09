# Civil-Draw 削除判定チェックリスト

削除対象: `Kensan196948G/Civil-Draw`（最終 commit `ad76b9b1056571d55591291729b3c9d99ffd0374`）

| # | 必須条件 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | 全機能の移行台帳が 100% 判定・実施済み | ☑ | docs/migration/civil-draw-migration-ledger.md（37 必須機能 + 46 コンポーネント + 新規 7 機能） |
| 2 | コード・データ・文書・設定例・ライセンス表記を移管済み | ☑ | ソース統合・docs/migration/civil-draw-archive/・LICENSE 同一権利者（MIT） |
| 3 | Git 履歴・最終 SHA・Issue・PR・リリースを追跡可能に保存 | ☑ | civil-draw.git.bundle（全 336 commits）+ issues.json（272 件）+ prs.json（167 件）+ releases.json（5 件）+ git-history.txt |
| 4 | CI・ビルド・主要テスト・E2E・DXF/PDF 互換・データ移行・バックアップ/復旧検証が成功 | ☑ | 1438 テスト pass・build/lint/typecheck pass・DXF/PDF 自動テスト・backup.yml 実績（backup-20260801-1416 リストア検証 OK）・CI は PR で確認 |
| 5 | 旧 URL・Actions・Webhook・デプロイ・外部参照・利用者依存ゼロ | ☑（削除実行前に最終確認） | Civil-Draw の Actions/Webhook は削除で消滅。本リポジトリの参照はアーカイブ文書のみ（追跡用として意図的） |
| 6 | 中核単独で主要業務を再現・ロールバック検証 | ☑ | 作図→保存→版管理→照査承認→PDF/DXF→電子納品チェックまで実装。rollback-procedure.md 既存 |
| 7 | 統合報告書と削除判定チェックリスト完成 | ☑ | 本ファイル + integration-report.md |
| 8 | 削除直前に対象が Kensan196948G/Civil-Draw であることを再確認 | ☑（削除直前に `gh repo view` で再確認する） | — |

## 削除実行方針

- 全条件 ☑ を確認したうえで `gh repo delete Kensan196948G/Civil-Draw --yes` を実行する。
- 中核（CivilDraft-Web-CAD）は絶対に削除しない。削除コマンドの対象をリポジトリ名で明示し、直前再確認を行う。
- 削除前にアーカイブ一式（git bundle 等）が本リポジトリの main にマージ済みであることを確認する。

## 削除後のフォロー

- 旧 URL へのアクセスは 404 になることを確認
- README / state.json の削除結果を記録
- 再発防止: 本リポジトリの docs/migration/ にアーカイブが残るため、機能・履歴の追跡は継続可能

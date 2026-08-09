# SLO ダッシュボード（内部運用目安）

最終更新: 2026-08-10

## 目的

本番合成監視（Production Health Check）の実績から稼働率を集計し、SLO 草案の達成状況を
継続的に確認する。**SLO の対外公開・通知先の確定は人間決裁事項**（`monitoring-readiness.md` §5）。

## 指標定義

| 指標 | 目標（草案） | 計測 |
| --- | --- | --- |
| 可用性（SPA 配信） | 99.5%（月間） | 合成監視 30 分毎 + Workers Analytics |
| API 5xx 率 | < 1%（月間） | Workers Analytics |
| 認証 fail-closed 正常性 | 100% | 合成監視（API error.code 検証） |
| セキュリティヘッダー | 100% | 合成監視 |
| 監査ログ書込失敗 | 0 件 | API 500 / hash chain verify |
| バックアップ | 週 1 回以上成功 | `backup.yml` |

## 自動集計

`.github/workflows/slo-report.yml` が毎週日曜 23:00 UTC に実行され、直近 30 日 / 90 日の
Production Health Check 実績から稼働率を計算してワークフローサマリーと
`slo-report.json`（Artifact・90 日保持）を生成する。

手動実行:

```bash
gh workflow run slo-report.yml
```

ローカル実行（GitHub トークンが必要）:

```bash
GH_TOKEN=<token> GITHUB_REPOSITORY=Kensan196948G/CivilDraft-Web-CAD node scripts/slo-tracking.mjs
```

## 見方

- `稼働率 = 成功 run 数 ÷ 完了 run 数 × 100`
- GitHub Actions の cron は遅延・実行停止がありうるため、実績がない期間は計測対象外。
- 直近 30 日の稼働率が 99.5% を下回る場合はインシデント対応を確認し、
  原因（監視設定誤り・デプロイ失敗・実障害）を `incident-response.md` に記録する。

## アラート

- 30 分毎のヘルスチェック失敗時: GitHub Issue 自動作成（重複防止済み）。
- Slack 通知は `MONITOR_SLACK_WEBHOOK` シークレット登録後に有効化される（通知先は人間決定）。
- 連続 2 回失敗・401 以外の応答・ヘッダー欠落は Critical 相当として即時対応。

## 既知の制約

- GitHub Actions の cron 精度・実行時間変動に依存するため、厳密な月間 SLO 計測は
  Cloudflare Workers Analytics と突き合わせて確定する必要がある。
- 過去 90 日より古い run 履歴は GitHub から取得できない。

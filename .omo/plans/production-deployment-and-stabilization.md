# Prometheus 実行計画 — CivilDraft 本番デプロイ + 安定化

> **Status**: READY（トークン設定待ち）
> **Created**: 2026-07-18
> **Target**: `civildraft.mirai-dx-platform.com`
> **Mode**: 即時連続実行（Phase 0→4 一括）

---

## 🔑 決定事項

| 項目 | 決定 |
|------|------|
| 本番 URL | `civildraft.mirai-dx-platform.com` |
| API Routing | 案A（同一 Worker 統合） |
| PR Merge | enforce_admins 一時解除 → merge → 即復元 |
| 実行 | トークン設定後即時連続 |

---

## 🛡️ Guardrails

| # | Gate | 違反時 |
|---|------|--------|
| G1 | production data 削除・DROP/TRUNCATE 禁止 | 停止 |
| G2 | secrets を logs/README/Issue に出力禁止 | 停止 |
| G3 | DNS変更・billing変更・auth変更は承認境界 | 停止 |
| G4 | mainブランチ保護 → 作業後5分以内に復元 | 復元確認 |
| G5 | 各Phase完了後 verify → fail 時 rollback判定 | rollback |
| G6 | 修正後 regression test 必須 | test必須 |
| G7 | deploy前に migration検証完了必須 | DB verify |
| G8 | Neon devブランチで migration検証 → 本番適用 | dev検証 |

## 🎯 Acceptance Criteria

| # | 条件 | 合格基準 |
|---|------|---------|
| AC1 | PR #57 + #64 merged | gh pr list確認 |
| AC2 | main branch protection 復元 | required checks active |
| AC3 | Neon migration 0001→0002 適用 | 12テーブル確認 |
| AC4 | R2 bucket 作成 | wrangler r2 bucket list |
| AC5 | Workers Secret 5種 登録 | wrangler secret list |
| AC6 | wrangler deploy 成功 | active deployment |
| AC7 | スモーク全パターン pass | 401/403/200/503 |
| AC8 | production URL HTTP 200 | curl |
| AC9 | 全品質ゲート green | lint/typecheck/test/build |
| AC10 | 運用文書最新 | diffなし |

## 🔄 Rollback Decision Points

| Phase | Trigger | Action |
|-------|---------|--------|
| P2 | Worker 500/503継続 | wrangler rollback |
| P2 | migration失敗 | Neon PITR |
| P3 | スモークfail | rollback + revert migration |
| P3 | data integrity違反 | Neon PITR + rollback |
| P4 | 修正3回連続失敗 | 全revert + 人間エスカレ |

---

## 📐 Work Breakdown

### Phase 0: Pre-Deployment Gate

| Step | 内容 | Agent |
|------|------|-------|
| P0.1 | CLOUDFLARE_API_TOKEN + NEON_API_KEY 検証 | CTO |
| P0.2 | 品質ゲート最終確認 | CTO |
| P0.3 | PR #57 merge → enforce_admins復元 | CTO |
| P0.4 | PR #64 merge → enforce_admins復元 | CTO |
| P0.5 | git pull + deployブランチ作成 | CTO |

### Phase 1: Infrastructure Provisioning

| Step | 内容 | Agent |
|------|------|-------|
| P1.1 | Neon 本番プロジェクト作成 | CTO |
| P1.2 | Neon devブランチ migration 0001→0002 検証 | CTO+DB |
| P1.3 | Neon 本番 migration 適用 | CTO+DB |
| P1.4 | R2 bucket `civildraft-drawings` 作成 | CTO |
| P1.5 | wrangler.jsonc 本番設定有効化 | Hephaestus |
| P1.6 | Workers Secret 5種 登録 | CTO |
| P1.7 | Access Application + ポリシー設定 | CTO |

### Phase 2: Deployment

| Step | 内容 | Agent |
|------|------|-------|
| P2.1 | wrangler deploy | CTO |
| P2.2 | DNS確認（civildraft.mirai-dx-platform.com） | Infra |

### Phase 3: Post-Deploy Verification

| Step | 内容 | Agent |
|------|------|-------|
| P3.1 | スモーク 全18エンドポイント | QA |
| P3.2 | Workers Observability 確認 | Infra |
| P3.3 | Neon DB data integrity | DB |
| P3.4 | 主要業務フロー E2E | QA |
| P3.5 | WebUI アクセス確認 | QA |

### Phase 4: Stabilization

| Step | 内容 | Agent |
|------|------|-------|
| P4.1 | 障害修正（P3検出時） | Debugger |
| P4.2 | monitoring/alerting 確認 | Infra |
| P4.3 | state.json 更新 | CTO |
| P4.4 | README/ops docs 更新 | Docs |
| P4.5 | GitHub Issues/Projects 更新 | CTO |

## 👥 Subagent Assignments

| Agent | Category | Phase |
|-------|----------|-------|
| CTO (Sisyphus) | — | All |
| Hephaestus | quick + git-master | P1, P4 |
| QA | deep + review-work | P3 |
| Infra | deep | P2, P3, P4 |
| DB | quick | P1, P3 |
| Docs | writing | P4 |
| Oracle | oracle | On-demand |

---

## ⚠️ 前提条件（ブロッカー）

```bash
# これらが設定されるまで実行不可
export CLOUDFLARE_API_TOKEN="<token>"
export NEON_API_KEY="<key>"
```

取得手順は同梱の `TOKEN_SETUP.md` を参照。

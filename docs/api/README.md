# API 仕様書

## 概要

`openapi.yaml` は Cloudflare Workers API（`src/workers/index.ts`）の実装ルートを
OpenAPI 3.0 形式で記述したものです。2026-08-10 時点のルーティング表
（`API_ROUTES`）と突合済みで、実装と乖離する項目は明記しています。

## 対象エンドポイント

- 案件: `GET/POST /api/v1/projects`・`GET/PATCH /api/v1/projects/{projectId}`
- メンバー: `GET/POST /api/v1/projects/{projectId}/members`・
  `PATCH/DELETE /api/v1/projects/{projectId}/members/{userId}`
- 図面: `GET/POST /api/v1/projects/{projectId}/drawings`・
  `GET/PATCH /api/v1/drawings/{drawingId}`・`PUT/DELETE .../checkout`
- 改訂: `POST /api/v1/drawings/{drawingId}/revisions`・
  `GET /api/v1/revisions/{revisionId}`・`GET/PUT .../content`・
  `GET/PUT .../quantities`・`GET/PUT .../sections`・`POST .../workflow-actions`
- 出力: `POST /api/v1/revisions/{revisionId}/exports`・`GET /api/v1/exports/{exportId}`
- 監査: `GET /api/v1/audit-logs`・`GET /api/v1/audit-logs/verify`

## 認証

Cloudflare Access が発行する JWT を `Authorization: Bearer <token>` または
`Cf-Access-Jwt-Assertion` ヘッダーで送信します。Workers 側で RS256・iss・aud・exp を
二次検証し、失敗時は 401 `CD-AUTH-001`（fail-closed）を返します。

## エラーコード

| コード | 意味 |
| --- | --- |
| CD-AUTH-001 | 未認証・無効な JWT |
| CD-AUTH-002 | 権限なし |
| CD-REQ-001 | リクエスト不正 |
| CD-SYS-001 | 対象なし（404） |
| CD-CONFLICT-001 | 楽観ロック・チェックアウト競合（409） |
| CD-RATE-LIMITED | レート制限（429・`Retry-After` 付き） |
| 501 | 未実装ルート（ルーティング表に存在するがハンドラ未実装） |

## 検証・閲覧

```bash
# YAML 構文チェック（Node 20+）
node -e "const fs=require('fs'); const y=require('yaml'); y.parse(fs.readFileSync('docs/api/openapi.yaml','utf8')); console.log('OK')"

# redocly CLI が利用可能な場合
npx @redocly/cli lint docs/api/openapi.yaml
```

## メンテナンス

`src/workers/index.ts` の `API_ROUTES`・各ハンドラを変更した場合は本ファイルを同時更新する。
未実装ルートの追加・削除もここに反映すること。

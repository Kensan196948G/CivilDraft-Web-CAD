/**
 * Issue #114 Phase 1: リクエスト経路から NeonApiStore のロードスコープが
 * 解決され、全件 SELECT ではなく述語付き SELECT で必要サブセットだけが
 * 発行されることを handleRequest 経由で検証する。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { handleRequest, type WorkerEnv } from '@/workers/index'
import type { SqlClient } from '@/workers/neonApiStore'

const TEAM_DOMAIN = 'https://civildraft.cloudflareaccess.com'
const AUD = 'aud-tag-civildraft-app'
const KID = 'test-key-1'
const AUTH_HEADER = 'Cf-Access-Jwt-Assertion'
const NOW = '2026-08-06T00:00:00.000Z'

function b64url(input: Uint8Array | string): string {
  const binary = typeof input === 'string' ? input : String.fromCharCode(...input)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let privateKey: CryptoKey
let jwks: { keys: Record<string, unknown>[] }

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const headerSegment = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }))
  const payloadSegment = b64url(JSON.stringify(payload))
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    ),
  )
  return `${headerSegment}.${payloadSegment}.${b64url(signature)}`
}

function validPayload(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: TEAM_DOMAIN,
    aud: [AUD],
    exp: now + 600,
    nbf: now - 60,
    iat: now,
    email: 'engineer@example.test',
  }
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  privateKey = keyPair.privateKey
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  jwks = { keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }
})

function makeNeonSql(
  responses: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): SqlClient & { readonly mock: ReturnType<typeof vi.fn> } {
  const tag = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const sql = strings[0] ?? ''
    let result: readonly Record<string, unknown>[] = []
    for (const [prefix, rows] of Object.entries(responses)) {
      if (sql.includes(prefix)) {
        result = rows
        break
      }
    }
    return Promise.resolve([...result])
  })
  const transaction = vi.fn((callback: (txn: typeof tag) => unknown[]) => {
    return Promise.all(callback(tag))
  })
  return Object.assign(tag, { transaction }) as unknown as SqlClient & {
    readonly mock: ReturnType<typeof vi.fn>
  }
}

function neonEnv(sql: SqlClient): WorkerEnv {
  return {
    CIVILDRAFT_API_MODE: 'neon-r2',
    CIVILDRAFT_NEON_CONNECTION: 'postgres://fake',
    sqlFactory: () => sql,
    CIVILDRAFT_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CIVILDRAFT_ACCESS_AUD: AUD,
    CIVILDRAFT_ACCESS_JWKS: jwks,
  }
}

const FULL_SCAN_SQL = [
  'SELECT * FROM projects',
  'SELECT * FROM project_members',
  'SELECT * FROM drawings',
  'SELECT * FROM drawing_revisions',
  'SELECT * FROM drawing_contents',
  'SELECT * FROM quantity_snapshots',
  'SELECT * FROM quantity_items',
  'SELECT * FROM quantity_sources',
  'SELECT * FROM workflow_actions',
  'SELECT * FROM export_jobs',
  'SELECT * FROM audit_logs',
  'SELECT * FROM projects ORDER BY project_number',
  'SELECT * FROM project_members ORDER BY project_id, user_id',
]

describe('Neon スコープ付きロードの配線（Issue #114 Phase 1）', () => {
  it('revision 内容取得は全件 SELECT を発行せず、述語付きで必要サブセットのみロードする', async () => {
    const sql = makeNeonSql({
      'FROM drawing_revisions WHERE id': [
        {
          id: 'rev-1',
          drawing_id: 'draw-1',
          revision_number: '1',
          status: 'draft',
          change_summary: '初版',
          based_on_revision_id: null,
          content_version: 1,
          content_checksum: 'sha256:abc',
          created_at: NOW,
          created_by: 'engineer@example.test',
          updated_at: NOW,
          updated_by: 'engineer@example.test',
        },
      ],
      'FROM drawings WHERE id': [
        {
          id: 'draw-1',
          project_id: 'proj-1',
          drawing_number: 'DWG-001',
          name: '平面図',
          drawing_type: 'general',
          settings: {},
          status: 'active',
          active_revision_id: null,
          created_at: NOW,
          created_by: 'engineer@example.test',
          updated_at: NOW,
          updated_by: 'engineer@example.test',
          version: 1,
        },
      ],
      'FROM projects WHERE id': [
        {
          id: 'proj-1',
          project_number: 'P-001',
          name: '国道245号',
          client_name: null,
          status: 'active',
          created_at: NOW,
          created_by: 'engineer@example.test',
          updated_at: NOW,
          updated_by: 'engineer@example.test',
          version: 1,
        },
      ],
      'FROM project_members WHERE project_id': [
        {
          project_id: 'proj-1',
          user_id: 'engineer@example.test',
          role: 'manager',
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      'FROM drawing_contents WHERE revision_id': [
        {
          revision_id: 'rev-1',
          content: { geometries: [] },
          byte_size: 100,
          content_checksum: 'sha256:abc',
          mime_type: 'application/json',
          schema_version: 1,
          content_version: 1,
          storage_provider: 'neon',
          updated_at: NOW,
        },
      ],
      'FROM quantity_snapshots WHERE revision_id': [],
      'FROM quantity_items WHERE revision_id': [],
      'FROM audit_logs ORDER BY occurred_at DESC, id DESC LIMIT 1': [],
    })

    const res = await handleRequest(
      new Request('https://api.example.com/api/v1/revisions/rev-1/content', {
        headers: { [AUTH_HEADER]: await signJwt(validPayload()) },
      }),
      neonEnv(sql),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { content: { revisionId: string; contentVersion: number } }
    expect(body.content.revisionId).toBe('rev-1')
    expect(body.content.contentVersion).toBe(1)

    const queries = (sql.mock.calls as [TemplateStringsArray][]).map((call) => call[0]?.join('') ?? '')
    expect(queries.some((q) => q.includes('FROM drawing_revisions WHERE id'))).toBe(true)
    expect(queries.some((q) => q.includes('FROM drawing_contents WHERE revision_id'))).toBe(true)
    for (const fullScan of FULL_SCAN_SQL) {
      expect(queries).not.toContain(fullScan)
    }
  })
})

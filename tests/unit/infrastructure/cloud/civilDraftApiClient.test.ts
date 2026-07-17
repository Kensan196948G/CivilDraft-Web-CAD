import { describe, expect, it } from 'vitest'
import {
  CivilDraftApiClient,
  type CloudApiClientOptions,
} from '@/infrastructure/cloud/civilDraftApiClient'
import { createMemoryStore, handleRequest, type WorkerEnv } from '@/workers/index'
import type { CivilDraftDocument } from '@/infrastructure/files'
import type { DrawingLayer, Geometry, GeometryStyle, LayerId } from '@/shared/types'

const AUTH_HEADER = 'Cf-Access-Jwt-Assertion'
const USER_HEADER = 'Cf-Access-Authenticated-User-Email'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const layer: DrawingLayer = {
  id: 'layer-main' as LayerId,
  name: '主線',
  order: 0,
  visible: true,
  locked: false,
  printable: true,
  defaultStyle: style,
}

function makeDocument(): CivilDraftDocument {
  const line: Geometry = {
    id: 'g-1' as Geometry['id'],
    type: 'line',
    layerId: layer.id,
    style,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    start: { x: 0, y: 0 },
    end: { x: 1200, y: 0 },
  }
  return { geometries: [line], layers: [layer] }
}

function makeClient(env: WorkerEnv): CivilDraftApiClient {
  const fetchImpl: CloudApiClientOptions['fetch'] = async (input, init) => {
    const headers = new Headers(init?.headers)
    return handleRequest(
      new Request(input, {
        method: init?.method,
        headers,
        body: init?.body,
      }),
      env,
    )
  }
  return new CivilDraftApiClient({
    baseUrl: 'https://api.example.test',
    fetch: fetchImpl,
    headers: {
      [AUTH_HEADER]: 'jwt-token',
      [USER_HEADER]: 'engineer@example.test',
    },
    correlationId: () => 'corr-client-test',
  })
}

describe('CivilDraftApiClient', () => {
  it('Workers API P0縦線をブラウザ側クライアントから保存・再読込・Export作成できる', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'memory', CIVILDRAFT_DEV_STORE: createMemoryStore() }
    const client = makeClient(env)
    const document = makeDocument()

    const saved = await client.saveDraft({
      project: {
        projectNumber: 'P-CLIENT-001',
        name: 'クライアント連携テスト',
        clientName: 'Mirai建設',
      },
      drawing: {
        drawingNumber: 'DWG-CLIENT-001',
        name: '仮設計画平面図',
        drawingType: 'temporary-yard-plan',
        settings: { unit: 'mm', paper: 'A3' },
      },
      revision: {
        revisionNumber: '1',
        changeSummary: 'ブラウザクライアントから初版保存',
      },
      document,
      exportFormat: 'json',
    })

    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.value.project.projectNumber).toBe('P-CLIENT-001')
    expect(saved.value.content.content).toEqual(document)
    expect(saved.value.content.contentChecksum).toMatch(/^sha256:/)
    expect(saved.value.exportJob?.status).toBe('completed')

    const loaded = await client.getRevisionContent(saved.value.revision.id)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.value.content).toEqual(document)
    expect(loaded.value.contentVersion).toBe(1)
  })

  it('Workers APIの業務エラーをValidationIssueとして返し、例外で握り潰さない', async () => {
    const env: WorkerEnv = { CIVILDRAFT_API_MODE: 'neon-r2' }
    const client = makeClient(env)

    const result = await client.createProject({
      projectNumber: 'P-FAIL-001',
      name: '永続化未接続',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CLOUD_API_HTTP')
    expect(result.error.message).toContain('binding')
  })
})

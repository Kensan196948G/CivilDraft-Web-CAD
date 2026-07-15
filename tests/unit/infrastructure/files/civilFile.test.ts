import { describe, expect, it } from 'vitest'
import {
  CIVIL_FILE_FORMAT,
  CURRENT_SCHEMA_VERSION,
  FILE_ERROR_CODES,
  parseCivilFile,
  serializeCivilFile,
} from '@/infrastructure/files'
import type { CivilDraftFileInput } from '@/infrastructure/files'
import type { DocumentState } from '@/domain/commands/editorCommand'
import type {
  DrawingId,
  DrawingLayer,
  Geometry,
  GeometryStyle,
  LayerId,
  ProjectId,
  RevisionId,
} from '@/shared/types'

const ISO = '2026-07-15T00:00:00.000Z'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

function layer(id: string): DrawingLayer {
  return {
    id: id as LayerId,
    name: `layer-${id}`,
    order: 0,
    visible: true,
    locked: false,
    printable: true,
    defaultStyle: style,
  }
}

function lineGeom(id: string, layerId: string): Geometry {
  return {
    id: id as Geometry['id'],
    layerId: layerId as LayerId,
    type: 'line',
    style,
    constructionStepIds: [],
    locked: false,
    createdAt: ISO,
    updatedAt: ISO,
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
  }
}

function makeDocument(): DocumentState {
  return {
    layers: [layer('layer-1')],
    geometries: [lineGeom('g1', 'layer-1'), lineGeom('g2', 'layer-1')],
  }
}

function makeInput(document: DocumentState = makeDocument()): CivilDraftFileInput {
  return {
    applicationVersion: '0.6.0',
    project: {
      id: 'p1' as ProjectId,
      projectNumber: 'PRJ-001',
      name: 'テスト案件',
      clientName: '発注者A',
      status: 'active',
    },
    drawing: {
      id: 'd1' as DrawingId,
      projectId: 'p1' as ProjectId,
      drawingNumber: 'DWG-001',
      name: '平面図',
      drawingType: 'plan',
      settings: {
        paperSize: 'A3',
        orientation: 'landscape',
        scaleDenominator: 100,
        drawingUnit: 'mm',
      },
      activeRevisionId: 'r1' as RevisionId,
      status: 'active',
      createdAt: ISO,
      updatedAt: ISO,
    },
    revision: {
      id: 'r1' as RevisionId,
      drawingId: 'd1' as DrawingId,
      revisionNumber: 'A',
      status: 'draft',
      changeSummary: '初版',
      contentVersion: 1,
      contentChecksum: 'unused-here',
      createdAt: ISO,
      updatedAt: ISO,
    },
    document,
  }
}

describe('serializeCivilFile', () => {
  it('§22.1 論理形式の JSON を生成し format/schemaVersion/checksums を付与する', () => {
    const result = serializeCivilFile(makeInput(), { now: () => ISO })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parsed = JSON.parse(result.value) as Record<string, unknown>
    expect(parsed.format).toBe(CIVIL_FILE_FORMAT)
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(parsed.exportedAt).toBe(ISO)
    expect((parsed.checksums as Record<string, unknown>).algorithm).toBe('SHA-256')
    expect(typeof (parsed.checksums as Record<string, unknown>).document).toBe('string')
  })

  it('applicationVersion が空なら CD-VAL-001 で失敗する', () => {
    const input = { ...makeInput(), applicationVersion: '   ' }
    const result = serializeCivilFile(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(FILE_ERROR_CODES.missingField)
  })

  it('図形数が制限を超えると CD-VAL-002 で失敗する', () => {
    const result = serializeCivilFile(makeInput(), { limits: { maxGeometryCount: 1 } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe(FILE_ERROR_CODES.rangeInvalid)
    expect(result.error.message).toContain('図形数')
  })
})

describe('parseCivilFile', () => {
  it('serialize→parse で往復し、内容が保持される', () => {
    const input = makeInput()
    const serialized = serializeCivilFile(input, { now: () => ISO })
    expect(serialized.ok).toBe(true)
    if (!serialized.ok) return

    const parsed = parseCivilFile(serialized.value)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.file.format).toBe(CIVIL_FILE_FORMAT)
    expect(parsed.value.file.project).toEqual(input.project)
    expect(parsed.value.file.drawing).toEqual(input.drawing)
    expect(parsed.value.file.revision).toEqual(input.revision)
    expect(parsed.value.document).toEqual(input.document)
    expect(parsed.value.issues).toEqual([])
  })

  it('壊れた JSON は CD-FILE-001 で失敗する（throw しない）', () => {
    const parsed = parseCivilFile('{ this is not json')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe(FILE_ERROR_CODES.unsupportedSchema)
  })

  it('format が CivilDraft 以外なら CD-FILE-001 で失敗する', () => {
    const parsed = parseCivilFile(JSON.stringify({ format: 'Other', schemaVersion: 1 }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe(FILE_ERROR_CODES.unsupportedSchema)
    expect(parsed.error.field).toBe('format')
  })

  it('未来のスキーマ版は CD-FILE-001 で失敗する（版不一致）', () => {
    const serialized = serializeCivilFile(makeInput(), { now: () => ISO })
    if (!serialized.ok) throw new Error('setup failed')
    const obj = JSON.parse(serialized.value) as Record<string, unknown>
    obj.schemaVersion = CURRENT_SCHEMA_VERSION + 1
    const parsed = parseCivilFile(JSON.stringify(obj))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe(FILE_ERROR_CODES.unsupportedSchema)
    expect(parsed.error.field).toBe('schemaVersion')
  })

  it('schemaVersion が非整数なら CD-FILE-001 で失敗する', () => {
    const parsed = parseCivilFile(
      JSON.stringify({ format: CIVIL_FILE_FORMAT, schemaVersion: 1.5 }),
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe(FILE_ERROR_CODES.unsupportedSchema)
  })

  it('必須項目が欠落すると CD-VAL-001 で失敗する', () => {
    const serialized = serializeCivilFile(makeInput(), { now: () => ISO })
    if (!serialized.ok) throw new Error('setup failed')
    const obj = JSON.parse(serialized.value) as Record<string, unknown>
    delete obj.project
    const parsed = parseCivilFile(JSON.stringify(obj))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe(FILE_ERROR_CODES.missingField)
    expect(parsed.error.field).toBe('project')
  })

  it('document 改変で Checksum 不一致なら CD-FILE-002 で失敗する', () => {
    const serialized = serializeCivilFile(makeInput(), { now: () => ISO })
    if (!serialized.ok) throw new Error('setup failed')
    const obj = JSON.parse(serialized.value) as Record<string, unknown>
    const doc = obj.document as DocumentState
    // Checksum を更新せずに図形を追加 → 不一致。
    obj.document = { ...doc, geometries: [...doc.geometries, lineGeom('g3', 'layer-1')] }
    const parsed = parseCivilFile(JSON.stringify(obj))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe(FILE_ERROR_CODES.checksumMismatch)
  })

  it('制限値超過は parse でも CD-VAL-002 で失敗する', () => {
    const serialized = serializeCivilFile(makeInput(), { now: () => ISO })
    if (!serialized.ok) throw new Error('setup failed')
    const parsed = parseCivilFile(serialized.value, { limits: { maxGeometryCount: 1 } })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error.code).toBe(FILE_ERROR_CODES.rangeInvalid)
  })

  it('未知レイヤー参照は graceful degradation の warning として開ける', () => {
    // 存在しないレイヤーを参照する図形を含む文書を書き出してから読み込む。
    const document: DocumentState = {
      layers: [layer('layer-1')],
      geometries: [lineGeom('g1', 'ghost-layer')],
    }
    const serialized = serializeCivilFile(makeInput(document), { now: () => ISO })
    if (!serialized.ok) throw new Error('setup failed')
    const parsed = parseCivilFile(serialized.value)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.issues.length).toBeGreaterThan(0)
    expect(parsed.value.issues[0]?.severity).toBe('warning')
    expect(parsed.value.issues[0]?.message).toContain('未知のレイヤー参照')
  })
})

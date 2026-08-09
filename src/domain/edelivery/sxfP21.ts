/**
 * SXF(P21) 試作エクスポータ（ISO 10303-21 / AP202 サブセット）。
 *
 * 出力内容: ヘッダ（FILE_SCHEMA('SXF')）+ 線分（LINE）/ ポリライン（POLYLINE）/
 * 円（CIRCLE）の AP202 曲線エンティティと SHAPE_REPRESENTATION 構造。
 *
 * 正直な境界:
 * - 本出力は「SXF(P21) を指向した AP202 サブセット」であり、SXF 特有の
 *   属性エンティティ（SXF_LAYER / SXF_ATTRIBUTE 等）や CAD 製図基準への
 *   完全適合を含まない。**電子納品チェックシステムでの検証が必須**であり、
 *   適合の自動断定はしない。
 * - 円弧（TRIMMED_CURVE 化）・楕円・スプライン・ハッチ・注記は未対応として
 *   issues に警告を積む（無効エンティティを出力しない）。
 */
import type { Geometry } from '@/shared/types'

export interface SxfP21ExportResult {
  readonly text: string
  readonly issues: readonly string[]
  readonly exportedCount: number
}

function esc(value: string): string {
  return value.replaceAll("'", "''")
}

function fmt(value: number): string {
  return (Math.round(value * 1000) / 1000).toFixed(3)
}

export function exportSxfP21(
  geometries: readonly Geometry[],
  meta: { readonly fileName: string; readonly drawingName: string },
): SxfP21ExportResult {
  const issues: string[] = []
  let id = 1
  const lines: string[] = []
  const curveRefs: string[] = []
  let exportedCount = 0

  const next = (): number => id++

  const pointRef = (x: number, y: number): string => {
    const ref = next()
    lines.push(`#${ref}=CARTESIAN_POINT('',(${fmt(x)},${fmt(y)},0.));`)
    return `#${ref}`
  }

  const directionRef = (x: number, y: number): string => {
    const ref = next()
    const len = Math.hypot(x, y) || 1
    lines.push(`#${ref}=DIRECTION('',(${fmt(x / len)},${fmt(y / len)},0.));`)
    return `#${ref}`
  }

  for (const geometry of geometries) {
    switch (geometry.type) {
      case 'line': {
        const p1 = pointRef(geometry.start.x, geometry.start.y)
        const dir = directionRef(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)
        const vector = next()
        lines.push(`#${vector}=VECTOR('',${dir},1.);`)
        const curve = next()
        lines.push(`#${curve}=LINE('',${p1},#${vector});`)
        curveRefs.push(`#${curve}`)
        exportedCount += 1
        break
      }
      case 'polyline': {
        const points = geometry.points.map((point) => pointRef(point.x, point.y)).join(',')
        const curve = next()
        lines.push(`#${curve}=POLYLINE('',(${points}));`)
        curveRefs.push(`#${curve}`)
        exportedCount += 1
        break
      }
      case 'circle': {
        const center = pointRef(geometry.center.x, geometry.center.y)
        const curve = next()
        lines.push(`#${curve}=CIRCLE('',${center},${fmt(geometry.radius)});`)
        curveRefs.push(`#${curve}`)
        exportedCount += 1
        break
      }
      case 'arc':
        issues.push('円弧は TRIMMED_CURVE 化が必要なため試作出力から除外しました')
        break
      case 'ellipse':
        issues.push('楕円は試作出力から除外しました')
        break
      case 'spline':
        issues.push('スプラインは B_SPLINE_CURVE 化が必要なため試作出力から除外しました')
        break
      case 'hatch':
        issues.push('ハッチングは試作出力から除外しました')
        break
      default:
        issues.push(`図形種別 ${geometry.type} は試作出力から除外しました`)
        break
    }
  }

  const appContext = next()
  const productContext = next()
  const product = next()
  const formation = next()
  const defContext = next()
  const definition = next()
  const shape = next()
  const representation = next()
  const curveSet = next()
  const sdr = next()

  lines.push(`#${appContext}=APPLICATION_CONTEXT('SXF');`)
  lines.push(`#${productContext}=PRODUCT_CONTEXT('',#${appContext},'mechanical');`)
  lines.push(`#${product}=PRODUCT('${esc(meta.drawingName)}','${esc(meta.drawingName)}','',(#${productContext}));`)
  lines.push(`#${formation}=PRODUCT_DEFINITION_FORMATION('','',#${product});`)
  lines.push(`#${defContext}=PRODUCT_DEFINITION_CONTEXT('part definition',#${appContext},'design');`)
  lines.push(`#${definition}=PRODUCT_DEFINITION('design','',#${formation},#${defContext});`)
  lines.push(`#${shape}=PRODUCT_DEFINITION_SHAPE('','',#${definition});`)
  lines.push(`#${curveSet}=GEOMETRIC_CURVE_SET('',(${curveRefs.join(',')}));`)
  lines.push(`#${representation}=SHAPE_REPRESENTATION('',(#${curveSet}),#${appContext});`)
  lines.push(`#${sdr}=SHAPE_DEFINITION_REPRESENTATION(#${shape},#${representation});`)

  const header = [
    `FILE_DESCRIPTION(('SXF P21 試作出力（AP202 サブセット）'),'2;1');`,
    `FILE_NAME('${esc(meta.fileName)}','${new Date().toISOString().slice(0, 19)}',('CivilDraft'),('CivilDraft'),'CivilDraft','CivilDraft','');`,
    `FILE_SCHEMA(('SXF'));`,
  ].join('\n')

  const text = `ISO-10303-21;\nHEADER;\n${header}\nENDSEC;\nDATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`
  return { text, issues, exportedCount }
}

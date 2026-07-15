/**
 * 図形モデル（Geometry判別共用体13種）とレイヤーをDXF文字列へ変換するエクスポータ。
 * 継承元: Civil-Draw src/utils/dxfExporter.ts（継承台帳 modify、DXF変換ロジック）。
 *
 * 継承元との設計差分:
 * - 入力をShape[]/Layer[]→readonly Geometry[]/readonly DrawingLayer[]へ変更。
 *   図形種別switchは13種を列挙しdefault:neverで網羅性検査する。
 * - 【最重要 R-002/R-004: 単位整合】継承元は `setUnits('Meters')` と宣言しながら座標を
 *   mm実値のまま書き出しており、DXF単位宣言と実座標が不整合だった。新実装は内部基準mm
 *   （ADR-0012）に対しDXF単位宣言と座標を単一のexportUnitから導出して構造的に一致させる。
 *   既定はexportUnit='mm'（宣言=Millimeters・座標は等倍）。options.unitで'cm'/'m'選択も可能で、
 *   座標変換はunits/index.tsのfromLengthMm経由（mmは基準単位=係数1のため等倍）。
 * - arc角度: 継承元はラジアン格納のArcShape角度を `*180/Math.PI` で度数変換していた。
 *   ArcGeometryは度数法（startAngleDeg/endAngleDeg、ADR-0012）であり、dxf-writerのdrawArcも
 *   度数入力（index.d.ts JSDoc: "startAngle - degree"）のため、変換せず直接渡す。
 * - cloud/mline: 新13種に存在しないため出力ロジックごと削除した。
 * - parametricObject: 生成図形（generatedGeometryIds先の実体）が出力対象のため本体はskipする。
 * - drawEllipse: dxf-writer 1.18.4はindex.d.tsにdrawEllipseを宣言していないが実体（src/Drawing.js）
 *   には存在する。型欠落を最小インターフェースのcastで補う（継承元はas anyで回避していた）。
 * - DASHDOT linetype: dxf-writerの組み込みLTYPEはCONTINUOUS/DASHED/DOTTEDのみ。継承元は
 *   dashdot図形に未定義LTYPE'DASHDOT'を参照させ不正DXF（dangling reference）を生成していた。
 *   新実装は標準DASHDOTパターンをaddLineTypeで登録し有効なDXFにする。
 *   lineType'double'はDXF標準に対応が無いためCONTINUOUSへフォールバックする。
 * - hexToAciはヘルパーとしてas_is移植（無変更）。lineType→DXF linetype名の対応表も踏襲。
 * - 依存の再利用: ハッチ線分はdomain/geometry/hatchGenerator（generateHatchLines）、記号定義は
 *   domain/catalog/symbolCatalog（getSymbolById）を利用する。
 *
 * 本移植の対象外（別レイヤー/別フォーマットの責務）:
 * - downloadDxf/downloadJson: document/Blob/URL依存のダウンロード処理はUI/infrastructure層の責務。
 *   domain層は純粋関数に保つため移植しない。
 * - exportJson/parseJson: .civil（JSON）永続化は別フォーマットであり、ドキュメント直列化モジュールの
 *   責務としてDXF変換から分離する。
 *
 * 継承元から引き継ぐ既知の制限（アルゴリズムはas_is、改良せず）:
 * - rectangle/ellipseのrotationDegは非適用（軸並行で出力）。shapeBBoxの回転前AABB方針と同じ。
 * - splineは開ポリラインで近似（tension非適用、DXF SPLINEエンティティは生成しない）。
 */
import Drawing from 'dxf-writer'
import type { Unit } from 'dxf-writer'
import type { DrawingLayer, Geometry, GeometryStyle, LengthUnit } from '@/shared/types'
import { fromLengthMm } from '@/domain/units'
import { generateHatchLines } from '@/domain/geometry/hatchGenerator'
import { getSymbolById } from '@/domain/catalog/symbolCatalog'

/** DXFエクスポートで選択可能な出力単位（内部基準mmからの変換対象）。 */
export type DxfExportUnit = LengthUnit

export interface DxfExportOptions {
  /** DXFの単位宣言と座標の出力単位。既定は 'mm'（内部基準単位、等倍出力）。 */
  readonly unit?: DxfExportUnit
}

/** exportUnit → dxf-writerの単位名（$INSUNITSヘッダー）。 */
const DXF_UNIT_NAME: Record<DxfExportUnit, Unit> = {
  mm: 'Millimeters',
  cm: 'Centimeters',
  m: 'Meters',
}

/**
 * dxf-writer 1.18.4がindex.d.tsで宣言していないdrawEllipseを型付けするための最小インターフェース。
 * 実体はsrc/Drawing.jsに存在する（majorAxisX/Yは中心からの主軸端点、axisRatioは短軸/長軸比）。
 */
interface EllipseCapableDrawing {
  drawEllipse(
    x: number,
    y: number,
    majorAxisX: number,
    majorAxisY: number,
    axisRatio: number,
    startAngle?: number,
    endAngle?: number,
  ): void
}

/** #rrggbb のhex色を、AutoCAD Color Index(ACI)の基本7色のうち最も近いものへ量子化する（as_is移植）。 */
function hexToAci(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const colors: [number, number, number, number][] = [
    [1, 255, 0, 0],
    [2, 255, 255, 0],
    [3, 0, 255, 0],
    [4, 0, 255, 255],
    [5, 0, 0, 255],
    [6, 255, 0, 255],
    [7, 255, 255, 255],
  ]
  let best = 0
  let bestDist = Infinity
  for (const [aci, cr, cg, cb] of colors) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (d < bestDist) {
      bestDist = d
      best = aci
    }
  }
  return best
}

/** GeometryStyle.lineType → DXF linetype名。doubleはDXF標準に無いためCONTINUOUSへフォールバック。 */
function lineTypeToDxf(lineType: GeometryStyle['lineType']): string {
  switch (lineType) {
    case 'dashed':
      return 'DASHED'
    case 'dashDot':
      return 'DASHDOT'
    case 'double':
      return 'CONTINUOUS'
    case 'continuous':
      return 'CONTINUOUS'
    default: {
      const exhaustive: never = lineType
      throw new Error(`Unhandled lineType: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * 図形モデルとレイヤーをDXF文字列へエクスポートする。
 * options.unit（既定'mm'）でDXF単位宣言と座標の出力単位を選択する。
 * 座標・長さは内部基準mmで計算し、dxf-writerへの出力境界でのみexportUnitへ変換する
 * （mmは基準単位=係数1で完全等倍）。角度（度数法）・比率は無変換で渡す。
 */
export function exportDxf(
  geometries: readonly Geometry[],
  layers: readonly DrawingLayer[],
  options: DxfExportOptions = {},
): string {
  const unit = options.unit ?? 'mm'
  /** 内部基準mm → exportUnitの座標/長さ変換。mmは基準単位のため係数1（等倍）。 */
  const cv = (mm: number): number => fromLengthMm(mm, unit).value

  const d = new Drawing()
  // R-002/R-004: 宣言単位と座標を同一のexportUnitから導出して構造的に一致させる。
  d.setUnits(DXF_UNIT_NAME[unit])
  // 組み込みLTYPEにDASHDOTが無いため、dashDot図形が未定義linetypeを参照しないよう登録する。
  d.addLineType('DASHDOT', 'Dash dot _ . _ . ', [5.0, -2.5, 0.0, -2.5])

  for (const layer of layers) {
    d.addLayer(layer.name, hexToAci(layer.defaultStyle.strokeColor), lineTypeToDxf(layer.defaultStyle.lineType))
  }

  for (const geometry of geometries) {
    const layerName = layers.find((l) => l.id === geometry.layerId)?.name ?? '0'
    d.setActiveLayer(layerName)

    switch (geometry.type) {
      case 'line':
        d.drawLine(cv(geometry.start.x), cv(geometry.start.y), cv(geometry.end.x), cv(geometry.end.y))
        break
      case 'rectangle':
        // 継承元同様、drawRectで軸並行の閉ポリラインを出力する（rotationDegは非適用）。
        d.drawRect(
          cv(geometry.origin.x),
          cv(geometry.origin.y),
          cv(geometry.origin.x + geometry.width),
          cv(geometry.origin.y + geometry.height),
        )
        break
      case 'circle':
        d.drawCircle(cv(geometry.center.x), cv(geometry.center.y), cv(geometry.radius))
        break
      case 'arc':
        // ArcGeometryは度数法。dxf-writerのdrawArcも度数入力のため無変換で渡す（継承元のrad→deg変換は撤去）。
        d.drawArc(
          cv(geometry.center.x),
          cv(geometry.center.y),
          cv(geometry.radius),
          geometry.startAngleDeg,
          geometry.endAngleDeg,
        )
        break
      case 'ellipse': {
        const maxR = Math.max(geometry.radiusX, geometry.radiusY)
        // 退化楕円（半径0）はaxisRatioがNaNになるためskip（継承元に無い防御分岐、hatchGeneratorと同方針）。
        if (maxR <= 0) break
        const ratio = Math.min(geometry.radiusX, geometry.radiusY) / maxR
        const majorX = geometry.radiusX >= geometry.radiusY ? maxR : 0
        const majorY = geometry.radiusX >= geometry.radiusY ? 0 : maxR
        // rotationDegは継承元同様非適用（軸並行の主軸で出力）。
        ;(d as unknown as EllipseCapableDrawing).drawEllipse(
          cv(geometry.center.x),
          cv(geometry.center.y),
          cv(majorX),
          cv(majorY),
          ratio,
        )
        break
      }
      case 'polyline':
      case 'spline': {
        // splineは継承元同様、開ポリラインで近似（tension非適用）。
        const pts: [number, number][] = geometry.points.map((p) => [cv(p.x), cv(p.y)])
        d.drawPolyline(pts, geometry.type === 'polyline' ? geometry.closed : false)
        break
      }
      case 'text':
        d.drawText(
          cv(geometry.anchor.x),
          cv(geometry.anchor.y),
          cv(geometry.height),
          geometry.rotationDeg,
          geometry.text,
          geometry.horizontalAlign,
        )
        break
      case 'hatch': {
        const pts: [number, number][] = geometry.boundaryPoints.map((p) => [cv(p.x), cv(p.y)])
        d.drawPolyline(pts, true)
        // generateHatchLinesはHatchGeometryを受けHatchLine{start,end}（mm）を返す新シグネチャ。
        for (const l of generateHatchLines(geometry)) {
          d.drawLine(cv(l.start.x), cv(l.start.y), cv(l.end.x), cv(l.end.y))
        }
        break
      }
      case 'symbol': {
        const sym = getSymbolById(geometry.symbolId)
        // 未知のsymbolIdは何も描かずskip（継承元踏襲）。
        if (!sym) break
        const rad = (geometry.rotationDeg * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        // 記号ローカル座標をworld-mm座標へ回転・スケール・平行移動する。
        const txMm = (px: number, py: number): [number, number] => [
          geometry.position.x + (px * cos - py * sin) * geometry.scale,
          geometry.position.y + (px * sin + py * cos) * geometry.scale,
        ]
        for (const path of sym.paths) {
          if (path.type === 'line') {
            const x0 = path.data[0]
            const y0 = path.data[1]
            const x1 = path.data[2]
            const y1 = path.data[3]
            if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) continue
            const [ax, ay] = txMm(x0, y0)
            const [bx, by] = txMm(x1, y1)
            d.drawLine(cv(ax), cv(ay), cv(bx), cv(by))
          } else if (path.type === 'circle') {
            const cx0 = path.data[0]
            const cy0 = path.data[1]
            const r0 = path.data[2]
            if (cx0 === undefined || cy0 === undefined || r0 === undefined) continue
            const [cx, cy] = txMm(cx0, cy0)
            d.drawCircle(cv(cx), cv(cy), cv(r0 * geometry.scale))
          } else {
            const polyPts: [number, number][] = []
            for (let i = 0; i < path.data.length - 1; i += 2) {
              const px = path.data[i]
              const py = path.data[i + 1]
              if (px === undefined || py === undefined) continue
              const [wx, wy] = txMm(px, py)
              polyPts.push([cv(wx), cv(wy)])
            }
            d.drawPolyline(polyPts, path.closed ?? false)
          }
        }
        break
      }
      case 'dimension': {
        // 座標・長さはmmで計算し、出力境界でcv()を適用する。寸法値ラベルもcv()で出力単位へ換算する。
        const x1 = geometry.start.x
        const y1 = geometry.start.y
        const x2 = geometry.end.x
        const y2 = geometry.end.y
        const { offset, orientation, textHeight } = geometry
        if (orientation === 'horizontal') {
          const ly = Math.min(y1, y2) - offset
          d.drawLine(cv(x1), cv(ly), cv(x2), cv(ly))
          d.drawLine(cv(x1), cv(y1), cv(x1), cv(ly))
          d.drawLine(cv(x2), cv(y2), cv(x2), cv(ly))
          d.drawText(cv((x1 + x2) / 2), cv(ly - textHeight), cv(textHeight), 0, cv(Math.abs(x2 - x1)).toFixed(2))
        } else if (orientation === 'vertical') {
          const lx = Math.min(x1, x2) - offset
          d.drawLine(cv(lx), cv(y1), cv(lx), cv(y2))
          d.drawLine(cv(x1), cv(y1), cv(lx), cv(y1))
          d.drawLine(cv(x2), cv(y2), cv(lx), cv(y2))
          d.drawText(cv(lx - textHeight), cv((y1 + y2) / 2), cv(textHeight), 90, cv(Math.abs(y2 - y1)).toFixed(2))
        } else {
          // parallel: 単位法線（90°CCW）方向へoffsetずらす。
          const dx = x2 - x1
          const dy = y2 - y1
          const len = Math.hypot(dx, dy)
          if (len > 1e-9) {
            const nx = -dy / len
            const ny = dx / len
            const lx1 = x1 + nx * offset
            const ly1 = y1 + ny * offset
            const lx2 = x2 + nx * offset
            const ly2 = y2 + ny * offset
            d.drawLine(cv(lx1), cv(ly1), cv(lx2), cv(ly2))
            d.drawLine(cv(x1), cv(y1), cv(lx1), cv(ly1))
            d.drawLine(cv(x2), cv(y2), cv(lx2), cv(ly2))
            d.drawText(cv((lx1 + lx2) / 2), cv((ly1 + ly2) / 2), cv(textHeight), 0, cv(len).toFixed(2))
          }
        }
        break
      }
      case 'leader': {
        // 継承元callout: 矢印→エルボ→ショルダーの2線分＋注記テキスト。textHeightをフォント高に用いる。
        const x1 = geometry.start.x
        const y1 = geometry.start.y
        const x2 = geometry.end.x
        const y2 = geometry.end.y
        const fontSize = geometry.textHeight
        const elbowX = x2
        const elbowY = y1
        const shoulderLen = Math.min(Math.abs(x2 - x1) * 0.3, 20)
        const textX = x2 > x1 ? x2 + shoulderLen : x2 - shoulderLen
        d.drawLine(cv(x1), cv(y1), cv(elbowX), cv(elbowY))
        d.drawLine(cv(elbowX), cv(elbowY), cv(textX), cv(y2))
        d.drawText(cv(textX + (x2 > x1 ? 2 : -2)), cv(y2 - fontSize * 0.5), cv(fontSize), 0, geometry.text)
        break
      }
      case 'parametricObject':
        // 生成図形（generatedGeometryIds先の実体）が出力対象のため、本体はskipする。
        break
      default: {
        const exhaustive: never = geometry
        throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
      }
    }
  }

  return d.toDxfString()
}

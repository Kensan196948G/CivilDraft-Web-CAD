/**
 * 単一図形の Canvas 描画コンポーネント（react-konva プリミティブへのマッピング）。
 * 継承元: Civil-Draw src/components/Canvas/ShapeRenderer.tsx（継承台帳 modify、Canvas描画パイプライン）。
 *
 * 継承元との差分:
 * - Shape（14種フラット座標）→ Geometry判別共用体13種（詳細設計仕様書§6）へマッピングを移植。
 *   line/rectangle/circle/arc/ellipse/polyline/spline/text/dimension/leader/hatch/symbol/parametricObject。
 * - 継承元の cloud / mline は新13種に存在しないため描画ロジックごと移植対象外とした。
 * - スタイル解決を layer prop 依存から Geometry.style（GeometryStyle）依存へ変更した。
 *   本コンポーネントは store 非依存の presentational であり、props（geometry / isSelected /
 *   isPreview）だけで描画する（色・線幅・線種・不透明度はすべて geometry.style から解決）。
 * - ヒットテストは Konva ではなく空間索引が担う設計（詳細設計仕様書§9.3）のため、継承元の
 *   onSelect / onClick を廃し listening={false} を全図形で固定した（継承元の
 *   strokeScaleEnabled=false / perfectDrawEnabled=false 等の性能設定は踏襲）。
 * - 寸法テキストは継承元の fmtLen(len * scale)（canvasStore の scale 依存）を、store 非依存の
 *   formatLengthMm(mm)（domain/units、ADR-0012 内部mm基準）へ置換した。
 * - lineType→dash は継承元 solid/dashed/dashdot を踏襲し、新規の 'double' は実線で近似する
 *   （二重線描画は未実装。dashForLineType のコメント参照）。
 */
import { memo } from 'react'
import { Arc, Arrow, Circle, Ellipse, Group, Line, Rect, Text } from 'react-konva'
import type { Geometry, GeometryStyle, Point } from '@/shared/types'
import { generateHatchLines } from '@/domain/geometry/hatchGenerator'
import { getSymbolById } from '@/domain/catalog/symbolCatalog'
import { formatLengthMm } from '@/domain/units'

export interface GeometryRendererProps {
  readonly geometry: Geometry
  /** 選択強調（線幅+1・青系シャドウ）を付与する。 */
  readonly isSelected?: boolean
  /** 作図中プレビュー表示（グレー描画・半透明・非対話）。 */
  readonly isPreview?: boolean
}

/** プレビュー時のグレー描画色（継承元 ShapeRenderer と同値）。 */
const PREVIEW_STROKE = '#888888'
/** 選択強調のシャドウ色（継承元 ShapeRenderer と同値）。 */
const SELECTION_SHADOW = '#4af'

/**
 * GeometryStyle.lineType を Konva の dash 配列へ変換する。
 * continuous/dashed/dashDot は継承元 DASH_PATTERNS を踏襲。
 * 'double'（二重線）は専用描画を持たないため実線で近似する（判断: 二重線は
 * オフセット2本描画が必要で単一プリミティブでは表現できず、Issue化して後続対応）。
 */
function dashForLineType(lineType: GeometryStyle['lineType']): number[] {
  switch (lineType) {
    case 'dashed':
      return [10, 5]
    case 'dashDot':
      return [10, 5, 2, 5]
    case 'continuous':
    case 'double':
      return []
    default: {
      const exhaustive: never = lineType
      throw new Error(`Unhandled lineType: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** Point 配列を Konva の平坦座標配列（x,y交互）へ変換する。 */
function flattenPoints(points: readonly Point[]): number[] {
  const out: number[] = []
  for (const p of points) {
    out.push(p.x, p.y)
  }
  return out
}

function GeometryRendererImpl({
  geometry,
  isSelected = false,
  isPreview = false,
}: GeometryRendererProps) {
  const { style } = geometry
  const stroke = isPreview ? PREVIEW_STROKE : style.strokeColor
  const baseStrokeWidth = style.strokeWidth
  const strokeWidth = isSelected ? baseStrokeWidth + 1 : baseStrokeWidth
  const opacity = isPreview ? 0.6 : style.opacity
  const dash = dashForLineType(style.lineType)
  const shadowBlur = isSelected ? 4 : 0

  // 全図形共通の Konva props。継承元の性能設定（screen-space stroke・
  // perfectDrawEnabled=false）を踏襲。ヒットテストは空間索引が担うため listening=false。
  const commonProps = {
    stroke,
    strokeWidth,
    // strokeScaleEnabled=false → stroke は Stage の zoom/pan 変換を受けず常に
    // screen-space で strokeWidth ピクセル幅で描画される（CAD標準・継承元踏襲）。
    strokeScaleEnabled: false,
    dash,
    shadowBlur,
    shadowColor: SELECTION_SHADOW,
    shadowForStrokeEnabled: false,
    perfectDrawEnabled: false,
    opacity,
    listening: false,
  }

  // 閉図形の塗り。明示的 fillColor があれば優先、無ければ透明（継承元の
  // rect/circle/ellipse は透明、closed polyline のみ stroke 由来の淡色）。
  const solidFill = style.fillColor ?? 'transparent'

  switch (geometry.type) {
    case 'line':
      return (
        <Line
          {...commonProps}
          points={[geometry.start.x, geometry.start.y, geometry.end.x, geometry.end.y]}
        />
      )

    case 'rectangle':
      return (
        <Rect
          {...commonProps}
          x={geometry.origin.x}
          y={geometry.origin.y}
          width={geometry.width}
          height={geometry.height}
          rotation={geometry.rotationDeg}
          fill={solidFill}
        />
      )

    case 'circle':
      return (
        <Circle
          {...commonProps}
          x={geometry.center.x}
          y={geometry.center.y}
          radius={geometry.radius}
          fill={solidFill}
        />
      )

    case 'arc': {
      // Konva Arc: innerRadius=outerRadius=radius で外周円弧のみ描画。
      // 暫定規約（掃引方向は Issue #23 で検討中）: rotation=startAngleDeg を起点に
      // angle=(endAngleDeg - startAngleDeg を 0..360 に正規化) 度ぶん掃引する。
      // 正規化結果が 0（始点=終点）のときは全円とみなす（継承元の `|| 360` を踏襲）。
      const sweep = ((geometry.endAngleDeg - geometry.startAngleDeg + 360) % 360) || 360
      return (
        <Arc
          {...commonProps}
          x={geometry.center.x}
          y={geometry.center.y}
          innerRadius={geometry.radius}
          outerRadius={geometry.radius}
          angle={sweep}
          rotation={geometry.startAngleDeg}
          fill="transparent"
        />
      )
    }

    case 'ellipse':
      return (
        <Ellipse
          {...commonProps}
          x={geometry.center.x}
          y={geometry.center.y}
          radiusX={geometry.radiusX}
          radiusY={geometry.radiusY}
          rotation={geometry.rotationDeg}
          fill={solidFill}
        />
      )

    case 'polyline':
      return (
        <Line
          {...commonProps}
          points={flattenPoints(geometry.points)}
          closed={geometry.closed}
          // closed polyline は継承元同様 stroke 由来の淡色（+22=約13%）で塗る。
          fill={geometry.closed ? (style.fillColor ?? `${stroke}22`) : 'transparent'}
        />
      )

    case 'spline':
      return (
        <Line
          {...commonProps}
          points={flattenPoints(geometry.points)}
          tension={geometry.tension}
          fill="transparent"
        />
      )

    case 'text':
      return (
        <Text
          x={geometry.anchor.x}
          y={geometry.anchor.y}
          text={geometry.text}
          fontSize={geometry.height}
          rotation={geometry.rotationDeg}
          align={geometry.horizontalAlign}
          fill={stroke}
          opacity={opacity}
          listening={false}
        />
      )

    case 'dimension': {
      const { start, end, offset, textHeight, arrowSize, orientation } = geometry
      let lx1 = start.x
      let ly1 = start.y
      let lx2 = end.x
      let ly2 = end.y
      // tx/ty/dimText は全分岐で必ず再代入されるため初期値を持たせない。
      let tx: number
      let ty: number
      let dimText: string

      if (orientation === 'horizontal') {
        ly1 = start.y - offset
        ly2 = end.y - offset
        tx = (start.x + end.x) / 2
        ty = Math.min(start.y, end.y) - offset - textHeight - 4
        dimText = formatLengthMm(Math.abs(end.x - start.x))
      } else if (orientation === 'vertical') {
        lx1 = start.x - offset
        lx2 = end.x - offset
        tx = Math.min(start.x, end.x) - offset - 4
        ty = (start.y + end.y) / 2
        dimText = formatLengthMm(Math.abs(end.y - start.y))
      } else {
        // parallel: 単位法線（90°CCW）方向へ offset ぶん寸法線を平行移動する。
        const dx = end.x - start.x
        const dy = end.y - start.y
        const len = Math.hypot(dx, dy)
        if (len > 1e-9) {
          const nx = -dy / len
          const ny = dx / len
          lx1 = start.x + nx * offset
          ly1 = start.y + ny * offset
          lx2 = end.x + nx * offset
          ly2 = end.y + ny * offset
        }
        dimText = formatLengthMm(len)
        tx = (lx1 + lx2) / 2
        ty = (ly1 + ly2) / 2 - textHeight - 4
      }

      return (
        <>
          <Arrow
            points={[lx1, ly1, lx2, ly2]}
            stroke={stroke}
            strokeWidth={strokeWidth}
            pointerAtBeginning
            pointerAtEnding
            pointerLength={arrowSize}
            pointerWidth={arrowSize}
            fill={stroke}
            opacity={opacity}
            listening={false}
          />
          <Line
            points={[start.x, start.y, lx1, ly1]}
            stroke={stroke}
            strokeWidth={strokeWidth * 0.5}
            dash={[4, 4]}
            opacity={opacity}
            listening={false}
          />
          <Line
            points={[end.x, end.y, lx2, ly2]}
            stroke={stroke}
            strokeWidth={strokeWidth * 0.5}
            dash={[4, 4]}
            opacity={opacity}
            listening={false}
          />
          <Text
            x={tx}
            y={ty}
            text={dimText}
            fontSize={textHeight}
            fill={stroke}
            opacity={opacity}
            listening={false}
          />
        </>
      )
    }

    case 'leader': {
      // 継承元 CalloutShape。引出線（肘つき）＋注記テキスト。
      const { start, end, text, textHeight } = geometry
      const elbowX = end.x
      const elbowY = start.y
      const shoulderLen = Math.min(Math.abs(end.x - start.x) * 0.3, 20)
      const textAnchorX = end.x > start.x ? end.x + shoulderLen : end.x - shoulderLen
      return (
        <Group listening={false} opacity={opacity}>
          <Arrow
            points={[start.x, start.y, elbowX, elbowY]}
            stroke={stroke}
            strokeWidth={strokeWidth}
            fill={stroke}
            pointerLength={6}
            pointerWidth={5}
            strokeScaleEnabled={false}
          />
          <Line
            points={[elbowX, elbowY, textAnchorX, end.y]}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeScaleEnabled={false}
          />
          <Text
            x={end.x > start.x ? textAnchorX + 3 : textAnchorX - 3}
            y={end.y - textHeight * 0.6}
            text={text}
            fontSize={textHeight}
            fill={stroke}
            align={end.x > start.x ? 'left' : 'right'}
          />
        </Group>
      )
    }

    case 'hatch': {
      // generateHatchLines は新シグネチャで HatchGeometry を一括受け取り、
      // start/end:Point 構造の HatchLine 配列を返す（継承元は平坦座標＋4引数）。
      const lines = generateHatchLines(geometry)
      return (
        <Group listening={false}>
          <Line
            points={flattenPoints(geometry.boundaryPoints)}
            closed
            stroke={stroke}
            strokeWidth={strokeWidth}
            fill="transparent"
            opacity={opacity}
          />
          {lines.map((l, i) => (
            <Line
              key={i}
              points={[l.start.x, l.start.y, l.end.x, l.end.y]}
              stroke={stroke}
              strokeWidth={baseStrokeWidth * 0.5}
              opacity={isPreview ? 0.4 : 0.7}
              listening={false}
            />
          ))}
        </Group>
      )
    }

    case 'symbol': {
      const sym = getSymbolById(geometry.symbolId)
      if (sym === undefined) return null
      // scale 0 は strokeWidth の 0除算（Infinity）を招くため 1 に退避する。
      const safeScale = geometry.scale === 0 ? 1 : geometry.scale
      // シンボル内 stroke は Group の scale を打ち消して screen-space 幅を保つ（継承元踏襲）。
      const symbolStrokeWidth = strokeWidth / safeScale
      return (
        <Group
          x={geometry.position.x}
          y={geometry.position.y}
          rotation={geometry.rotationDeg}
          scaleX={geometry.scale}
          scaleY={geometry.scale}
          listening={false}
          opacity={opacity}
        >
          {sym.paths.map((p, i) => {
            if (p.type === 'line') {
              return (
                <Line
                  key={i}
                  points={[...p.data]}
                  stroke={stroke}
                  strokeWidth={symbolStrokeWidth}
                />
              )
            }
            if (p.type === 'circle') {
              const [cx, cy, r] = p.data
              if (cx === undefined || cy === undefined || r === undefined) return null
              return (
                <Circle
                  key={i}
                  x={cx}
                  y={cy}
                  radius={r}
                  stroke={stroke}
                  strokeWidth={symbolStrokeWidth}
                  fill={p.fill ? stroke : 'transparent'}
                />
              )
            }
            return (
              <Line
                key={i}
                points={[...p.data]}
                closed={p.closed}
                stroke={stroke}
                strokeWidth={symbolStrokeWidth}
                fill={p.fill ? `${stroke}44` : 'transparent'}
              />
            )
          })}
        </Group>
      )
    }

    case 'parametricObject':
      // パラメトリック図形は座標を直接持たない間接参照型（詳細設計仕様書§15）。
      // 実体は generatedGeometryIds が指す生成図形側で描画されるため、ここでは何も描かない。
      return null

    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * geometry は不変更新（変更時に新参照）を前提とするため、参照一致＋選択/プレビュー状態の
 * 一致で再描画をスキップできる（style は geometry に内包されるため個別比較は不要）。
 */
export const GeometryRenderer = memo(
  GeometryRendererImpl,
  (prev, next) =>
    prev.geometry === next.geometry &&
    prev.isSelected === next.isSelected &&
    prev.isPreview === next.isPreview,
)

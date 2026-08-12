/**
 * 選択図形のプロパティ入力（NumInput / GeometryFields）と補助関数。
 * Issue #179 で CadEditorPage（2,577行モノリス）から抽出。
 */
import type { Geometry } from '@/shared/types'
import { FIELD_LABELS } from './labels'
import { withUpdatedAt } from './geometryUpdate'
import { fieldInputStyle, fieldLabelStyle, fieldRowStyle } from './styles'
import { monoStyle } from '../pageStyles'

const GEOMETRY_BASE_KEYS = new Set([
  'id',
  'layerId',
  'type',
  'style',
  'civilAttributeId',
  'constructionStepIds',
  'locked',
  'createdAt',
  'updatedAt',
])

function formatFieldValue(value: unknown): string {
  if (value === undefined) return '未設定'
  if (typeof value === 'number') return value.toFixed(3)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return `${value.length}件`
  if (value !== null && typeof value === 'object' && 'x' in value && 'y' in value) {
    const p = value as { x: number; y: number }
    return `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`
  }
  return String(value)
}

/** 数値入力欄。keyにgeometry.id+フィールド値を含めることで、選択切替・Undo/Redoによる外部変更時に defaultValue を再適用する（非制御コンポーネントの取りこぼしを防ぐ）。 */
export function NumInput({
  value,
  onCommit,
  precision = 3,
}: {
  readonly value: number
  readonly onCommit: (next: number) => void
  readonly precision?: number
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={value.toFixed(precision)}
      style={fieldInputStyle}
      onBlur={(e) => {
        const next = Number(e.target.value)
        if (Number.isFinite(next) && next !== value) onCommit(next)
      }}
    />
  )
}

/** 選択図形の「幾何」フィールド。実データが存在するline/circle/rectangle/textのみ編集可能、他9種は実フィールドの読み取り専用表示とする。 */
export function GeometryFields({
  geometry,
  onCommit,
}: {
  readonly geometry: Geometry
  readonly onCommit: (next: Geometry) => void
}) {
  switch (geometry.type) {
    case 'line': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>始点 X</span>
            <NumInput key={`${g.id}:sx:${g.start.x}`} value={g.start.x} onCommit={(v) => onCommit(withUpdatedAt(g, { start: { ...g.start, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>始点 Y</span>
            <NumInput key={`${g.id}:sy:${g.start.y}`} value={g.start.y} onCommit={(v) => onCommit(withUpdatedAt(g, { start: { ...g.start, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>終点 X</span>
            <NumInput key={`${g.id}:ex:${g.end.x}`} value={g.end.x} onCommit={(v) => onCommit(withUpdatedAt(g, { end: { ...g.end, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>終点 Y</span>
            <NumInput key={`${g.id}:ey:${g.end.y}`} value={g.end.y} onCommit={(v) => onCommit(withUpdatedAt(g, { end: { ...g.end, y: v } }))} />
          </div>
        </>
      )
    }
    case 'circle': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>中心 X</span>
            <NumInput key={`${g.id}:cx:${g.center.x}`} value={g.center.x} onCommit={(v) => onCommit(withUpdatedAt(g, { center: { ...g.center, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>中心 Y</span>
            <NumInput key={`${g.id}:cy:${g.center.y}`} value={g.center.y} onCommit={(v) => onCommit(withUpdatedAt(g, { center: { ...g.center, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>半径</span>
            <NumInput key={`${g.id}:r:${g.radius}`} value={g.radius} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { radius: v }))} />
          </div>
        </>
      )
    }
    case 'rectangle': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>原点 X</span>
            <NumInput key={`${g.id}:ox:${g.origin.x}`} value={g.origin.x} onCommit={(v) => onCommit(withUpdatedAt(g, { origin: { ...g.origin, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>原点 Y</span>
            <NumInput key={`${g.id}:oy:${g.origin.y}`} value={g.origin.y} onCommit={(v) => onCommit(withUpdatedAt(g, { origin: { ...g.origin, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>幅</span>
            <NumInput key={`${g.id}:w:${g.width}`} value={g.width} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { width: v }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>高さ</span>
            <NumInput key={`${g.id}:h:${g.height}`} value={g.height} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { height: v }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>回転角(°)</span>
            <NumInput key={`${g.id}:rot:${g.rotationDeg}`} value={g.rotationDeg} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { rotationDeg: v }))} />
          </div>
        </>
      )
    }
    case 'text': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>位置 X</span>
            <NumInput key={`${g.id}:ax:${g.anchor.x}`} value={g.anchor.x} onCommit={(v) => onCommit(withUpdatedAt(g, { anchor: { ...g.anchor, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>位置 Y</span>
            <NumInput key={`${g.id}:ay:${g.anchor.y}`} value={g.anchor.y} onCommit={(v) => onCommit(withUpdatedAt(g, { anchor: { ...g.anchor, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>内容</span>
            <input
              key={`${g.id}:text:${g.text}`}
              type="text"
              defaultValue={g.text}
              style={fieldInputStyle}
              onBlur={(e) => {
                if (e.target.value !== g.text) onCommit(withUpdatedAt(g, { text: e.target.value }))
              }}
            />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>文字高さ</span>
            <NumInput key={`${g.id}:height:${g.height}`} value={g.height} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { height: v }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>回転角(°)</span>
            <NumInput key={`${g.id}:rot:${g.rotationDeg}`} value={g.rotationDeg} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { rotationDeg: v }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>配置</span>
            <select
              value={g.horizontalAlign}
              style={fieldInputStyle}
              onChange={(e) => onCommit(withUpdatedAt(g, { horizontalAlign: e.target.value as typeof g.horizontalAlign }))}
            >
              <option value="left">左寄せ</option>
              <option value="center">中央</option>
              <option value="right">右寄せ</option>
            </select>
          </div>
        </>
      )
    }
    case 'leader': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>始点 X</span>
            <NumInput key={`${g.id}:sx:${g.start.x}`} value={g.start.x} onCommit={(v) => onCommit(withUpdatedAt(g, { start: { ...g.start, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>始点 Y</span>
            <NumInput key={`${g.id}:sy:${g.start.y}`} value={g.start.y} onCommit={(v) => onCommit(withUpdatedAt(g, { start: { ...g.start, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>終点 X</span>
            <NumInput key={`${g.id}:ex:${g.end.x}`} value={g.end.x} onCommit={(v) => onCommit(withUpdatedAt(g, { end: { ...g.end, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>終点 Y</span>
            <NumInput key={`${g.id}:ey:${g.end.y}`} value={g.end.y} onCommit={(v) => onCommit(withUpdatedAt(g, { end: { ...g.end, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>内容</span>
            <input
              key={`${g.id}:text:${g.text}`}
              type="text"
              defaultValue={g.text}
              style={fieldInputStyle}
              onBlur={(e) => {
                if (e.target.value !== g.text) onCommit(withUpdatedAt(g, { text: e.target.value }))
              }}
            />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>文字高さ</span>
            <NumInput key={`${g.id}:th:${g.textHeight}`} value={g.textHeight} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { textHeight: v }))} />
          </div>
        </>
      )
    }
    default: {
      const entries = Object.entries(geometry).filter(([key]) => !GEOMETRY_BASE_KEYS.has(key))
      return (
        <>
          {entries.map(([key, value]) => (
            <div key={key} style={fieldRowStyle}>
              <span style={fieldLabelStyle}>{FIELD_LABELS[key] ?? key}</span>
              <span style={monoStyle}>{formatFieldValue(value)}</span>
            </div>
          ))}
        </>
      )
    }
  }
}

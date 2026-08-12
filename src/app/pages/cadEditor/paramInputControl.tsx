/**
 * パラメトリック編集の数値入力（ParamInputControl）。
 * Issue #179 で CadEditorPage（2,577行モノリス）から抽出。
 */
import { editParamInputStyle, editParamRowStyle } from './styles'

export function ParamInputControl({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: number
  readonly onChange: (v: number) => void
}) {
  return (
    <div style={editParamRowStyle}>
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <input
        type="number"
        value={value}
        min={0.1}
        step={1}
        style={editParamInputStyle}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  )
}

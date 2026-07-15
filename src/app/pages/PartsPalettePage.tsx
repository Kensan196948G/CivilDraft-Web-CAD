/**
 * 土木部材パレット画面。
 * 記号（symbolCatalog 30種）・テンプレート（templateCatalog 6種）・パラメトリック部材
 * （parametric PARAMETRIC_CATALOG 7種）を図面へ配置する。配置は EditorStore の
 * dispatchCommand(AddGeometryCommand) 経由で行い Undo 可能とする（§7 コマンドパターン）。
 *
 * 配置スタイル・レイヤは activeLayer の id / defaultStyle を正本とする（§6.3）。
 * パラメトリックはパラメータスキーマから入力フォームを動的生成し、範囲外・型不正は
 * generateParametric の ValidationIssue をそのまま表示する（握り潰さない）。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { useEditorStore, useEditorStoreApi } from '@/app/store/useEditorStore'
import { createDefaultLayer } from '@/app/store/editorStore'
import { createAddGeometryCommand } from '@/domain/commands/geometryCommands'
import {
  defaultCreationContext,
  type GeometryCreationContext,
} from '@/domain/geometry/geometryFactory'
import { SYMBOL_CATALOG, getCategories } from '@/domain/catalog/symbolCatalog'
import type { SymbolDef } from '@/domain/catalog/symbolCatalog'
import { TEMPLATE_CATALOG, instantiateTemplate } from '@/domain/catalog/templateCatalog'
import type { TemplateDef } from '@/domain/catalog/templateCatalog'
import {
  PARAMETRIC_CATALOG,
  generateParametric,
  makeSymbol,
} from '@/domain/parametric'
import type {
  GenerationContext,
  ParameterSpec,
  ParametricObjectDefinition,
  ParametricParams,
} from '@/domain/parametric'
import type { DrawingLayer, Geometry, ValidationIssue } from '@/shared/types'
import {
  ghostButtonStyle,
  pageHeaderStyle,
  pageMainStyle,
  pageRootStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  panelStyle,
  primaryButtonStyle,
} from './pageStyles'

type PaletteTab = 'symbol' | 'template' | 'parametric'

const TAB_LABELS: Record<PaletteTab, string> = {
  symbol: '🧱 記号',
  template: '📐 テンプレート',
  parametric: '⚙️ パラメトリック',
}

const panelHeaderRowStyle: CSSProperties = {
  padding: '15px 18px',
  borderBottom: '1px solid var(--line2)',
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--ink)',
}

const inputStyle: CSSProperties = {
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  borderRadius: 6,
  padding: '6px 9px',
  font: 'inherit',
  fontSize: 12.5,
  color: 'var(--ink)',
  width: 120,
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '12px 14px',
  background: 'var(--surface)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

/** 配置先レイヤを解決する（activeLayerId → 先頭 → 既定）。 */
function resolveActiveLayer(layers: readonly DrawingLayer[], activeLayerId: string): DrawingLayer {
  return layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? createDefaultLayer()
}

/** number/integer/angle 入力の文字列表現へ変換する（オブジェクトは空文字）。 */
function toInputText(value: unknown): string {
  if (value === undefined || value === null || typeof value === 'object') return ''
  return String(value)
}

/** 数値入力を解釈する。空は空文字のまま、数値化できなければ生文字列（→検証で型エラー化）。 */
function parseNumberInput(raw: string): number | string {
  if (raw === '') return ''
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? raw : parsed
}

/** 経路（pointList）を "x,y" 行テキストへ変換する。 */
function pointListToText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((p) => (p && typeof p === 'object' ? `${(p as Record<string, unknown>).x},${(p as Record<string, unknown>).y}` : ''))
    .join('\n')
}

/** "x,y" 行テキストを Point 配列へ解釈する（不正行は NaN 座標→検証で型エラー化）。 */
function parsePointList(text: string): { x: number; y: number }[] {
  return text
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [xText, yText] = line.split(',')
      return { x: Number(xText), y: Number(yText) }
    })
}

/** スキーマ既定値からフォーム初期値を作る。 */
function initFormValues(def: ParametricObjectDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const spec of def.parameterSchema) values[spec.name] = spec.defaultValue
  return values
}

/** 数値パラメータの範囲説明文を組み立てる。 */
function rangeHint(spec: ParameterSpec): string {
  const parts: string[] = []
  if (spec.exclusiveMin !== undefined) parts.push(`${spec.exclusiveMin} より大きい`)
  if (spec.min !== undefined) parts.push(`${spec.min} 以上`)
  if (spec.max !== undefined) parts.push(`${spec.max} 以下`)
  return parts.join(' / ')
}

export interface PartsPalettePageProps {
  /** 配置後にCAD編集画面へ遷移する導線（任意）。 */
  readonly onOpenEditor?: () => void
}

export function PartsPalettePage({ onOpenEditor }: PartsPalettePageProps) {
  const storeApi = useEditorStoreApi()
  const geometryCount = useEditorStore((s) => s.geometries.length)

  const [tab, setTab] = useState<PaletteTab>('symbol')
  const firstDef = PARAMETRIC_CATALOG[0]
  const [selectedDefId, setSelectedDefId] = useState<string>(firstDef?.definitionId ?? '')
  const [formValues, setFormValues] = useState<Record<string, unknown>>(
    firstDef ? initFormValues(firstDef) : {},
  )
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const selectedDef = PARAMETRIC_CATALOG.find((d) => d.definitionId === selectedDefId)

  /** 生成済み図形群を 1 図形=1 コマンドで配置し、結果メッセージを立てる。 */
  const placeGeometries = (geometries: readonly Geometry[], label: string) => {
    const state = storeApi.getState()
    for (const geometry of geometries) {
      state.dispatchCommand(createAddGeometryCommand(geometry))
    }
    setIssues([])
    setMessage(`${label}を ${geometries.length} 件配置しました`)
  }

  const activeLayer = () => {
    const state = storeApi.getState()
    return resolveActiveLayer(state.layers, state.activeLayerId)
  }

  const placeSymbol = (symbol: SymbolDef) => {
    const layer = activeLayer()
    const ctx: GenerationContext = {
      ...defaultCreationContext,
      layerId: layer.id,
      style: layer.defaultStyle,
    }
    const geometry = makeSymbol(ctx, symbol.id, { x: 0, y: 0 }, 0, 1)
    placeGeometries([geometry], `記号「${symbol.name}」`)
  }

  const placeTemplate = (template: TemplateDef) => {
    const layer = activeLayer()
    const ctx: GeometryCreationContext = defaultCreationContext
    const geometries = instantiateTemplate(
      template,
      { layerId: layer.id, style: layer.defaultStyle },
      ctx,
    )
    placeGeometries(geometries, `テンプレート「${template.name}」`)
  }

  const placeParametric = () => {
    if (selectedDef === undefined) return
    const layer = activeLayer()
    const ctx: GenerationContext = {
      ...defaultCreationContext,
      layerId: layer.id,
      style: layer.defaultStyle,
    }
    const params: ParametricParams = formValues
    const result = generateParametric(selectedDef, params, ctx)
    if (!result.ok) {
      setMessage(null)
      setIssues(result.error)
      return
    }
    placeGeometries(result.value, `${selectedDef.name}`)
  }

  const selectDefinition = (def: ParametricObjectDefinition) => {
    setSelectedDefId(def.definitionId)
    setFormValues(initFormValues(def))
    setIssues([])
    setMessage(null)
  }

  const setParam = (name: string, value: unknown) =>
    setFormValues((prev) => ({ ...prev, [name]: value }))

  const setPointAxis = (name: string, axis: 'x' | 'y', raw: string) =>
    setFormValues((prev) => {
      const current =
        prev[name] !== null && typeof prev[name] === 'object'
          ? (prev[name] as Record<string, unknown>)
          : {}
      return { ...prev, [name]: { ...current, [axis]: parseNumberInput(raw) } }
    })

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>土木部材パレット</div>
          <div style={pageSubtitleStyle}>記号・テンプレート・パラメトリック部材の配置</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={pageSubtitleStyle}>現在の図面: {geometryCount} 件</div>
      </header>

      <main style={pageMainStyle}>
        {/* タブ */}
        <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(Object.keys(TAB_LABELS) as PaletteTab[]).map((key) => {
            const count =
              key === 'symbol'
                ? SYMBOL_CATALOG.length
                : key === 'template'
                  ? TEMPLATE_CATALOG.length
                  : PARAMETRIC_CATALOG.length
            const active = tab === key
            return (
              <button
                key={key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                style={{
                  ...(active ? primaryButtonStyle : ghostButtonStyle),
                  fontSize: 13,
                }}
              >
                {TAB_LABELS[key]} ({count})
              </button>
            )
          })}
        </div>

        {/* 配置結果・検証メッセージ */}
        {message !== null && (
          <div
            role="status"
            style={{
              marginBottom: 14,
              padding: '10px 14px',
              borderRadius: 8,
              background: 'var(--subtle)',
              border: '1px solid var(--line)',
              color: 'var(--ink)',
              fontSize: 12.5,
            }}
          >
            ✅ {message}
          </div>
        )}
        {issues.length > 0 && (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              padding: '10px 14px',
              borderRadius: 8,
              background: '#FDEAE8',
              border: '1px solid #E5A9A2',
              color: '#8A2018',
              fontSize: 12.5,
            }}
          >
            {issues.map((issue, i) => (
              <div key={`${issue.code}-${issue.field ?? ''}-${i}`}>⚠️ {issue.message}</div>
            ))}
          </div>
        )}

        {tab === 'symbol' && <SymbolSection onPlace={placeSymbol} />}
        {tab === 'template' && <TemplateSection onPlace={placeTemplate} />}
        {tab === 'parametric' && (
          <ParametricSection
            selectedDef={selectedDef}
            selectedDefId={selectedDefId}
            formValues={formValues}
            onSelectDefinition={selectDefinition}
            onSetParam={setParam}
            onSetPointAxis={setPointAxis}
            onPlace={placeParametric}
          />
        )}

        <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--muted)' }}>
          💡 配置した部材はCAD編集画面で確認・調整できます。配置は Undo（取り消し）可能です。
          {onOpenEditor !== undefined && (
            <button onClick={onOpenEditor} style={{ ...ghostButtonStyle, marginLeft: 10 }}>
              CAD編集画面へ
            </button>
          )}
        </div>
      </main>
    </div>
  )
}

/** 記号セクション: symbolCatalog をカテゴリ別に一覧し配置する。 */
function SymbolSection({ onPlace }: { readonly onPlace: (symbol: SymbolDef) => void }) {
  const categories = getCategories()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {categories.map((category) => {
        const symbols = SYMBOL_CATALOG.filter((s) => s.category === category)
        return (
          <div key={category} style={panelStyle}>
            <div style={panelHeaderRowStyle}>
              {category}（{symbols.length}種）
            </div>
            <div
              style={{
                padding: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))',
                gap: 10,
              }}
            >
              {symbols.map((symbol) => (
                <div key={symbol.id} style={cardStyle}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
                    {symbol.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{symbol.id}</div>
                  <button style={primaryButtonStyle} onClick={() => onPlace(symbol)}>
                    図面に配置
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** テンプレートセクション: templateCatalog 6種を一覧し配置する。 */
function TemplateSection({ onPlace }: { readonly onPlace: (template: TemplateDef) => void }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
        gap: 12,
      }}
    >
      {TEMPLATE_CATALOG.map((template) => (
        <div key={template.id} style={{ ...panelStyle, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{template.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {template.category} ・ {template.shapes.length}要素
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{template.description}</div>
          <button style={primaryButtonStyle} onClick={() => onPlace(template)}>
            図面に配置
          </button>
        </div>
      ))}
    </div>
  )
}

interface ParametricSectionProps {
  readonly selectedDef: ParametricObjectDefinition | undefined
  readonly selectedDefId: string
  readonly formValues: Record<string, unknown>
  readonly onSelectDefinition: (def: ParametricObjectDefinition) => void
  readonly onSetParam: (name: string, value: unknown) => void
  readonly onSetPointAxis: (name: string, axis: 'x' | 'y', raw: string) => void
  readonly onPlace: () => void
}

/** パラメトリックセクション: 定義選択 + スキーマ由来の動的フォーム + 配置。 */
function ParametricSection({
  selectedDef,
  selectedDefId,
  formValues,
  onSelectDefinition,
  onSetParam,
  onSetPointAxis,
  onPlace,
}: ParametricSectionProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 16, alignItems: 'start' }}>
      <div style={panelStyle}>
        <div style={panelHeaderRowStyle}>パラメトリック部材（{PARAMETRIC_CATALOG.length}種）</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {PARAMETRIC_CATALOG.map((def) => {
            const active = def.definitionId === selectedDefId
            return (
              <button
                key={def.definitionId}
                aria-pressed={active}
                onClick={() => onSelectDefinition(def)}
                style={{
                  textAlign: 'left',
                  padding: '11px 16px',
                  border: 'none',
                  borderBottom: '1px solid var(--line2)',
                  background: active ? 'var(--hover)' : 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{def.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {def.category} ・ {def.definitionId}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={panelStyle}>
        <div style={panelHeaderRowStyle}>
          {selectedDef !== undefined ? `${selectedDef.name} のパラメータ` : 'パラメータ'}
        </div>
        {selectedDef === undefined ? (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--muted)' }}>
            左の一覧から部材を選択してください。
          </div>
        ) : (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{selectedDef.description}</div>
            {selectedDef.parameterSchema.map((spec) => (
              <ParameterField
                key={spec.name}
                spec={spec}
                value={formValues[spec.name]}
                onSetParam={onSetParam}
                onSetPointAxis={onSetPointAxis}
              />
            ))}
            <div>
              <button style={primaryButtonStyle} onClick={onPlace}>
                図面に配置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ParameterFieldProps {
  readonly spec: ParameterSpec
  readonly value: unknown
  readonly onSetParam: (name: string, value: unknown) => void
  readonly onSetPointAxis: (name: string, axis: 'x' | 'y', raw: string) => void
}

/** 1 パラメータの入力欄。型に応じて数値/座標/経路/文字列入力を出し分ける。 */
function ParameterField({ spec, value, onSetParam, onSetPointAxis }: ParameterFieldProps) {
  const labelText = (
    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
      {spec.label}
      {spec.required && <span style={{ color: '#C5392F' }}> *</span>}
      {spec.unit !== undefined && <span style={{ color: 'var(--muted)' }}>（{spec.unit}）</span>}
    </div>
  )

  const hint = (
    <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
      既定: {String(spec.defaultValue)}
      {(spec.type === 'number' || spec.type === 'integer' || spec.type === 'angle') &&
        rangeHint(spec) !== '' && ` ・ 範囲: ${rangeHint(spec)}`}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {labelText}
      {(spec.type === 'number' || spec.type === 'integer' || spec.type === 'angle') && (
        <input
          type="number"
          aria-label={spec.label}
          value={toInputText(value)}
          onChange={(e) => onSetParam(spec.name, parseNumberInput(e.target.value))}
          style={inputStyle}
        />
      )}
      {spec.type === 'point' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            aria-label={`${spec.label} X`}
            value={toInputText((value as Record<string, unknown> | undefined)?.x)}
            onChange={(e) => onSetPointAxis(spec.name, 'x', e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            aria-label={`${spec.label} Y`}
            value={toInputText((value as Record<string, unknown> | undefined)?.y)}
            onChange={(e) => onSetPointAxis(spec.name, 'y', e.target.value)}
            style={inputStyle}
          />
        </div>
      )}
      {spec.type === 'pointList' && (
        <textarea
          aria-label={spec.label}
          value={pointListToText(value)}
          onChange={(e) => onSetParam(spec.name, parsePointList(e.target.value))}
          rows={3}
          style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
        />
      )}
      {(spec.type === 'string' || spec.type === 'slopeRatio') && (
        <input
          type="text"
          aria-label={spec.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onSetParam(spec.name, e.target.value)}
          style={{ ...inputStyle, width: 200 }}
        />
      )}
      {hint}
    </div>
  )
}

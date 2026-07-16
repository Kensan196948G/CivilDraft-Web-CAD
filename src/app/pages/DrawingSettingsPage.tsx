/**
 * 図面設定画面。
 * 正本: Claude Design「CivilDraft Web CAD」Drawing Settings.dc.html（100%適用）。
 * 図面ドキュメント（§5 DrawingDocument）は本番データ層接続前のため、画面内状態で
 * 用紙・縮尺・単位・原点・座標系・表題欄の編集、保存、キャンセルを処理する。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ghostButtonStyle,
  pageHeaderStyle,
  pageMainStyle,
  pageRootStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  panelHeaderStyle,
  panelStyle,
  primaryButtonStyle,
} from './pageStyles'

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }
const fieldStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  padding: '8px 11px',
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'var(--surface)',
  color: 'var(--ink)',
}
const fieldCol: CSSProperties = { flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 5 }
const formBody: CSSProperties = { padding: 18, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }

interface DrawingSettingsState {
  readonly paperSize: string
  readonly scale: string
  readonly unit: string
  readonly originX: string
  readonly originY: string
  readonly coordinateSystem: string
  readonly drawingName: string
  readonly drawingNo: string
  readonly rev: string
  readonly author: string
  readonly createdOn: string
}

const INITIAL_SETTINGS: DrawingSettingsState = {
  paperSize: 'A1（横）',
  scale: '1:500',
  unit: 'm（メートル）',
  originX: '78400.000',
  originY: '-12920.000',
  coordinateSystem: '平面直角座標系 第Ⅵ系',
  drawingName: '施工ヤード計画図',
  drawingNo: 'DWG-014',
  rev: 'Rev.3',
  author: '山田 太郎',
  createdOn: '2026-07-14',
}

export function DrawingSettingsPage() {
  const [savedSettings, setSavedSettings] = useState<DrawingSettingsState>(INITIAL_SETTINGS)
  const [draft, setDraft] = useState<DrawingSettingsState>(INITIAL_SETTINGS)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const setDraftValue = (key: keyof DrawingSettingsState, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const cancelSettings = () => {
    setDraft(savedSettings)
    setSavedMessage('変更をキャンセルしました')
  }

  const saveSettings = () => {
    setSavedSettings(draft)
    setSavedMessage('設定を保存しました')
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>図面設定</div>
          <div style={pageSubtitleStyle}>{savedSettings.drawingName} {savedSettings.rev} ・ 用紙、縮尺、単位、原点、座標系、表題欄</div>
        </div>
        <div style={{ flex: 1 }} />
        {savedMessage !== null && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{savedMessage}</span>
        )}
        <button style={{ ...ghostButtonStyle, padding: '8px 14px', fontSize: 12.5 }} onClick={cancelSettings}>キャンセル</button>
        <button style={primaryButtonStyle} onClick={saveSettings}>
          設定を保存
        </button>
      </header>

      <main style={pageMainStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 392px', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>用紙・縮尺</div>
              <div style={formBody}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={fieldCol}>
                    <label style={labelStyle}>用紙サイズ</label>
                    <select style={fieldStyle} value={draft.paperSize} onChange={(e) => setDraftValue('paperSize', e.target.value)}>
                      <option>A1（横）</option>
                      <option>A2（横）</option>
                      <option>A3（横）</option>
                    </select>
                  </div>
                  <div style={fieldCol}>
                    <label style={labelStyle}>縮尺</label>
                    <select style={fieldStyle} value={draft.scale} onChange={(e) => setDraftValue('scale', e.target.value)}>
                      <option>1:500</option>
                      <option>1:200</option>
                      <option>1:100</option>
                    </select>
                  </div>
                  <div style={fieldCol}>
                    <label style={labelStyle}>単位</label>
                    <select style={fieldStyle} value={draft.unit} onChange={(e) => setDraftValue('unit', e.target.value)}>
                      <option>m（メートル）</option>
                      <option>mm（ミリメートル）</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>原点・座標系</div>
              <div style={formBody}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ ...fieldCol, minWidth: 0 }}>
                    <label style={labelStyle}>図面原点 X</label>
                    <input style={fieldStyle} value={draft.originX} onChange={(e) => setDraftValue('originX', e.target.value)} />
                  </div>
                  <div style={{ ...fieldCol, minWidth: 0 }}>
                    <label style={labelStyle}>図面原点 Y</label>
                    <input style={fieldStyle} value={draft.originY} onChange={(e) => setDraftValue('originY', e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>座標系</label>
                  <select style={fieldStyle} value={draft.coordinateSystem} onChange={(e) => setDraftValue('coordinateSystem', e.target.value)}>
                    <option>平面直角座標系 第Ⅵ系</option>
                    <option>平面直角座標系 第Ⅶ系</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>表題欄</div>
              <div style={formBody}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={labelStyle}>図面名</label>
                  <input style={fieldStyle} value={draft.drawingName} onChange={(e) => setDraftValue('drawingName', e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ ...fieldCol, minWidth: 0 }}>
                    <label style={labelStyle}>図面番号</label>
                    <input style={fieldStyle} value={draft.drawingNo} onChange={(e) => setDraftValue('drawingNo', e.target.value)} />
                  </div>
                  <div style={{ ...fieldCol, minWidth: 0 }}>
                    <label style={labelStyle}>改訂</label>
                    <input style={fieldStyle} value={draft.rev} onChange={(e) => setDraftValue('rev', e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ ...fieldCol, minWidth: 0 }}>
                    <label style={labelStyle}>作成者</label>
                    <input style={fieldStyle} value={draft.author} onChange={(e) => setDraftValue('author', e.target.value)} />
                  </div>
                  <div style={{ ...fieldCol, minWidth: 0 }}>
                    <label style={labelStyle}>作成日</label>
                    <input style={fieldStyle} value={draft.createdOn} onChange={(e) => setDraftValue('createdOn', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>用紙プレビュー</div>
              <div style={{ padding: 18, display: 'flex', justifyContent: 'center' }}>
                <div
                  style={{
                    width: 280,
                    height: 198,
                    background: '#fff',
                    border: '2px solid #1A2433',
                    position: 'relative',
                    boxShadow: '0 1px 2px rgba(16,24,40,.08)',
                  }}
                >
                  <div style={{ position: 'absolute', inset: 10, border: '1px solid #8A97A8' }} />
                  <div
                    style={{
                      position: 'absolute',
                      right: 10,
                      bottom: 10,
                      width: 140,
                      border: '1px solid #1A2433',
                      background: '#F8FAFB',
                    }}
                  >
                    <div style={{ fontSize: 9, padding: '3px 6px', borderBottom: '1px solid #8A97A8', fontWeight: 600, color: '#1A2433' }}>
                      {draft.drawingName}
                    </div>
                    <div style={{ fontSize: 8, padding: '3px 6px', display: 'flex', justifyContent: 'space-between', color: '#5A6678' }}>
                      <span>{draft.drawingNo}</span>
                      <span>{draft.rev}</span>
                    </div>
                    <div style={{ fontSize: 8, padding: '3px 6px', display: 'flex', justifyContent: 'space-between', color: '#5A6678' }}>
                      <span>S={draft.scale.replace('1:', '1:')}</span>
                      <span>{draft.author}</span>
                    </div>
                  </div>
                  <div style={{ position: 'absolute', left: 16, top: 10, fontSize: 9, color: '#8A97A8' }}>
                    {draft.paperSize}841×594
                  </div>
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>設定履歴</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--ink2)' }}>縮尺を1:1000→1:500に変更</span>
                  <span style={{ color: 'var(--muted)' }}>07-13</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--ink2)' }}>座標系を初期設定</span>
                  <span style={{ color: 'var(--muted)' }}>07-02</span>
                </div>
              </div>
            </div>

            <div style={{ background: '#FDEFE0', color: '#B5701A', fontSize: 12.5, padding: '12px 14px', borderRadius: 8 }}>
              図面外に配置された図形があります。用紙プレビューで位置を確認してください。
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

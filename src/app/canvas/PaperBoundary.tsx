/**
 * 用紙境界の描画。現在の用紙サイズ・向き（world単位=mm）で塗り矩形＋ドロップシャドウを描く。
 * 継承元: Civil-Draw src/canvas/PaperBoundary.tsx（継承台帳 modify、Canvas描画補助）。
 *
 * 配置判断: src/app/canvas（プレゼンテーション層。react-konva使用）。
 *
 * 継承元との差分（Issue #6 / Issue #7 store統合）:
 * - zoom は継承元 useCanvasStore → 移植先 useEditorStore（ViewportSlice）セレクターへ置換。
 * - paperSize / paperOrientation は新 EditorStore に存在しない状態のため props で受け取る
 *   （rule 2: store肥大化回避。paperSize の store追加要否は親の別途判断）。寸法計算は
 *   移植済み domain/canvas/paperSize.ts の getPaperSizeMm を経由する。
 * - テーマ変更に伴う CSS変数の再読取（継承元は useThemeStore + useMemo([theme])）は、新システムに
 *   themeStore が無いため親（CanvasArea, Issue #6）の責務へ移し、配色を colors prop で受け取る設計に
 *   変更した。省略時は現在の CSS変数から読む（既定配色にフォールバック）。
 * - Konva Stage 内で world座標のまま描画し、stroke幅・shadowは 1/zoom で割ってpx一定に保つ挙動は as_is。
 */
import { Rect } from 'react-konva'
import { useEditorStore } from '@/app/store/useEditorStore'
import { getPaperSizeMm } from '@/domain/canvas/paperSize'
import type { PaperOrientation, PaperSize } from '@/domain/canvas/paperSize'

export interface PaperColors {
  readonly fill: string
  readonly stroke: string
  readonly shadow: string
}

export interface PaperBoundaryProps {
  readonly paperSize: PaperSize
  readonly paperOrientation: PaperOrientation
  /** CSS変数由来の配色。テーマ変更時の再読取は親が担い、変化時に新しいオブジェクトを渡す。 */
  readonly colors?: PaperColors
}

/** CSS変数（--paper-*）から配色を読む。未定義・SSR時は既定配色にフォールバックする。 */
function readPaperColors(): PaperColors {
  if (typeof window === 'undefined') {
    return { fill: '#ffffff', stroke: 'rgba(0,0,0,0.18)', shadow: 'rgba(0,0,0,0.25)' }
  }
  const style = getComputedStyle(document.documentElement)
  return {
    fill: style.getPropertyValue('--paper-fill').trim() || '#ffffff',
    stroke: style.getPropertyValue('--paper-stroke').trim() || 'rgba(0,0,0,0.18)',
    shadow: style.getPropertyValue('--paper-shadow').trim() || 'rgba(0,0,0,0.25)',
  }
}

export function PaperBoundary({ paperSize, paperOrientation, colors }: PaperBoundaryProps) {
  const zoom = useEditorStore((s) => s.zoom)
  const resolved = colors ?? readPaperColors()
  const paperMm = getPaperSizeMm(paperSize, paperOrientation)

  return (
    <Rect
      x={0}
      y={0}
      width={paperMm.w}
      height={paperMm.h}
      fill={resolved.fill}
      stroke={resolved.stroke}
      strokeWidth={1 / zoom}
      shadowColor={resolved.shadow}
      shadowBlur={10 / zoom}
      shadowOffset={{ x: 2 / zoom, y: 4 / zoom }}
      shadowOpacity={1}
      listening={false}
    />
  )
}

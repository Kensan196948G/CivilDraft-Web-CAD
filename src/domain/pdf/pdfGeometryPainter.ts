/**
 * 単一Geometryの PDF ベクター描画（pdf-lib のプリミティブ／低レベルオペレータへのマッピング）。
 * 継承元: なし（新規実装、Issue #10 / 詳細設計仕様書§24.1）。描画の対応規約は
 * src/app/canvas/GeometryRenderer.tsx（Konva描画）の規約に一致させる
 * （arc掃引方向: startAngleDeg→endAngleDeg の正方向=画面時計回り、Issue #23 確定）。
 *
 * 設計方針:
 * - 座標は pdfCoordinate.ts の PdfProjector（単一の真実）で内部mm→絶対PDF pt へ写像する。
 *   pdf-lib の drawSvgPath 等が内部で行う暗黙のY反転には依存しない（stroke=drawLine[絶対座標]、
 *   fill=生パスオペレータ[絶対座標]。挙動を実測確認済み）。
 * - Geometry 13種を default:never 網羅で描画する。parametricObject は座標を持たない間接参照型
 *   （§15）のため描画せず skip（生成図形側が描画される。GeometryRenderer と同じ判断）。
 * - text/leader の文字は requiresFontFallback で判定し、標準フォント（WinAnsi）で表現できない
 *   文字（CJK等）は「文字化けを出力せず」プレースホルダ矩形＋warning issue を積む（§24.1）。
 * - 線幅は用紙固有属性のため縮尺で割らず、strokeWidth を pt として解釈する（§24.1「線幅を明示指定」）。
 *   半径・文字高さ・寸法オフセット等の図面空間の量は projector.length（縮尺適用）で縮む。
 * - fill は生オペレータのため不透明度(ExtGState)を持たせずソリッド塗り。半透明塗りは非対応
 *   （印刷用途では明示 fillColor のみベタ塗り。Konvaのclosed polyline淡色自動塗りは画面専用の
 *   演出とみなし用紙には描かない）。
 */
import {
  closePath,
  degrees,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
} from 'pdf-lib'
import type { Color, PDFFont, PDFPage } from 'pdf-lib'
import type {
  DimensionGeometry,
  Geometry,
  GeometryStyle,
  LeaderGeometry,
  Point,
  RectangleGeometry,
  SymbolGeometry,
  TextGeometry,
  ValidationIssue,
} from '@/shared/types'
import { formatLengthMm } from '@/domain/units'
import { generateHatchLines } from '@/domain/geometry/hatchGenerator'
import { getSymbolById } from '@/domain/catalog/symbolCatalog'
import type { PdfProjector } from './pdfCoordinate'

/** strokeWidth の下限（pt）。0や極小で線が消えるのを防ぐ。 */
const MIN_LINE_WIDTH_PT = 0.25
/** 矢印など用紙空間の最小サイズ（pt）。縮尺で潰れないよう下限を設ける。 */
const MIN_ARROW_PT = 4
/** arc/曲線近似の1セグメントあたり角度（度）。 */
const ARC_SEG_DEG = 6
/** arc 近似の最小分割数。 */
const ARC_MIN_SEG = 8
/** プレースホルダ矩形の枠色（グレー）。 */
const PLACEHOLDER_COLOR = rgb(0.6, 0.6, 0.6)

const DEG_TO_RAD = Math.PI / 180

/** 描画に必要な文脈（ページ・投影器・フォント・issue収集先）。 */
export interface PaintContext {
  readonly page: PDFPage
  readonly projector: PdfProjector
  /** テキスト描画に使うフォント（注入フォント or 標準Helvetica）。 */
  readonly font: PDFFont
  /**
   * 注入フォントを埋め込み済みか。true のとき任意文字を描画可能とみなす
   * （DD-TBD-006の日本語フォント注入DIが供給されたケース）。
   */
  readonly hasInjectedFont: boolean
  /** warning/info issue の収集先（呼び出し側で初期化した可変配列）。 */
  readonly issues: ValidationIssue[]
}

/**
 * テキストが標準フォント（StandardFonts=WinAnsiエンコーディング）で表現できず、
 * フォント代替（プレースホルダ）が必要かを判定する純関数（§24.1 フォント代替規則）。
 *
 * 規則:
 * - 注入フォントあり（hasInjectedFont=true）: そのフォントで描画するため代替不要 → false。
 * - 注入フォントなし: WinAnsi は Latin-1（U+0000–U+00FF）までしか表現できない。
 *   U+0100 以上（CJK・全角記号等）を含むテキストは代替が必要 → true。
 *   ※ Latin-1 内のアクセント付き文字（é 等）は WinAnsi で描画できるため代替しない
 *     （「文字化けを出さない」目的に対し過剰なプレースホルダ化を避ける）。
 */
export function requiresFontFallback(text: string, hasInjectedFont: boolean): boolean {
  if (hasInjectedFont) return false
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) > 0xff) return true
  }
  return false
}

/** '#RRGGBB' / '#RGB'（先頭#省略可・8桁のalphaは無視）を pdf-lib Color へ。失敗時 undefined。 */
function parseHexColor(hex: string | undefined): Color | undefined {
  if (hex === undefined) return undefined
  const raw = hex.startsWith('#') ? hex.slice(1) : hex
  let r: number
  let g: number
  let b: number
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    r = parseInt(raw[0]! + raw[0]!, 16)
    g = parseInt(raw[1]! + raw[1]!, 16)
    b = parseInt(raw[2]! + raw[2]!, 16)
  } else if (/^[0-9a-fA-F]{6}/.test(raw)) {
    r = parseInt(raw.slice(0, 2), 16)
    g = parseInt(raw.slice(2, 4), 16)
    b = parseInt(raw.slice(4, 6), 16)
  } else {
    return undefined
  }
  return rgb(r / 255, g / 255, b / 255)
}

/** stroke色（既定=黒）。 */
function strokeColorOf(style: GeometryStyle): Color {
  return parseHexColor(style.strokeColor) ?? rgb(0, 0, 0)
}

/** fill色（明示指定が無ければ undefined＝塗りなし）。 */
function fillColorOf(style: GeometryStyle): Color | undefined {
  return parseHexColor(style.fillColor)
}

/** strokeWidth を pt として解釈（下限クランプ）。 */
function lineWidthPt(style: GeometryStyle): number {
  return Math.max(style.strokeWidth, MIN_LINE_WIDTH_PT)
}

/** lineType → dash配列(pt)。continuous/double は実線（double専用描画は未実装、GeometryRenderer踏襲）。 */
function dashArrayPt(lineType: GeometryStyle['lineType']): number[] | undefined {
  switch (lineType) {
    case 'dashed':
      return [3, 1.5]
    case 'dashDot':
      return [3, 1.5, 0.5, 1.5]
    case 'continuous':
    case 'double':
      return undefined
    default: {
      const exhaustive: never = lineType
      throw new Error(`Unhandled lineType: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 内部mm点列を絶対PDF点列へ投影する。 */
function project(projector: PdfProjector, points: readonly Point[]): { x: number; y: number }[] {
  return points.map((p) => projector.point(p))
}

/** 絶対PDF点の折れ線をstroke描画する（drawLineの連続。closedなら終点→始点も結ぶ）。 */
function strokePolyline(
  page: PDFPage,
  pts: readonly { x: number; y: number }[],
  style: GeometryStyle,
  opts: { readonly closed?: boolean } = {},
): void {
  if (pts.length < 2) return
  const color = strokeColorOf(style)
  const thickness = lineWidthPt(style)
  const dashArray = dashArrayPt(style.lineType)
  const opacity = style.opacity
  const segments = opts.closed ? pts.length : pts.length - 1
  for (let i = 0; i < segments; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % pts.length]!
    page.drawLine({ start: a, end: b, thickness, color, dashArray, opacity })
  }
}

/** 絶対PDF点の多角形をソリッド塗りする（生パスオペレータ。graphics stateで隔離）。 */
function fillPolygonAbsolute(
  page: PDFPage,
  pts: readonly { x: number; y: number }[],
  color: Color,
): void {
  if (pts.length < 3) return
  const head = pts[0]!
  const ops = [
    pushGraphicsState(),
    setFillingColor(color),
    moveTo(head.x, head.y),
    ...pts.slice(1).map((p) => lineTo(p.x, p.y)),
    closePath(),
    fill(),
    popGraphicsState(),
  ]
  page.pushOperators(...ops)
}

/** 矢じり（三角形）を tip に向けて塗る。方向は tail→tip。sizePt は用紙空間。 */
function drawArrowhead(
  page: PDFPage,
  tip: { x: number; y: number },
  tail: { x: number; y: number },
  sizePt: number,
  color: Color,
): void {
  const dx = tip.x - tail.x
  const dy = tip.y - tail.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const baseX = tip.x - ux * sizePt
  const baseY = tip.y - uy * sizePt
  const half = sizePt * 0.4
  fillPolygonAbsolute(
    page,
    [
      tip,
      { x: baseX + px * half, y: baseY + py * half },
      { x: baseX - px * half, y: baseY - py * half },
    ],
    color,
  )
}

/** テキストを描画する。標準フォントで表現できない文字はプレースホルダ矩形＋warning。 */
function drawTextWithFallback(
  ctx: PaintContext,
  text: string,
  anchor: Point,
  heightMm: number,
  rotationDeg: number,
  align: 'left' | 'center' | 'right',
  color: Color,
  entityId: string,
): void {
  const fontSize = ctx.projector.length(heightMm)
  const pos = ctx.projector.point(anchor)
  // ベースラインは内部アンカー（テキスト上端）から1em下。PDFはY上向きのためyを減らす。
  const baselineY = pos.y - fontSize

  if (requiresFontFallback(text, ctx.hasInjectedFont)) {
    const widthPt = Math.max(text.length * fontSize * 0.6, fontSize * 0.6)
    ctx.page.drawRectangle({
      x: pos.x,
      y: baselineY,
      width: widthPt,
      height: fontSize,
      borderColor: PLACEHOLDER_COLOR,
      borderWidth: 0.5,
      borderDashArray: [2, 2],
    })
    ctx.issues.push({
      code: 'PDF_FONT_FALLBACK',
      severity: 'warning',
      entityId,
      message: `標準フォントで描画できない文字を含むためプレースホルダに置換しました（日本語フォント未注入）: "${text}"`,
    })
    return
  }

  let x = pos.x
  if (align !== 'left') {
    try {
      const w = ctx.font.widthOfTextAtSize(text, fontSize)
      x -= align === 'center' ? w / 2 : w
    } catch {
      // 幅計算に失敗しても左寄せで続行する（描画自体は成立する）。
    }
  }

  try {
    ctx.page.drawText(text, {
      x,
      y: baselineY,
      size: fontSize,
      font: ctx.font,
      color,
      rotate: degrees(-rotationDeg),
    })
  } catch {
    // requiresFontFallback を通過したが実エンコードに失敗した場合の安全網。
    ctx.page.drawRectangle({
      x: pos.x,
      y: baselineY,
      width: Math.max(text.length * fontSize * 0.6, fontSize * 0.6),
      height: fontSize,
      borderColor: PLACEHOLDER_COLOR,
      borderWidth: 0.5,
      borderDashArray: [2, 2],
    })
    ctx.issues.push({
      code: 'PDF_FONT_FALLBACK',
      severity: 'warning',
      entityId,
      message: `フォントが文字をエンコードできずプレースホルダに置換しました: "${text}"`,
    })
  }
}

/** 矩形（回転を原点まわりに適用した4隅）を描く。 */
function paintRectangle(ctx: PaintContext, geometry: RectangleGeometry): void {
  const { origin, width, height, rotationDeg, style } = geometry
  const rad = rotationDeg * DEG_TO_RAD
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rel: readonly [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ]
  const corners = rel.map(([dx, dy]) => ({
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }))
  const pts = project(ctx.projector, corners)
  const fillCol = fillColorOf(style)
  if (fillCol !== undefined) fillPolygonAbsolute(ctx.page, pts, fillCol)
  strokePolyline(ctx.page, pts, style, { closed: true })
}

/** 寸法図形（水平/垂直/平行）を GeometryRenderer と同じ規約で描く。 */
function paintDimension(ctx: PaintContext, geometry: DimensionGeometry): void {
  const { start, end, offset, textHeight, arrowSize, orientation, style } = geometry
  let lx1 = start.x
  let ly1 = start.y
  let lx2 = end.x
  let ly2 = end.y
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

  const p1 = ctx.projector.point({ x: lx1, y: ly1 })
  const p2 = ctx.projector.point({ x: lx2, y: ly2 })
  const color = strokeColorOf(style)

  // 寸法線本体＋両端矢印
  strokePolyline(ctx.page, [p1, p2], style)
  const arrowPt = Math.max(ctx.projector.length(arrowSize), MIN_ARROW_PT)
  drawArrowhead(ctx.page, p1, p2, arrowPt, color)
  drawArrowhead(ctx.page, p2, p1, arrowPt, color)

  // 補助線（始点/終点 → 寸法線端。細い破線）
  const extStyle: GeometryStyle = { ...style, strokeWidth: lineWidthPt(style) * 0.5, lineType: 'dashed' }
  strokePolyline(ctx.page, [ctx.projector.point(start), p1], extStyle)
  strokePolyline(ctx.page, [ctx.projector.point(end), p2], extStyle)

  // 寸法テキスト（数値＋単位のASCII）
  drawTextWithFallback(ctx, dimText, { x: tx, y: ty }, textHeight, 0, 'left', color, geometry.id)
}

/** 引出線（肘つき）＋注記。GeometryRenderer の CalloutShape 規約を踏襲。 */
function paintLeader(ctx: PaintContext, geometry: LeaderGeometry): void {
  const { start, end, text, textHeight, style } = geometry
  const elbow: Point = { x: end.x, y: start.y }
  const shoulderLen = Math.min(Math.abs(end.x - start.x) * 0.3, 20)
  const textAnchorX = end.x > start.x ? end.x + shoulderLen : end.x - shoulderLen
  const color = strokeColorOf(style)

  const pStart = ctx.projector.point(start)
  const pElbow = ctx.projector.point(elbow)
  const pShoulder = ctx.projector.point({ x: textAnchorX, y: end.y })

  strokePolyline(ctx.page, [pStart, pElbow], style)
  drawArrowhead(ctx.page, pElbow, pStart, Math.max(ctx.projector.length(textHeight), MIN_ARROW_PT), color)
  strokePolyline(ctx.page, [pElbow, pShoulder], style)

  const rightward = end.x > start.x
  const align = rightward ? 'left' : 'right'
  const textAnchor: Point = { x: rightward ? textAnchorX + 3 : textAnchorX - 3, y: end.y }
  drawTextWithFallback(ctx, text, textAnchor, textHeight, 0, align, color, geometry.id)
}

/** シンボル（カタログ図形）を position/rotation/scale で配置描画する。 */
function paintSymbol(ctx: PaintContext, geometry: SymbolGeometry): void {
  const sym = getSymbolById(geometry.symbolId)
  if (sym === undefined) {
    ctx.issues.push({
      code: 'PDF_SYMBOL_UNKNOWN',
      severity: 'info',
      entityId: geometry.id,
      message: `未知のシンボルIDのため描画をスキップしました: "${geometry.symbolId}"`,
    })
    return
  }
  const { position, rotationDeg, scale, style } = geometry
  const rad = rotationDeg * DEG_TO_RAD
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const toWorld = (lx: number, ly: number): Point => {
    const sx = lx * scale
    const sy = ly * scale
    return { x: position.x + sx * cos - sy * sin, y: position.y + sx * sin + sy * cos }
  }
  const strokeCol = strokeColorOf(style)

  for (const path of sym.paths) {
    if (path.type === 'circle') {
      const [cx, cy, r] = path.data
      if (cx === undefined || cy === undefined || r === undefined) continue
      const center = ctx.projector.point(toWorld(cx, cy))
      const radiusPt = ctx.projector.length(Math.abs(r) * scale)
      ctx.page.drawCircle({
        x: center.x,
        y: center.y,
        size: radiusPt,
        borderColor: strokeCol,
        borderWidth: lineWidthPt(style),
        color: path.fill ? strokeCol : undefined,
        opacity: path.fill ? style.opacity : undefined,
        borderOpacity: style.opacity,
      })
      continue
    }
    // line / polyline: data は x,y 交互
    const world: Point[] = []
    for (let i = 0; i + 1 < path.data.length; i += 2) {
      const lx = path.data[i]
      const ly = path.data[i + 1]
      if (lx === undefined || ly === undefined) continue
      world.push(toWorld(lx, ly))
    }
    const pts = project(ctx.projector, world)
    const closed = path.type === 'polyline' && path.closed === true
    if (path.fill && pts.length >= 3) fillPolygonAbsolute(ctx.page, pts, strokeCol)
    strokePolyline(ctx.page, pts, style, { closed })
  }
}

/** テキスト図形。 */
function paintText(ctx: PaintContext, geometry: TextGeometry): void {
  drawTextWithFallback(
    ctx,
    geometry.text,
    geometry.anchor,
    geometry.height,
    geometry.rotationDeg,
    geometry.horizontalAlign,
    strokeColorOf(geometry.style),
    geometry.id,
  )
}

/**
 * Geometry 1件を PDF ページへ描画する（default:never網羅）。
 * 描画中に生じた警告・情報は ctx.issues へ積む（例外は投げない）。
 */
export function paintGeometry(ctx: PaintContext, geometry: Geometry): void {
  const { page, projector } = ctx
  const style = geometry.style

  switch (geometry.type) {
    case 'line':
      strokePolyline(page, project(projector, [geometry.start, geometry.end]), style)
      return

    case 'rectangle':
      paintRectangle(ctx, geometry)
      return

    case 'circle': {
      const c = projector.point(geometry.center)
      const fillCol = fillColorOf(style)
      page.drawCircle({
        x: c.x,
        y: c.y,
        size: projector.length(geometry.radius),
        borderColor: strokeColorOf(style),
        borderWidth: lineWidthPt(style),
        borderDashArray: dashArrayPt(style.lineType),
        color: fillCol,
        opacity: fillCol ? style.opacity : undefined,
        borderOpacity: style.opacity,
      })
      return
    }

    case 'arc': {
      const sweep = ((geometry.endAngleDeg - geometry.startAngleDeg + 360) % 360) || 360
      const segs = Math.max(ARC_MIN_SEG, Math.ceil(sweep / ARC_SEG_DEG))
      const pts: Point[] = []
      for (let k = 0; k <= segs; k++) {
        const aDeg = geometry.startAngleDeg + (sweep * k) / segs
        const a = aDeg * DEG_TO_RAD
        pts.push({
          x: geometry.center.x + geometry.radius * Math.cos(a),
          y: geometry.center.y + geometry.radius * Math.sin(a),
        })
      }
      strokePolyline(page, project(projector, pts), style)
      return
    }

    case 'ellipse': {
      const c = projector.point(geometry.center)
      const fillCol = fillColorOf(style)
      page.drawEllipse({
        x: c.x,
        y: c.y,
        xScale: projector.length(geometry.radiusX),
        yScale: projector.length(geometry.radiusY),
        rotate: degrees(-geometry.rotationDeg),
        borderColor: strokeColorOf(style),
        borderWidth: lineWidthPt(style),
        borderDashArray: dashArrayPt(style.lineType),
        color: fillCol,
        opacity: fillCol ? style.opacity : undefined,
        borderOpacity: style.opacity,
      })
      return
    }

    case 'polyline': {
      const pts = project(projector, geometry.points)
      const fillCol = fillColorOf(style)
      if (geometry.closed && fillCol !== undefined && pts.length >= 3) {
        fillPolygonAbsolute(page, pts, fillCol)
      }
      strokePolyline(page, pts, style, { closed: geometry.closed })
      return
    }

    case 'spline':
      // 内部splineはtension平滑曲線だが、PDFでは制御点を直線で結ぶ折れ線近似で描く
      // （Konvaのtension平滑は再現しない。既知の忠実度ギャップ、報告済み）。
      strokePolyline(page, project(projector, geometry.points), style)
      return

    case 'cloud': {
      // 改訂雲マークは円弧の弦近似ポリラインで描く（DXF 出力と同一方針）。
      const minX = Math.min(geometry.x1, geometry.x2)
      const minY = Math.min(geometry.y1, geometry.y2)
      const maxX = Math.max(geometry.x1, geometry.x2)
      const maxY = Math.max(geometry.y1, geometry.y2)
      const arcSize = Math.max(1, geometry.arcSize)
      const pts: Point[] = []
      const sides: readonly (readonly [number, number, number, number])[] = [
        [minX, minY, maxX, minY],
        [maxX, minY, maxX, maxY],
        [maxX, maxY, minX, maxY],
        [minX, maxY, minX, minY],
      ]
      for (const [sx, sy, ex, ey] of sides) {
        const segLen = Math.hypot(ex - sx, ey - sy)
        if (segLen < 1) continue
        const n = Math.max(1, Math.round(segLen / arcSize))
        for (let i = 0; i <= n; i++) {
          const t = i / n
          pts.push({ x: sx + (ex - sx) * t, y: sy + (ey - sy) * t })
        }
      }
      strokePolyline(page, project(projector, pts), style, { closed: true })
      return
    }

    case 'mline': {
      // 平行2線。中心線の法線方向へ ±offset した 2 本の線分。
      const dx = geometry.end.x - geometry.start.x
      const dy = geometry.end.y - geometry.start.y
      const len = Math.hypot(dx, dy)
      const nx = len < 1e-12 ? 0 : (-dy / len) * geometry.offset
      const ny = len < 1e-12 ? geometry.offset : (dx / len) * geometry.offset
      strokePolyline(
        page,
        project(projector, [
          { x: geometry.start.x + nx, y: geometry.start.y + ny },
          { x: geometry.end.x + nx, y: geometry.end.y + ny },
        ]),
        style,
      )
      strokePolyline(
        page,
        project(projector, [
          { x: geometry.start.x - nx, y: geometry.start.y - ny },
          { x: geometry.end.x - nx, y: geometry.end.y - ny },
        ]),
        style,
      )
      return
    }

    case 'text':
      paintText(ctx, geometry)
      return

    case 'dimension':
      paintDimension(ctx, geometry)
      return

    case 'leader':
      paintLeader(ctx, geometry)
      return

    case 'hatch': {
      const boundary = project(projector, geometry.boundaryPoints)
      strokePolyline(page, boundary, style, { closed: true })
      const thinStyle: GeometryStyle = { ...style, strokeWidth: lineWidthPt(style) * 0.5 }
      for (const line of generateHatchLines(geometry)) {
        strokePolyline(page, project(projector, [line.start, line.end]), thinStyle)
      }
      return
    }

    case 'symbol':
      paintSymbol(ctx, geometry)
      return

    case 'parametricObject':
      // 座標を持たない間接参照型（§15）。生成図形側が描画されるため何も描かない。
      return

    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * DXF テキストを内部データモデル（Geometry 判別共用体・DrawingLayer）へ取り込むインポータ。
 * 継承元: Civil-Draw src/utils/dxfImporter.ts（継承台帳 modify、DXF変換ロジック）。
 *
 * 継承元との差分:
 * - 出力型を Shape 型（フラット座標、14種）から詳細設計仕様書§6の Geometry 判別共用体（13種、
 *   Point ベース）へ全面置換した。Layer 型は §6.3 の DrawingLayer へ置換した。
 * - 戻り値を `ImportResult`（warnings: string[]）から `Result<ImportResult, ValidationIssue>`
 *   （§4.2）へ変更した。ImportResult = { geometries, layers, issues }。
 *   パース失敗・未対応エンティティ・未対応単位は throw せず issues（ValidationIssue）に集約する。
 *   唯一 error 側（ok:false）を返すのは「入力が空（空白のみ）」の致命ケースに限定した。
 *   dxf-parser の例外は致命ではなく fallback パーサへ切り替える（継承元の graceful degradation を踏襲）。
 * - 【R-002 / R-004 最重要】単位不整合対策: DXF ヘッダ $INSUNITS を読み取り、内部基準 mm（ADR-0012）
 *   への換算を必ず domain/units の toLengthMm() 経由で適用する（係数の直書きをしない）。
 *   対応表（DXF $INSUNITS → domain/units LengthUnit）:
 *     4 = Millimeters → 'mm'（等倍）
 *     5 = Centimeters → 'cm'（×10）
 *     6 = Meters      → 'm'（×1000）
 *     0 = Unitless / 欠落 → 'mm' 既定（内部基準が mm のため無変換。判断根拠は下記）
 *     上記以外（1=Inches, 2=Feet, 3=Miles, 7=Kilometers 等）→ domain/units 非対応のため
 *       「未対応単位」ValidationIssue(warning) を記録し、無変換(mm扱い)で取り込む（明示的な劣化）。
 *   $INSUNITS 欠落時に mm を既定とする根拠: 内部基準単位が mm（ADR-0012）であり、係数1で
 *   無変換となるため、単位不明の座標を最も安全に（値を歪めずに）取り込める。
 * - 角度単位の非対称変換（新 ArcGeometry は度数法 startAngleDeg/endAngleDeg）:
 *     - dxf-parser 経路: ライブラリが ARC の startAngle/endAngle をラジアンで返すため rad→deg 変換
 *       （domain/units の fromAngleRad 経由）。
 *     - fallback 経路: 生 DXF の group 50/51 は度数法のため無変換で startAngleDeg/endAngleDeg に入れる。
 *   TEXT の rotation は dxf-parser・生DXFとも度数法のため無変換で rotationDeg に入れる。
 *   継承元は逆に「両経路ともラジアンへ」寄せていた（旧 ArcShape がラジアン保持のため）。
 * - 図形種別ごとの新型マッピング（継承元は一律 polyline へテッセレーションしていた種別も含む）:
 *     - DXF ELLIPSE 全楕円（sweep≈2π） → EllipseGeometry（center/radiusX/radiusY/rotationDeg）。
 *       楕円弧（部分）は EllipseGeometry が全楕円しか表現できないため、継承元同様 64分割の
 *       PolylineGeometry で近似し info issue を記録する。
 *     - DXF SPLINE → SplineGeometry（fitPoints 優先、無ければ controlPoints。tension は DXF に無い
 *       概念のため既定値。closed 情報は SplineGeometry に無く欠落）。継承元は polyline 化していた。
 * - ID 発番: 継承元の nanoid() 直呼びを廃し、GeometryCreationContext 注入（ADR-0013、省略可能な
 *   最終引数）へ変更。レイヤーIDも同一コンテキストの newId() を共有し（テストで決定的）、
 *   ブランドのみ LayerId へ読み替える。nanoid 依存は導入しない。
 * - DrawingLayer 合成規則（DXF LAYER テーブルに無いフィールドの既定値、根拠はコメント）:
 *     order=テーブル出現順、visible=true、locked=false、printable=true、
 *     defaultStyle=レイヤー色(ACI)から strokeColor を生成し他は既定値。
 * - 図形の style: 継承元 Shape は style を持たず色はレイヤー色で描画していた。新モデルは図形が
 *   style を必須とするため、所属レイヤーの defaultStyle を図形 style の初期値として複製する。
 * - 継承元 Shape の cloud/mline は新13種に存在しないが、DXF 側にも対応エンティティが無いため
 *   本インポータでは元々生成しておらず、影響なし。未対応 DXF エンティティは issues に記録する。
 * - noUncheckedIndexedAccess 対応の undefined ガードを配列インデックスアクセスへ付した。
 *
 * DXF-002/003/004（継承元の互換対応）はそのまま維持:
 * - DXF-002: dxf-parser 未対応の HATCH を生 group code から独自抽出（extractRawHatches）。
 * - DXF-003: dxf-parser v1.1.2 が XDATA(1000-1071) で型変換例外を投げる問題への pre-processing。
 * - DXF-004: dxf-parser が例外/ null を返す非標準出力向けの fallback パーサ。
 */
import DxfParser from 'dxf-parser'
import { fromAngleRad, toLengthMm } from '@/domain/units'
import type {
  ArcGeometry,
  CircleGeometry,
  EllipseGeometry,
  Geometry,
  GeometryBase,
  GeometryStyle,
  HatchGeometry,
  HatchPattern,
  LayerId,
  LineGeometry,
  Point,
  PolylineGeometry,
  Result,
  SplineGeometry,
  TextGeometry,
  ValidationIssue,
} from '@/shared/types'
import type { DrawingLayer } from '@/shared/types/layer'
import { defaultCreationContext, type GeometryCreationContext } from '@/domain/geometry/geometryFactory'

const TWO_PI = Math.PI * 2
const ELLIPSE_SEGMENTS = 64
/** DXF に高さ指定が無い TEXT/MTEXT のフォールバック文字高（DXF単位）。継承元の 14 を踏襲。 */
const DEFAULT_TEXT_HEIGHT = 14
/** DXF SPLINE には対応概念が無いため設定する SplineGeometry.tension の既定値（描画ヒント）。 */
const DEFAULT_SPLINE_TENSION = 0.5

export interface ImportResult {
  readonly geometries: readonly Geometry[]
  readonly layers: readonly DrawingLayer[]
  readonly issues: readonly ValidationIssue[]
}

// ---------------------------------------------------------------------------
// 生 DXF テキストの group code 解析（DXF-002/003/004 の共通基盤）
// ---------------------------------------------------------------------------

interface DxfGroup {
  readonly code: number
  readonly value: string
}

/**
 * 生 DXF テキストを (group code, value) ペア列へ解析する。
 * 一部の DXF ライタは空の値行を省略するため、行を1行ずつ走査し、有効な group code 整数
 * (0..1071) に見える行のみを code 行として扱い、直後の行を値とする（継承元 DXF-002 の堅牢化）。
 */
function parseDxfGroups(content: string): DxfGroup[] {
  const lines = content.split(/\r?\n/)
  const groups: DxfGroup[] = []
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    if (rawLine === undefined) continue
    const trimmed = rawLine.trim()
    if (trimmed === '') continue
    const code = parseInt(trimmed, 10)
    // 非負整数かつ trimmed が数値文字列と完全一致（"999" 等の値行を code と誤認しないため）。
    if (!Number.isNaN(code) && code >= 0 && code <= 1071 && String(code) === trimmed) {
      const next = i + 1 < lines.length ? lines[i + 1] : ''
      groups.push({ code, value: (next ?? '').trim() })
      i++ // 値行を消費
    }
  }
  return groups
}

/**
 * DXF-003: XDATA(group code 1000-1071)行ペアを除去する。dxf-parser v1.1.2 が XDATA を含む DXF で
 * 型変換例外を投げる問題を回避する。XDATA はエンティティ付随メタデータでジオメトリに影響しない。
 */
function stripXdata(content: string): string {
  const lines = content.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  while (i + 1 < lines.length) {
    const codeLine = lines[i]
    const valueLine = lines[i + 1]
    if (codeLine === undefined || valueLine === undefined) break
    const code = parseInt(codeLine.trim(), 10)
    if (!Number.isNaN(code) && code >= 1000 && code <= 1071) {
      i += 2
      continue
    }
    out.push(codeLine, valueLine)
    i += 2
  }
  // 末尾に1行残る場合（EOF マーカ等）を失わないよう保持する。
  if (i < lines.length) {
    const last = lines[i]
    if (last !== undefined) out.push(last)
  }
  return out.join('\n')
}

/**
 * R-002/R-004: ヘッダ $INSUNITS の整数値を生テキストから抽出する（dxf-parser 経路・fallback 経路の
 * 双方で単位解決を統一するため、ライブラリの header ではなく生テキストから読む）。無ければ null。
 */
function extractInsunits(content: string): number | null {
  const groups = parseDxfGroups(content)
  for (let i = 0; i < groups.length - 1; i++) {
    const g = groups[i]
    const next = groups[i + 1]
    if (g === undefined || next === undefined) continue
    if (g.code === 9 && g.value === '$INSUNITS' && next.code === 70) {
      const v = parseInt(next.value, 10)
      return Number.isNaN(v) ? null : v
    }
  }
  return null
}

/**
 * DXF $INSUNITS を domain/units の LengthUnit へ解決する。非対応単位は無変換(mm扱い)とし
 * ValidationIssue(warning) を返す。対応表はファイル冒頭コメント参照。
 */
function resolveLengthUnit(insunits: number | null): {
  toMm: (value: number) => number
  issue: ValidationIssue | null
} {
  switch (insunits) {
    case 4:
      return { toMm: (v) => toLengthMm({ value: v, unit: 'mm' }), issue: null }
    case 5:
      return { toMm: (v) => toLengthMm({ value: v, unit: 'cm' }), issue: null }
    case 6:
      return { toMm: (v) => toLengthMm({ value: v, unit: 'm' }), issue: null }
    case null:
    case 0:
      // 欠落 or Unitless → mm 既定（内部基準が mm のため無変換）。
      return { toMm: (v) => toLengthMm({ value: v, unit: 'mm' }), issue: null }
    default:
      return {
        toMm: (v) => toLengthMm({ value: v, unit: 'mm' }),
        issue: {
          code: 'dxf-unsupported-unit',
          severity: 'warning',
          message: `DXF単位コード ${insunits} は未対応（対応: 4=mm, 5=cm, 6=m）。座標を無変換(mm扱い)で取り込みました`,
        },
      }
  }
}

/** ラジアン→度数法（ADR-0012: 公開APIは度数法）。domain/units 経由で変換する。 */
function radToDeg(rad: number): number {
  return fromAngleRad(rad, 'deg').value
}

// ---------------------------------------------------------------------------
// ACI（AutoCAD Color Index）→ hex（継承元のテーブルをそのまま踏襲）
// ACI 0=BYBLOCK, 256=BYLAYER は未登録 → 黒(#000000)にフォールバック。
// ---------------------------------------------------------------------------
const ACI_TABLE: Record<number, string> = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff',
  5: '#0000ff', 6: '#ff00ff', 7: '#ffffff',
  8: '#414141', 9: '#808080', 10: '#ff0000', 11: '#ffaaaa',
  12: '#bd0000', 13: '#bd7e7e', 14: '#810000', 15: '#815656',
  16: '#682b2b', 17: '#682020', 18: '#ff3f00', 19: '#ffbfaa',
  20: '#bd2e00', 21: '#bd8d7e', 22: '#811f00', 23: '#816056',
  24: '#681900', 25: '#684e47', 26: '#ff7f00', 27: '#ffd4aa',
  28: '#bd5e00', 29: '#bd9d7e', 30: '#814000', 31: '#816b56',
  32: '#683400', 33: '#685647', 34: '#ffbf00', 35: '#ffeaaa',
  36: '#bd8d00', 37: '#bdad7e', 38: '#816000', 39: '#817656',
  40: '#684e00', 41: '#686047', 42: '#ffff00', 43: '#ffffaa',
  44: '#bdbd00', 45: '#bdbd7e', 46: '#818100', 47: '#818156',
  48: '#686800', 49: '#686847', 50: '#bfff00', 51: '#eaffaa',
  52: '#8dbd00', 53: '#adbd7e', 54: '#608100', 55: '#768156',
  56: '#4e6800', 57: '#606847', 58: '#7fff00', 59: '#d4ffaa',
  60: '#5ebd00', 61: '#9dbd7e', 62: '#408100', 63: '#6b8156',
  64: '#346800', 65: '#566847', 66: '#3fff00', 67: '#bfffaa',
  68: '#2ebd00', 69: '#8dbd7e', 70: '#1f8100', 71: '#608156',
  72: '#196800', 73: '#4e6847', 74: '#00ff00', 75: '#aaffaa',
  76: '#00bd00', 77: '#7ebd7e', 78: '#008100', 79: '#568156',
  80: '#006800', 81: '#476847', 82: '#00ff3f', 83: '#aaffbf',
  84: '#00bd2e', 85: '#7ebd8d', 86: '#00811f', 87: '#568160',
  88: '#006819', 89: '#47684e', 90: '#00ff7f', 91: '#aaffd4',
  92: '#00bd5e', 93: '#7ebd9d', 94: '#008140', 95: '#56816b',
  96: '#006834', 97: '#476856', 98: '#00ffbf', 99: '#aaffea',
  100: '#00bd8d', 101: '#7ebdad', 102: '#008160', 103: '#568176',
  104: '#00684e', 105: '#476860', 106: '#00ffff', 107: '#aaffff',
  108: '#00bdbd', 109: '#7ebdbd', 110: '#008181', 111: '#568181',
  112: '#006868', 113: '#476868', 114: '#00bfff', 115: '#aaeaff',
  116: '#008dbd', 117: '#7eadbd', 118: '#006081', 119: '#567681',
  120: '#004e68', 121: '#476068', 122: '#007fff', 123: '#aad4ff',
  124: '#005ebd', 125: '#7e9dbd', 126: '#004081', 127: '#566b81',
  128: '#003468', 129: '#475668', 130: '#003fff', 131: '#aabfff',
  132: '#002ebd', 133: '#7e8dbd', 134: '#001f81', 135: '#566081',
  136: '#001968', 137: '#474e68', 138: '#0000ff', 139: '#aaaaff',
  140: '#0000bd', 141: '#7e7ebd', 142: '#000081', 143: '#565681',
  144: '#000068', 145: '#474768', 146: '#3f00ff', 147: '#bfaaff',
  148: '#2e00bd', 149: '#8d7ebd', 150: '#1f0081', 151: '#605681',
  152: '#190068', 153: '#4e4768', 154: '#7f00ff', 155: '#d4aaff',
  156: '#5e00bd', 157: '#9d7ebd', 158: '#400081', 159: '#6b5681',
  160: '#340068', 161: '#564768', 162: '#bf00ff', 163: '#eaaaff',
  164: '#8d00bd', 165: '#ad7ebd', 166: '#600081', 167: '#765681',
  168: '#4e0068', 169: '#604768', 170: '#ff00ff', 171: '#ffaaff',
  172: '#bd00bd', 173: '#bd7ebd', 174: '#810081', 175: '#815681',
  176: '#680068', 177: '#684768', 178: '#ff00bf', 179: '#ffaaea',
  180: '#bd008d', 181: '#bd7ead', 182: '#810060', 183: '#815676',
  184: '#68004e', 185: '#684760', 186: '#ff007f', 187: '#ffaad4',
  188: '#bd005e', 189: '#bd7e9d', 190: '#810040', 191: '#81566b',
  192: '#680034', 193: '#684756', 194: '#ff003f', 195: '#ffaabf',
  196: '#bd002e', 197: '#bd7e8d', 198: '#81001f', 199: '#815660',
  200: '#680019', 201: '#68474e', 202: '#ff0000', 203: '#ffaaaa',
  204: '#bd0000', 205: '#bd7e7e', 206: '#810000', 207: '#815656',
  208: '#525252', 209: '#696969', 210: '#848484', 211: '#9e9e9e',
  212: '#b8b8b8', 213: '#d2d2d2', 214: '#ececec', 215: '#ffffff',
  216: '#000000', 217: '#1a1a1a', 218: '#333333', 219: '#4d4d4d',
  220: '#666666', 221: '#808080', 222: '#999999', 223: '#b3b3b3',
  224: '#cccccc', 225: '#e6e6e6', 226: '#ffffff', 227: '#ffffff',
  228: '#ffffff', 229: '#ffffff', 230: '#ffffff', 231: '#ffffff',
  232: '#ffffff', 233: '#ffffff', 234: '#ffffff', 235: '#ffffff',
  236: '#ffffff', 237: '#ffffff', 238: '#ffffff', 239: '#ffffff',
  240: '#ffffff', 241: '#ffffff', 242: '#ffffff', 243: '#ffffff',
  244: '#ffffff', 245: '#ffffff', 246: '#ffffff', 247: '#ffffff',
  248: '#ffffff', 249: '#ffffff', 250: '#ffffff', 251: '#ffffff',
  252: '#ffffff', 253: '#ffffff', 254: '#ffffff', 255: '#ffffff',
}

function aciToHex(aci: number): string {
  return ACI_TABLE[aci] ?? '#000000'
}

/** DXF HATCH パターン名 → 内部 HatchPattern マッピング（継承元踏襲）。 */
function mapHatchPattern(dxfName: string): HatchPattern {
  const n = dxfName.toUpperCase()
  if (n === 'ANSI31' || n === 'LINE' || n === 'DIAGONAL') return 'parallel'
  if (n === 'ANSI32' || n === 'CROSS' || n === 'NET' || n === 'DOTS') return 'cross'
  if (n.includes('GRAVEL') || n === 'ANSI36') return 'gravel'
  if (n.includes('EARTH') || n === 'ANSI37') return 'earth'
  if (n.includes('CONCRETE') || n === 'AR-CONC') return 'concrete'
  if (n.includes('ROCK') || n === 'ANSI33') return 'rock'
  if (n.includes('ASPHALT') || n === 'AR-BRSTD') return 'asphalt'
  if (n.includes('WOOD') || n === 'AR-RSHKE') return 'wood'
  if (n.includes('STEEL') || n === 'ANSI34') return 'steel'
  if (n.includes('WATER') || n === 'ANSI35') return 'water'
  return 'parallel'
}

// ---------------------------------------------------------------------------
// DXF-002: HATCH 独自抽出（dxf-parser 未対応のため）
// ---------------------------------------------------------------------------
interface RawHatch {
  layerName: string
  patternName: string
  angle: number
  scale: number
  boundaryPoints: number[]
}

function extractRawHatches(content: string): RawHatch[] {
  const groups = parseDxfGroups(content)
  const hatches: RawHatch[] = []

  let i = 0
  while (i < groups.length) {
    const g = groups[i]
    if (g === undefined) {
      i++
      continue
    }
    if (g.code === 0 && g.value === 'HATCH') {
      const hatch: RawHatch = {
        layerName: '0',
        patternName: 'ANSI31',
        angle: 0,
        scale: 1,
        boundaryPoints: [],
      }
      i++

      let numBoundaryPaths = 0
      let inBoundaryPath = false
      let currentEdgeType = 0 // 0=未設定, 1=line, 2=arc, 3=elliptic, 4=spline
      let pendingX: number | null = null

      while (i < groups.length) {
        const gg = groups[i]
        if (gg === undefined) {
          i++
          continue
        }
        if (gg.code === 0) break
        const { code, value } = gg

        if (code === 8) hatch.layerName = value
        else if (code === 2) hatch.patternName = value
        else if (code === 52) hatch.angle = parseFloat(value) || 0
        else if (code === 41) hatch.scale = parseFloat(value) || 1
        else if (code === 91) numBoundaryPaths = parseInt(value, 10) || 0
        else if (code === 92 && numBoundaryPaths > 0) {
          inBoundaryPath = true
          currentEdgeType = 0
        } else if (inBoundaryPath) {
          if (code === 72) {
            currentEdgeType = parseInt(value, 10)
            pendingX = null
          } else if (currentEdgeType === 1) {
            // ラインエッジ(type=1)のみ頂点を収集（arc/spline の 10/20 を混入させない）。
            if (code === 10) pendingX = parseFloat(value)
            else if (code === 20 && pendingX !== null) {
              hatch.boundaryPoints.push(pendingX, parseFloat(value))
              pendingX = null
            } else if (code === 11) pendingX = parseFloat(value)
            else if (code === 21 && pendingX !== null) {
              hatch.boundaryPoints.push(pendingX, parseFloat(value))
              pendingX = null
            }
          }
        }
        i++
      }

      if (hatch.boundaryPoints.length >= 4 && numBoundaryPaths > 0) {
        hatches.push(hatch)
      }
      continue
    }
    i++
  }
  return hatches
}

// ---------------------------------------------------------------------------
// DXF-004: fallback パーサ（dxf-parser が例外/null を返すケース向け）
// ---------------------------------------------------------------------------
interface FallbackEntity {
  type: string
  layer: string
  data: Map<number, number | string>
  vertices: number[]
  closed: boolean
  text: string
}

function extractEntitiesFallback(content: string): FallbackEntity[] {
  const groups = parseDxfGroups(content)
  let secStart = -1
  let secEnd = groups.length
  for (let i = 0; i < groups.length - 1; i++) {
    const g = groups[i]
    const next = groups[i + 1]
    if (g === undefined || next === undefined) continue
    if (g.code === 0 && g.value === 'SECTION' && next.code === 2 && next.value === 'ENTITIES') {
      secStart = i + 2
      break
    }
  }
  if (secStart < 0) return []
  for (let i = secStart; i < groups.length; i++) {
    const g = groups[i]
    if (g === undefined) continue
    if (g.code === 0 && g.value === 'ENDSEC') {
      secEnd = i
      break
    }
  }

  const out: FallbackEntity[] = []
  let cur: FallbackEntity | null = null
  let pendingVx: number | null = null
  const flushVertex = (x: number | null, y: number) => {
    if (x !== null && cur) cur.vertices.push(x, y)
  }

  for (let i = secStart; i < secEnd; i++) {
    const g = groups[i]
    if (g === undefined) continue
    const { code, value } = g
    if (code === 0) {
      if (cur) out.push(cur)
      cur = { type: value, layer: '0', data: new Map(), vertices: [], closed: false, text: '' }
      pendingVx = null
      continue
    }
    if (!cur) continue
    switch (code) {
      case 8:
        cur.layer = value
        break
      case 1:
        cur.text = value
        break
      case 70: {
        const f = parseInt(value, 10) || 0
        cur.data.set(70, f)
        if ((cur.type === 'LWPOLYLINE' || cur.type === 'POLYLINE') && (f & 1) !== 0) cur.closed = true
        break
      }
      case 10: {
        const v = parseFloat(value)
        if (cur.type === 'LWPOLYLINE') pendingVx = v
        else cur.data.set(10, v)
        break
      }
      case 20: {
        const v = parseFloat(value)
        if (cur.type === 'LWPOLYLINE') {
          flushVertex(pendingVx, v)
          pendingVx = null
        } else {
          cur.data.set(20, v)
        }
        break
      }
      case 11:
        cur.data.set(11, parseFloat(value))
        break
      case 21:
        cur.data.set(21, parseFloat(value))
        break
      case 40:
        cur.data.set(40, parseFloat(value))
        break
      case 41:
        cur.data.set(41, parseFloat(value))
        break
      case 50:
        cur.data.set(50, parseFloat(value))
        break
      case 51:
        cur.data.set(51, parseFloat(value))
        break
      case 62:
        cur.data.set(62, parseInt(value, 10) || 0)
        break
      default:
        break
    }
  }
  if (cur) out.push(cur)

  // レガシー POLYLINE を統合: VERTEX を直前の POLYLINE へ、SEQEND まで併合する。
  const merged: FallbackEntity[] = []
  let openPoly: FallbackEntity | null = null
  for (const e of out) {
    if (e.type === 'POLYLINE') {
      openPoly = { ...e, type: 'POLYLINE', vertices: [], closed: e.closed }
      merged.push(openPoly)
      continue
    }
    if (e.type === 'VERTEX' && openPoly) {
      const x = e.data.get(10)
      const y = e.data.get(20)
      if (typeof x === 'number' && typeof y === 'number') openPoly.vertices.push(x, y)
      continue
    }
    if (e.type === 'SEQEND') {
      openPoly = null
      continue
    }
    merged.push(e)
  }
  return merged
}

/** 生 DXF の TABLES > LAYER テーブルからレイヤー定義を抽出する（fallback 経路用）。 */
function extractLayerTable(
  content: string,
): Map<string, { name: string; color?: number; lineTypeName?: string; flags?: number }> {
  const groups = parseDxfGroups(content)
  const layers = new Map<string, { name: string; color?: number; lineTypeName?: string; flags?: number }>()
  let inLayerTable = false
  let curName: string | null = null
  let curColor: number | undefined
  let curLineType: string | undefined
  let curFlags: number | undefined
  for (let i = 0; i < groups.length - 1; i++) {
    const g = groups[i]
    const next = groups[i + 1]
    if (g === undefined || next === undefined) continue
    if (g.code === 0 && g.value === 'TABLE' && next.code === 2 && next.value === 'LAYER') {
      inLayerTable = true
      continue
    }
    if (inLayerTable && g.code === 0 && g.value === 'ENDTAB') {
      if (curName) layers.set(curName, { name: curName, color: curColor, lineTypeName: curLineType, flags: curFlags })
      inLayerTable = false
      curName = null
      curColor = undefined
      curLineType = undefined
      curFlags = undefined
      continue
    }
    if (!inLayerTable) continue
    if (g.code === 0 && g.value === 'LAYER') {
      if (curName) layers.set(curName, { name: curName, color: curColor, lineTypeName: curLineType, flags: curFlags })
      curName = null
      curColor = undefined
      curLineType = undefined
      curFlags = undefined
    } else if (g.code === 2 && curName === null) {
      curName = g.value
    } else if (g.code === 62) {
      curColor = parseInt(g.value, 10)
    } else if (g.code === 6) {
      curLineType = g.value
    } else if (g.code === 70) {
      curFlags = parseInt(g.value, 10)
    }
  }
  return layers
}

// ---------------------------------------------------------------------------
// レイヤー・図形の合成（Shape→Geometry / Layer→DrawingLayer）
// ---------------------------------------------------------------------------

/** ADR-0013 のコンテキストが発番する GeometryId を LayerId ブランドへ読み替える（実体は同一UUID）。 */
function newLayerId(ctx: GeometryCreationContext): LayerId {
  return ctx.newId() as unknown as LayerId
}

/** DXF の linetype 名を内部 lineType へ写像する（不明・未指定は continuous）。 */
function mapDxfLineTypeName(name: string | undefined): GeometryStyle['lineType'] {
  const upper = name?.trim().toUpperCase()
  switch (upper) {
    case 'CONTINUOUS':
      return 'continuous'
    case 'DASHED':
    case 'DOTTED':
      return 'dashed'
    case 'DASHDOT':
    case 'DASH_DOT':
    case 'DASHDOTX2':
      return 'dashDot'
    default:
      return 'continuous'
  }
}

/** LAYER フラグ（group 70）: bit1/2=frozen、bit4=locked。 */
function layerFlagsToVisibility(flags: number | undefined): boolean | undefined {
  if (flags === undefined) return undefined
  return (flags & 0b0011) === 0
}

/** レイヤー色(ACI)から図形/レイヤーの既定 GeometryStyle を合成する。 */
function synthesizeStyle(aci: number, lineTypeName?: string): GeometryStyle {
  return {
    strokeColor: aciToHex(aci),
    strokeWidth: 1,
    lineType: mapDxfLineTypeName(lineTypeName),
    opacity: 1,
    printable: true,
  }
}

interface DxfLayerSource {
  readonly name?: string
  readonly color?: number
  readonly lineTypeName?: string
  readonly flags?: number
  /** dxf-parser が color の符号から判定した可視性。 */
  readonly visible?: boolean
  /** dxf-parser が layer フラグ(70) から判定した凍結状態。 */
  readonly frozen?: boolean
}

interface BuiltLayers {
  layers: DrawingLayer[]
  byName: Map<string, DrawingLayer>
}

function buildLayers(
  dxfLayers: Record<string, DxfLayerSource>,
  ctx: GeometryCreationContext,
): BuiltLayers {
  const layers: DrawingLayer[] = []
  const byName = new Map<string, DrawingLayer>()
  let order = 0
  for (const name of Object.keys(dxfLayers)) {
    const src = dxfLayers[name]
    if (src === undefined) continue
    const layer: DrawingLayer = {
      id: newLayerId(ctx),
      name: src.name ?? name,
      order: order++, // DXF LAYER テーブルの出現順を order とする（DXF 側に順序フィールドが無いため）。
      // 可視性: dxf-parser の判定（color符号/凍結）→ 生テーブルのフラグ(70) → 既定 true の順で採用。
      visible: (src.frozen === true ? false : src.visible ?? true) && (layerFlagsToVisibility(src.flags) ?? true),
      locked: ((src.flags ?? 0) & 0b0100) !== 0, // フラグ(70) bit4 = ロック。
      printable: true, // DXF layer plot フラグは未解析。既定印刷可。
      defaultStyle: synthesizeStyle(src.color ?? 7, src.lineTypeName), // 色欠落時は ACI 7（白/既定）。
    }
    layers.push(layer)
    byName.set(name, layer)
  }
  if (layers.length === 0) {
    const layer: DrawingLayer = {
      id: newLayerId(ctx),
      name: '0',
      order: 0,
      visible: true,
      locked: false,
      printable: true,
      defaultStyle: synthesizeStyle(7),
    }
    layers.push(layer)
    byName.set('0', layer)
  }
  return { layers, byName }
}

/** GeometryBase の共通フィールド（type を除く）を合成する。style は所属レイヤーの defaultStyle を複製。 */
function makeBase(ctx: GeometryCreationContext, layer: DrawingLayer): Omit<GeometryBase, 'type'> {
  const timestamp = ctx.now()
  return {
    id: ctx.newId(),
    layerId: layer.id,
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

// ---------------------------------------------------------------------------
// dxf-parser が返すエンティティの最小構造（継承元同様、緩い独自型で受ける）
// ---------------------------------------------------------------------------
interface DxfEntity {
  type: string
  layer?: string
  vertices?: { x: number; y: number }[]
  startPoint?: { x: number; y: number }
  endPoint?: { x: number; y: number }
  center?: { x: number; y: number; z?: number }
  radius?: number
  startAngle?: number
  endAngle?: number
  position?: { x: number; y: number }
  text?: string
  textHeight?: number
  height?: number
  rotation?: number
  shape?: boolean
  controlPoints?: { x: number; y: number }[]
  fitPoints?: { x: number; y: number }[]
  closed?: boolean
  majorAxisEndPoint?: { x: number; y: number }
  axisRatio?: number
}

interface DxfDocument {
  entities?: DxfEntity[]
  tables?: {
    // dxf-parser は ACI を colorIndex に、解決済みRGB(24bit整数)を color に格納する。
    layer?: {
      layers?: Record<
        string,
        { name?: string; colorIndex?: number; color?: number; visible?: boolean; frozen?: boolean }
      >
    }
  }
}

/** レイヤー名を解決する。未知のレイヤー名は先頭レイヤーへフォールバックする。 */
function resolveLayer(built: BuiltLayers, name: string): DrawingLayer | null {
  return built.byName.get(name) ?? built.layers[0] ?? null
}

/** dxf-parser の解析結果からジオメトリを生成する（HATCH を除く）。 */
function buildFromParsed(
  entities: readonly DxfEntity[],
  built: BuiltLayers,
  toMm: (value: number) => number,
  ctx: GeometryCreationContext,
  geometries: Geometry[],
  issues: ValidationIssue[],
): void {
  const pt = (x: number, y: number): Point => ({ x: toMm(x), y: toMm(y) })

  for (const ent of entities) {
    const layer = resolveLayer(built, ent.layer ?? '0')
    if (layer === null) continue

    switch (ent.type) {
      case 'LINE': {
        const v = ent.vertices
        let start: Point | null = null
        let end: Point | null = null
        if (v && v.length >= 2 && v[0] !== undefined && v[1] !== undefined) {
          start = pt(v[0].x, v[0].y)
          end = pt(v[1].x, v[1].y)
        } else if (ent.startPoint && ent.endPoint) {
          start = pt(ent.startPoint.x, ent.startPoint.y)
          end = pt(ent.endPoint.x, ent.endPoint.y)
        }
        if (start && end) {
          const line: LineGeometry = { ...makeBase(ctx, layer), type: 'line', start, end }
          geometries.push(line)
        }
        break
      }
      case 'CIRCLE': {
        if (!ent.center || ent.radius == null) break
        const circle: CircleGeometry = {
          ...makeBase(ctx, layer),
          type: 'circle',
          center: pt(ent.center.x, ent.center.y),
          radius: toMm(ent.radius),
        }
        geometries.push(circle)
        break
      }
      case 'ARC': {
        if (!ent.center || ent.radius == null) break
        // dxf-parser は ARC 角度をラジアンで返すため rad→deg 変換（ArcGeometry は度数法）。
        const arc: ArcGeometry = {
          ...makeBase(ctx, layer),
          type: 'arc',
          center: pt(ent.center.x, ent.center.y),
          radius: toMm(ent.radius),
          startAngleDeg: radToDeg(ent.startAngle ?? 0),
          endAngleDeg: radToDeg(ent.endAngle ?? TWO_PI),
        }
        geometries.push(arc)
        break
      }
      case 'POLYLINE':
      case 'LWPOLYLINE': {
        const vertices = ent.vertices ?? []
        if (vertices.length < 2) break
        const points: Point[] = vertices.map((vv) => pt(vv.x, vv.y))
        const poly: PolylineGeometry = {
          ...makeBase(ctx, layer),
          type: 'polyline',
          points,
          closed: Boolean(ent.shape),
        }
        geometries.push(poly)
        break
      }
      case 'TEXT':
      case 'MTEXT': {
        // TEXT は startPoint、MTEXT は position を用いる。継承元同様どちらも受ける。
        const pos = ent.position ?? ent.startPoint
        if (!pos) break
        const textGeom: TextGeometry = {
          ...makeBase(ctx, layer),
          type: 'text',
          anchor: pt(pos.x, pos.y),
          text: ent.text ?? '',
          height: toMm(ent.textHeight ?? ent.height ?? DEFAULT_TEXT_HEIGHT),
          rotationDeg: ent.rotation ?? 0, // TEXT rotation は度数法のため無変換。
          horizontalAlign: 'left', // DXF group 72 の水平寄せは未マッピング。既定 left。
        }
        geometries.push(textGeom)
        break
      }
      case 'SPLINE': {
        // fitPoints（曲線補間点）を優先、無ければ controlPoints を用いる。
        const src = ent.fitPoints && ent.fitPoints.length >= 2 ? ent.fitPoints : ent.controlPoints
        if (!src || src.length < 2) {
          issues.push({
            code: 'dxf-spline-insufficient',
            severity: 'warning',
            message: 'SPLINE: fitPoints/controlPoints が不足しているため無視しました',
          })
          break
        }
        const points: Point[] = src.map((p) => pt(p.x, p.y))
        const spline: SplineGeometry = {
          ...makeBase(ctx, layer),
          type: 'spline',
          points,
          tension: DEFAULT_SPLINE_TENSION,
        }
        geometries.push(spline)
        break
      }
      case 'ELLIPSE': {
        if (!ent.center || !ent.majorAxisEndPoint) {
          issues.push({
            code: 'dxf-ellipse-insufficient',
            severity: 'warning',
            message: 'ELLIPSE: center/majorAxisEndPoint が不足しているため無視しました',
          })
          break
        }
        const cx = ent.center.x
        const cy = ent.center.y
        const mx = ent.majorAxisEndPoint.x
        const my = ent.majorAxisEndPoint.y
        const ratio = ent.axisRatio ?? 1
        const start = ent.startAngle ?? 0
        let end = ent.endAngle ?? TWO_PI
        if (end < start) end += TWO_PI
        const sweep = end - start
        const isFull = Math.abs(sweep - TWO_PI) < 1e-6

        if (isFull) {
          // 全楕円 → EllipseGeometry（ネイティブ表現）。rotationDeg は主軸方向（スケール不変）。
          const major = Math.hypot(mx, my)
          const ellipse: EllipseGeometry = {
            ...makeBase(ctx, layer),
            type: 'ellipse',
            center: pt(cx, cy),
            radiusX: toMm(major),
            radiusY: toMm(major * ratio),
            rotationDeg: radToDeg(Math.atan2(my, mx)),
          }
          geometries.push(ellipse)
        } else {
          // 楕円弧は EllipseGeometry（全楕円のみ）で表現不可 → 折れ線近似（継承元同様 64分割）。
          const nx = -my * ratio
          const ny = mx * ratio
          const points: Point[] = []
          for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
            const t = start + (sweep * i) / ELLIPSE_SEGMENTS
            const x = cx + Math.cos(t) * mx + Math.sin(t) * nx
            const y = cy + Math.cos(t) * my + Math.sin(t) * ny
            points.push(pt(x, y))
          }
          const poly: PolylineGeometry = {
            ...makeBase(ctx, layer),
            type: 'polyline',
            points,
            closed: false,
          }
          geometries.push(poly)
          issues.push({
            code: 'dxf-ellipse-arc-approximated',
            severity: 'info',
            message: `楕円弧を ${ELLIPSE_SEGMENTS} 分割の折れ線で近似しました（EllipseGeometry は全楕円のみ表現可能）`,
          })
        }
        break
      }
      case 'HATCH':
        // dxf-parser は HATCH 未サポート。後続の extractRawHatches() で補完するためここではスキップ。
        break
      default:
        issues.push({
          code: 'dxf-unsupported-entity',
          severity: 'warning',
          field: ent.type,
          message: `サポート外エンティティ: ${ent.type}`,
        })
    }
  }
}

/** fallback パーサの抽出結果からジオメトリを生成する（HATCH を除く）。 */
function buildFromFallback(
  content: string,
  built: BuiltLayers,
  toMm: (value: number) => number,
  ctx: GeometryCreationContext,
  geometries: Geometry[],
  issues: ValidationIssue[],
): void {
  const ents = extractEntitiesFallback(content)
  const counts: Record<string, number> = {}
  const inc = (t: string) => {
    counts[t] = (counts[t] ?? 0) + 1
  }

  for (const e of ents) {
    const layer = resolveLayer(built, e.layer)
    if (layer === null) continue

    switch (e.type) {
      case 'LINE': {
        const x1 = e.data.get(10)
        const y1 = e.data.get(20)
        const x2 = e.data.get(11)
        const y2 = e.data.get(21)
        if (
          typeof x1 === 'number' &&
          typeof y1 === 'number' &&
          typeof x2 === 'number' &&
          typeof y2 === 'number'
        ) {
          const line: LineGeometry = {
            ...makeBase(ctx, layer),
            type: 'line',
            start: { x: toMm(x1), y: toMm(y1) },
            end: { x: toMm(x2), y: toMm(y2) },
          }
          geometries.push(line)
          inc('LINE')
        }
        break
      }
      case 'CIRCLE': {
        const cx = e.data.get(10)
        const cy = e.data.get(20)
        const r = e.data.get(40)
        if (typeof cx === 'number' && typeof cy === 'number' && typeof r === 'number') {
          const circle: CircleGeometry = {
            ...makeBase(ctx, layer),
            type: 'circle',
            center: { x: toMm(cx), y: toMm(cy) },
            radius: toMm(r),
          }
          geometries.push(circle)
          inc('CIRCLE')
        }
        break
      }
      case 'ARC': {
        const cx = e.data.get(10)
        const cy = e.data.get(20)
        const r = e.data.get(40)
        const sa = e.data.get(50)
        const ea = e.data.get(51)
        if (typeof cx === 'number' && typeof cy === 'number' && typeof r === 'number') {
          // 生 DXF の group 50/51 は度数法。ArcGeometry も度数法のため無変換。
          const arc: ArcGeometry = {
            ...makeBase(ctx, layer),
            type: 'arc',
            center: { x: toMm(cx), y: toMm(cy) },
            radius: toMm(r),
            startAngleDeg: typeof sa === 'number' ? sa : 0,
            endAngleDeg: typeof ea === 'number' ? ea : 360,
          }
          geometries.push(arc)
          inc('ARC')
        }
        break
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        if (e.vertices.length >= 4) {
          const points: Point[] = []
          for (let i = 0; i < e.vertices.length - 1; i += 2) {
            const x = e.vertices[i]
            const y = e.vertices[i + 1]
            if (x === undefined || y === undefined) continue
            points.push({ x: toMm(x), y: toMm(y) })
          }
          const poly: PolylineGeometry = {
            ...makeBase(ctx, layer),
            type: 'polyline',
            points,
            closed: e.closed,
          }
          geometries.push(poly)
          inc(e.type)
        }
        break
      }
      case 'TEXT':
      case 'MTEXT': {
        const x = e.data.get(10)
        const y = e.data.get(20)
        if (typeof x === 'number' && typeof y === 'number') {
          const h = e.data.get(40)
          const rot = e.data.get(50)
          const textGeom: TextGeometry = {
            ...makeBase(ctx, layer),
            type: 'text',
            anchor: { x: toMm(x), y: toMm(y) },
            text: e.text,
            height: toMm(typeof h === 'number' ? h : DEFAULT_TEXT_HEIGHT),
            rotationDeg: typeof rot === 'number' ? rot : 0, // 生 DXF の rotation は度数法。
            horizontalAlign: 'left',
          }
          geometries.push(textGeom)
          inc(e.type)
        }
        break
      }
      default:
        break
    }
  }

  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  if (summary) {
    issues.push({ code: 'dxf-fallback-extracted', severity: 'info', message: `抽出した図形: ${summary}` })
  }
}

/** 生テキストから HATCH を抽出して HatchGeometry を追加する（dxf-parser 経路・fallback 経路の共通後処理）。 */
function appendHatches(
  content: string,
  built: BuiltLayers,
  toMm: (value: number) => number,
  ctx: GeometryCreationContext,
  geometries: Geometry[],
  issues: ValidationIssue[],
): void {
  const rawHatches = extractRawHatches(content)
  for (const rh of rawHatches) {
    const layer = resolveLayer(built, rh.layerName)
    if (layer === null) continue
    const boundaryPoints: Point[] = []
    for (let i = 0; i < rh.boundaryPoints.length - 1; i += 2) {
      const x = rh.boundaryPoints[i]
      const y = rh.boundaryPoints[i + 1]
      if (x === undefined || y === undefined) continue
      boundaryPoints.push({ x: toMm(x), y: toMm(y) })
    }
    const hatch: HatchGeometry = {
      ...makeBase(ctx, layer),
      type: 'hatch',
      boundaryPoints,
      pattern: mapHatchPattern(rh.patternName),
      angleDeg: rh.angle, // DXF group 52 は度数法。angleDeg も度数法のため無変換。
      // spacing はパターン尺度(scale)由来の描画パラメータであり DXF 座標ではないため $INSUNITS 換算しない。
      spacing: Math.max(rh.scale * 10, 5),
    }
    geometries.push(hatch)
  }
  if (rawHatches.length > 0) {
    issues.push({
      code: 'dxf-hatch-imported',
      severity: 'info',
      message: `HATCH ${rawHatches.length} 件を独自パーサで取込みました（dxf-parser 未対応のため）`,
    })
  }
}

/**
 * DXF テキストを取り込み、Geometry 群・DrawingLayer 群・ValidationIssue 群を返す。
 * 入力が空（空白のみ）の場合のみ error 側（ok:false）を返す。それ以外の想定内の失敗は issues に集約する。
 * @param content DXF テキスト
 * @param ctx ID発番・タイムスタンプのコンテキスト（ADR-0013、省略時は crypto.randomUUID ベースの既定）
 */
export function importDxf(
  content: string,
  ctx: GeometryCreationContext = defaultCreationContext,
): Result<ImportResult, ValidationIssue> {
  if (content.trim() === '') {
    return {
      ok: false,
      error: { code: 'dxf-empty', severity: 'error', message: 'DXF内容が空のため取り込めません' },
    }
  }

  const issues: ValidationIssue[] = []

  // R-002/R-004: $INSUNITS を内部基準 mm への換算係数へ解決する（domain/units 経由）。
  const { toMm, issue: unitIssue } = resolveLengthUnit(extractInsunits(content))
  if (unitIssue) issues.push(unitIssue)

  // DXF-003: XDATA を除去（dxf-parser v1.1.2 の型変換例外を回避）。
  const originalLen = content.length
  const sanitized = stripXdata(content)
  if (sanitized.length < originalLen) {
    const removed = ((1 - sanitized.length / originalLen) * 100).toFixed(1)
    issues.push({
      code: 'dxf-xdata-stripped',
      severity: 'info',
      message: `AutoCAD拡張属性(XDATA, ${removed}%)は描画対象外としてスキップしました`,
    })
  }

  const parser = new DxfParser()
  let dxf: DxfDocument | null = null
  let parserError: Error | null = null
  try {
    dxf = parser.parseSync(sanitized) as unknown as DxfDocument | null
  } catch (e) {
    parserError = e instanceof Error ? e : new Error(String(e))
  }

  const geometries: Geometry[] = []

  // DXF-004: dxf-parser が失敗 → fallback パーサで基本図形だけでも読み込む。
  if (!dxf || parserError) {
    issues.push({
      code: 'dxf-compat-mode',
      severity: 'warning',
      message:
        `非標準フォーマットを検出→互換モードで読み込みました` +
        (parserError ? `（内部詳細: ${parserError.message}）` : ''),
    })
    const rawLayers = extractLayerTable(content)
    const fallbackLayers: Record<string, { name?: string; color?: number }> = {}
    for (const [k, v] of rawLayers) fallbackLayers[k] = v
    const built = buildLayers(fallbackLayers, ctx)
    buildFromFallback(content, built, toMm, ctx, geometries, issues)
    appendHatches(content, built, toMm, ctx, geometries, issues)
    return { ok: true, value: { geometries, layers: built.layers, issues } }
  }

  // dxf-parser はレイヤーの ACI を colorIndex に、解決済みRGB整数を color に格納する。
  // 継承元は color(RGB整数)を ACI として aciToHex に渡していたため、実DXFファイルでは
  // ほぼ全レイヤーが #000000 になる潜在バグがあった（ACIテストが color にACI値を注入して隠蔽）。
  // 新実装では ACI を colorIndex から読む。生テキストfallback経路は group 62(ACI)を用いるため整合する。
  const parsedLayers = dxf.tables?.layer?.layers ?? {}
  const normalizedLayers: Record<string, DxfLayerSource> = {}
  for (const [k, v] of Object.entries(parsedLayers)) {
    normalizedLayers[k] = { name: v.name, color: v.colorIndex, visible: v.visible, frozen: v.frozen }
  }
  // dxf-parser は layer の linetype(6)・lock フラグ(70 bit4) を保持しないため、
  // 生テキストの LAYER テーブルから補完する（線種の DXF 往復を実現、Issue #40 残）。
  const rawLayerTable = extractLayerTable(content)
  for (const [k, raw] of rawLayerTable) {
    const existing = normalizedLayers[k]
    normalizedLayers[k] = {
      ...(existing ?? { name: raw.name }),
      color: existing?.color ?? raw.color,
      lineTypeName: raw.lineTypeName,
      flags: raw.flags,
    }
  }
  const built = buildLayers(normalizedLayers, ctx)
  buildFromParsed(dxf.entities ?? [], built, toMm, ctx, geometries, issues)
  appendHatches(content, built, toMm, ctx, geometries, issues)

  return { ok: true, value: { geometries, layers: built.layers, issues } }
}

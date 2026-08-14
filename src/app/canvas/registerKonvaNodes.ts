/**
 * Konva v9 + react-konva v19 の本番ビルドで、フルバンドル（`import 'konva'`）と
 * react-konva が参照する Core の間でノード登録が分離し、Line / Text 等が
 * 「Konva has no node with the type ...」になり描画されない問題への対策。
 *
 * 公式エラーメッセージの推奨どおり、使用する形状モジュールを副作用 import して
 * react-konva が参照する同じ Core インスタンスへ明示的に登録する。
 */
import 'konva/lib/Stage'
import 'konva/lib/Layer'
import 'konva/lib/Group'
import 'konva/lib/shapes/Arc'
import 'konva/lib/shapes/Arrow'
import 'konva/lib/shapes/Circle'
import 'konva/lib/shapes/Ellipse'
import 'konva/lib/shapes/Line'
import 'konva/lib/shapes/Path'
import 'konva/lib/shapes/Rect'
import 'konva/lib/shapes/Star'
import 'konva/lib/shapes/Text'
import Konva from 'konva/lib/Core'
import { Line } from 'konva/lib/shapes/Line'
import { Rect } from 'konva/lib/shapes/Rect'
import { Circle } from 'konva/lib/shapes/Circle'
import { Arc } from 'konva/lib/shapes/Arc'
import { Arrow } from 'konva/lib/shapes/Arrow'
import { Ellipse } from 'konva/lib/shapes/Ellipse'
import { Path } from 'konva/lib/shapes/Path'
import { Star } from 'konva/lib/shapes/Star'
import { Text } from 'konva/lib/shapes/Text'

// 副作用 import だけではビルド依存の登録順で失敗し得るため、
// react-konva が参照する Core のレジストリへ明示的に代入して保険をかける。
const registry = Konva as unknown as Record<string, unknown>
registry.Line = Line
registry.Rect = Rect
registry.Circle = Circle
registry.Arc = Arc
registry.Arrow = Arrow
registry.Ellipse = Ellipse
registry.Path = Path
registry.Star = Star
registry.Text = Text

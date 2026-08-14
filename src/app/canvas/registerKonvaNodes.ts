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

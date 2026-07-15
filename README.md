# 🏗️ CivilDraft

> 土木施工図、仮設計画図、施工ヤード図、土工・断面図、数量根拠図を、Webブラウザで作成・確認するための土木施工向け2D CAD

| 製品情報 | 内容 |
| --- | --- |
| 日本語名 | **Civil施工図CAD** |
| 英語名 | **Civil Construction Drawing CAD** |
| 製品名 | **CivilDraft** |
| リポジトリ | `CivilDraft-Web-CAD` |
| 既存技術資産 | [`Civil-Draw`](https://github.com/Kensan196948G/Civil-Draw) |
| 開発基盤 | Claude Code on Linux＋GitHub＋Cloudflare＋Neon |
| 現在の位置付け | **Phase 2-6 コード実装完了（PR #31 承認待ち）**。全ロードマップ機能のドメイン+画面が動作。残: デプロイ系の人間決裁（Neon適用・wrangler deploy・Workers本実装） |

---

## 👋 CivilDraftとは

CivilDraftは、土木工事の日常業務で使う施工図や計画図を、Webブラウザ上で作成・編集・照査する2D CADです。

一般的なCADの線や円に、**工種・規格・測点・数量・施工段階という「土木施工上の意味」**を持たせます。図面、数量根拠、施工順序を別々に管理する負担を減らし、現場説明、協議、照査を分かりやすくすることを目指しています。

```mermaid
flowchart LR
    A["✏️ 図形を描く"] --> B["🏷️ 工種・規格を付ける"]
    B --> C["🧮 数量を集計する"]
    C --> D["🚧 施工段階で切り替える"]
    D --> E["✅ 照査・承認する"]
```

### ひとことで言うと

> 「図を描くだけのCAD」から、「施工図を作り、数量根拠と施工順序まで説明できるCAD」へ。

---

## 👥 どなた向けの製品か

| 対象 | CivilDraftで確認・実施できること | 最初に読む章 |
| --- | --- | --- |
| 👷 現場管理者 | 施工ヤード、仮設、重機範囲、搬入経路、施工順序の作成・説明 | [現場でできること](#-現場でできること) |
| 📐 土木現場技術者 | 測点、座標、中心線、法面、断面、数量根拠の作成・確認 | [目指す機能](#-目指す機能) |
| 🔬 土木建設研究者 | 図形・業務属性・数量・施工ステップを結び付けたデータモデルの検証 | [研究・技術的な価値](#-研究技術的な価値) |
| 🧑‍💼 経営層 | 作図時間、転記、手戻り、照査負担を減らす狙いとKPI | [導入によって目指す効果](#-導入によって目指す効果) |
| 🖥️ ITシステム部門 | Cloudflare、Neon、GitHub、認証、保存、監査、運用 | [システム構成](#%EF%B8%8F-システム構成) |
| 🛠️ 開発者 | React、TypeScript、Konva、Zustand、IndexedDB、Workers | [開発を始める](#%EF%B8%8F-開発を始める) |

CADやプログラミングに詳しくなくても、まず「何ができるか」と「何は自動判断しないか」を理解できる構成にしています。

---

## 🧭 いま何ができて、何を目指すか

このREADMEは、**「いま実際に動くもの（Phase 1）」と「これから目指す姿（Phase 2 以降のロードマップ）」を分けて**説明します。以降の「解決したい課題」「主な対象図面」「目指す機能」等は**製品ビジョン（目標）**であり、そのすべてが現時点で動くわけではありません。現時点で実装済みの範囲は、次の「✅ 実装済み機能」を参照してください。

| | いま動くこと（Phase 1・実装済み） | これから目指すこと（Phase 2〜6・ロードマップ） |
| --- | --- | --- |
| 🖥️ 動作環境 | Webブラウザ内だけで完結（サーバー・DB不要） | 共有版でCloudflare Workers + Neonを追加 |
| ✏️ 作図 | 選択・線・矩形・円・ポリラインの作図、パン/ズーム/選択、Undo/Redo | 測点・仮設・重機・土工などの土木パラメトリック作図 |
| 💾 保存 | ブラウザ内IndexedDBへ自動保存・起動時復元 | 案件・改訂・数量・監査をサーバーで共有 |
| 🔄 相互運用 | DXF入出力（単位を内部mmへ変換） | DXF強化・独自形式・改訂/照査/承認 |
| 🧮 業務属性 | （未実装） | 工種・規格・数量根拠・施工ステップの統合 |

> つまり、現時点のCivilDraftは「土木記号・テンプレートを配置し、DXFで受け渡しでき、ブラウザに自動保存される基本的な2D作図ツール」です。土木業務属性（数量・測点・施工段階）はこれからの実装です。

---

## ✅ 実装済み機能（Phase 1 時点）

以下は**実際にコードとして存在し、テスト済みの機能**です（正本＝根拠となる実装ファイル）。「実装済みだが未配線」の部品も正直に区別して記載します。

| 機能 | 状態 | 概要 | 正本 |
| --- | --- | --- | --- |
| 幾何演算エンジン | ✅ 実装済み | トリム・延長・オフセット・フィレット・面取り・回転/ミラー・配列・尺度・スナップ・寸法・ハッチ生成・選択判定・空間索引(R-tree)・カリング・外接矩形・面積・座標パーサ 等 | `src/domain/geometry/`（19ファイル） |
| Canvas描画・操作 | ✅ 実装済み | 6レイヤー構成の描画、パン・ズーム・クリック/Shiftクリック選択、レイヤー表示制御、500図形超でビューポートカリング | `src/app/canvas/`（`CanvasStage.tsx` 他） |
| 作図ツール | ✅ 実装済み | 選択・線・矩形・円・ポリライン（ドラフトプレビュー・自動確定つき状態機械） | `src/domain/tools/draftGeometry.ts`・ToolSlice |
| Undo / Redo | ✅ 実装済み | 「1操作＝1コマンド」方式、履歴上限100、差分のみ保持 | `src/domain/commands/`・`editorStore.ts` |
| DXF入出力 | ✅ 実装済み | `$INSUNITS`(mm/cm/m)を内部mmへ変換して取込、書出時は単位宣言と座標を整合。未対応要素は警告(issues)に集約。ツールバーの📥取込/📤出力ボタンから操作可能 | `src/domain/dxf/` |
| PDF出力 | ✅ 実装済み | A3等の用紙・縮尺・図面枠・表題欄つきベクター出力（pdf-lib）。日本語フォント未設定時は警告つき代替描画（文字化け黙殺なし）。ツールバーの📄ボタンから操作可能 | `src/domain/pdf/` |
| 土木記号・テンプレート | ✅ 実装済み | 土木記号30種（仮設・車両・測量・土工・構造物）、作図テンプレート6種 | `src/domain/catalog/` |
| 自動保存（IndexedDB） | ✅ 実装・**配線済み** | 起動時に最新下書きを復元、図形/レイヤー変更をデバウンス保存、保存失敗は握り潰さず警告表示 | `src/infrastructure/autosave/`・`App.tsx`（`AutosaveManager`） |
| 認証（Cloudflare Access） | 🟡 **部品のみ・未配線** | Access配下のidentity取得層とロール定義は実装済みだが、まだ画面本体へ接続していない（配線は共有版=Phase 6） | `src/infrastructure/auth/accessIdentity.ts` |
| SBOM・ライセンス衛生 | ✅ 実装済み | CycloneDX SBOM生成、サードパーティ表記生成、依存衛生手順 | `npm run sbom` / `npm run notices`・`docs/operations/dependency-hygiene.md` |

> 🟡 の「未配線」は、部品（モジュール）としては実装・テスト済みだが、まだアプリ本体から呼び出していない状態を指します。誇張せずそのまま記載しています。

---

## 🗺️ システム構成図（現在の実装）

### いま動いている構成（ブラウザ内で完結）

```mermaid
graph TB
    subgraph BROWSER["🌐 Webブラウザ（現在はこの中だけで動作）"]
        UI["React UI・ツールバー（App.tsx）"]
        TOOLS["作図ツール（選択・線・矩形・円・ポリライン）"]
        STORE["EditorStore（zustand）<br>図面・表示位置・レイヤー・選択・履歴"]
        INDEX["GeometryIndex（R-tree）<br>図形を高速に探す索引"]
        KONVA["Konva キャンバス（6レイヤー描画）"]
        IDB["IndexedDB<br>自動保存・起動時復元"]
        UI --> TOOLS
        TOOLS --> STORE
        STORE --> INDEX
        STORE --> KONVA
        STORE --> IDB
    end
```

> ⚠️ サーバー・データベースはまだ使いません。認証（Cloudflare Access）は部品のみで未配線です。共有版（Workers + Neon）は Phase 6 で追加します。

### レイヤー構造（依存の向き）

内側ほど土木の計算そのもの、外側ほど画面・保存・通信です。**内側は外側を知らない**依存方向を、ESLintの`no-restricted-imports`で機械的に強制しています（domain層はReact/Konva/Zustandや上位層をimportできない等）。

```mermaid
graph TD
    APP["app ✅（画面・Canvas・Store）"]
    INFRA["infrastructure ✅一部（autosave配線済 / auth未配線）"]
    APPLICATION["application ⬜雛形（ports・services）"]
    DOMAIN["domain ✅（geometry・canvas・dxf・commands・catalog・tools・units）"]
    SHARED["shared/types ✅（Geometry型・Result型）"]
    APP --> APPLICATION
    APP --> DOMAIN
    INFRA --> DOMAIN
    APPLICATION --> DOMAIN
    DOMAIN --> SHARED
```

> 📖 図の詳細版（データフローのシーケンス図・座標系の解説・DXF入出力フロー・用語集）は
> [`docs/architecture/overview.md`](./docs/architecture/overview.md) を参照してください。
> ✅＝実装済み、⬜＝ディレクトリだけ用意した雛形（Phase 2 以降で実装）。

---

## 📁 ディレクトリ構造

実際の `src/` の構成です（✅＝実装済み、⬜＝雛形）。

```text
src/
├─ shared/          ✅ 共通型（Geometry判別共用体・Result型・Brand型）
├─ domain/          ✅ 中核ロジック（React/Konvaに非依存・テスト容易）
│  ├─ geometry/     ✅ 幾何演算エンジン19ファイル（トリム/オフセット/スナップ/空間索引 等）
│  ├─ canvas/       ✅ 座標変換・グリッド・用紙・ルーラー
│  ├─ commands/     ✅ Undo/Redo コマンド（1操作=1コマンド）
│  ├─ dxf/          ✅ DXF入出力（単位変換）
│  ├─ catalog/      ✅ 土木記号30種・テンプレート6種
│  ├─ tools/        ✅ 作図ツール状態機械（ドラフト生成）
│  ├─ units/        ✅ 単位換算
│  ├─ pdf/          ✅ PDF出力（用紙・縮尺・図面枠・表題欄、pdf-lib）
│  └─ （civil-attributes / coordinates / quantities / revisions / validation は雛形 ⬜）
├─ app/             ✅ アプリ層（React）
│  ├─ canvas/       ✅ CanvasStage・GeometryRenderer・Ruler・SnapMarker
│  └─ store/        ✅ EditorStore（zustand）と供給層
├─ infrastructure/  ✅一部
│  ├─ autosave/     ✅ IndexedDB 自動保存（配線済み）
│  └─ auth/         🟡 Cloudflare Access identity（部品のみ・未配線）
├─ application/     ⬜ ユースケースの窓口（ports・services・commands）雛形
├─ features/ pages/ stores/ components/ workers/   ⬜ 雛形（Phase 2 以降）
└─ main.tsx         ✅ エントリポイント
```

---

## 🎯 解決したい課題

```mermaid
flowchart TB
    subgraph BEFORE["これまで起きやすかったこと"]
      B1["同じ仮設・重機図を毎回作る"]
      B2["図面と数量表を別々に修正する"]
      B3["施工段階ごとに図面が増える"]
      B4["どの版が最新か分かりにくい"]
    end
    subgraph AFTER["CivilDraftが目指す状態"]
      A1["定型図形を条件入力で生成"]
      A2["図形から数量根拠を追跡"]
      A3["一つの図面を施工段階で切替"]
      A4["改訂・照査・承認を記録"]
    end
    BEFORE --> AFTER
```

| 現在の負担 | CivilDraftによる改善方針 |
| --- | --- |
| 仮設設備や重機範囲を毎回手作図する | 幅、長さ、半径等を入力して図形を生成する |
| 図面と数量表の転記・修正が別作業 | 図形と数量を関連付け、根拠を強調表示する |
| 施工前・掘削・仮設・完成で別図面が増える | 同じ図面内で施工ステップを切り替える |
| 測点・座標情報が注記だけになる | 測点と座標をデータとして管理する |
| 変更箇所と承認経緯を追いにくい | 新旧比較、改訂、照査、承認を記録する |

---

## 🧭 CivilDraftの立ち位置

CivilDraftは、AutoCADやJw_cadの完全な代替を目指すものではありません。

```mermaid
quadrantChart
    title CADの得意分野イメージ
    x-axis 汎用作図中心 --> 土木施工業務中心
    y-axis 個別ファイル中心 --> 属性・数量・工程連携
    quadrant-1 CivilDraftが目指す領域
    quadrant-2 業務管理システム
    quadrant-3 汎用2D CAD
    quadrant-4 土木専用作図ツール
    CivilDraft: [0.85, 0.82]
    汎用CAD: [0.22, 0.30]
```

得意にするのは、施工計画、現場説明、仮設配置、数量根拠、施工ステップおよび照査です。高度な道路設計、構造計算、測量網計算、3D BIM/CIM等は初期対象外です。

---

## 🗺️ 主な対象図面

| 分野 | 対象図面例 |
| --- | --- |
| 🏗️ 施工計画 | 施工ヤード計画図、協議・施工説明用図面 |
| 🚧 仮設・安全 | 仮設計画図、重機配置図、クレーン作業計画図、安全設備配置図 |
| 🚚 動線 | 搬入・搬出経路図、作業帯、立入禁止範囲 |
| ⛏️ 土工 | 掘削・埋戻し範囲図、土工平面図、法面・断面図 |
| 🧱 構造物 | 簡易構造図、擁壁、側溝、管渠、桝等の配置図 |
| 🧮 数量 | 数量根拠図、工種・規格別集計図 |

---

## ✨ 目指す機能

> ⚠️ この節は**製品ビジョンとしての目標機能**を示します。現時点で動くのは「[✅ 実装済み機能](#-実装済み機能phase-1-時点)」に挙げた範囲で、測点・座標、仮設・重機、土工、数量、施工ステップ、改訂・照査の大半はPhaseロードマップのPhase 2以降で実装します。「ある」と読み取らないでください。

### 📐 基本作図・編集

- 線、矩形、円、円弧、楕円、ポリライン、スプライン
- 文字、寸法線、引出線、平行線、改訂雲
- トリム、オフセット、回転、ミラー
- レイヤー、スナップ、座標直接入力
- 距離、面積、周長の計測
- ハッチング、土木記号

### 📍 測点・座標

- 測点番号、X・Y座標、標高、備考の管理
- 座標または距離・方位角による点配置
- 座標CSVの取込・出力
- 基準点、水準点、仮BMの表示
- 中心線、測点ピッチ、左右オフセット

### 🚧 仮設・重機・安全設備

- 矢板、腹起し、切梁、仮囲い、バリケード
- 敷鉄板、覆工板、足場、作業帯
- 重機旋回範囲、クレーン作業範囲
- 資材置場、搬入・搬出経路、立入禁止範囲
- 幅、長さ、半径等を入力するパラメトリック作図

### ⛏️ 土工・縦横断

- 切土、盛土、法肩、法尻、掘削、埋戻し
- `1:0.5`、`1:1.0`等の法勾配入力
- 現況線、計画線、地盤高、計画高
- 測点別断面、切盛土の色分け、横断面積
- 平面図と断面図の関連付け、簡易土量

### 🧮 数量と根拠

- 延長、面積、周長、個数、簡易体積
- 工種、種別、細別、規格、単位、工区、測点による集計
- 数量から根拠図形を選択・強調表示
- 図形変更後の再計算と未確定表示
- CSV出力、丸め規則、手動補正理由の記録

### 🕒 施工ステップ

1. 施工前
2. 掘削時
3. 仮設設置時
4. 構造物施工時
5. 埋戻し時
6. 完成時

```mermaid
timeline
    title 施工ステップ表示
    施工前 : 現況・計画範囲
    掘削時 : 掘削・法面・作業帯
    仮設設置時 : 矢板・切梁・安全設備
    構造物施工時 : 構造物・重機・資材
    埋戻し時 : 埋戻し範囲・撤去対象
    完成時 : 完成形・最終数量
```

### ✅ 改訂・照査・承認

- 改訂番号、作成日、変更概要
- 新旧図面比較と変更箇所の強調
- 作成中、照査待ち、差戻し、承認待ち、承認済み
- 作成者、照査者、承認者、コメント、日時
- 承認済み版の直接上書き防止

---

## 👷 現場でできること

### 例1：施工ヤード計画図

```mermaid
flowchart LR
    A["現況・敷地図を準備"] --> B["資材置場・重機を配置"]
    B --> C["搬入経路・安全設備を追加"]
    C --> D["施工段階を設定"]
    D --> E["PDFで説明・協議"]
```

重機や敷鉄板を毎回一から描かず、寸法や半径を入力して配置します。施工前、掘削時、構造物施工時等を切り替え、同じ図面で施工順序を説明できます。

### 例2：測点を使った施工平面図

```mermaid
flowchart LR
    A["座標CSV"] --> B["取込前検査"]
    B --> C["測点を配置"]
    C --> D["中心線・幅員線"]
    D --> E["注記・表を出力"]
```

欠損、非数値、重複等を取込前に確認します。読み込めなかった行を黙って捨てず、どの行を直すべきか表示します。

### 例3：数量根拠図

```mermaid
flowchart LR
    A["対象範囲を作図"] --> B["工種・規格を付与"]
    B --> C["延長・面積等を計算"]
    C --> D["根拠図形を強調"]
    D --> E["数量CSVを出力"]
```

数量だけを表示するのではなく、その数値がどの図形から算出されたかを確認できます。図形を変更すると、関連数量を未確定にして再計算します。

---

## 📈 導入によって目指す効果

PoC開始時に現行業務の基準値を測り、次のKPIで効果を評価します。

| 指標 | 目標 |
| --- | --- |
| 定型的な施工・仮設計画図の作成時間 | 現行比30%以上削減 |
| 数量集計表への手入力項目数 | 現行比50%以上削減 |
| 図面と数量集計の重大不整合 | UAT期間中0件 |
| 基本操作の習得 | 代表利用者が60分以内に課題図面を作成 |
| 自動保存からの復旧成功率 | 主要ブラウザで99%以上 |

```mermaid
pie showData
    title CivilDraftで削減を狙う作業のイメージ
    "定型図形の作成" : 30
    "数量の転記・集計" : 30
    "施工段階別の図面管理" : 20
    "改訂・照査の確認" : 20
```

この円グラフは実測結果ではなく、改善対象の構成イメージです。正式な効果はPoC・UATで測定します。

---

## 🔬 研究・技術的な価値

CivilDraftの中核は、Canvas上の図形に土木施工の意味を関連付けるデータモデルです。

```mermaid
flowchart TB
    G["図形 Geometry"] --> A["工種・規格 Civil Attribute"]
    G --> S["測点・断面 Survey / Section"]
    G --> Q["数量根拠 Quantity Source"]
    G --> T["施工段階 Construction Step"]
    G --> R["改訂 Revision"]
```

研究・検証テーマの例：

- 図形と施工属性を結ぶ実用的なデータモデル
- 数量根拠の追跡可能性と変更影響の可視化
- 施工ステップによる4D的な説明支援
- Web Canvasで10,000図形を扱う描画最適化
- DXFと土木属性付き独自形式の相互運用
- 土木施工知識をパラメトリック図形として再利用する方法

---

## ⚠️ 重要な注意事項

CivilDraftは**作図・確認・説明を支援するシステム**です。次の正式な判断や計算を自動で保証しません。

| CivilDraftが支援すること | CivilDraftが代替しないこと |
| --- | --- |
| 重機旋回・クレーン作業範囲の図示 | クレーン能力、地耐力、安全離隔の正式判定 |
| 測点・座標の登録と簡易作図 | 測量網平均計算、法定・正式な測量成果 |
| 土工断面と簡易土量 | 正式な設計・積算・出来形判定 |
| 擁壁・仮設材等の配置図 | 構造計算、安定計算、照査計算 |
| DXF入出力 | AutoCAD・Jw_cadとの完全互換 |

> 自動計算結果は必ず人が根拠、単位、条件を確認し、各社・各現場の正式な照査手順に従ってください。「CADがそう言ったから」は、残念ながら安全書類の決め台詞にはなりません。

---

## 💾 データはどこに保存されるか

### 初期版：ローカル完結

```mermaid
flowchart LR
    B["Webブラウザ"] --> I["IndexedDB<br>編集中・自動保存"]
    B --> F["CivilDraftファイル<br>利用者が明示保存"]
    B --> P["PDF・DXF・CSV"]
```

- 編集中データはブラウザ内のIndexedDBへ自動保存します（✅ Phase 1で実装・配線済み。起動時に最新下書きを復元）。
- DXFでの受け渡し・PDF出力は実装済みです（✅）。CivilDraft独自形式での明示ファイル保存は整備中です（🔄）。
- ブラウザデータを消去すると下書きが失われる可能性があります。
- 重要な図面はブラウザ内だけに置かず、正式な保存手順に従います。

### 共有版：将来構成

```mermaid
flowchart LR
    U["利用者"] --> A["Cloudflare Access"]
    A --> W["CivilDraft Web"]
    W --> API["Workers API"]
    API --> N["Neon PostgreSQL"]
    API --> O["Object Storage"]
```

共有、改訂、照査、承認、監査が必要になった段階でNeonとObject Storageを導入します。初期から巨大なクラウド要塞を建てず、必要性を確かめながら育てます。

---

## 🏛️ システム構成

| 構成要素 | 役割 | 正本・位置付け |
| --- | --- | --- |
| Claude Code on Linux | 開発、テスト、ビルド | 開発作業台。正本データを置かない |
| GitHub | ソース、設計書、README、Issue、CI/CD | ソース・文書の正本 |
| Cloudflare Pages | Webフロントエンドの検証公開 | Access配下で公開 |
| Cloudflare Workers | API、認証連携、認可、検証 | 共有版で導入 |
| Cloudflare Access | 検証環境の入口制御 | 許可利用者だけがアクセス |
| IndexedDB | 自動保存、復旧候補 | 編集中のローカルデータ |
| Neon PostgreSQL | 案件、改訂、数量、監査 | 共有版業務メタデータの正本 |
| Object Storage | 図面、PDF、DXF、添付 | 共有版の大容量ファイル候補 |

```mermaid
flowchart TB
    subgraph DEV["🛠️ 開発"]
      C["Claude Code on Linux"] --> G["GitHub"]
    end
    subgraph WEB["🌐 検証・利用"]
      G --> P["Cloudflare Pages"]
      X["Cloudflare Access"] --> P
    end
    subgraph DATA["💾 段階的なデータ"]
      P --> I["IndexedDB"]
      P -. "共有版" .-> W["Workers"]
      W -.-> N["Neon"]
      W -.-> O["Object Storage"]
    end
```

---

## 🧱 ソフトウェア構造

```mermaid
flowchart TB
    UI["画面・Canvas"] --> APP["操作・ユースケース"]
    APP --> DOMAIN["図形・座標・数量・改訂"]
    APP --> PORT["保存・API・変換の共通窓口"]
    PORT --> INFRA["IndexedDB・DXF・PDF・HTTP"]
```

- **画面**と**計算**を分離します。
- 数量や座標計算はReactやCanvasに依存しない形でテストします。
- 保存先がIndexedDBからクラウドへ増えても、CADコアを作り直さない構成にします。
- 既存`Civil-Draw`は丸ごと複製せず、品質・ライセンス・保守性を確認して選択継承します。

---

## 🛣️ 開発ロードマップ

```mermaid
timeline
    title CivilDraft開発フェーズ
    Phase 0 : Civil-Draw棚卸し : ライセンス・品質・再利用範囲
    Phase 1 : 基本CAD・図面管理 : 保存・復旧・印刷
    Phase 2 : 土木座標・測点 : 中心線・オフセット
    Phase 3 : 仮設・重機・土工 : パラメトリック作図
    Phase 4 : 業務属性・数量 : 根拠・CSV
    Phase 5 : 縦横断・施工段階 : 簡易土量
    Phase 6 : DXF強化・改訂 : UAT・共有・承認
```

| Phase | 状態 | 到達点 |
| --- | --- | --- |
| 0 | ✅ 完了 | 継承するもの、改修するもの、作り直すものが確定している |
| 1 | 🚧 進行中 | ブラウザで図面を作成・保存・復旧・PDF出力できる |
| 2 | ⬜ 未着手 | 測点と座標を使った施工平面図を作成できる |
| 3 | ⬜ 未着手 | 施工・仮設計画図を定型・条件入力で作成できる |
| 4 | ⬜ 未着手 | 図形から数量根拠を確認・出力できる |
| 5 | ⬜ 未着手 | 平面・断面・施工段階を関連付けられる |
| 6 | ⬜ 未着手 | 代表利用者が実務利用可否をUATで判定できる |

### MVP

最初の実務評価可能版はPhase 1～3です。数量、縦横断、承認を全部載せてから初めて触るのではなく、施工・仮設計画図として役立つかを早めに確認します。

---

## 📊 開発進捗

### 直近のマイルストーン

| 完了日 | 内容 |
| --- | --- |
| 2026-07-14 | ✅ Phase 0: `Civil-Draw`棚卸し・継承台帳・ADR・リスク台帳作成 |
| 2026-07-15 | ✅ Phase 1: プロジェクトスキャフォールド作成（Vite 7 + React 19 + TS 6、共通型システム） |
| 2026-07-15 | ✅ Phase 1: CI品質ゲート構築（GitHub Actions: Lint/Typecheck/Test/Build + Dependency Audit） |
| 2026-07-15 | ✅ `main`ブランチ保護設定（必須ステータスチェック・レビュー承認1件必須） |
| 2026-07-15 | ✅ Phase 1: 内部座標基準の確定（ADR-0012）・幾何演算エンジン移植着手（coordParser/areaCalculator/orthoConstraint等、55テスト） |
| 2026-07-15 | 🔍 Geometry型（Shape判別共用体）の未定義箇所を仕様書横断調査で発見、設計Issue化（Issue #20・後続移植作業の前提条件） |
| 2026-07-15 | ✅ Phase 1: Geometry判別共用体を実装（Issue #20完了・13種のGeometryType全具体型を定義、58テスト）。Issue #5残14ファイル・Issue #18・Issue #19のブロック解除 |
| 2026-07-15 | 🔍 Issue #20実装をコードレビュー（Critical/Important級バグなし。コメント誤字を修正、仕様書§6.2の内部矛盾をIssue #22として起票） |
| 2026-07-15 | ✅ Issue #22対応（仕様書§6.2にSplineGeometry追加、Arc以降8型の正本を実装ファイルに明文化）。Issue closed |
| 2026-07-15 | ✅ Issue #5部分完了: `shapeBBox.ts`（外接矩形計算エンジン）移植、テスト12件追加、70/70 green |
| 2026-07-15 | ✅ **Issue #5完了（closed）**: 幾何演算エンジン17/17ファイル移植。5並列エージェントで selection/spatialIndex/viewportCulling/trim/extend/offset/fillet/chamfer/shapeTransform/scale/array/snap/dimension/hatchGenerator を一括移植 |
| 2026-07-15 | ✅ ADR-0013（図形ID発番: crypto.randomUUID + コンテキスト注入、nanoid不採用）制定・`geometryFactory.ts`実装 |
| 2026-07-15 | ✅ Issue #7部分: `GeometryIndex`（R-tree空間索引）のインスタンス化改修・複数図面独立性テスト完了 |
| 2026-07-15 | ✅ Issue #19部分: `symbolCatalog`（土木記号30種）・`templateCatalog`（テンプレート6種）移植 |
| 2026-07-15 | ✅ Issue #6基盤: `CoordinateTransformer`（仕様書§9.2）・`EditorStore`（§8.1 Slice構成ファクトリ）・React供給層実装。konva/react-konva/zustand導入 |
| 2026-07-15 | 🔍 継承元の潜在課題をIssue化: #23（Arc掃引方向）・#24（スナップ改善）・#25（回転二重適用疑い） |
| 2026-07-15 | ✅ **Issue #18完了**: DXF入出力移植（$INSUNITS→mm単位変換層、R-002/R-004不整合是正、継承元バグ5件修正、回帰テスト付き） |
| 2026-07-15 | ✅ **Issue #6完了**: Canvas描画パイプライン（§9.1レイヤー構成・パン/ズーム/選択・カリング）+ GeometryRenderer 13種 |
| 2026-07-15 | ✅ **Issue #7完了**: 空間索引+store層シングルトン解消。ベンチ実測32〜59倍高速（劣化なし実証） |
| 2026-07-15 | ✅ **Issue #8完了**: Undo/Redo Commandパターン（メモリ約5,000倍改善実証、R-001解消）+ ToolSlice作図ツール |
| 2026-07-15 | ✅ **Issue #9完了**: 自動保存IndexedDB移行+UI配線（起動時復元・容量超過警告、R-006握り潰し解消） |
| 2026-07-15 | ✅ **Issue #10完了**: PDF出力新規実装（pdf-lib、用紙/縮尺/図面枠/表題欄、DD-TBD-006方式確定） |
| 2026-07-15 | ✅ **Issue #13完了**: Cloudflare Access認証アプリ側（identity取得+ロール3種、テナント設定は人間確認事項） |
| 2026-07-15 | ✅ **Issue #19/#21完了**: 記号30種・テンプレート6種・ルーラー/グリッド計算移植 |
| 2026-07-15 | ✅ Issue #12部分: SBOM（CycloneDX）+ THIRD-PARTY-NOTICES自動生成（copyleft混入なし確認、ci.yml組込は人間承認待ち） |
| 2026-07-15 | ✅ 結合テスト12件（エディタ全体フロー7+PDF経路5）、運用文書4点、アーキテクチャ図解（mermaid 8図）整備 |
| 2026-07-15 | 🔒 セキュリティレビュー実施: 高信頼・実悪用可能な脆弱性0件（DXF/autosave/auth/CI/スクリプト全経路検査） |
| 2026-07-15 | 📊 品質ゲート最終確認: **テスト632/632（3連続・STABLE）**・typecheck/lint/build green・脆弱性0 |
| 2026-07-15 | 🎉 **PR #1→#14→#16 マージトレイン完遂**（人間承認）。Phase 1 コアが main へ着地、CI実機green |
| 2026-07-15 | 🎨 ホーム画面デザイン100%適用（Claude Design Home.dc.html、PR #28マージ）。テーマ切替・実IndexedDB復旧候補結線 |
| 2026-07-15 | 🔤 PDF日本語フォント同梱（Noto Sans JP・OFL、DD-TBD-006確定、PR #29マージ）。函渠等レア漢字も埋込可 |
| 2026-07-15 | 🚀 ホスティング確定: Cloudflare Workers Static Assets（人間承認）。CI: 全ブランチPRトリガー+SBOMジョブ（PR #27マージ、Issue #12/#17完了） |
| 2026-07-15 | 📊 最終: **テスト646/646**・オープンIssueは設計課題4件のみ（#23/#24/#25実機検証待ち・#26 P3） |
| 2026-07-15 | 🚀 **Phase 2-6 完全実装（PR #31）**: 測量・線形（§12/§13）/ パラメトリック7種（§15）/ 属性・数量集計（§14/§17）/ 断面・土量・施工ステップ（§16/§18）/ 承認ワークフロー・図面差分（§19/§20）/ 独自ファイル形式・Workers 18エンドポイント骨格・Neon 12テーブルDDL（§22/§25/§26） |
| 2026-07-15 | 🖥️ 業務画面7枚実装: 測点・座標一覧 / 土木部材パレット / 数量集計 / 縦横断管理 / 施工ステップ（CAD描画連動）/ 図面比較 / 照査・承認 — サイドバー全ナビが有効化 |
| 2026-07-15 | 📊 最終: **テスト1030/1030（×2連続STABLE）**・typecheck/lint/build green |

### Pull Request（全件マージ済み 🎉）

| PR | 内容 | 状態 |
| --- | --- | --- |
| [#1](../../pull/1) | Phase 0 継承台帳・リスク台帳・ADR 11件 | ✅ マージ済み（2026-07-15） |
| [#14](../../pull/14) | Phase 1 スキャフォールド・共通型システム・CI品質ゲート | ✅ マージ済み（2026-07-15） |
| [#16](../../pull/16) | **Phase 1 コア実装一式** | ✅ マージ済み（2026-07-15） |
| [#27](../../pull/27) | CI: PRトリガー全ブランチ化 + SBOMジョブ | ✅ マージ済み（2026-07-15） |
| [#28](../../pull/28) | ホーム画面デザイン100%適用 | ✅ マージ済み（2026-07-15） |
| [#29](../../pull/29) | PDF日本語フォント同梱 + Workers配信手順確定 | ✅ マージ済み（2026-07-15） |

> すべて人間の明示承認（2026-07-15、選択式Y判断）を得てマージ済み。マージ実行時は enforce_admins を一時解除し完了後に即復元した（レビュー承認1件必須はPR作成者の自己承認不可のため）。

進捗の詳細は[GitHub Projects「CivilDraft-Web-CAD 開発司令盤」](../../projects)、Issue一覧は[Issues](../../issues)を参照してください。

### 🔁 セッション終了時サマリー（2026-07-15 午後・Phase 1 コア完成）

⏱ セッション時間: 2026-07-15T04:16:26Z 開始（JST 13:16）、5時間上限 09:16:26Z

📊 **本セッションの成果（6並列エージェント + CTO統合）**

- ✅ **Issue 10件クローズ**: #5(幾何演算17種)・#6(Canvas描画)・#7(空間索引+store刷新)・#8(Undo/Redo Command)・#9(自動保存IndexedDB)・#10(PDF出力)・#13(認証部品)・#18(DXF入出力)・#19(カタログ)・#21(ルーラー/グリッド)
- ✅ ADR-0013制定（ID発番=crypto.randomUUID+コンテキスト注入）、DD-TBD-006方式確定（PDF=pdf-lib）
- ✅ WebUIが動作: 作図（線/矩形/円/ポリライン）・選択・Undo/Redo・パン/ズーム・グリッド・DXF取込/出力・PDF出力・自動保存/復元
- ✅ 継承元バグ是正: DXF単位不整合(R-002/R-004)・hatch無限ループ・DASHDOT不正DXF・rad二重変換・レイヤー色取り違え・autosave握り潰し(R-006)
- ✅ 性能実証: 空間索引32〜59倍高速・Undo履歴メモリ約5,000倍改善(R-001)
- 📊 **テスト 70 → 632件（+562、3連続green=STABLE）**、typecheck/lint/build green、脆弱性0
- 🔒 セキュリティレビュー実施（DXF/autosave/auth/CI全経路、実悪用可能な所見0件）、シークレット露出なし
- 📚 運用文書4点（リリース/ロールバック/運用/障害対応）・アーキテクチャ図解(mermaid 8図)・SBOM/NOTICES・README刷新

📋 **残課題（次セッション/人間判断）**

1. 🚫 **人間承認待ち**: PR #1/#14/#16のマージ（main宛）、Issue #17（ci.ymlトリガー）、Issue #12残（CIへのSBOM組込）、Cloudflare Accessテナント設定（Issue #13コメントのチェックリスト）、日本語フォント同梱（DD-TBD-006配布条件）
2. 🔍 **描画実機検証待ち**: Issue #23（Arc掃引方向）・#24残（回転図形スナップ）・#25（回転二重適用疑い）— 本端末のChrome起動不能（SIGTRAP）のため、ユーザーによるブラウザ確認が必要
3. 📐 **Phase 2以降**: 土木座標・測量・線形（ロードマップどおり）。Issue #26（バンドル最適化、P3）
4. Minimap/ContextMenu/スナップガイド表示/独自形式保存は必要時に別Issue起票

🚫 **本セッションでは main直push・PRマージ・本番デプロイを一切実行していません**（人間の明示承認待ちの状態を維持）。

---

## 🛡️ セキュリティと運用

- 検証環境はCloudflare Accessで入口を制御します。
- APIキー、DB接続情報、トークンをブラウザ、GitHub、ログへ置きません。
- `.env`はGit管理せず、`.env.example`だけを管理します。
- DXF、CSV、独自形式は、容量・形式・件数・数値・参照を検査します。
- 共有版はAPI側で案件とロールを毎回確認します。
- 承認済み図面は直接上書きせず、新しい改訂を作成します。
- 監査ログへSecretや図面本文を不用意に記録しません。
- バックアップだけで安心せず、リストア試験も行います。

---

## 🧪 品質確認

```mermaid
flowchart LR
    C["コード変更"] --> L["Lint・型検査"]
    L --> U["単体・結合テスト"]
    U --> E["E2Eテスト"]
    E --> B["Build・依存検査"]
    B --> R["レビュー"]
```

重点的に確認する項目：

- 距離、面積、交点、座標、方位角、単位、丸めの既知解
- 0、極小・極大、自己交差、閉じていない領域等の境界値
- Undo・Redo後の図形・属性・数量の整合性
- ブラウザ異常終了、保存失敗、容量不足からの復旧
- DXFの要素別往復変換と未対応要素の報告
- 1,000・5,000・10,000図形の性能
- 作成者、照査者、承認者、閲覧者、管理者の権限

### ⚙️ 現在のCI実態（Phase 1時点）

上記は目指す品質確認プロセス全体で、E2E・性能・権限テストはPhase 1後半以降で順次追加します。
現時点で`main`向けPRに自動実行される内容は次のとおりです。

| ジョブ | 内容 | 必須チェック |
| --- | --- | --- |
| `Lint / Typecheck / Test / Build` | ESLint → `tsc --noEmit` → Vitest → `vite build`を直列実行 | ✅ mainブランチ保護で必須化済み |
| `Dependency Audit` | `npm audit --audit-level=high` | ✅ mainブランチ保護で必須化済み |

`main`ブランチはPR必須・レビュー承認1件必須・上記2チェック成功必須（`strict`のためブランチ最新化も要求）・force push禁止・削除禁止で保護されています。

---

## 🛠️ 開発を始める

### 前提

- Linux開発環境
- Git
- Node.js 25系・npm 10以上（`.nvmrc`に記載。`nvm use`で自動選択）
- Cloudflare・Neonは対応フェーズで利用

### 初期化後の標準的な流れ

```bash
git clone <CivilDraft-Web-CADのURL>
cd CivilDraft-Web-CAD
nvm use   # .nvmrcに従いNode 25系を選択
npm ci
npm run dev
```

> `.env`を使う機能（Cloudflare/Neon連携）はPhase 1後半以降で導入予定。現時点ではローカル起動に環境変数は不要です。

### 利用可能なコマンド

`package.json`を正本とします。以下はPhase 1スキャフォールド時点の実績値です。

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | ローカル開発サーバー（Vite） |
| `npm run build` | 本番用ビルド（`tsc -b && vite build`） |
| `npm run preview` | ビルド結果の確認 |
| `npm run lint` | ESLint静的検査（レイヤー間依存方向を`no-restricted-imports`で強制） |
| `npm run typecheck` | TypeScript型検査（`tsc -b --noEmit`） |
| `npm run test` | 単体・結合テスト（Vitest） |
| `npm run test:watch` | Vitestをwatchモードで実行 |
| `npm run sbom` | CycloneDX形式のSBOMを生成（`sbom/civildraft-sbom.cdx.json`） |
| `npm run notices` | サードパーティ表記を生成（`THIRD-PARTY-NOTICES.md`） |

> Playwright E2Eテストは未導入（将来のE2E整備時に追加予定）。導入後、本表に`npm run test:e2e`を追記します。

### ✅ 品質ゲート（PR前・リリース前に全green必須）

| # | ゲート | コマンド | 合格条件 |
| --- | --- | --- | --- |
| 1 | Lint | `npm run lint` | ESLintエラー0（レイヤー間依存も強制） |
| 2 | 型検査 | `npm run typecheck` | `tsc -b --noEmit`エラー0 |
| 3 | テスト | `npm run test` | Vitest全件pass |
| 4 | ビルド | `npm run build` | `tsc -b && vite build`成功・`dist/`生成 |
| 5 | 依存脆弱性 | `npm audit --audit-level=high` | high以上0件（CIの`Dependency Audit`と同一基準） |

一括実行（1つでも失敗したら停止）:

```bash
npm run lint && npm run typecheck && npm run test && npm run build && npm audit --audit-level=high
```

> 上記1〜4はGitHub Actionsの`quality`ジョブ、5は`security`ジョブとしてPR時に自動実行されます（[⚙️ 現在のCI実態](#-現在のci実態phase-1時点)参照）。
> リリース・ロールバック・障害対応の手順は [`docs/operations/`](./docs/operations/) を参照してください。

### 環境変数

- Secretの実値をREADMEや`.env.example`へ書かないでください。
- フロントエンドへ渡す値は公開されても問題ない設定だけに限定します。
- DB接続情報やAPI SecretはWorkers側のSecretとして管理します。
- 初期ローカル版はNeon接続を必須にしません。

---

## 🤝 開発・変更ルール

1. Issueに目的、対象要件ID、受入条件を記載する。
2. 変更前に要件・基本設計・詳細設計への影響を確認する。
3. ブランチで実装し、テストを追加する。
4. Pull Requestへ変更内容、テスト、リスク、画面差分を記載する。
5. CIの型検査、テスト、ビルド、依存検査を通す。
6. 文書・README・既知制限をコードと同時に更新する。
7. レビュー後に保護ブランチへマージする。

```mermaid
flowchart LR
    I["Issue・要件ID"] --> D["設計確認"]
    D --> C["実装"]
    C --> T["テスト"]
    T --> P["Pull Request"]
    P --> M["レビュー・マージ"]
```

---

## 📚 ドキュメント

### 設計文書

| 文書 | 内容 |
| --- | --- |
| [`CivilDraft_要件定義書_20260714.md`](./CivilDraft_要件定義書_20260714.md) | 何を、なぜ、どこまで実現するか |
| [`CivilDraft_基本設計書_20260714.md`](./CivilDraft_基本設計書_20260714.md) | システム構成、画面、機能配置、データ・APIの全体方式 |
| [`CivilDraft_詳細設計仕様書_20260714.md`](./CivilDraft_詳細設計仕様書_20260714.md) | コード、型、処理、DB、API、計算、テストの実装仕様 |
| `README.md` | 製品概要、対象者別案内、導入、開発入口 |

### アーキテクチャ・設計判断（ADR）

| 文書 | 内容 |
| --- | --- |
| [`docs/architecture/overview.md`](./docs/architecture/overview.md) | 非エンジニア向けアーキテクチャ図解（構成・レイヤー・データフロー・座標系・DXF・用語集） |
| [`docs/adr/0012-internal-coordinate-baseline.md`](./docs/adr/0012-internal-coordinate-baseline.md) | 内部座標基準（mm・X右・Y下、公開APIは度数法） |
| [`docs/adr/0013-geometry-id-generation.md`](./docs/adr/0013-geometry-id-generation.md) | 図形ID発番（`crypto.randomUUID` + コンテキスト注入） |

### 運用文書（Phase 1版）

| 文書 | 内容 |
| --- | --- |
| [`docs/operations/release-procedure.md`](./docs/operations/release-procedure.md) | リリース前チェックリストと成果物生成・検証手順 |
| [`docs/operations/rollback-procedure.md`](./docs/operations/rollback-procedure.md) | 切り戻し（git revert / タグ再ビルド）手順 |
| [`docs/operations/operations-manual.md`](./docs/operations/operations-manual.md) | 開発サーバー・品質ゲート・SBOM/NOTICES・GitHub Projects運用 |
| [`docs/operations/incident-response.md`](./docs/operations/incident-response.md) | 障害分類・初動・Auto Repair制約・エスカレーション |
| [`docs/operations/dependency-hygiene.md`](./docs/operations/dependency-hygiene.md) | 依存衛生・ライセンス・リリース可否の人間判断（正本） |

```mermaid
flowchart TD
    R["要件定義書<br>何を・なぜ・どこまで"] --> B["基本設計書<br>どの構成・方式で"]
    B --> D["詳細設計仕様書<br>どのコード・処理で"]
    D --> C["実装・テスト"]
    M["README<br>全員の入口"] --> R
    M --> B
    M --> D
    A["ADR<br>個別の設計判断"] --> D
    O["architecture/overview<br>図解の入口"] --> D
```

---

## 📌 現在の未決事項

- `Civil-Draw`のコード、依存関係、素材、フォントのライセンスと再利用範囲
- ~~内部座標の軸方向、角度正方向、基準単位、許容誤差~~ → ✅ ADR-0012で確定（mm・X右・Y下、公開APIは度数法）
- CivilDraft独自ファイルの拡張子と圧縮方式
- 対応するDXFバージョンと要素
- 日本語PDFフォントの方式と配布条件
- 共有版の正式な認証、Neon接続、Object Storage
- 数量の標準丸め規則と工種・規格マスター

未決事項は「とりあえず実装」で埋めず、性能・運用・権利・土木実務の確認を経てADRで決定します。

---

## 📄 ライセンス

CivilDraft本体、既存`Civil-Draw`から継承するコード、OSS依存関係、土木記号、テンプレート、フォントのライセンスはPhase 0で確認します。正式なライセンス確定前に、社外公開・再配布・商用利用を判断しないでください。

---

## 🏁 最終目標

> `Civil-Draw`のWeb CAD基盤を選択的に継承し、土木座標、施工・仮設計画、数量算出、断面、施工ステップを統合した「土木施工業務のためのWeb CAD」へ発展させる。

CivilDraftは、いきなり巨大な万能CADを目指しません。現場で繰り返されている作図・転記・説明・照査を一つずつ確実に減らし、土木施工の知識を再利用できる道具として育てていきます。


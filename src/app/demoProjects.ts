/**
 * MVP/Prototype 用の詳細な架空ダミーデータ（10 案件）。
 *
 * - ホーム（一覧・検索・KPI・ステータス分布）と案件詳細（図面・メンバー・
 *   アクティビティ）の両方から同じデータを参照し、UI 間の不整合を防ぐ。
 * - 人名・会社名・住所・電話・金額・案件名はすべて架空値（住所は「架空・デモ用」、
 *   電話は「00-0000-0000（デモ用）」、メールは予約ドメイン example.jp を使用）。
 * - 正常系に加え、空図面（0 件）・差戻し・照査滞留・非公開金額などの
 *   境界・代表的な異常系も確認できる構成。
 */

export type DemoProjectStatus = '進行中' | '照査待ち' | '承認待ち' | '承認済み' | '差戻し'
export type DemoDrawingType = '施工ヤード図' | '仮設計画図' | '土工・断面図' | '数量根拠図'
export type DemoDrawingStatus = '作成中' | '照査待ち' | '承認済み' | '差戻し'
export type DemoMemberRole = '作成者' | '照査者' | '承認者' | '閲覧者' | '数量担当'

/** 案件ごとの図面テーマ（案件の業務内容に応じたサンプル図形を生成する）。 */
export type DemoProjectTheme =
  | 'road-widening'
  | 'pump-station'
  | 'planting-paving'
  | 'retention-pond'
  | 'sewer-main'
  | 'bridge-pier'
  | 'sidewalk'
  | 'revetment'
  | 'slope-protection'
  | 'tunnel-portal'

/** 図面種別の日本語表示と Workers API 契約の種別コードの対応（単一の真実）。 */
export const DEMO_DRAWING_TYPE_CODES: Readonly<Record<DemoDrawingType, string>> = {
  施工ヤード図: 'temporary-yard-plan',
  仮設計画図: 'temporary-plan',
  '土工・断面図': 'earthwork-plan',
  数量根拠図: 'quantity-basis',
}

export interface DemoMember {
  readonly name: string
  readonly role: DemoMemberRole
  /** 予約済みの架空ドメイン example.jp のみを使用（実在メール不使用）。 */
  readonly email: string
}

export interface DemoDrawing {
  readonly no: string
  readonly name: string
  readonly type: DemoDrawingType
  readonly rev: string
  readonly status: DemoDrawingStatus
  /** 更新者（プロジェクトのメンバー名と一致する）。 */
  readonly by: string
  readonly updatedAt: string
}

export interface DemoActivity {
  readonly text: string
  readonly when: string
}

export interface DemoProject {
  readonly id: string
  readonly projectNumber: string
  /** 図面サンプルデータのテーマ（案件内容と一致させる）。 */
  readonly theme: DemoProjectTheme
  readonly name: string
  readonly area: string
  readonly status: DemoProjectStatus
  readonly clientSummary: string
  readonly client: string
  readonly period: string
  readonly districtCount: string
  readonly coordinateSystem: string
  readonly unitSystem: string
  readonly contractAmount: string
  readonly supervisor: string
  readonly address: string
  readonly tel: string
  readonly manager: string
  readonly note: string
  readonly updated: string
  /** 照査・承認待ちの滞留日数（KPI の「3日以上滞留」表示用）。 */
  readonly staleDays?: number
  readonly drawings: readonly DemoDrawing[]
  readonly members: readonly DemoMember[]
  readonly activities: readonly DemoActivity[]
}

const DRAWING_ICON: Readonly<Record<DemoDrawingType, string>> = {
  施工ヤード図: '📐',
  仮設計画図: '🚧',
  '土工・断面図': '⛰️',
  数量根拠図: '🧮',
}

const DEFAULT_DRAWING_UPDATED_AT = '2026-07-10T09:00:00+09:00'
/** 「最近開いた図面」の相対時刻ラベル基準（デモ固定時刻）。 */
const DEMO_NOW_MS = Date.parse('2026-07-16T12:00:00+09:00')

function member(name: string, role: DemoMemberRole, localPart: string): DemoMember {
  return { name, role, email: `${localPart}@example.jp` }
}

function drawing(
  no: string,
  name: string,
  type: DemoDrawingType,
  rev: string,
  status: DemoDrawingStatus,
  by: string,
  updatedAt = DEFAULT_DRAWING_UPDATED_AT,
): DemoDrawing {
  return { no, name, type, rev, status, by, updatedAt }
}

function activity(text: string, when: string): DemoActivity {
  return { text, when }
}

/**
 * 詳細ダミーデータ 10 件。
 * ステータス内訳: 進行中 3 / 照査待ち 2 / 承認待ち 2 / 承認済み 2 / 差戻し 1。
 */
export const DEMO_PROJECTS: readonly DemoProject[] = [
  {
    id: 'demo-p01',
    projectNumber: 'P-DEMO-2026-001',
    theme: 'road-widening',
    name: 'みらい台地区 市道拡幅工事',
    area: '第2工区',
    status: '進行中',
    clientSummary: 'デモ県 みらい土木事務所',
    client: 'デモ県 みらい土木事務所 道路課',
    period: '2026-04-01 〜 2027-01-31',
    districtCount: '2工区（第1・第2工区）',
    coordinateSystem: '平面直角座標系 第Ⅵ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥486,000,000',
    supervisor: 'デモ県 みらい土木事務所 第2事務所',
    address: 'デモ県みらい市みらい台3-12-1（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '出雲 拓海',
    note: '施工ヤード計画図 Rev.3 を編集中',
    updated: '2026-07-16',
    drawings: [
      drawing('DWG-014', '施工ヤード計画図', '施工ヤード図', 'Rev.3', '作成中', '出雲 拓海', '2026-07-16T11:50:00+09:00'),
      drawing('DWG-011', '仮設計画図（矢板・切梁）', '仮設計画図', 'Rev.2', '照査待ち', '出雲 拓海'),
      drawing('DWG-009', '土工平面図・法面計画', '土工・断面図', 'Rev.5', '承認済み', '綾瀬 紬'),
      drawing('DWG-002', '数量根拠図（土工数量）', '数量根拠図', 'Rev.1', '差戻し', '出雲 拓海'),
      drawing('DWG-018', '重機作業半径図', '仮設計画図', 'Rev.1', '作成中', '氷川 蒼', '2026-07-14T09:00:00+09:00'),
      drawing('DWG-020', '施工ヤード資材配置図', '施工ヤード図', 'Rev.1', '作成中', '黒鉄 徹'),
      drawing('DWG-021', '施工ヤード排水計画図', '施工ヤード図', 'Rev.1', '照査待ち', '出雲 拓海', '2026-07-15T10:00:00+09:00'),
      drawing('DWG-022', '標準横断図 No.20', '土工・断面図', 'Rev.2', '承認済み', '綾瀬 紬'),
      drawing('DWG-023', '法面断面図 No.40', '土工・断面図', 'Rev.2', '作成中', '出雲 拓海'),
      drawing('DWG-024', '掘削断面図 No.60', '土工・断面図', 'Rev.1', '照査待ち', '氷川 蒼'),
      drawing('DWG-025', '数量根拠図（舗装数量）', '数量根拠図', 'Rev.1', '承認済み', '黒鉄 徹'),
      drawing('DWG-026', '数量根拠図（仮設材数量）', '数量根拠図', 'Rev.1', '作成中', '出雲 拓海'),
    ],
    members: [
      member('出雲 拓海', '作成者', 'izumo.taku'),
      member('綾瀬 紬', '照査者', 'ayase.tsumugi'),
      member('氷川 蒼', '承認者', 'hikawa.aoi'),
      member('白鳥 梓', '閲覧者', 'shiratori.azusa'),
      member('黒鉄 徹', '数量担当', 'kurogane.toru'),
    ],
    activities: [
      activity('出雲 拓海が DWG-014 Rev.3 を保存', '2026-07-14 18:42'),
      activity('綾瀬 紬が DWG-011 Rev.2 を照査依頼', '2026-07-13 11:20'),
      activity('氷川 蒼が DWG-002 Rev.1 を差戻し', '2026-07-12 16:05'),
      activity('黒鉄 徹が数量CSVを出力', '2026-07-12 10:25'),
      activity('白鳥 梓が DWG-018 を新規作成', '2026-07-11 09:30'),
    ],
  },
  {
    id: 'demo-p02',
    projectNumber: 'P-DEMO-2026-002',
    theme: 'pump-station',
    name: '第二湾岸 雨水ポンプ場整備工事',
    area: 'ポンプ棟工区',
    status: '照査待ち',
    clientSummary: 'デモ県 第二湾岸整備局',
    client: 'デモ県 第二湾岸整備局 施設課',
    period: '2026-03-01 〜 2026-12-28',
    districtCount: '1工区（ポンプ棟）',
    coordinateSystem: '平面直角座標系 第Ⅷ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥312,500,000',
    supervisor: 'デモ県 第二湾岸整備局 湾岸事務所',
    address: 'デモ県第二湾岸市埠頭町5-8（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '早乙女 遥',
    note: '吸水槽数量の照査が4日滞留',
    updated: '2026-07-12',
    staleDays: 4,
    drawings: [
      drawing('DWG-006', 'ポンプ場平面配置図', '仮設計画図', 'Rev.2', '照査待ち', '早乙女 遥', '2026-07-16T10:00:00+09:00'),
      drawing('DWG-003', '吸水槽断面図', '土工・断面図', 'Rev.3', '照査待ち', '神楽 芽衣'),
      drawing('DWG-007', '数量根拠図（吸水槽数量）', '数量根拠図', 'Rev.1', '照査待ち', '早乙女 遥'),
      drawing('DWG-008', '電気室配置図', '仮設計画図', 'Rev.1', '作成中', '一ノ瀬 悠'),
      drawing('DWG-010', '施工ヤード計画図', '施工ヤード図', 'Rev.2', '承認済み', '早乙女 遥'),
      drawing('DWG-015', '配管縦断図', '土工・断面図', 'Rev.1', '差戻し', '神楽 芽衣'),
      drawing('DWG-019', '重機配置図', '仮設計画図', 'Rev.1', '照査待ち', '一ノ瀬 悠'),
    ],
    members: [
      member('早乙女 遥', '作成者', 'saotome.haruka'),
      member('神楽 芽衣', '照査者', 'kagura.mei'),
      member('一ノ瀬 悠', '承認者', 'ichinose.yu'),
      member('藤堂 志保', '閲覧者', 'toudou.shiho'),
      member('若葉 陸', '数量担当', 'wakaba.riku'),
    ],
    activities: [
      activity('早乙女 遥が DWG-006 Rev.2 を照査依頼', '2026-07-13 09:10'),
      activity('神楽 芽衣が DWG-015 Rev.1 を差戻し', '2026-07-11 15:40'),
      activity('若葉 陸が吸水槽数量を集計', '2026-07-10 13:25'),
      activity('一ノ瀬 悠が DWG-008 を保存', '2026-07-09 17:05'),
    ],
  },
  {
    id: 'demo-p03',
    projectNumber: 'P-DEMO-2026-003',
    theme: 'planting-paving',
    name: 'ひかり鉄道高架下 植栽・舗装整備',
    area: '高架下A工区',
    status: '承認待ち',
    clientSummary: 'ひかり鉄道株式会社（デモ）',
    client: 'ひかり鉄道株式会社 施設部（デモ）',
    period: '2026-05-01 〜 2026-10-31',
    districtCount: '2工区（A・B工区）',
    coordinateSystem: '平面直角座標系 第Ⅸ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥58,400,000',
    supervisor: 'ひかり鉄道 高架下開発部（デモ）',
    address: 'デモ県ひかり市駅前1-1（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '霧島 奏',
    note: '植栽計画図の承認者確認待ち',
    updated: '2026-07-11',
    drawings: [
      drawing('DWG-101', '植栽平面図', '土工・断面図', 'Rev.3', '照査待ち', '霧島 奏'),
      drawing('DWG-102', '舗装構成図', '数量根拠図', 'Rev.2', '照査待ち', '桜庭 望'),
      drawing('DWG-103', '排水詳細図', '仮設計画図', 'Rev.1', '照査待ち', '霧島 奏'),
      drawing('DWG-104', '照明配置図', '施工ヤード図', 'Rev.1', '承認済み', '天城 光'),
      drawing('DWG-105', '出入口計画図', '仮設計画図', 'Rev.2', '照査待ち', '桜庭 望'),
      drawing('DWG-106', '数量根拠図（舗装数量）', '数量根拠図', 'Rev.1', '照査待ち', '霧島 奏'),
    ],
    members: [
      member('霧島 奏', '作成者', 'kirishima.kanade'),
      member('桜庭 望', '照査者', 'sakuraba.nozomi'),
      member('天城 光', '承認者', 'amagi.hikaru'),
      member('白鳥 梓', '閲覧者', 'shiratori.azusa'),
      member('若葉 陸', '数量担当', 'wakaba.riku'),
    ],
    activities: [
      activity('霧島 奏が DWG-101 Rev.3 を照査依頼', '2026-07-10 16:20'),
      activity('桜庭 望が DWG-102 Rev.2 を照査完了', '2026-07-09 11:00'),
      activity('天城 光が承認待ちに変更', '2026-07-08 14:30'),
    ],
  },
  {
    id: 'demo-p04',
    projectNumber: 'P-DEMO-2026-004',
    theme: 'retention-pond',
    name: '中央公園 調整池築造工事',
    area: '池体工区',
    status: '承認済み',
    clientSummary: 'デモ市 公園みどり課',
    client: 'デモ市 都市整備部 公園みどり課',
    period: '2025-11-01 〜 2026-09-30',
    districtCount: '1工区（調整池）',
    coordinateSystem: '平面直角座標系 第Ⅵ系',
    unitSystem: 'm（メートル）',
    contractAmount: '非公開（権限者のみ閲覧可）',
    supervisor: 'デモ市 都市整備部 第3事務所',
    address: 'デモ市中央区公園通り4-6（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '星野 蓮',
    note: '数量根拠図まで承認済み',
    updated: '2026-07-10',
    drawings: [
      drawing('DWG-030', '出力確認図', '施工ヤード図', 'Rev.1', '承認済み', '星野 蓮', '2026-07-13T08:00:00+09:00'),
      drawing('DWG-031', '調整池平面図', '土工・断面図', 'Rev.4', '承認済み', '藤堂 志保'),
      drawing('DWG-032', '護岸標準断面図', '土工・断面図', 'Rev.3', '承認済み', '星野 蓮'),
      drawing('DWG-033', '流入・流出桝詳細図', '仮設計画図', 'Rev.2', '承認済み', '藤堂 志保'),
      drawing('DWG-034', '数量根拠図（掘削数量）', '数量根拠図', 'Rev.2', '承認済み', '若葉 陸'),
      drawing('DWG-035', '仮設締切計画図', '仮設計画図', 'Rev.1', '承認済み', '星野 蓮'),
      drawing('DWG-036', '管理用階段詳細図', '施工ヤード図', 'Rev.1', '承認済み', '藤堂 志保'),
      drawing('DWG-037', '防水シート張付図', '土工・断面図', 'Rev.1', '承認済み', '星野 蓮'),
      drawing('DWG-038', '数量根拠図（張石数量）', '数量根拠図', 'Rev.1', '承認済み', '若葉 陸'),
    ],
    members: [
      member('星野 蓮', '作成者', 'hoshino.ren'),
      member('藤堂 志保', '照査者', 'toudou.shiho'),
      member('天城 光', '承認者', 'amagi.hikaru'),
      member('白鳥 梓', '閲覧者', 'shiratori.azusa'),
      member('若葉 陸', '数量担当', 'wakaba.riku'),
    ],
    activities: [
      activity('天城 光が DWG-038 Rev.1 を承認', '2026-07-09 10:15'),
      activity('藤堂 志保が DWG-033 Rev.2 を照査完了', '2026-07-08 14:50'),
      activity('星野 蓮が出力確認図を作成', '2026-07-07 16:30'),
      activity('若葉 陸が張石数量を確定', '2026-07-06 11:20'),
    ],
  },
  {
    id: 'demo-p05',
    projectNumber: 'P-DEMO-2026-005',
    theme: 'sewer-main',
    name: '北ヶ丘団地 雨水幹線更新工事',
    area: '北ヶ丘2丁目',
    status: '差戻し',
    clientSummary: 'デモ市 上下水道局',
    client: 'デモ市 上下水道局 管路課',
    period: '2026-02-01 〜 2026-08-31',
    districtCount: '2工区（幹線・立坑）',
    coordinateSystem: '平面直角座標系 第Ⅵ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥94,700,000',
    supervisor: 'デモ市 上下水道局 北部事務所',
    address: 'デモ市北ヶ丘2-14-7（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '黒鉄 徹',
    note: '既設管との離隔不足のため幹線縦断を再検討中',
    updated: '2026-07-09',
    drawings: [
      drawing('DWG-201', '幹線平面図', '土工・断面図', 'Rev.2', '差戻し', '黒鉄 徹'),
      drawing('DWG-202', '幹線縦断図', '土工・断面図', 'Rev.2', '差戻し', '黒鉄 徹'),
      drawing('DWG-203', '立坑詳細図', '仮設計画図', 'Rev.1', '差戻し', '星野 蓮'),
      drawing('DWG-204', '数量根拠図（管材数量）', '数量根拠図', 'Rev.1', '差戻し', '若葉 陸'),
    ],
    members: [
      member('黒鉄 徹', '作成者', 'kurogane.toru'),
      member('星野 蓮', '照査者', 'hoshino.ren'),
      member('天城 光', '承認者', 'amagi.hikaru'),
      member('白鳥 梓', '閲覧者', 'shiratori.azusa'),
      member('若葉 陸', '数量担当', 'wakaba.riku'),
    ],
    activities: [
      activity('天城 光が DWG-202 Rev.2 を差戻し（既設管離隔不足）', '2026-07-09 13:05'),
      activity('星野 蓮が DWG-203 Rev.1 を照査', '2026-07-08 10:40'),
      activity('黒鉄 徹が幹線縦断の再検討を開始', '2026-07-09 15:25'),
    ],
  },
  {
    id: 'demo-p06',
    projectNumber: 'P-DEMO-2026-006',
    theme: 'bridge-pier',
    name: 'たんぽぽ橋 下部工補修工事',
    area: 'P2橋脚',
    status: '進行中',
    clientSummary: 'デモ県 道路公社',
    client: 'デモ県 道路公社 橋梁課',
    period: '2026-07-01 〜 2026-11-30',
    districtCount: '1工区（P2橋脚）',
    coordinateSystem: '平面直角座標系 第Ⅵ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥76,300,000',
    supervisor: 'デモ県 道路公社 たんぽぽ管理所',
    address: 'デモ県みらい市たんぽぽ町9-3（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '氷川 蒼',
    note: '着工準備中・図面未作成（空状態確認用）',
    updated: '2026-07-08',
    drawings: [],
    members: [
      member('氷川 蒼', '作成者', 'hikawa.aoi'),
      member('綾瀬 紬', '照査者', 'ayase.tsumugi'),
      member('天城 光', '承認者', 'amagi.hikaru'),
      member('白鳥 梓', '閲覧者', 'shiratori.azusa'),
      member('黒鉄 徹', '数量担当', 'kurogane.toru'),
    ],
    activities: [
      activity('氷川 蒼が案件を開設', '2026-07-08 09:00'),
      activity('白鳥 梓が現地調査写真を確認', '2026-07-08 10:20'),
    ],
  },
  {
    id: 'demo-p07',
    projectNumber: 'P-DEMO-2026-007',
    theme: 'sidewalk',
    name: 'ふれあい通り 歩道バリアフリー化工事',
    area: '歩道区間1',
    status: '承認済み',
    clientSummary: 'デモ市 道路管理課',
    client: 'デモ市 都市整備部 道路管理課',
    period: '2026-04-15 〜 2026-07-31',
    districtCount: '1工区（歩道区間1）',
    coordinateSystem: '平面直角座標系 第Ⅵ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥12,800,000',
    supervisor: 'デモ市 都市整備部 第1事務所',
    address: 'デモ市ふれあい町2-2（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '綾瀬 紬',
    note: '施工ステップ図まで承認済み',
    updated: '2026-07-07',
    drawings: [
      drawing('DWG-301', '歩道平面図', '土工・断面図', 'Rev.2', '承認済み', '綾瀬 紬'),
      drawing('DWG-302', '勾配改良詳細図', '土工・断面図', 'Rev.1', '承認済み', '綾瀬 紬'),
      drawing('DWG-303', '施工ステップ図', '仮設計画図', 'Rev.1', '承認済み', '出雲 拓海'),
    ],
    members: [
      member('綾瀬 紬', '作成者', 'ayase.tsumugi'),
      member('出雲 拓海', '照査者', 'izumo.taku'),
      member('氷川 蒼', '承認者', 'hikawa.aoi'),
      member('白鳥 梓', '閲覧者', 'shiratori.azusa'),
      member('黒鉄 徹', '数量担当', 'kurogane.toru'),
    ],
    activities: [
      activity('氷川 蒼が DWG-303 Rev.1 を承認', '2026-07-07 10:00'),
      activity('出雲 拓海が DWG-301 Rev.2 を照査完了', '2026-07-05 15:30'),
      activity('綾瀬 紬が勾配改良詳細図を作成', '2026-07-03 11:45'),
    ],
  },
  {
    id: 'demo-p08',
    projectNumber: 'P-DEMO-2026-008',
    theme: 'revetment',
    name: 'ひまわり川 護岸補強工事（第3期）',
    area: '左岸3工区',
    status: '照査待ち',
    clientSummary: 'デモ県 河川整備課',
    client: 'デモ県 土木部 河川整備課',
    period: '2026-03-15 〜 2026-12-25',
    districtCount: '2工区（左岸2・3工区）',
    coordinateSystem: '平面直角座標系 第Ⅵ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥205,000,000',
    supervisor: 'デモ県 ひまわり川出張所',
    address: 'デモ県みらい市ひまわり町5-5（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '神楽 芽衣',
    note: '護岸ブロック数量の照査が6日滞留',
    updated: '2026-07-05',
    staleDays: 6,
    drawings: [
      drawing('DWG-401', '護岸平面図', '土工・断面図', 'Rev.3', '照査待ち', '神楽 芽衣'),
      drawing('DWG-402', '護岸標準断面図', '土工・断面図', 'Rev.3', '照査待ち', '神楽 芽衣'),
      drawing('DWG-403', '数量根拠図（護岸数量）', '数量根拠図', 'Rev.2', '照査待ち', '若葉 陸'),
      drawing('DWG-404', '仮締切計画図', '仮設計画図', 'Rev.1', '照査待ち', '一ノ瀬 悠'),
      drawing('DWG-405', '施工ヤード計画図', '施工ヤード図', 'Rev.2', '承認済み', '神楽 芽衣'),
      drawing('DWG-406', '洗掘防止工詳細図', '土工・断面図', 'Rev.1', '照査待ち', '一ノ瀬 悠'),
      drawing('DWG-407', '測点配置図', '土工・断面図', 'Rev.1', '照査待ち', '神楽 芽衣'),
      drawing('DWG-408', '数量根拠図（捨石数量）', '数量根拠図', 'Rev.1', '作成中', '若葉 陸'),
    ],
    members: [
      member('神楽 芽衣', '作成者', 'kagura.mei'),
      member('一ノ瀬 悠', '照査者', 'ichinose.yu'),
      member('天城 光', '承認者', 'amagi.hikaru'),
      member('藤堂 志保', '閲覧者', 'toudou.shiho'),
      member('若葉 陸', '数量担当', 'wakaba.riku'),
    ],
    activities: [
      activity('神楽 芽衣が DWG-401 Rev.3 を照査依頼', '2026-07-05 09:40'),
      activity('若葉 陸が護岸ブロック数量を集計', '2026-07-04 14:10'),
      activity('一ノ瀬 悠が DWG-404 を保存', '2026-07-02 16:55'),
    ],
  },
  {
    id: 'demo-p09',
    projectNumber: 'P-DEMO-2026-009',
    theme: 'slope-protection',
    name: '東の原造成地 法面保護工事',
    area: '法面B工区',
    status: '承認待ち',
    clientSummary: 'デモ開発株式会社（架空）',
    client: 'デモ開発株式会社 造成事業部（架空）',
    period: '2026-04-01 〜 2026-10-31',
    districtCount: '2工区（法面A・B工区）',
    coordinateSystem: '平面直角座標系 第Ⅵ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥138,600,000',
    supervisor: 'デモ開発 東の原事業所（架空）',
    address: 'デモ県みらい市東の原8-10（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '一ノ瀬 悠',
    note: '法面保護工の承認者確認待ち',
    updated: '2026-07-04',
    drawings: [
      drawing('DWG-501', '法面平面図', '土工・断面図', 'Rev.2', '照査待ち', '一ノ瀬 悠'),
      drawing('DWG-502', '法面標準断面図', '土工・断面図', 'Rev.2', '照査待ち', '一ノ瀬 悠'),
      drawing('DWG-503', '数量根拠図（法面数量）', '数量根拠図', 'Rev.1', '照査待ち', '若葉 陸'),
      drawing('DWG-504', '吹付工詳細図', '土工・断面図', 'Rev.1', '照査待ち', '神楽 芽衣'),
      drawing('DWG-505', '排水工計画図', '仮設計画図', 'Rev.1', '照査待ち', '一ノ瀬 悠'),
    ],
    members: [
      member('一ノ瀬 悠', '作成者', 'ichinose.yu'),
      member('神楽 芽衣', '照査者', 'kagura.mei'),
      member('天城 光', '承認者', 'amagi.hikaru'),
      member('藤堂 志保', '閲覧者', 'toudou.shiho'),
      member('若葉 陸', '数量担当', 'wakaba.riku'),
    ],
    activities: [
      activity('一ノ瀬 悠が DWG-501 Rev.2 を照査依頼', '2026-07-04 10:35'),
      activity('神楽 芽衣が DWG-504 を照査完了', '2026-07-03 13:20'),
      activity('天城 光が承認待ちに変更', '2026-07-02 17:40'),
    ],
  },
  {
    id: 'demo-p10',
    projectNumber: 'P-DEMO-2026-010',
    theme: 'tunnel-portal',
    name: 'てんとう虫トンネル 坑口安全対策工事',
    area: '東坑口',
    status: '進行中',
    clientSummary: 'デモ県 道路公社',
    client: 'デモ県 道路公社 トンネル課',
    period: '2026-01-15 〜 2027-03-31',
    districtCount: '2工区（東・西坑口）',
    coordinateSystem: '平面直角座標系 第Ⅵ系',
    unitSystem: 'm（メートル）',
    contractAmount: '¥1,250,000,000',
    supervisor: 'デモ県 道路公社 てんとう虫管理所',
    address: 'デモ県みらい市てんとう虫峠7-7（架空・デモ用）',
    tel: '00-0000-0000（デモ用）',
    manager: '白鳥 梓',
    note: '坑口防護工の作業手順を整理中',
    updated: '2026-07-03',
    drawings: [
      drawing('DWG-601', '坑口平面図', '土工・断面図', 'Rev.2', '作成中', '白鳥 梓'),
      drawing('DWG-602', '坑口断面図', '土工・断面図', 'Rev.2', '作成中', '白鳥 梓'),
      drawing('DWG-603', '防護工計画図', '仮設計画図', 'Rev.1', '照査待ち', '霧島 奏'),
      drawing('DWG-604', '数量根拠図（防護工数量）', '数量根拠図', 'Rev.1', '作成中', '若葉 陸'),
      drawing('DWG-605', '仮設道路計画図', '仮設計画図', 'Rev.2', '承認済み', '白鳥 梓'),
      drawing('DWG-606', '施工ヤード計画図', '施工ヤード図', 'Rev.1', '作成中', '白鳥 梓'),
      drawing('DWG-607', '監視計測配置図', '土工・断面図', 'Rev.1', '照査待ち', '霧島 奏'),
      drawing('DWG-608', '数量根拠図（仮設数量）', '数量根拠図', 'Rev.1', '作成中', '若葉 陸'),
      drawing('DWG-609', '坑口排水計画図', '仮設計画図', 'Rev.1', '照査待ち', '白鳥 梓'),
      drawing('DWG-610', '重機作業半径図', '仮設計画図', 'Rev.1', '作成中', '霧島 奏'),
    ],
    members: [
      member('白鳥 梓', '作成者', 'shiratori.azusa'),
      member('霧島 奏', '照査者', 'kirishima.kanade'),
      member('天城 光', '承認者', 'amagi.hikaru'),
      member('藤堂 志保', '閲覧者', 'toudou.shiho'),
      member('若葉 陸', '数量担当', 'wakaba.riku'),
    ],
    activities: [
      activity('白鳥 梓が DWG-601 Rev.2 を保存', '2026-07-03 15:10'),
      activity('霧島 奏が DWG-603 Rev.1 を照査依頼', '2026-07-02 11:25'),
      activity('若葉 陸が防護工数量を集計中', '2026-07-01 14:50'),
      activity('藤堂 志保が坑口現地写真を確認', '2026-06-30 10:05'),
    ],
  },
]

/** 指定 ID のデモ案件を返す（見つからなければ undefined）。 */
export function findDemoProject(id: string | undefined): DemoProject | undefined {
  if (id === undefined) return undefined
  return DEMO_PROJECTS.find((project) => project.id === id)
}

/** デモ固定時刻からの相対ラベル（10分前 / 2時間前 / 昨日 / N日前）。 */
export function relativeDemoWhen(updatedAt: string): string {
  const elapsedMinutes = Math.max(0, Math.floor((DEMO_NOW_MS - Date.parse(updatedAt)) / 60000))
  if (elapsedMinutes < 60) return `${elapsedMinutes}分前`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}時間前`
  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays === 1) return '昨日'
  return `${elapsedDays}日前`
}

export interface DemoRecentDrawing {
  readonly icon: string
  readonly name: string
  readonly project: string
  readonly no: string
  readonly rev: string
  readonly when: string
  readonly status: string
}

/** 全案件の図面を更新日時の降順に並べ、直近 5 件を「最近開いた図面」として返す。 */
export function recentDrawingsFromProjects(
  projects: readonly DemoProject[] = DEMO_PROJECTS,
  limit = 5,
): readonly DemoRecentDrawing[] {
  return projects
    .flatMap((project) => project.drawings.map((item) => ({ project: project.name, ...item })))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit)
    .map((item) => ({
      icon: DRAWING_ICON[item.type],
      name: item.name,
      project: item.project,
      no: item.no,
      rev: item.rev,
      when: relativeDemoWhen(item.updatedAt),
      status: item.status,
    }))
}

/** 照査待ちのうち 3 日以上滞留している案件数（KPI の説明表示用）。 */
export function demoStaleReviewCount(projects: readonly DemoProject[] = DEMO_PROJECTS): number {
  return projects.filter((project) => project.status === '照査待ち' && (project.staleDays ?? 0) >= 3).length
}

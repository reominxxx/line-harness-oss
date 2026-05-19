/**
 * AI アクション定義
 *
 * 各画面の「✨ AI に任せる」ボタンが実行するアクションを定義。
 * AiActionButton はここの定義を読んで動的にフォームを生成する。
 */

export type AiActionFieldType = 'text' | 'textarea' | 'select' | 'number'

export interface AiActionField {
  key: string
  label: string
  type: AiActionFieldType
  required?: boolean
  options?: string[] // select の選択肢
  placeholder?: string
  defaultValue?: string | number
  description?: string
}

export interface AiActionDef {
  /** ユーザー向けラベル */
  label: string
  /** 説明 */
  description: string
  /** 内部で呼ぶジョブタイプ（worker の handler 名） */
  jobType: string
  /** AI 解析後、即実行可能か（true なら承認待ちにせず直接プレビュー） */
  inlinePreview: boolean
  /** モーダル入力フィールド */
  fields: AiActionField[]
  /** 想定実行時間（秒） */
  estimatedSeconds: number
}

export const AI_ACTIONS: Record<string, AiActionDef> = {
  // ───────────────────────────────────────────
  // 配信
  // ───────────────────────────────────────────
  'broadcast.generate': {
    label: 'AI に配信案を作らせる',
    description: 'トピック・ターゲット・トーンを指定して、AI が業界トーンの配信案を生成します',
    jobType: 'generate_broadcast',
    inlinePreview: true,
    estimatedSeconds: 15,
    fields: [
      { key: 'topic', label: 'トピック', type: 'text', required: true, placeholder: '例：初夏のキャンペーン、母の日企画' },
      {
        key: 'targetSegment',
        label: 'ターゲット',
        type: 'select',
        options: ['全員', 'VIP', 'ホット顧客', 'ウォーム', '休眠', '新規', 'カスタム（自由記述）'],
        defaultValue: '全員',
      },
      {
        key: 'tone',
        label: 'トーン',
        type: 'select',
        options: ['親しみ系', 'フォーマル', 'カジュアル', '専門家系', 'お任せ（AI に判断させる）'],
        defaultValue: 'お任せ（AI に判断させる）',
      },
    ],
  },

  // ───────────────────────────────────────────
  // シナリオ
  // ───────────────────────────────────────────
  'scenario.generate': {
    label: 'AI にシナリオを作らせる',
    description: 'ステップ配信の構成案を AI が業界別に生成します',
    jobType: 'create_scenario',
    inlinePreview: true,
    estimatedSeconds: 20,
    fields: [
      { key: 'goal', label: 'シナリオの目的', type: 'text', required: true, placeholder: '例：友だち追加後の入会促進、リピート購入誘導' },
      {
        key: 'trigger',
        label: 'トリガー',
        type: 'select',
        options: ['友だち追加時', 'タグ追加時', '手動投入'],
        defaultValue: '友だち追加時',
      },
      { key: 'stepCount', label: 'ステップ数', type: 'number', defaultValue: 3 },
    ],
  },

  // ───────────────────────────────────────────
  // チャット返信
  // ───────────────────────────────────────────
  'chat.suggest_replies': {
    label: 'AI に返信案を作らせる',
    description: 'お客様のメッセージに対する返信案を 3 つ提案します',
    jobType: 'chat_suggest_replies',
    inlinePreview: true,
    estimatedSeconds: 10,
    fields: [
      { key: 'customerMessage', label: 'お客様のメッセージ', type: 'textarea', required: true },
      {
        key: 'tone',
        label: 'トーン',
        type: 'select',
        options: ['丁寧', 'カジュアル', 'フォーマル'],
        defaultValue: '丁寧',
      },
    ],
  },

  // ───────────────────────────────────────────
  // 休眠抽出
  // ───────────────────────────────────────────
  'friend.extract_dormant': {
    label: 'AI に休眠顧客を抽出させる',
    description: '指定日数以上動きのない顧客を抽出し、呼び戻し配信案も生成します',
    jobType: 'wake_dormant',
    inlinePreview: false, // 承認待ちに入る
    estimatedSeconds: 30,
    fields: [
      { key: 'dormantDays', label: '休眠日数', type: 'number', defaultValue: 90, description: 'N 日以上動きなしの顧客' },
      { key: 'maxFriends', label: '最大対象人数', type: 'number', defaultValue: 20 },
    ],
  },

  // ───────────────────────────────────────────
  // リッチメニュー
  // ───────────────────────────────────────────
  'rich_menu.generate_labels': {
    label: 'AI にメニュー文言を考えさせる',
    description: 'リッチメニューの各タップ領域に最適な文言を業界トーンで生成',
    jobType: 'rich_menu_labels',
    inlinePreview: true,
    estimatedSeconds: 8,
    fields: [
      { key: 'tabCount', label: 'タブ数', type: 'number', defaultValue: 6 },
      { key: 'purpose', label: 'メニューの目的', type: 'text', placeholder: '例：予約 / メニュー / アクセス案内' },
    ],
  },

  // ───────────────────────────────────────────
  // テンプレートバリエーション
  // ───────────────────────────────────────────
  'template.generate_variations': {
    label: 'AI にバリエーションを作らせる',
    description: '既存テンプレートを元に異なるトーンの派生案を 5 つ生成',
    jobType: 'template_variations',
    inlinePreview: true,
    estimatedSeconds: 12,
    fields: [
      { key: 'baseText', label: '元のテンプレート', type: 'textarea', required: true },
      { key: 'count', label: '生成数', type: 'number', defaultValue: 5 },
    ],
  },

  // ───────────────────────────────────────────
  // リマインダー
  // ───────────────────────────────────────────
  'reminder.generate': {
    label: 'AI にリマインダー文を作らせる',
    description: 'リマインダーの最適な文面を業界トーンで生成',
    jobType: 'reminder_setup',
    inlinePreview: true,
    estimatedSeconds: 10,
    fields: [
      { key: 'context', label: '何のリマインダー？', type: 'text', required: true, placeholder: '例：予約 24h 前、キャンペーン終了前日' },
    ],
  },
}

export type AiActionKey = keyof typeof AI_ACTIONS

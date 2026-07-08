/**
 * 運用設計書スキーマ
 *
 * ヒアリング (MTG 文字起こし + CSV) → Claude → このスキーマに沿った構造化 JSON。
 * UI/PDF はこの JSON をそのまま表示する。
 *
 * 採否判定 (adopt) は L-port の全機能を一律で評価し、
 * ヒアリング内容 (ゴール / 予算 / 配信頻度 / 業種特性) から逆算で決める。
 */

export type AdoptDecision = 'adopt' | 'hold' | 'reject';

export interface BusinessProfile {
  industry: string;                    // 業種
  business_type: string;               // 店舗 / EC / サービス / 混合
  staff_count: string | null;
  hours: string | null;                // 営業時間・定休日
  location: string | null;             // 所在地・商圏
  customer_segment: string | null;     // 主要客層
  avg_unit_price: string | null;       // 客単価
  monthly_visits: string | null;       // 月間来店/購入
  repeat_rate: string | null;          // リピート率
  current_friends: string | null;      // 現 LINE 友だち数
  source_tool: string | null;          // 既存ツール (Lステップ等)
}

export interface PainPoint {
  priority: 1 | 2 | 3 | 4 | 5;          // 1=最優先
  description: string;
  evidence: string | null;              // 録音/CSV の引用 (なければ null)
  impact: 'high' | 'medium' | 'low';
}

export interface Goal {
  kpi: string;
  current_value: string | null;
  target_value: string;
  deadline: string;                     // "3 ヶ月" 等の人間表記で OK
}

export interface FeatureDecision {
  feature_key:
    | 'coupon_discount'
    | 'coupon_free'
    | 'coupon_present'
    | 'coupon_cashback'
    | 'coupon_lottery'
    | 'scenario'
    | 'segment_ai'
    | 'segment_manual'
    | 'rich_menu'
    | 'broadcast_all'
    | 'broadcast_tag'
    | 'broadcast_multi_segment'
    | 'liff_booking'
    | 'liff_event'
    | 'form'
    | 'card_message'
    | 'auto_reply'
    | 'ai_generation'
    | 'scoring'
    | 'multi_account_dedup';
  feature_label: string;                // 表示名 (例: "クーポン (割引)")
  decision: AdoptDecision;              // 採用 / 保留 / 不採用
  reason: string;                       // 決定理由 (ヒアリング根拠を含む)
  phase: 'week1' | 'week2-4' | 'month2' | 'month3' | null;  // 採用なら時期
}

export interface CouponPlan {
  name: string;
  type: 'discount' | 'free' | 'present' | 'cashback' | 'lottery';
  description: string;
  trigger: string;                      // 配布条件 (例: "来店翌日に自動")
}

export interface ScenarioStep {
  trigger: string;                      // 例: "T+0 (友だち追加直後)"
  action: string;                       // 例: "ウェルカム + 来店履歴フォーム"
  message_outline: string | null;
}

export interface SegmentDesign {
  category: string;                     // 例: "年代"、"髪悩み"
  tags: string[];                       // 例: ["30代", "40代", "50代"]
  assignment_method: 'ai' | 'manual' | 'form';
}

export interface BroadcastCalendarItem {
  week: 1 | 2 | 3 | 4;
  content: string;
  target: string;                       // 例: "全員" / "VIP のみ"
  purpose: string;
}

/**
 * 月内 N 本の配信、それぞれの 1 本分の詳細設計。
 * ヒアリングで「月 X 本」と指定された値ぶん、AI が個別に生成する。
 */
export interface BroadcastDesign {
  index: number;                        // 1, 2, 3, ... (月内の通し番号)
  send_week: 1 | 2 | 3 | 4 | 5;         // 配信週
  send_day_hint: string;                // 推奨曜日・時間帯 (例: "金曜 19:00")
  message_type: 'text' | 'image_text' | 'flex_card' | 'card_message' | 'coupon' | 'video';
  title: string;                        // 配信タイトル (社内管理用)
  goal: string;                         // この 1 本の目的 (例: "週末来店促進")
  target_segment: string;               // 配信対象 (例: "全員" / "30 代女性タグ")
  hook: string;                         // 冒頭フック (1-2 行)
  body_outline: string;                 // 本文の骨子 (3-6 行)
  cta: string;                          // CTA 文言とリンク先 (LIFF/予約/クーポン)
  uses_feature: string[];               // 紐づく L-port 機能 (feature_key の文字列群)
  expected_kpi: string;                 // 想定 KPI (例: "開封 35% / クリック 8%")
  notes: string | null;                 // 注意事項 (薬機法等)
}

export interface ActionItem {
  when: 'this_week' | 'this_month' | 'next_month' | 'later';
  task: string;
  feature_dependency: string | null;    // 関連する feature_key (なければ null)
}

export interface Risk {
  category: 'legal' | 'platform' | 'operational' | 'business';
  description: string;
  mitigation: string | null;
}

export interface BudgetEstimate {
  monthly_yen: number;                  // 月コスト目安
  breakdown: Array<{ item: string; yen_per_month: number }>;
  fits_user_budget: boolean | null;     // ユーザー予算に収まるか (null=ユーザー予算不明)
}

export interface RoadmapItem {
  phase: 'week1' | 'week2-4' | 'month2' | 'month3';
  label: string;                        // "Week 1" 等
  tasks: string[];
}

export interface Blueprint {
  generated_at: string;                 // ISO date
  version: 1;
  summary: string;                      // 全体要約 (3-5 行)
  monthly_broadcast_count: number;      // ヒアリングで指定された月の配信本数
  business_profile: BusinessProfile;
  pain_points: PainPoint[];
  goals: Goal[];
  feature_decisions: FeatureDecision[]; // 全機能の採否マトリクス
  central_strategy: string;             // 中心施策のテキスト説明
  coupon_plan: CouponPlan[];
  scenario_steps: ScenarioStep[];
  segments: SegmentDesign[];
  broadcast_calendar: BroadcastCalendarItem[];
  broadcast_designs: BroadcastDesign[]; // 月 N 本の 1 本ごとの詳細設計 (length == monthly_broadcast_count)
  rich_menu_layout: string | null;      // 6 ボタンの並び (テキストでよい)
  action_items: ActionItem[];
  risks: Risk[];
  budget_estimate: BudgetEstimate | null;
  roadmap: RoadmapItem[];
}

/** Blueprint のキーをすべて埋めた空テンプレ (UI 初期表示等で) */
export function emptyBlueprint(): Blueprint {
  return {
    generated_at: new Date().toISOString(),
    version: 1,
    summary: '',
    monthly_broadcast_count: 4,
    business_profile: {
      industry: '',
      business_type: '',
      staff_count: null,
      hours: null,
      location: null,
      customer_segment: null,
      avg_unit_price: null,
      monthly_visits: null,
      repeat_rate: null,
      current_friends: null,
      source_tool: null,
    },
    pain_points: [],
    goals: [],
    feature_decisions: [],
    central_strategy: '',
    coupon_plan: [],
    scenario_steps: [],
    segments: [],
    broadcast_calendar: [],
    broadcast_designs: [],
    rich_menu_layout: null,
    action_items: [],
    risks: [],
    budget_estimate: null,
    roadmap: [],
  };
}

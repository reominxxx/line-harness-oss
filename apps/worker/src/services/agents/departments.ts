/**
 * 部署（department）マッピングとガバナンス定義。
 *
 * agent_jobs を「AIエージェント組織の部署」次元で俯瞰するための分類。
 * job_type ごとに担当部署を割り当てる。これは可視化（司令室ダッシュボード）の
 * グルーピング用メタデータであり、handler の実行ロジックには影響しない。
 *
 * 新しい handler を追加したら、registry.ts への登録と合わせてここにも 1 行足す。
 */

export type Department =
  | 'delivery' // 運用部: 顧客の LINE に直接届く配信・リマインダ
  | 'marketing' // マーケ部: キャンペーン/シナリオ設計/集客/SNS
  | 'analytics' // 分析部: レポート・各種分析・スコアリング
  | 'sales' // 営業部: ホットリード・商談化
  | 'cs' // CS部: 問い合わせ一次対応・チャット補助
  | 'ops' // 運用補助: メンテナンス・ラベル整備
  | 'engineering' // 開発部: コード改善（Tier2 routine 起案）
  | 'other';

/** job_type → 担当部署 */
const JOB_DEPARTMENT: Record<string, Department> = {
  // 運用部（顧客へ直接届く）
  generate_broadcast: 'delivery',
  wake_dormant: 'delivery',
  wake_warm_leads: 'delivery',
  request_reviews: 'delivery',
  birthday_greeting: 'delivery',
  pre_reservation_survey: 'delivery',
  reminder_setup: 'delivery',
  template_create: 'delivery',

  // 分析部
  generate_monthly_report: 'analytics',
  generate_weekly_report: 'analytics',
  analyze_funnel: 'analytics',
  analyze_broadcast_performance: 'analytics',
  analyze_chat_sentiment: 'analytics',
  analyze_scenarios: 'analytics',
  optimize_schedule: 'analytics',
  calculate_intent_scores: 'analytics',
  summarize_friend_profile: 'analytics',
  ban_risk_check: 'analytics',
  scoring_design: 'analytics',
  cv_setup: 'analytics',

  // マーケ部
  plan_monthly_broadcasts: 'marketing',
  create_scenario: 'marketing',
  generate_acquisition_campaign: 'marketing',
  update_rich_menu_cta: 'marketing',
  optimize_booking_promotion: 'marketing',
  segment_friends: 'marketing',
  automation_design: 'marketing',
  // Phase 1 で追加予定:
  fetch_social_signals: 'marketing',
  generate_social_post: 'marketing',
  publish_social_post: 'marketing',

  // 営業部
  hot_lead_notify: 'sales',

  // CS部
  unanswered_chat_summary: 'cs',
  chat_suggest_replies: 'cs',

  // 運用補助
  cleanup_stale_data: 'ops',
  rich_menu_labels: 'ops',
  template_variations: 'ops',
};

export function departmentForJobType(jobType: string): Department {
  return JOB_DEPARTMENT[jobType] ?? 'other';
}

// 不可逆アクションのガバナンス定義は db パッケージ（shouldAutoApprove と同居）が
// 単一の真実の源。ここでは利便のため再エクスポートする。
export { IRREVERSIBLE_JOB_TYPES, isIrreversibleJobType } from '@line-crm/db';

export const ALL_DEPARTMENTS: Department[] = [
  'delivery',
  'marketing',
  'analytics',
  'sales',
  'cs',
  'ops',
  'engineering',
  'other',
];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  delivery: '運用部',
  marketing: 'マーケ部',
  analytics: '分析部',
  sales: '営業部',
  cs: 'CS部',
  ops: '運用補助',
  engineering: '開発部',
  other: 'その他',
};

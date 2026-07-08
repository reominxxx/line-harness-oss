export { jstNow, toJstString, isTimeBefore, ensureJstOffset } from './utils';
export * from './friends';
export * from './tags';
export * from './scenarios';
export * from './scenario-schedule';
export * from './scenario-resolve';
export * from './broadcasts';
export * from './users';
export * from './line-accounts';
export * from './conversions';
export * from './affiliates';
export * from './webhooks';
export * from './calendar';
export * from './reminders';
export * from './scoring';
export * from './templates';
export * from './chats';
export * from './notifications';
export * from './stripe';
export * from './health';
export * from './automations';
export * from './entry-routes';
export * from './tracked-links';
export * from './forms';
export * from './ad-platforms';
export * from './staff';
export * from './auto-replies';
export * from './traffic-pools';
export * from './message-templates';
export * from './rich-menus';
// L-アシスト AI 拡張 (041_l_assist_ai_foundation.sql)
export * from './kb';
export * from './prompts';
export * from './ai-products';
export * from './ai-signals';
export * from './signal-tags';
export * from './audit';
// L-アシスト KPI 駆動エンジン (042_l_assist_agent_engine.sql)
export * from './kpi-goals';
export * from './agent-jobs';
// L-アシスト 全テナント共有の配信実例ライブラリ (049_agency_examples.sql)
export * from './agency-examples';
// L-アシスト 友だち長期プロファイル要約 (050_friend_profile_summary.sql)
export * from './friend-profile-summary';
// L-アシスト シグナル→自動アクションルール (051_friend_signal_actions.sql)
export * from './friend-signal-actions';
// L-アシスト 月次学習ノート (PDCA フィードバック) (052_monthly_learning_notes.sql)
export * from './monthly-learning';
// L-アシスト アカウント別カスタムセグメントタグ (055_segment_tags.sql)
export * from './segment-tags';
// アカウント別 KV 設定 (L ステップ Bridge トークン等)
export * from './account-settings';
// カード型メッセージ (公式 LINE 風 Flex Carousel ビルダー)
export * from './card-messages';
// クーポン管理 + Flex 生成 (062_coupons.sql)
export * from './coupons';
// ヒアリング → 運用設計書 (071_hearings.sql)
export * from './hearings';
// 無料診断 採点ロジック (純関数、テーブル不要)
export * from './diagnosis-scoring';

/**
 * Thin wrapper around D1Database.
 * Pass the result of createDb() into any query helper in this package.
 */
export function createDb(d1: D1Database): D1Database {
  return d1;
}

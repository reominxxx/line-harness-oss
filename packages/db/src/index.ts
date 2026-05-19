export { jstNow, toJstString, isTimeBefore } from './utils';
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
export * from './audit';
// L-アシスト KPI 駆動エンジン (042_l_assist_agent_engine.sql)
export * from './kpi-goals';
export * from './agent-jobs';
// L-アシスト 全テナント共有の配信実例ライブラリ (049_agency_examples.sql)
export * from './agency-examples';

/**
 * Thin wrapper around D1Database.
 * Pass the result of createDb() into any query helper in this package.
 */
export function createDb(d1: D1Database): D1Database {
  return d1;
}

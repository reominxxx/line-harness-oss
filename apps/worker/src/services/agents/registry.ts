/**
 * ジョブハンドラレジストリ
 *
 * 新しいハンドラを追加するときは、handlers/ にファイルを足して
 * このマップに登録するだけ。
 */

import { handleGenerateMonthlyReport } from './handlers/generate-monthly-report.js';
import { handleGenerateWeeklyReport } from './handlers/generate-weekly-report.js';
import { handleGenerateBroadcast } from './handlers/generate-broadcast.js';
import { handleWakeDormant } from './handlers/wake-dormant.js';
import { handleWakeWarmLeads } from './handlers/wake-warm-leads.js';
import { handleAnalyzeFunnel } from './handlers/analyze-funnel.js';
import { handleAnalyzeBroadcastPerformance } from './handlers/analyze-broadcast-performance.js';
import { handleAnalyzeChatSentiment } from './handlers/analyze-chat-sentiment.js';
import { handleAnalyzeScenarios } from './handlers/analyze-scenarios.js';
import { handleOptimizeSchedule } from './handlers/optimize-schedule.js';
import { handleCreateScenario } from './handlers/create-scenario.js';
import { handleGenerateAcquisitionCampaign } from './handlers/generate-acquisition-campaign.js';
import { handleUpdateRichMenuCta } from './handlers/update-rich-menu-cta.js';
import { handleOptimizeBookingPromotion } from './handlers/optimize-booking-promotion.js';
import { handleRequestReviews } from './handlers/request-reviews.js';
import { handleHotLeadNotify } from './handlers/hot-lead-notify.js';
import { handleSegmentFriends } from './handlers/segment-friends.js';
import { handleScoringDesign } from './handlers/scoring-design.js';
import { handleCvSetup } from './handlers/cv-setup.js';
import { handleTemplateCreate } from './handlers/template-create.js';
import { handleReminderSetup } from './handlers/reminder-setup.js';
import { handleUnansweredChatSummary } from './handlers/unanswered-chat-summary.js';
import { handleBanRiskCheck } from './handlers/ban-risk-check.js';
import { handleAutomationDesign } from './handlers/automation-design.js';
import { handleCalculateIntentScores } from './handlers/calculate-intent-scores.js';
import { handleBirthdayGreeting } from './handlers/birthday-greeting.js';
import { handlePreReservationSurvey } from './handlers/pre-reservation-survey.js';
import { handleCleanupStaleData } from './handlers/cleanup-stale-data.js';
import { handleChatSuggestReplies } from './handlers/chat-suggest-replies.js';
import { handleRichMenuLabels } from './handlers/rich-menu-labels.js';
import { handleTemplateVariations } from './handlers/template-variations.js';
import { handleSummarizeFriendProfile } from './handlers/summarize-friend-profile.js';
import { handlePlanMonthlyBroadcasts } from './handlers/plan-monthly-broadcasts.js';
import type { JobHandler } from './types.js';

export const JOB_HANDLERS: Record<string, JobHandler> = {
  // ── 分析・レポート系（自動公開系が多い） ──
  generate_monthly_report: handleGenerateMonthlyReport,
  generate_weekly_report: handleGenerateWeeklyReport,
  analyze_funnel: handleAnalyzeFunnel,
  analyze_broadcast_performance: handleAnalyzeBroadcastPerformance,
  analyze_chat_sentiment: handleAnalyzeChatSentiment,
  analyze_scenarios: handleAnalyzeScenarios,
  optimize_schedule: handleOptimizeSchedule,
  hot_lead_notify: handleHotLeadNotify,

  // ── 戦略立案系 (月初プランナー、自動公開) ──
  plan_monthly_broadcasts: handlePlanMonthlyBroadcasts,

  // ── 配信系（顧客に直接届く・review 必須） ──
  generate_broadcast: handleGenerateBroadcast,
  wake_dormant: handleWakeDormant,
  wake_warm_leads: handleWakeWarmLeads,
  request_reviews: handleRequestReviews,
  birthday_greeting: handleBirthdayGreeting,
  pre_reservation_survey: handlePreReservationSurvey,

  // ── シナリオ・キャンペーン系（review 必須） ──
  create_scenario: handleCreateScenario,
  generate_acquisition_campaign: handleGenerateAcquisitionCampaign,
  update_rich_menu_cta: handleUpdateRichMenuCta,
  optimize_booking_promotion: handleOptimizeBookingPromotion,

  // ── 設計提案系（手動 trigger 用、review 必須） ──
  scoring_design: handleScoringDesign,
  cv_setup: handleCvSetup,
  template_create: handleTemplateCreate,
  reminder_setup: handleReminderSetup,
  automation_design: handleAutomationDesign,

  // ── 分析・運用補助系（自動公開可） ──
  segment_friends: handleSegmentFriends,
  unanswered_chat_summary: handleUnansweredChatSummary,
  ban_risk_check: handleBanRiskCheck,
  calculate_intent_scores: handleCalculateIntentScores,
  summarize_friend_profile: handleSummarizeFriendProfile,

  // ── 運用メンテナンス（自動公開） ──
  cleanup_stale_data: handleCleanupStaleData,

  // ── AI アクションボタン用（即時プレビュー、review なし） ──
  chat_suggest_replies: handleChatSuggestReplies,
  rich_menu_labels: handleRichMenuLabels,
  template_variations: handleTemplateVariations,
};

export function getHandler(jobType: string): JobHandler | null {
  return JOB_HANDLERS[jobType] ?? null;
}

export function listJobTypes(): string[] {
  return Object.keys(JOB_HANDLERS);
}

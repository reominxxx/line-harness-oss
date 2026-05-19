/**
 * 配信種別ごとの専用プロンプトモジュール (Big Move 2)
 *
 * 配信種別 (broadcastType) に応じて、その種別の "型" を AI に伝える。
 * 1 つの汎用プロンプトで全種別をこなすと、どれも似たような無難な文章になりがち。
 * 種別ごとに「型」「やってはいけないこと」「黄金パターン」を明示する。
 */

import { CAMPAIGN_RULES } from './campaign.js';
import { REMINDER_RULES } from './reminder.js';
import { NEWSLETTER_RULES } from './newsletter.js';
import { EVENT_RULES } from './event.js';
import { LIMITED_OFFER_RULES } from './limited-offer.js';
import { AFTERCARE_RULES } from './aftercare.js';
import { WELCOME_RULES } from './welcome.js';
import { REACTIVATION_RULES } from './reactivation.js';

const TYPE_RULES: Record<string, string> = {
  campaign: CAMPAIGN_RULES,
  reminder: REMINDER_RULES,
  newsletter: NEWSLETTER_RULES,
  event: EVENT_RULES,
  limited_offer: LIMITED_OFFER_RULES,
  aftercare: AFTERCARE_RULES,
  welcome: WELCOME_RULES,
  reactivation: REACTIVATION_RULES,
};

/**
 * 配信種別に応じた専用ルールを返す。
 * 不明な種別なら空文字 (汎用プロンプトのみで生成)。
 */
export function getBroadcastTypeRules(broadcastType?: string | null): string {
  if (!broadcastType) return '';
  return TYPE_RULES[broadcastType] ?? '';
}

export {
  CAMPAIGN_RULES,
  REMINDER_RULES,
  NEWSLETTER_RULES,
  EVENT_RULES,
  LIMITED_OFFER_RULES,
  AFTERCARE_RULES,
  WELCOME_RULES,
  REACTIVATION_RULES,
};

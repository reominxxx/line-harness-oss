/**
 * AI コストガード
 *
 * 役割:
 *  - インテントに応じたモデル選択（Haiku / Sonnet 自動切替）
 *  - テナント月次予算上限の事前チェック
 *  - 使用ログの記録
 *  - メーター（含有枠 + 超過）の更新
 *
 * これがあることで、コスト暴走を構造的に防ぐ。
 */

import {
  getTenantMetering,
  logAiUsage,
  incrementMeter,
  type AiFeature,
  type MeterAxis,
} from '@line-crm/db';
import type { ClaudeModel } from '../lib/claude-client.js';

export type IntentClass =
  | 'simple_qa'         // FAQ レベル、Haiku で OK
  | 'complex_qa'        // 文脈考慮必要、Sonnet
  | 'product_recommend' // 商品レコメンド、Sonnet
  | 'image_query'       // 画像理解、Sonnet Vision
  | 'reservation'       // 予約意向、Haiku で十分
  | 'complaint'         // クレーム、エスカレ
  | 'small_talk'        // 雑談、Haiku
  | 'unknown';

/**
 * インテントとモデル種別の対応表
 *
 * Haiku 4.5 は接客応答用途で十分な品質。Sonnet は本当に複雑な文脈が必要な
 * 場合（画像理解 / 長文の複雑質問）だけに絞り、コストを抑える。
 *
 * 1 応答あたり: Haiku ≒ ¥0.3〜0.8 / Sonnet ≒ ¥3〜10
 */
export function pickModelForIntent(intent: IntentClass): ClaudeModel {
  switch (intent) {
    case 'image_query':
      return 'claude-sonnet-4-6'; // 画像理解は Sonnet
    case 'complex_qa':
      return 'claude-sonnet-4-6'; // 長文・複雑コンテキストのみ Sonnet
    case 'product_recommend':
    case 'simple_qa':
    case 'reservation':
    case 'small_talk':
    case 'complaint':
    case 'unknown':
    default:
      return 'claude-haiku-4-5-20251001';
  }
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: 'no_metering' | 'budget_cap_exceeded' | 'auto_fallback_disabled';
  currentSpentYen: number;
  budgetCapYen: number | null;
}

/** リクエスト前の予算チェック */
export async function checkBudget(
  db: D1Database,
  lineAccountId: string,
): Promise<BudgetCheckResult> {
  const m = await getTenantMetering(db, lineAccountId);
  if (!m) {
    return { allowed: false, reason: 'no_metering', currentSpentYen: 0, budgetCapYen: null };
  }

  const currentSpentYen = m.overage_charge_yen;
  const cap = m.monthly_budget_cap_yen;

  if (cap !== null && currentSpentYen >= cap) {
    if (m.auto_fallback_at_limit === 1) {
      return {
        allowed: false,
        reason: 'budget_cap_exceeded',
        currentSpentYen,
        budgetCapYen: cap,
      };
    }
  }

  return { allowed: true, currentSpentYen, budgetCapYen: cap };
}

export interface RecordUsageOptions {
  lineAccountId: string;
  friendId?: string | null;
  feature: AiFeature;
  /** Claude モデル名 or 他プロバイダ (例: 'gpt-image-2') を許容 */
  model: ClaudeModel | string;
  inputTokens: number;
  outputTokens: number;
  costYenX100: number;
  cached?: boolean;
  requestId?: string;
  meterAxis?: MeterAxis;  // メーター加算対象
}

/** 使用ログを記録し、メーターを 1 進める */
export async function recordUsage(
  db: D1Database,
  opts: RecordUsageOptions,
): Promise<{ overageYen: number; withinQuota: boolean }> {
  // 使用ログ記録
  await logAiUsage(db, {
    lineAccountId: opts.lineAccountId,
    friendId: opts.friendId,
    feature: opts.feature,
    model: opts.model,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    costYenX100: opts.costYenX100,
    cached: opts.cached,
    requestId: opts.requestId,
  });

  // メーター更新（軸が指定されているとき）
  if (opts.meterAxis && !opts.cached) {
    const result = await incrementMeter(db, opts.lineAccountId, opts.meterAxis, 1);
    return result;
  }
  return { overageYen: 0, withinQuota: true };
}

/**
 * 簡易インテント分類器（ルールベース、Haiku 呼び出しコスト節約のためのフォールバック）
 * 本格運用時は Haiku に分類させる方が精度高いが、開発初期はこれで十分。
 */
export function quickClassify(text: string): IntentClass {
  const t = text.toLowerCase();
  if (/予約|空き|空い|キャンセル|変更|日時|何時/.test(text)) return 'reservation';
  if (/写真|画像|これ/.test(text)) return 'image_query';
  if (/おすすめ|似合|合う|どれ/.test(text)) return 'product_recommend';
  if (/最悪|怒|ふざけ|二度と|返金|クレーム|苦情/.test(text)) return 'complaint';
  if (text.length < 20 && /\?|？|ですか|でしょうか|どう|なに/.test(text)) return 'simple_qa';
  if (text.length >= 50) return 'complex_qa';
  return 'small_talk';
}

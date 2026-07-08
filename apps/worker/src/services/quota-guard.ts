/**
 * LINE メッセージ配信上限 (課金対象メッセージの月間上限) ガード。
 *
 * LINE 公式アカウントは「push / multicast / broadcast」を課金対象として月間上限で数える
 * (reply は対象外)。上限を超えると超過分は送信できない/追加課金になるため、配信実行前に
 * LINE の quota API で残枠を確認して、超過する配信を止めるための共通ヘルパー。
 *
 * 設計方針:
 *   - 上限が type='none' (無制限プラン) の場合は残枠 null = 制限なし扱い。
 *   - quota API 自体が失敗したときは残枠 null (fail-open)。上限判定できないだけで
 *     正当な配信をブロックしてしまうのは避ける。ただしその旨をログに残す。
 *   - broadcast (全配信) は事前に正確な送信数が読めないため、残枠 0 以下なら止める判定に使う。
 */

import type { LineClient } from '@line-crm/line-sdk';

export interface RemainingQuota {
  /** 上限が設定されているか (limited プラン) */
  limited: boolean;
  /** 残り送信可能数。null = 無制限 または 取得失敗 (fail-open)。 */
  remaining: number | null;
  /** 月間上限値 (limited のとき) */
  limit: number | null;
  /** 当月消費数 */
  used: number | null;
}

/** LINE quota / consumption を取得し残枠を算出する。失敗時は fail-open (remaining=null)。 */
export async function getRemainingQuota(lineClient: LineClient): Promise<RemainingQuota> {
  try {
    const [quota, consumption] = await Promise.all([
      lineClient.getMessageQuota(),
      lineClient.getMessageQuotaConsumption(),
    ]);
    if (quota.type !== 'limited' || typeof quota.value !== 'number') {
      // 無制限プラン
      return { limited: false, remaining: null, limit: null, used: consumption.totalUsage ?? null };
    }
    const used = consumption.totalUsage ?? 0;
    return { limited: true, remaining: Math.max(0, quota.value - used), limit: quota.value, used };
  } catch (err) {
    console.error('[quota-guard] quota 取得失敗 (fail-open):', err);
    return { limited: false, remaining: null, limit: null, used: null };
  }
}

/** 配信上限超過を表すエラー。呼び出し側でハンドリングして配信を止める。 */
export class QuotaExceededError extends Error {
  constructor(
    public readonly remaining: number,
    public readonly planned: number,
  ) {
    super(
      `配信上限に達したため送信を中止しました（残り ${remaining} 通 / 送信予定 ${planned} 通）。` +
        `LINE 公式アカウントのプラン上限をご確認ください。`,
    );
    this.name = 'QuotaExceededError';
  }
}

/**
 * plannedCount 通を送る前に残枠を確認し、超過するなら QuotaExceededError を投げる。
 * remaining=null (無制限 or 取得失敗) のときは通す。
 * plannedCount を渡せない (broadcast 全配信など) 場合は plannedCount=1 として「残枠 0 以下なら止める」判定に使う。
 */
export async function assertWithinQuota(
  lineClient: LineClient,
  plannedCount: number,
): Promise<RemainingQuota> {
  const q = await getRemainingQuota(lineClient);
  if (q.limited && q.remaining !== null && plannedCount > q.remaining) {
    throw new QuotaExceededError(q.remaining, plannedCount);
  }
  return q;
}

/**
 * Cron で呼ばれる "pending hearings 処理".
 *
 * waitUntil 経由で fetch するパターンは Cloudflare Workers Bundled tier の
 * 30 秒上限で死ぬため、ヒアリング生成は cron triggered scheduled handler 上で
 * 動かす。scheduled handler のほうが walltime が長く取れる + 中断されない。
 *
 * フロー:
 *   1. status='pending' な hearing を 1 件 atomically 取得 (claimNextPendingHearing)
 *   2. AbortController 90 秒 timeout で Claude 呼び出し
 *   3. 成功 → saveHearingBlueprint で status='ready'
 *      失敗 → updateHearingStatus で status='error'
 *   4. 5 分以上 generating の stale なものは pending に戻す (recoverStalledHearings)
 *
 * 同時実行: cron は worker のリージョン分散で 1 回ずつしか走らないが、
 * 複数 hearing が pending している場合、1 cron tick = 1 件のみ処理する
 * (Worker の CPU/wall 余裕を残し、他のジョブと衝突しないようにするため)。
 */
import {
  claimNextPendingHearing,
  recoverStalledHearings,
  saveHearingBlueprint,
  updateHearingStatus,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import type { Env } from '../../index.js';
import { generateBlueprint } from './generate-blueprint.js';

export async function processPendingHearings(env: Env['Bindings']): Promise<{ processed: number; recovered: number }> {
  // stale の自動復旧
  const recovered = await recoverStalledHearings(env.DB).catch((err) => {
    console.error('[hearings-cron] recoverStalledHearings failed', err);
    return 0;
  });

  if (!env.ANTHROPIC_API_KEY) {
    console.warn('[hearings-cron] ANTHROPIC_API_KEY not set, skipping');
    return { processed: 0, recovered };
  }

  const hearing = await claimNextPendingHearing(env.DB);
  if (!hearing) return { processed: 0, recovered };

  console.log('[hearings-cron] claimed', { id: hearing.id, monthlyN: hearing.monthly_broadcast_count });

  const setProgress = async (msg: string) => {
    try {
      await env.DB
        .prepare(`UPDATE hearings SET error_message = ?, updated_at = ? WHERE id = ?`)
        .bind(`[進捗] ${msg}`, jstNow(), hearing.id)
        .run();
    } catch (err) {
      console.error('[hearings-cron] setProgress failed', hearing.id, err);
    }
  };

  await setProgress('1/4 cron pickup, Claude 呼び出し開始');

  try {
    const account = await getLineAccountById(env.DB, hearing.line_account_id).catch(() => null);
    const friendCountRow = await env.DB
      .prepare(`SELECT COUNT(*) as count FROM friends WHERE line_account_id = ? AND is_following = 1`)
      .bind(hearing.line_account_id)
      .first<{ count: number }>()
      .catch(() => null);

    const { blueprint, costYenX100 } = await generateBlueprint({
      apiKey: env.ANTHROPIC_API_KEY,
      transcript: hearing.transcript_text,
      csvText: hearing.csv_text,
      monthlyBroadcastCount: hearing.monthly_broadcast_count,
      accountContext: {
        accountName: account?.name ?? undefined,
        currentFriendCount: friendCountRow?.count ?? undefined,
      },
      onProgress: (msg) => setProgress(msg),
    });

    await setProgress(`3/4 Claude 完了 (¥${(costYenX100 / 100).toFixed(2)}, designs=${blueprint.broadcast_designs.length}) — DB 保存中`);
    await saveHearingBlueprint(env.DB, hearing.id, JSON.stringify(blueprint), costYenX100);
    console.log('[hearings-cron] saved', hearing.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : '';
    console.error('[hearings-cron] generate failed', hearing.id, msg, stack);
    await updateHearingStatus(env.DB, hearing.id, 'error', msg).catch((err) => {
      console.error('[hearings-cron] failed to set error status', hearing.id, err);
    });
  }
  return { processed: 1, recovered };
}

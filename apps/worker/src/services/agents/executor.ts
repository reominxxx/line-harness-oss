/**
 * Agent Executor
 *
 * cron で 5 分ごとに呼ばれて、pending な agent_jobs を順次処理。
 * 1 tick あたり最大 N 件まで（コスト爆発防止）。
 */

import {
  pickPendingJobs,
  markJobRunning,
  markJobReview,
  markJobCompleted,
  markJobFailed,
  getAutomationPolicy,
  shouldAutoApprove,
  type AgentJobRow,
} from '@line-crm/db';
import { checkBudget } from '../ai-cost-guard.js';
import { getHandler } from './registry.js';
import { notifyOperator } from '../../lib/line-notify.js';
import type { JobContext } from './types.js';

const JOB_TYPE_LABELS: Record<string, string> = {
  generate_broadcast: '配信案',
  wake_dormant: '休眠掘り起こし',
  wake_warm_leads: 'ウォームリード一押し',
  request_reviews: 'レビュー依頼',
  create_scenario: '新シナリオ案',
  generate_acquisition_campaign: '集客キャンペーン案',
  update_rich_menu_cta: 'リッチメニュー改善',
  optimize_booking_promotion: '予約促進',
  hot_lead_notify: 'ホットリード通知',
};

export interface ExecutorTickResult {
  picked: number;
  succeeded: number;
  reviewQueued: number;
  failed: number;
  skipped: number;
}

const MAX_JOBS_PER_TICK = 10;

export interface ExecutorEnv {
  bucket?: R2Bucket;
  workerUrl?: string;
}

export async function runExecutorTick(
  db: D1Database,
  apiKey: string | undefined,
  limit = MAX_JOBS_PER_TICK,
  envOpts?: ExecutorEnv,
): Promise<ExecutorTickResult> {
  const result: ExecutorTickResult = {
    picked: 0,
    succeeded: 0,
    reviewQueued: 0,
    failed: 0,
    skipped: 0,
  };

  const jobs = await pickPendingJobs(db, limit);
  result.picked = jobs.length;

  for (const job of jobs) {
    if (!apiKey) {
      await markJobFailed(db, job.id, 'ANTHROPIC_API_KEY not configured');
      result.failed++;
      continue;
    }

    // 予算チェック
    const budget = await checkBudget(db, job.line_account_id);
    if (!budget.allowed) {
      // budget 超過時は実行スキップ（次 tick で再試行）
      result.skipped++;
      continue;
    }

    // ハンドラ取得
    const handler = getHandler(job.job_type);
    if (!handler) {
      await markJobFailed(db, job.id, `Unknown job_type: ${job.job_type}`);
      result.failed++;
      continue;
    }

    await markJobRunning(db, job.id);

    try {
      const ctx: JobContext = {
        job,
        db,
        apiKey,
        lineAccountId: job.line_account_id,
        bucket: envOpts?.bucket,
        workerUrl: envOpts?.workerUrl,
      };
      const handlerResult = await handler(ctx);

      // policy で自動公開可能か判断
      const policy = await getAutomationPolicy(db, job.line_account_id);
      const autoApprove =
        handlerResult.forceStatus === 'completed' ||
        (handlerResult.forceStatus !== 'review' && shouldAutoApprove(policy, job.job_type));

      if (autoApprove) {
        await markJobCompleted(db, job.id, handlerResult.output, handlerResult.costYenX100);
        if (handlerResult.postAction) {
          try {
            await handlerResult.postAction();
          } catch (e) {
            console.error(`[executor] postAction failed for ${job.id}:`, e);
          }
        }
        result.succeeded++;
      } else {
        await markJobReview(db, job.id, handlerResult.output, handlerResult.costYenX100);
        result.reviewQueued++;
        // 事業者にプッシュ通知（設定があれば）
        const label = JOB_TYPE_LABELS[job.job_type] ?? job.job_type;
        await notifyOperator({
          db,
          lineAccountId: job.line_account_id,
          text: `承認待ちが届きました\n\n${label}\n\n管理画面の自動化ダッシュボードでご確認ください。`,
        });
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[executor] job ${job.id} (${job.job_type}) failed:`, e);
      await markJobFailed(db, job.id, errorMsg);
      result.failed++;
    }
  }

  return result;
}

/** 単一ジョブを即時実行（manual trigger 用） */
export async function runJobNow(
  db: D1Database,
  apiKey: string,
  jobId: string,
  envOpts?: ExecutorEnv,
): Promise<{ ok: boolean; status: AgentJobRow['status']; error?: string }> {
  const job = await db
    .prepare(`SELECT * FROM agent_jobs WHERE id = ?`)
    .bind(jobId)
    .first<AgentJobRow>();
  if (!job) return { ok: false, status: 'failed', error: 'job not found' };
  if (job.status !== 'pending') {
    return { ok: false, status: job.status, error: `job is already ${job.status}` };
  }

  const handler = getHandler(job.job_type);
  if (!handler) {
    await markJobFailed(db, job.id, `Unknown job_type: ${job.job_type}`);
    return { ok: false, status: 'failed', error: 'unknown job_type' };
  }

  await markJobRunning(db, job.id);

  try {
    const handlerResult = await handler({
      job,
      db,
      apiKey,
      lineAccountId: job.line_account_id,
      bucket: envOpts?.bucket,
      workerUrl: envOpts?.workerUrl,
    });
    const policy = await getAutomationPolicy(db, job.line_account_id);
    const autoApprove =
      handlerResult.forceStatus === 'completed' ||
      (handlerResult.forceStatus !== 'review' && shouldAutoApprove(policy, job.job_type));
    if (autoApprove) {
      await markJobCompleted(db, job.id, handlerResult.output, handlerResult.costYenX100);
      if (handlerResult.postAction) await handlerResult.postAction();
      return { ok: true, status: 'completed' };
    }
    await markJobReview(db, job.id, handlerResult.output, handlerResult.costYenX100);
    const label = JOB_TYPE_LABELS[job.job_type] ?? job.job_type;
    await notifyOperator({
      db,
      lineAccountId: job.line_account_id,
      text: `承認待ちが届きました\n\n${label}\n\n管理画面の自動化ダッシュボードでご確認ください。`,
    });
    return { ok: true, status: 'review' };
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await markJobFailed(db, job.id, errorMsg);
    return { ok: false, status: 'failed', error: errorMsg };
  }
}

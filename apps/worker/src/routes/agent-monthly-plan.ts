/**
 * 月の AI 配信案を一発で立ち上げるエンドポイント。
 *
 * POST /api/agent/start-monthly-plan
 *   header: X-Line-Account-Id
 *   body: { totalCount?: number, yearMonth?: string, industry?: string }
 *   resp: { success, planJobId, kpiUpdated, executorResult }
 *
 * 処理:
 *   1. kpi_goals の今月 broadcast_count を totalCount (デフォルト 8) で upsert
 *   2. plan_monthly_broadcasts ジョブを enqueue (origin='manual')
 *   3. executor tick を即実行 (= 戦略立案 → 8 本の generate_broadcast ジョブを enqueue)
 *   4. もう一度 tick を呼んで生成された generate_broadcast も処理開始
 *
 * 画像の有無は generate-broadcast.ts 内で Claude が imageNeeded: true|false を JSON で
 * 判断して、true なら GPT-Image-2 で画像も生成される (既存実装)。
 */

import { Hono } from 'hono';
import { upsertKpiGoal, createAgentJob, getLineAccountById } from '@line-crm/db';
import { runExecutorTick } from '../services/agents/executor.js';
import type { Env } from '../index.js';

export const agentMonthlyPlan = new Hono<Env>();

agentMonthlyPlan.post('/api/agent/start-monthly-plan', async (c) => {
  const lineAccountId = c.req.header('x-line-account-id');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }

  const body = await c.req.json<{
    totalCount?: number;
    yearMonth?: string;
    industry?: string;
    hint?: string;
    referenceImageDataUrl?: string;
    imageGenCount?: number;
  }>();
  const totalCount = Math.min(Math.max(body.totalCount ?? 8, 1), 30);
  const imageGenCount = Math.min(Math.max(body.imageGenCount ?? 0, 0), totalCount);
  const yearMonth = body.yearMonth ?? new Date().toISOString().slice(0, 7);

  // テナント業界を取得 (body 優先)
  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  const industry =
    body.industry ?? (account as { agency_industry?: string | null }).agency_industry ?? undefined;

  // 1. kpi_goals に broadcast_count = totalCount を upsert
  await upsertKpiGoal(c.env.DB, {
    lineAccountId,
    yearMonth,
    metric: 'broadcast_count',
    targetValue: totalCount,
    notes: 'AI 自動化ダッシュボードから設定',
  });

  // 2. plan_monthly_broadcasts ジョブを enqueue
  const planJob = await createAgentJob(c.env.DB, {
    lineAccountId,
    jobType: 'plan_monthly_broadcasts',
    input: {
      yearMonth,
      totalCount,
      industry,
      hint: body.hint,
      referenceImageDataUrl: body.referenceImageDataUrl,
      imageGenCount,
    },
    origin: 'manual',
    scheduledAt: new Date().toISOString(),
  });

  // 3. executor を即時 tick (plan_monthly_broadcasts を実行 → post-action が N 本展開)
  let firstTick;
  try {
    firstTick = await runExecutorTick(c.env.DB, apiKey, undefined, {
      bucket: c.env.IMAGES,
      workerUrl: c.env.WORKER_URL,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });
  } catch (e) {
    console.error('[start-monthly-plan] first tick failed:', e);
    return c.json({ success: false, error: e instanceof Error ? e.message : 'tick failed' }, 500);
  }

  // 4. もう一度 tick して、post-action が enqueue した generate_broadcast を即座に処理
  //    (各配信案は forceStatus: 'review' で 承認待ちに入る)
  let secondTick;
  try {
    secondTick = await runExecutorTick(c.env.DB, apiKey, undefined, {
      bucket: c.env.IMAGES,
      workerUrl: c.env.WORKER_URL,
      openaiApiKey: c.env.OPENAI_API_KEY,
    });
  } catch (e) {
    console.error('[start-monthly-plan] second tick failed:', e);
    // 2 回目の失敗は致命的ではない (次の cron で拾われる)
  }

  return c.json({
    success: true,
    planJobId: planJob.id,
    yearMonth,
    totalCount,
    industry,
    executorResult: firstTick,
    secondTickResult: secondTick,
    note: `${totalCount} 本の配信案を生成中です。承認待ちセクションに順次表示されます。`,
  });
});

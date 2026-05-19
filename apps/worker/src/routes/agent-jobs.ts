/**
 * Agent Jobs API routes
 *
 * GET    /api/agent-jobs                   ジョブ一覧（status / job_type フィルタ可）
 * GET    /api/agent-jobs/:id                ジョブ詳細
 * POST   /api/agent-jobs                   手動でジョブを作成（manual origin）
 * POST   /api/agent-jobs/:id/run            即時実行（テスト用）
 * POST   /api/agent-jobs/:id/approve       review → approved → completed
 * POST   /api/agent-jobs/:id/reject        review → rejected
 * POST   /api/agent-jobs/:id/cancel        pending → cancelled
 * GET    /api/agent-jobs/types              利用可能な job_type 一覧
 * POST   /api/agent-jobs/executor/tick     手動で executor を 1 tick 実行（テスト/CI 用）
 *
 * GET    /api/automation-policy            テナントの自動化ポリシー取得
 * PUT    /api/automation-policy            自動化ポリシー設定
 */

import { Hono } from 'hono';
import {
  createAgentJob,
  getAgentJob,
  listAgentJobs,
  approveJob,
  rejectJob,
  cancelJob,
  markJobCompleted,
  updateAgentJobOutput,
  getAutomationPolicy,
  upsertAutomationPolicy,
  type AgentJobStatus,
  type AutomationLevel,
} from '@line-crm/db';
import { runExecutorTick, runJobNow } from '../services/agents/executor.js';
import { listJobTypes } from '../services/agents/registry.js';
import { getPostAction } from '../services/agents/post-actions/index.js';
import { staffIdForFk } from '../lib/staff-fk.js';
import type { Env } from '../index.js';

export const agentJobs = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

agentJobs.get('/api/agent-jobs/types', async (c) => {
  return c.json({ success: true, types: listJobTypes() });
});

/**
 * 日別ジョブ統計
 * GET /api/agent-jobs/daily-stats?days=14
 * 返り値: [{ date: '2026-05-01', total: 5, completed: 4, cost_yen_x100: 1234 }, ...]
 */
agentJobs.get('/api/agent-jobs/daily-stats', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);
  }
  const days = Math.min(parseInt(c.req.query('days') ?? '14', 10), 90);

  const res = await c.env.DB
    .prepare(
      `SELECT
         substr(COALESCE(completed_at, created_at), 1, 10) AS date,
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review,
         SUM(cost_yen_x100) AS cost_yen_x100
       FROM agent_jobs
       WHERE line_account_id = ?
         AND COALESCE(completed_at, created_at) >= datetime('now', '-' || ? || ' days', '+9 hours')
       GROUP BY substr(COALESCE(completed_at, created_at), 1, 10)
       ORDER BY date ASC`,
    )
    .bind(lineAccountId, days)
    .all<{
      date: string;
      total: number;
      completed: number;
      failed: number;
      review: number;
      cost_yen_x100: number;
    }>();

  return c.json({ success: true, days, stats: res.results ?? [] });
});

agentJobs.get('/api/agent-jobs', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const status = c.req.query('status') as AgentJobStatus | undefined;
  const jobType = c.req.query('job_type');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);
  const jobs = await listAgentJobs(c.env.DB, lineAccountId, { status, jobType, limit });
  return c.json({ success: true, jobs });
});

agentJobs.get('/api/agent-jobs/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const job = await getAgentJob(c.env.DB, c.req.param('id'));
  if (!job || job.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return c.json({ success: true, job });
});

agentJobs.post('/api/agent-jobs', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req.json<{
    job_type: string;
    input?: Record<string, unknown>;
    scheduled_at?: string;
    related_kpi_id?: string;
  }>();
  if (!body.job_type) {
    return c.json({ success: false, error: 'job_type required' }, 400);
  }
  const validTypes = listJobTypes();
  if (!validTypes.includes(body.job_type)) {
    return c.json({ success: false, error: `Unknown job_type. Valid: ${validTypes.join(', ')}` }, 400);
  }
  const job = await createAgentJob(c.env.DB, {
    lineAccountId,
    jobType: body.job_type,
    input: body.input,
    origin: 'manual',
    scheduledAt: body.scheduled_at,
    relatedKpiId: body.related_kpi_id,
  });
  return c.json({ success: true, job }, 201);
});

agentJobs.post('/api/agent-jobs/:id/run', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }
  const id = c.req.param('id');
  const job = await getAgentJob(c.env.DB, id);
  if (!job || job.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const result = await runJobNow(c.env.DB, apiKey, id, { bucket: c.env.IMAGES, workerUrl: c.env.WORKER_URL });
  const updated = await getAgentJob(c.env.DB, id);
  return c.json({ success: result.ok, ...result, job: updated });
});

agentJobs.post('/api/agent-jobs/:id/approve', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const staff = c.get('staff');
  if (!staff) {
    return c.json({ success: false, error: 'Auth required' }, 401);
  }
  const id = c.req.param('id');
  const job = await getAgentJob(c.env.DB, id);
  if (!job || job.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  if (job.status !== 'review') {
    return c.json({ success: false, error: `Job status is ${job.status}, expected review` }, 400);
  }
  const body = await c.req.json<{
    notes?: string;
    /** 承認前に編集された output_json (指定があれば DB の output_json を上書きしてから post-action 実行) */
    output_overrides?: Record<string, unknown>;
  }>().catch(() => ({} as { notes?: string; output_overrides?: Record<string, unknown> }));

  // output_overrides が指定されていれば agent_jobs.output_json をマージ更新
  let effectiveJob = job;
  if (body.output_overrides && Object.keys(body.output_overrides).length > 0) {
    let currentOutput: Record<string, unknown> = {};
    if (job.output_json) {
      try {
        currentOutput = JSON.parse(job.output_json) as Record<string, unknown>;
      } catch {
        currentOutput = {};
      }
    }
    const mergedOutput = { ...currentOutput, ...body.output_overrides };
    const newOutputJson = JSON.stringify(mergedOutput);
    await c.env.DB
      .prepare(`UPDATE agent_jobs SET output_json = ?, updated_at = ? WHERE id = ?`)
      .bind(newOutputJson, new Date().toISOString(), id)
      .run();
    effectiveJob = { ...job, output_json: newOutputJson };
  }

  await approveJob(c.env.DB, id, staffIdForFk(staff), body.notes);

  // Post-action 実行: AI 出力を実テーブルに反映（broadcasts / scenarios 等）
  const postAction = getPostAction(effectiveJob.job_type);
  let postActionResult: { ok: boolean; createdResource?: string; createdResourceType?: string; notes?: string; error?: string } | null = null;
  if (postAction) {
    try {
      postActionResult = await postAction({
        job: effectiveJob,
        db: c.env.DB,
        lineAccountId,
        workerUrl: c.env.WORKER_URL,
      });
      if (postActionResult.ok) {
        // post-action 成功なら status='completed' に進める
        await markJobCompleted(c.env.DB, id);
      }
    } catch (e) {
      postActionResult = { ok: false, error: e instanceof Error ? e.message : 'post-action failed' };
      console.error(`[agent-jobs] post-action failed for ${id}:`, e);
    }
  }

  return c.json({ success: true, postAction: postActionResult });
});

agentJobs.post('/api/agent-jobs/:id/reject', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const staff = c.get('staff');
  if (!staff) {
    return c.json({ success: false, error: 'Auth required' }, 401);
  }
  const id = c.req.param('id');
  const job = await getAgentJob(c.env.DB, id);
  if (!job || job.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const body = await c.req.json<{ notes?: string }>().catch(() => ({} as { notes?: string }));
  await rejectJob(c.env.DB, id, staffIdForFk(staff), body.notes);
  return c.json({ success: true });
});

/**
 * PATCH /api/agent-jobs/:id/output
 *
 * review 状態のジョブの出力（output_json）を編集する。
 * body は output_json として上書きする任意のオブジェクト。
 * 例: { title: "新タイトル", content: "新文章" }
 * 例: { messages: [{ display_name, message }, ...] }
 */
agentJobs.patch('/api/agent-jobs/:id/output', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const job = await getAgentJob(c.env.DB, id);
  if (!job || job.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  if (job.status !== 'review') {
    return c.json({ success: false, error: '編集できるのは review 状態のジョブのみです' }, 400);
  }
  const body = await c.req.json<Record<string, unknown>>();
  if (!body || typeof body !== 'object') {
    return c.json({ success: false, error: 'invalid body' }, 400);
  }
  await updateAgentJobOutput(c.env.DB, id, lineAccountId, body);
  const updated = await getAgentJob(c.env.DB, id);
  return c.json({ success: true, job: updated });
});

agentJobs.post('/api/agent-jobs/:id/cancel', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const id = c.req.param('id');
  const job = await getAgentJob(c.env.DB, id);
  if (!job || job.line_account_id !== lineAccountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await cancelJob(c.env.DB, id);
  return c.json({ success: true });
});

agentJobs.post('/api/agent-jobs/executor/tick', async (c) => {
  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  const result = await runExecutorTick(c.env.DB, apiKey, undefined, { bucket: c.env.IMAGES, workerUrl: c.env.WORKER_URL });
  return c.json({ success: true, ...result });
});

// ---------------------------------------------------------------------------
// Automation policy
// ---------------------------------------------------------------------------

agentJobs.get('/api/automation-policy', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const policy = await getAutomationPolicy(c.env.DB, lineAccountId);
  return c.json({ success: true, policy });
});

agentJobs.put('/api/automation-policy', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req.json<{
    plan_tier?: 'starter' | 'pro' | 'enterprise';
    monthly_broadcast_count?: number;
    automation_level?: AutomationLevel;
    job_overrides?: Record<string, 'auto' | 'review'>;
    notification_channel?: string;
    notification_target?: string;
  }>();
  await upsertAutomationPolicy(c.env.DB, {
    lineAccountId,
    planTier: body.plan_tier,
    monthlyBroadcastCount: body.monthly_broadcast_count,
    automationLevel: body.automation_level,
    jobOverrides: body.job_overrides,
    notificationChannel: body.notification_channel,
    notificationTarget: body.notification_target,
  });
  const policy = await getAutomationPolicy(c.env.DB, lineAccountId);
  return c.json({ success: true, policy });
});

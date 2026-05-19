/**
 * AI ジョブキュー（agent_jobs）と自動化ポリシー（tenant_automation_policy）
 * のクエリヘルパー。
 *
 * agent_jobs は KPI 駆動エンジンの中核キュー。
 * pending → running → review → approved/rejected → completed/failed
 */

import { jstNow } from './utils.js';

export type AgentJobStatus =
  | 'pending'
  | 'running'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentJobOrigin = 'kpi_planner' | 'manual' | 'automation' | 'cron' | 'webhook';

export interface AgentJobRow {
  id: string;
  line_account_id: string;
  job_type: string;
  input_json: string;
  origin: AgentJobOrigin;
  related_kpi_id: string | null;
  status: AgentJobStatus;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  output_json: string | null;
  cost_yen_x100: number;
  retries: number;
  max_retries: number;
  error: string | null;
  reviewer_id: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createAgentJob(
  db: D1Database,
  input: {
    lineAccountId: string;
    jobType: string;
    input?: Record<string, unknown>;
    origin: AgentJobOrigin;
    relatedKpiId?: string | null;
    scheduledAt?: string;
    maxRetries?: number;
  },
): Promise<AgentJobRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO agent_jobs (
         id, line_account_id, job_type, input_json, origin, related_kpi_id,
         status, scheduled_at, max_retries, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.jobType,
      JSON.stringify(input.input ?? {}),
      input.origin,
      input.relatedKpiId ?? null,
      input.scheduledAt ?? now,
      input.maxRetries ?? 3,
      now,
    )
    .run();
  return (await getAgentJob(db, id))!;
}

export async function getAgentJob(db: D1Database, id: string): Promise<AgentJobRow | null> {
  return db.prepare(`SELECT * FROM agent_jobs WHERE id = ?`).bind(id).first<AgentJobRow>();
}

export async function listAgentJobs(
  db: D1Database,
  lineAccountId: string,
  filters: { status?: AgentJobStatus; jobType?: string; limit?: number } = {},
): Promise<AgentJobRow[]> {
  const conditions = ['line_account_id = ?'];
  const values: unknown[] = [lineAccountId];
  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }
  if (filters.jobType) {
    conditions.push('job_type = ?');
    values.push(filters.jobType);
  }
  const limit = Math.min(filters.limit ?? 100, 500);
  const sql = `SELECT * FROM agent_jobs WHERE ${conditions.join(' AND ')}
               ORDER BY scheduled_at DESC, created_at DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...values, limit).all<AgentJobRow>();
  return result.results;
}

/** cron が次に実行すべきジョブを取得（FIFO、scheduled_at <= now） */
export async function pickPendingJobs(
  db: D1Database,
  limit = 5,
): Promise<AgentJobRow[]> {
  const now = jstNow();
  const result = await db
    .prepare(
      `SELECT * FROM agent_jobs
       WHERE status = 'pending' AND scheduled_at <= ?
       ORDER BY scheduled_at ASC LIMIT ?`,
    )
    .bind(now, limit)
    .all<AgentJobRow>();
  return result.results;
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

export async function markJobRunning(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE agent_jobs SET status = 'running', started_at = ? WHERE id = ?`)
    .bind(jstNow(), id)
    .run();
}

export async function markJobReview(
  db: D1Database,
  id: string,
  output: Record<string, unknown>,
  costYenX100: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_jobs SET status = 'review', output_json = ?, cost_yen_x100 = ?, completed_at = ? WHERE id = ?`,
    )
    .bind(JSON.stringify(output), costYenX100, jstNow(), id)
    .run();
}

/**
 * review 状態のジョブの output_json を編集する
 * （承認前に内容を修正したいときに使用）
 */
export async function updateAgentJobOutput(
  db: D1Database,
  id: string,
  lineAccountId: string,
  output: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_jobs SET output_json = ? WHERE id = ? AND line_account_id = ? AND status = 'review'`,
    )
    .bind(JSON.stringify(output), id, lineAccountId)
    .run();
}

export async function markJobCompleted(
  db: D1Database,
  id: string,
  output?: Record<string, unknown>,
  costYenX100 = 0,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_jobs SET status = 'completed', output_json = ?, cost_yen_x100 = ?, completed_at = ? WHERE id = ?`,
    )
    .bind(output ? JSON.stringify(output) : null, costYenX100, jstNow(), id)
    .run();
}

export async function markJobFailed(
  db: D1Database,
  id: string,
  error: string,
): Promise<void> {
  // retries++、max_retries 未到達なら pending に戻す
  const job = await getAgentJob(db, id);
  if (!job) return;
  const newRetries = job.retries + 1;
  if (newRetries < job.max_retries) {
    // 指数バックオフ（5 分 → 25 分 → 125 分）
    const backoffMs = Math.pow(5, newRetries) * 60 * 1000;
    const nextAt = new Date(Date.now() + backoffMs).toISOString();
    await db
      .prepare(
        `UPDATE agent_jobs SET status = 'pending', retries = ?, error = ?, scheduled_at = ? WHERE id = ?`,
      )
      .bind(newRetries, error, nextAt, id)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE agent_jobs SET status = 'failed', retries = ?, error = ?, completed_at = ? WHERE id = ?`,
      )
      .bind(newRetries, error, jstNow(), id)
      .run();
  }
}

export async function approveJob(
  db: D1Database,
  id: string,
  reviewerId: string | null,
  notes?: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_jobs SET status = 'approved', reviewer_id = ?, reviewed_at = ?, notes = ? WHERE id = ?`,
    )
    .bind(reviewerId, jstNow(), notes ?? null, id)
    .run();
}

export async function rejectJob(
  db: D1Database,
  id: string,
  reviewerId: string | null,
  notes?: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_jobs SET status = 'rejected', reviewer_id = ?, reviewed_at = ?, notes = ? WHERE id = ?`,
    )
    .bind(reviewerId, jstNow(), notes ?? null, id)
    .run();
}

export async function cancelJob(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE agent_jobs SET status = 'cancelled', completed_at = ? WHERE id = ?`)
    .bind(jstNow(), id)
    .run();
}

// ---------------------------------------------------------------------------
// tenant_automation_policy
// ---------------------------------------------------------------------------

export type AutomationLevel = 'careful' | 'standard' | 'aggressive';
export type PlanTier = 'starter' | 'pro' | 'enterprise';

export interface TenantAutomationPolicyRow {
  line_account_id: string;
  plan_tier: PlanTier;
  monthly_broadcast_count: number;
  automation_level: AutomationLevel;
  job_overrides_json: string | null;
  notification_channel: string | null;
  notification_target: string | null;
  updated_at: string;
}

export async function getAutomationPolicy(
  db: D1Database,
  lineAccountId: string,
): Promise<TenantAutomationPolicyRow | null> {
  return db
    .prepare(`SELECT * FROM tenant_automation_policy WHERE line_account_id = ?`)
    .bind(lineAccountId)
    .first<TenantAutomationPolicyRow>();
}

export async function upsertAutomationPolicy(
  db: D1Database,
  input: {
    lineAccountId: string;
    planTier?: PlanTier;
    monthlyBroadcastCount?: number;
    automationLevel?: AutomationLevel;
    jobOverrides?: Record<string, 'auto' | 'review'>;
    notificationChannel?: string;
    notificationTarget?: string;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO tenant_automation_policy (
         line_account_id, plan_tier, monthly_broadcast_count, automation_level,
         job_overrides_json, notification_channel, notification_target, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(line_account_id) DO UPDATE SET
         plan_tier = COALESCE(excluded.plan_tier, tenant_automation_policy.plan_tier),
         monthly_broadcast_count = COALESCE(excluded.monthly_broadcast_count, tenant_automation_policy.monthly_broadcast_count),
         automation_level = COALESCE(excluded.automation_level, tenant_automation_policy.automation_level),
         job_overrides_json = COALESCE(excluded.job_overrides_json, tenant_automation_policy.job_overrides_json),
         notification_channel = COALESCE(excluded.notification_channel, tenant_automation_policy.notification_channel),
         notification_target = COALESCE(excluded.notification_target, tenant_automation_policy.notification_target),
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.lineAccountId,
      input.planTier ?? 'starter',
      input.monthlyBroadcastCount ?? 4,
      input.automationLevel ?? 'careful',
      input.jobOverrides ? JSON.stringify(input.jobOverrides) : null,
      input.notificationChannel ?? null,
      input.notificationTarget ?? null,
      now,
    )
    .run();
}

/**
 * ジョブ種別ごとに「自動公開して良いか」を判定。
 * デフォルトはレビュー必須、policy で個別 override 可能。
 */
export function shouldAutoApprove(
  policy: TenantAutomationPolicyRow | null,
  jobType: string,
): boolean {
  if (!policy) return false;
  // 個別 override が最優先
  if (policy.job_overrides_json) {
    try {
      const overrides = JSON.parse(policy.job_overrides_json) as Record<string, 'auto' | 'review'>;
      if (overrides[jobType] === 'auto') return true;
      if (overrides[jobType] === 'review') return false;
    } catch {
      /* ignore */
    }
  }
  // automation_level によるデフォルト
  const SAFE_AUTO_BY_DEFAULT = new Set([
    'generate_monthly_report',
    'generate_weekly_report',
    'tag_auto_assign',
    'hot_lead_notify',
    'analyze_chat_sentiment',
    'analyze_funnel',
    'kpi_progress_check',
  ]);
  if (SAFE_AUTO_BY_DEFAULT.has(jobType)) return true;
  if (policy.automation_level === 'aggressive') return true;
  return false;
}

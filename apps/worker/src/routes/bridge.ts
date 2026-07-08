/**
 * 司令室ダッシュボード（Bridge）API
 *
 * L-port を「AIエージェント組織」として俯瞰するための、全テナント横断の集計エンドポイント。
 * 運用チームの owner / admin のみアクセス可。
 *
 * GET /api/bridge/overview    部署別の稼働サマリ（running/pending/review/本日完了/本日コスト/最終アクション）
 * GET /api/bridge/approvals   全部署横断の承認待ち（review）キュー
 * GET /api/bridge/activity    直近のジョブ活動フィード（今何をやっているか）
 * GET /api/bridge/cost        本日 / 当月のコスト集計
 *
 * 部署（department）は agent_jobs に列を持たせず、job_type から TS 側で畳む
 * （departmentForJobType）。既存ジョブの enqueue ホットパスを変更しないための設計。
 */

import { Hono } from 'hono';
import {
  departmentForJobType,
  ALL_DEPARTMENTS,
  DEPARTMENT_LABELS,
  type Department,
} from '../services/agents/departments.js';
import type { Env } from '../index.js';

export const bridge = new Hono<Env>();

/** owner / admin のみ許可。staff は 403。 */
bridge.use('/api/bridge/*', async (c, next) => {
  const staff = c.get('staff');
  if (!staff || (staff.role !== 'owner' && staff.role !== 'admin')) {
    return c.json({ success: false, error: 'forbidden' }, 403);
  }
  await next();
});

interface JobTypeAgg {
  job_type: string;
  running: number;
  pending: number;
  review: number;
  completed_today: number;
  cost_today: number;
  last_action: string | null;
}

interface DepartmentSummary {
  department: Department;
  label: string;
  running: number;
  pending: number;
  review: number;
  completed_today: number;
  cost_yen_today: number;
  last_action: string | null;
}

bridge.get('/api/bridge/overview', async (c) => {
  const res = await c.env.DB
    .prepare(
      `SELECT
         job_type,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review,
         SUM(CASE WHEN status = 'completed'
                   AND substr(COALESCE(completed_at, created_at), 1, 10)
                       = strftime('%Y-%m-%d', 'now', '+9 hours')
              THEN 1 ELSE 0 END) AS completed_today,
         SUM(CASE WHEN substr(COALESCE(completed_at, created_at), 1, 10)
                       = strftime('%Y-%m-%d', 'now', '+9 hours')
              THEN cost_yen_x100 ELSE 0 END) AS cost_today,
         MAX(COALESCE(completed_at, started_at, created_at)) AS last_action
       FROM agent_jobs
       GROUP BY job_type`,
    )
    .all<JobTypeAgg>();

  // 部署ごとに初期化
  const byDept = new Map<Department, DepartmentSummary>();
  for (const dept of ALL_DEPARTMENTS) {
    byDept.set(dept, {
      department: dept,
      label: DEPARTMENT_LABELS[dept],
      running: 0,
      pending: 0,
      review: 0,
      completed_today: 0,
      cost_yen_today: 0,
      last_action: null,
    });
  }

  for (const row of res.results ?? []) {
    const dept = departmentForJobType(row.job_type);
    const s = byDept.get(dept)!;
    s.running += row.running ?? 0;
    s.pending += row.pending ?? 0;
    s.review += row.review ?? 0;
    s.completed_today += row.completed_today ?? 0;
    s.cost_yen_today += Math.round((row.cost_today ?? 0) / 100);
    if (row.last_action && (!s.last_action || row.last_action > s.last_action)) {
      s.last_action = row.last_action;
    }
  }

  // 何か動きのある部署を上に、空の部署は下に
  const departments = ALL_DEPARTMENTS.map((d) => byDept.get(d)!).filter(
    (s) =>
      s.running + s.pending + s.review + s.completed_today > 0 || s.last_action !== null,
  );

  return c.json({ success: true, departments });
});

bridge.get('/api/bridge/approvals', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const res = await c.env.DB
    .prepare(
      `SELECT id, line_account_id, job_type, output_json, cost_yen_x100, created_at, completed_at
       FROM agent_jobs
       WHERE status = 'review'
       ORDER BY COALESCE(completed_at, created_at) DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      line_account_id: string;
      job_type: string;
      output_json: string | null;
      cost_yen_x100: number;
      created_at: string;
      completed_at: string | null;
    }>();

  const items = (res.results ?? []).map((r) => ({
    id: r.id,
    line_account_id: r.line_account_id,
    job_type: r.job_type,
    department: departmentForJobType(r.job_type),
    department_label: DEPARTMENT_LABELS[departmentForJobType(r.job_type)],
    cost_yen: Math.round((r.cost_yen_x100 ?? 0) / 100),
    queued_at: r.completed_at ?? r.created_at,
  }));

  return c.json({ success: true, count: items.length, items });
});

bridge.get('/api/bridge/activity', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10), 100);
  const res = await c.env.DB
    .prepare(
      `SELECT id, line_account_id, job_type, status, origin,
              COALESCE(completed_at, started_at, created_at) AS at
       FROM agent_jobs
       ORDER BY COALESCE(completed_at, started_at, created_at) DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      line_account_id: string;
      job_type: string;
      status: string;
      origin: string;
      at: string;
    }>();

  const items = (res.results ?? []).map((r) => ({
    id: r.id,
    line_account_id: r.line_account_id,
    job_type: r.job_type,
    department: departmentForJobType(r.job_type),
    department_label: DEPARTMENT_LABELS[departmentForJobType(r.job_type)],
    status: r.status,
    origin: r.origin,
    at: r.at,
  }));

  return c.json({ success: true, items });
});

bridge.get('/api/bridge/cost', async (c) => {
  // ai_usage_log を権威ソースとして、本日 / 当月の AI コストを集計（全テナント横断）
  const usage = await c.env.DB
    .prepare(
      `SELECT
         SUM(CASE WHEN substr(created_at, 1, 10)
                       = strftime('%Y-%m-%d', 'now', '+9 hours')
              THEN cost_yen_x100 ELSE 0 END) AS today,
         SUM(CASE WHEN substr(created_at, 1, 7)
                       = strftime('%Y-%m', 'now', '+9 hours')
              THEN cost_yen_x100 ELSE 0 END) AS month
       FROM ai_usage_log`,
    )
    .first<{ today: number | null; month: number | null }>();

  // テナント計量の月次予算キャップ合計（設定がある分のみ）
  const cap = await c.env.DB
    .prepare(
      `SELECT SUM(COALESCE(monthly_budget_cap_yen, 0)) AS cap_yen
       FROM tenant_metering
       WHERE monthly_budget_cap_yen IS NOT NULL`,
    )
    .first<{ cap_yen: number | null }>();

  return c.json({
    success: true,
    cost: {
      today_yen: Math.round((usage?.today ?? 0) / 100),
      month_yen: Math.round((usage?.month ?? 0) / 100),
      month_budget_cap_yen: cap?.cap_yen ?? null,
    },
  });
});

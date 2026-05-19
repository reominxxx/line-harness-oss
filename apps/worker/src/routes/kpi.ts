/**
 * KPI 目標 API routes
 *
 * GET    /api/kpi                  全 KPI 一覧（指定月 or 全期間）
 * GET    /api/kpi/:metric           指定 metric の現状
 * PUT    /api/kpi                  KPI 目標を upsert
 * DELETE /api/kpi/:id               KPI 削除
 * POST   /api/kpi/plan              手動でプランナーを起動（テスト用）
 */

import { Hono } from 'hono';
import {
  listKpiGoals,
  getKpiGoal,
  upsertKpiGoal,
  deleteKpiGoal,
  KPI_METRICS,
  type KpiMetric,
} from '@line-crm/db';
import { planForTenant } from '../services/agents/kpi-planner.js';
import { staffIdForFk } from '../lib/staff-fk.js';
import type { Env } from '../index.js';

export const kpi = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

kpi.get('/api/kpi', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const yearMonth = c.req.query('year_month');
  const goals = await listKpiGoals(c.env.DB, lineAccountId, yearMonth);
  return c.json({ success: true, goals, metrics: KPI_METRICS });
});

kpi.get('/api/kpi/:metric', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const metric = c.req.param('metric');
  if (!KPI_METRICS.includes(metric as KpiMetric)) {
    return c.json({ success: false, error: 'Invalid metric' }, 400);
  }
  const yearMonth = c.req.query('year_month') ?? new Date().toISOString().slice(0, 7);
  const goal = await getKpiGoal(c.env.DB, lineAccountId, yearMonth, metric as KpiMetric);
  return c.json({ success: true, goal });
});

kpi.put('/api/kpi', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const staff = c.get('staff');
  const body = await c.req.json<{
    year_month: string;
    metric: KpiMetric;
    target_value: number;
    notes?: string;
  }>();
  if (!body.year_month || !body.metric) {
    return c.json({ success: false, error: 'year_month and metric required' }, 400);
  }
  if (!KPI_METRICS.includes(body.metric)) {
    return c.json({ success: false, error: 'Invalid metric' }, 400);
  }
  if (typeof body.target_value !== 'number' || body.target_value < 0) {
    return c.json({ success: false, error: 'target_value must be a non-negative number' }, 400);
  }
  const goal = await upsertKpiGoal(c.env.DB, {
    lineAccountId,
    yearMonth: body.year_month,
    metric: body.metric,
    targetValue: body.target_value,
    notes: body.notes,
    createdBy: staffIdForFk(staff) ?? undefined,
  });
  return c.json({ success: true, goal });
});

kpi.delete('/api/kpi/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  await deleteKpiGoal(c.env.DB, c.req.param('id'), lineAccountId);
  return c.json({ success: true });
});

/** 手動でプランナーを起動（テスト/即実行用） */
kpi.post('/api/kpi/plan', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req.json<{ year_month?: string }>().catch(() => ({} as { year_month?: string }));
  const yearMonth = body.year_month ?? new Date().toISOString().slice(0, 7);
  const result = await planForTenant(c.env.DB, lineAccountId, yearMonth);
  return c.json({ success: true, ...result, year_month: yearMonth });
});

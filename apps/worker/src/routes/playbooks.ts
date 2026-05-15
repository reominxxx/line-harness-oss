/**
 * 業界プレイブック API
 *
 * GET    /api/playbooks                      利用可能なプレイブック一覧
 * GET    /api/playbooks/:key                 詳細プレビュー
 * POST   /api/playbooks/:key/apply           テナントに適用
 */

import { Hono } from 'hono';
import { listPlaybooks, getPlaybook } from '../services/playbooks/registry.js';
import { applyPlaybook } from '../services/playbooks/apply.js';
import type { Env } from '../index.js';

export const playbooks = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

playbooks.get('/api/playbooks', async (c) => {
  const items = listPlaybooks().map((p) => ({
    key: p.key,
    label: p.label,
    emoji: p.emoji,
    description: p.description,
    promptModuleCount: p.promptModules.length,
    kpiCount: p.kpis.length,
    scenarioCount: p.scenarios.length,
  }));
  return c.json({ success: true, playbooks: items });
});

playbooks.get('/api/playbooks/:key', async (c) => {
  const key = c.req.param('key');
  const playbook = getPlaybook(key);
  if (!playbook) {
    return c.json({ success: false, error: 'Playbook not found' }, 404);
  }
  return c.json({ success: true, playbook });
});

playbooks.post('/api/playbooks/:key/apply', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const key = c.req.param('key');
  const playbook = getPlaybook(key);
  if (!playbook) {
    return c.json({ success: false, error: 'Playbook not found' }, 404);
  }
  const body = await c.req.json<{ year_month?: string; overwrite_kpi?: boolean }>().catch(() => ({} as { year_month?: string; overwrite_kpi?: boolean }));

  try {
    const result = await applyPlaybook(c.env.DB, lineAccountId, playbook, {
      yearMonth: body.year_month,
      overwriteKpi: body.overwrite_kpi,
    });
    return c.json({ success: true, playbook: { key: playbook.key, label: playbook.label }, ...result });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'apply failed' }, 500);
  }
});

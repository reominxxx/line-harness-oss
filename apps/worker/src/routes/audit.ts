/**
 * 監査ログ API
 */

import { Hono } from 'hono';
import { listAuditLogs, type AuditResult } from '@line-crm/db';
import type { Env } from '../index.js';

export const audit = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

audit.get('/api/audit-log', async (c) => {
  const lineAccountId = getLineAccountId(c);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);
  const result = c.req.query('result') as AuditResult | undefined;
  const resourceType = c.req.query('resource_type');
  const staffId = c.req.query('staff_id');

  const logs = await listAuditLogs(c.env.DB, {
    lineAccountId: lineAccountId ?? undefined,
    result,
    resourceType,
    staffId,
    limit,
  });
  return c.json({ success: true, logs });
});

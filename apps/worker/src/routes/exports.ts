/**
 * データエクスポート API
 *
 * 解約・引き継ぎ対応のため、顧客が自社データを CSV / JSON で一括取得できる。
 *
 * GET /api/exports/:type
 *   type: friends | tags | broadcasts | scenarios | kb | chats
 *   返却形式: CSV（friends, tags, broadcasts, chats）or JSON（scenarios, kb）
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const exportsRoute = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Array<Record<string, unknown>>, headers?: string[]): string {
  if (rows.length === 0) {
    return headers ? headers.join(',') + '\n' : '';
  }
  const cols = headers ?? Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => csvEscape(r[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

function csvResponse(c: { newResponse: (body: string, init?: ResponseInit) => Response }, csv: string, filename: string): Response {
  return c.newResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  }) as Response;
}

exportsRoute.get('/api/exports/friends', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);

  const res = await c.env.DB
    .prepare(
      `SELECT id, line_user_id, display_name, picture_url, status, created_at, updated_at
       FROM friends WHERE line_account_id = ? ORDER BY created_at DESC`,
    )
    .bind(accountId)
    .all();

  const csv = toCsv(res.results as unknown as Array<Record<string, unknown>>, [
    'id', 'line_user_id', 'display_name', 'picture_url', 'status', 'created_at', 'updated_at',
  ]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="friends-${accountId.slice(0, 8)}-${Date.now()}.csv"`,
    },
  });
});

exportsRoute.get('/api/exports/tags', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);

  const res = await c.env.DB
    .prepare(`SELECT id, name, color, created_at FROM tags WHERE line_account_id = ? ORDER BY name`)
    .bind(accountId)
    .all();

  const csv = toCsv(res.results as unknown as Array<Record<string, unknown>>, ['id', 'name', 'color', 'created_at']);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tags-${Date.now()}.csv"`,
    },
  });
});

exportsRoute.get('/api/exports/broadcasts', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);

  const res = await c.env.DB
    .prepare(
      `SELECT id, title, message_type, message_content, target_type, status,
              scheduled_at, sent_at, created_at
       FROM broadcasts WHERE line_account_id = ? ORDER BY created_at DESC`,
    )
    .bind(accountId)
    .all();

  const csv = toCsv(res.results as unknown as Array<Record<string, unknown>>, [
    'id', 'title', 'message_type', 'message_content', 'target_type', 'status',
    'scheduled_at', 'sent_at', 'created_at',
  ]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="broadcasts-${Date.now()}.csv"`,
    },
  });
});

exportsRoute.get('/api/exports/chats', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);

  const res = await c.env.DB
    .prepare(
      `SELECT id, friend_id, operator_id, status, notes, last_message_at, created_at, updated_at
       FROM chats WHERE line_account_id = ? ORDER BY last_message_at DESC NULLS LAST`,
    )
    .bind(accountId)
    .all();

  const csv = toCsv(res.results as unknown as Array<Record<string, unknown>>, [
    'id', 'friend_id', 'operator_id', 'status', 'notes', 'last_message_at', 'created_at', 'updated_at',
  ]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="chats-${Date.now()}.csv"`,
    },
  });
});

exportsRoute.get('/api/exports/scenarios', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);

  const scenarios = await c.env.DB
    .prepare(
      `SELECT id, name, description, trigger_type, status, created_at FROM scenarios
       WHERE line_account_id = ? ORDER BY created_at DESC`,
    )
    .bind(accountId)
    .all();

  // 各シナリオのステップも取得
  const result = [];
  for (const s of scenarios.results as Array<{ id: string }>) {
    const steps = await c.env.DB
      .prepare(
        `SELECT id, step_index, name, delay_minutes, message_content, message_type
         FROM scenario_steps WHERE scenario_id = ? ORDER BY step_index`,
      )
      .bind(s.id)
      .all();
    result.push({ ...s, steps: steps.results });
  }

  return new Response(JSON.stringify({ exported_at: new Date().toISOString(), scenarios: result }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="scenarios-${Date.now()}.json"`,
    },
  });
});

exportsRoute.get('/api/exports/kb', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);

  const res = await c.env.DB
    .prepare(
      `SELECT id, source_type, title, content, source_url, created_at, updated_at
       FROM kb_documents WHERE line_account_id = ? ORDER BY source_type, title`,
    )
    .bind(accountId)
    .all();

  return new Response(JSON.stringify({ exported_at: new Date().toISOString(), documents: res.results }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="kb-${Date.now()}.json"`,
    },
  });
});

exportsRoute.get('/api/exports/manifest', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id required' }, 400);

  const [friends, tags, broadcasts, chats, scenarios, kb] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM friends WHERE line_account_id = ?`).bind(accountId).first<{ c: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM tags WHERE line_account_id = ?`).bind(accountId).first<{ c: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM broadcasts WHERE line_account_id = ?`).bind(accountId).first<{ c: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM chats WHERE line_account_id = ?`).bind(accountId).first<{ c: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM scenarios WHERE line_account_id = ?`).bind(accountId).first<{ c: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM kb_documents WHERE line_account_id = ?`).bind(accountId).first<{ c: number }>(),
  ]);

  return c.json({
    success: true,
    counts: {
      friends: friends?.c ?? 0,
      tags: tags?.c ?? 0,
      broadcasts: broadcasts?.c ?? 0,
      chats: chats?.c ?? 0,
      scenarios: scenarios?.c ?? 0,
      kb_documents: kb?.c ?? 0,
    },
    exports: [
      { type: 'friends', format: 'csv', path: '/api/exports/friends' },
      { type: 'tags', format: 'csv', path: '/api/exports/tags' },
      { type: 'broadcasts', format: 'csv', path: '/api/exports/broadcasts' },
      { type: 'chats', format: 'csv', path: '/api/exports/chats' },
      { type: 'scenarios', format: 'json', path: '/api/exports/scenarios' },
      { type: 'kb', format: 'json', path: '/api/exports/kb' },
    ],
  });
});

/**
 * ヒアリング → 運用設計書 (Blueprint) API。
 *
 * フロー:
 *   1. POST /api/hearings: 文字起こし + CSV + タイトル + 月配信本数 で作成 (status=draft)
 *   2. POST /api/hearings/:id/generate: AI で Blueprint 生成 (status=generating → ready)
 *      長時間処理は waitUntil でバックグラウンドに逃がし、即時に generating で返す。
 *   3. GET /api/hearings: 一覧
 *   4. GET /api/hearings/:id: 詳細 (blueprint_json をパースして返す)
 *   5. DELETE /api/hearings/:id: 削除
 */
import { Hono } from 'hono';
import {
  createHearing,
  deleteHearing,
  getHearing,
  listHearings,
  setHearingPending,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const hearings = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

hearings.get('/api/hearings', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const rows = await listHearings(c.env.DB, lineAccountId);
  return c.json({ success: true, hearings: rows });
});

hearings.get('/api/hearings/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const row = await getHearing(c.env.DB, c.req.param('id'), lineAccountId);
  if (!row) return c.json({ success: false, error: 'Not found' }, 404);
  let blueprint: unknown = null;
  if (row.blueprint_json) {
    try {
      blueprint = JSON.parse(row.blueprint_json);
    } catch {
      blueprint = null;
    }
  }
  return c.json({ success: true, hearing: row, blueprint });
});

hearings.post('/api/hearings', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const body = (await c.req.json().catch(() => null)) as {
    title?: string;
    transcript_text?: string | null;
    csv_text?: string | null;
    csv_filename?: string | null;
  } | null;
  if (!body || !body.title?.trim()) {
    return c.json({ success: false, error: 'title is required' }, 400);
  }
  const row = await createHearing(c.env.DB, {
    lineAccountId,
    title: body.title.trim(),
    transcriptText: body.transcript_text ?? null,
    csvText: body.csv_text ?? null,
    csvFilename: body.csv_filename ?? null,
  });
  return c.json({ success: true, hearing: row });
});

hearings.post('/api/hearings/:id/generate', async (c) => {
  // ⚠ 注意: waitUntil で Claude を呼び出すパターンは Cloudflare Workers Bundled tier
  // の 30 秒上限で中断され、status='generating' のまま固まる事故が頻発した。
  // 代わりに status='pending' にしてから返し、cron (*/5 min) で processPendingHearings が
  // 実際の Claude 呼び出しを行う設計に変更。ユーザーは最大 1 分待つだけ。
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const id = c.req.param('id');
  const row = await getHearing(c.env.DB, id, lineAccountId);
  if (!row) return c.json({ success: false, error: 'Not found' }, 404);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);
  if (!row.transcript_text && !row.csv_text) {
    return c.json({ success: false, error: '文字起こしまたは CSV のどちらかが必要です' }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as { monthly_broadcast_count?: number };
  const monthlyN = Math.max(1, Math.min(30, Math.floor(body.monthly_broadcast_count ?? 4)));

  await setHearingPending(c.env.DB, id, monthlyN);

  // 早期 kick: cron 待たずに即座に 1 件処理を試みる (waitUntil で 30 秒以内に終われば即完成)。
  // 失敗 / タイムアウトした場合は status を pending に戻し、cron が拾い直す。
  try {
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const { processPendingHearings } = await import('../services/hearings/process-pending.js');
          await processPendingHearings(c.env);
        } catch (err) {
          console.error('[hearings] early-kick failed (cron will retry)', err);
        }
      })(),
    );
  } catch { /* ignore - cron will pick it up */ }

  return c.json({ success: true, status: 'pending', monthly_broadcast_count: monthlyN });
});

hearings.delete('/api/hearings/:id', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const ok = await deleteHearing(c.env.DB, c.req.param('id'), lineAccountId);
  if (!ok) return c.json({ success: false, error: 'Not found' }, 404);
  return c.json({ success: true });
});

import { Hono } from 'hono';
import type { Env } from '../index.js';

const cspReports = new Hono<Env>();
const app = cspReports;

// CSP-Report-Only からブラウザが POST してくる違反レポートを受ける。
// 認証なし、CORS 開放(_headers 側で出した CSP の report-uri に指定する)。
// ブラウザは Content-Type: application/csp-report または application/json で送る。
app.post('/api/csp-report', async (c) => {
  try {
    const text = await c.req.text();
    if (!text) return c.body(null, 204);

    let report: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      // 旧形式: { "csp-report": {...} }、新形式: 配列 [{ type:"csp-violation", body:{...} }]
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0] as Record<string, unknown>;
        report = (first.body as Record<string, unknown>) ?? first;
      } else if (parsed['csp-report']) {
        report = parsed['csp-report'] as Record<string, unknown>;
      } else {
        report = parsed;
      }
    } catch {
      report = { raw_text: text.slice(0, 2000) };
    }

    const get = (key: string): unknown => report[key];
    const ua = c.req.header('user-agent')?.slice(0, 500) ?? null;

    await c.env.DB.prepare(
      `INSERT INTO csp_reports (
        id, created_at, document_uri, violated_directive, effective_directive,
        blocked_uri, source_file, line_number, column_number, status_code,
        disposition, user_agent, raw
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        String(get('document-uri') ?? get('documentURL') ?? '').slice(0, 500) || null,
        String(get('violated-directive') ?? get('violatedDirective') ?? '').slice(0, 200) || null,
        String(get('effective-directive') ?? get('effectiveDirective') ?? '').slice(0, 200) || null,
        String(get('blocked-uri') ?? get('blockedURL') ?? '').slice(0, 500) || null,
        String(get('source-file') ?? get('sourceFile') ?? '').slice(0, 500) || null,
        Number(get('line-number') ?? get('lineNumber') ?? 0) || null,
        Number(get('column-number') ?? get('columnNumber') ?? 0) || null,
        Number(get('status-code') ?? get('statusCode') ?? 0) || null,
        String(get('disposition') ?? '').slice(0, 50) || null,
        ua,
        text.slice(0, 4000),
      )
      .run();
    return c.body(null, 204);
  } catch (e) {
    console.error('[csp-report] failed:', e);
    return c.body(null, 204);
  }
});

// 集計確認用(認証必要)。直近 7 日の違反を上位 directive/blocked_uri で集計。
app.get('/api/csp-report/summary', async (c) => {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const rows = await c.env.DB.prepare(
    `SELECT violated_directive, blocked_uri, COUNT(*) AS count
     FROM csp_reports
     WHERE created_at >= ?
     GROUP BY violated_directive, blocked_uri
     ORDER BY count DESC
     LIMIT 100`,
  )
    .bind(since)
    .all();
  return c.json({ success: true, data: rows.results, since });
});

export { cspReports };

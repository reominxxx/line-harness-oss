/**
 * 公開レポート閲覧
 *
 * GET /reports/:line_account_id/:id
 *   R2 に保存された HTML レポートを返す（認証不要、URL さえあれば閲覧可）
 *
 * GET /reports/render/:account/:job_id
 *   agent_jobs.output_json から markdown を取得して、その場で HTML 生成して返す
 *   印刷用 CSS 付き、ブラウザの印刷→ PDF 保存で PDF 化可能
 */

import { Hono } from 'hono';
import { markdownToHtml, buildReportHtml } from '../lib/markdown-to-html.js';
import type { Env } from '../index.js';

export const reports = new Hono<Env>();

reports.get('/reports/:account/:id', async (c) => {
  const account = c.req.param('account');
  const id = c.req.param('id');
  const key = `reports/${account}/${id}.html`;

  try {
    const obj = await c.env.IMAGES.get(key);
    if (!obj) {
      return c.text('Report not found', 404);
    }
    const html = await obj.text();
    return c.html(html);
  } catch (e) {
    console.error('[reports] get failed:', e);
    return c.text('Internal error', 500);
  }
});

reports.get('/reports/render/:account/:jobId', async (c) => {
  const account = c.req.param('account');
  const jobId = c.req.param('jobId');

  try {
    const row = await c.env.DB
      .prepare(
        `SELECT output_json, job_type, completed_at FROM agent_jobs
         WHERE id = ? AND line_account_id = ?
           AND job_type IN ('generate_monthly_report', 'generate_weekly_report')
           AND status = 'completed'`,
      )
      .bind(jobId, account)
      .first<{ output_json: string | null; job_type: string; completed_at: string | null }>();

    if (!row || !row.output_json) {
      return c.text('Report not found', 404);
    }

    const parsed = JSON.parse(row.output_json) as {
      title?: string;
      reportMarkdown?: string;
      yearMonth?: string;
      brandName?: string;
    };

    const markdown = parsed.reportMarkdown ?? '';
    if (!markdown) {
      return c.text('Report content is empty', 404);
    }

    const title = parsed.title
      ?? `${parsed.brandName ?? 'L-アシスト'} ${parsed.yearMonth ?? ''} レポート`.trim();

    const bodyHtml = markdownToHtml(markdown);
    const html = buildReportHtml({ title, bodyHtml });
    return c.html(html);
  } catch (e) {
    console.error('[reports] render failed:', e);
    return c.text('Internal error', 500);
  }
});

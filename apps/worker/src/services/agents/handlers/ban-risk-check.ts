import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 公式アカウントの BAN リスク管理スペシャリストです。
アカウントの健全性ログから、BAN リスクを評価して対策を提示します。

【出力 JSON】
{
  "riskLevel": "low/medium/high/critical",
  "currentIssues": [{ "type": "...", "frequency": N, "impact": "..." }],
  "mitigations": ["対策 1", "対策 2"],
  "preventiveActions": "予防策",
  "shouldMigrate": "アカウント移行を検討すべきかどうか"
}`;

export async function handleBanRiskCheck(ctx: JobContext): Promise<JobResult> {
  let logs: Array<{ event_type: string; severity: string; created_at: string }> = [];
  try {
    const result = await ctx.db
      .prepare(
        `SELECT event_type, severity, created_at
         FROM account_health_logs
         WHERE line_account_id = ?
         ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(ctx.lineAccountId)
      .all<{ event_type: string; severity: string; created_at: string }>();
    logs = result.results;
  } catch {
    /* fallback */
  }

  const summary = logs.length > 0
    ? logs.slice(0, 20).map((l) => `${l.created_at}: [${l.severity}] ${l.event_type}`).join('\n')
    : 'ログなし（健全）';

  return runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-sonnet-4-6',
    system: SYSTEM,
    user: `直近の health log（${logs.length} 件）：\n${summary}\n\nBAN リスク評価と対策を JSON で返してください。`,
    extraOutput: { logsAnalyzed: logs.length },
  });
}

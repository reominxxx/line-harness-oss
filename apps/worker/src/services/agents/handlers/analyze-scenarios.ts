import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE シナリオ全体のヘルスチェック担当です。
複数のシナリオの発火状況・進行率・成果を見渡して、整理 / 改善案を提示します。

【出力 JSON】
{
  "summary": "全シナリオの状況サマリー",
  "wellPerforming": ["うまく回っているシナリオ"],
  "needsAttention": [{ "scenarioName": "...", "issue": "...", "fix": "..." }],
  "duplicateConcerns": "重複や競合してそうなシナリオがあれば",
  "newScenarioSuggestions": ["新規追加すべきシナリオ案"]
}`;

export async function handleAnalyzeScenarios(ctx: JobContext): Promise<JobResult> {
  // シナリオ一覧 + friend_scenarios の集計
  let summaries: Array<{ name: string; active: number; current_count: number }> = [];
  try {
    const result = await ctx.db
      .prepare(
        `SELECT s.name, s.is_active as active, COUNT(fs.id) as current_count
         FROM scenarios s
         LEFT JOIN friend_scenarios fs ON fs.scenario_id = s.id AND fs.status = 'active'
         GROUP BY s.id ORDER BY current_count DESC LIMIT 30`,
      )
      .all<{ name: string; active: number; current_count: number }>();
    summaries = result.results;
  } catch {
    /* fallback */
  }

  const table = summaries.length > 0
    ? summaries.map((s) => `- ${s.name} (${s.active ? 'active' : 'inactive'}): ${s.current_count} 名進行中`).join('\n')
    : 'シナリオなし';

  return runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-sonnet-4-6',
    system: SYSTEM,
    user: `シナリオ一覧：\n${table}\n\n全体を分析して JSON で返してください。`,
    extraOutput: { scenarioCount: summaries.length },
  });
}

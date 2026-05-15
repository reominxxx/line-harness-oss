import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE 友だちセグメント分析のスペシャリストです。
タグ別友だち数、行動傾向、エンゲージメント度から、優先攻略すべきセグメントと施策を提示します。

【出力 JSON】
{
  "topSegments": [
    { "tag": "...", "size": N, "engagement": "high/medium/low", "opportunity": "このセグメントへの推奨施策" }
  ],
  "neglectedSegments": [{ "tag": "...", "issue": "なぜ放置気味か", "recovery": "回復施策" }],
  "newSegmentSuggestions": "新たに切るべきセグメント案",
  "priorityAction": "今すぐやるべき 1 つのアクション"
}`;

export async function handleSegmentFriends(ctx: JobContext): Promise<JobResult> {
  let tagStats: Array<{ name: string; count: number }> = [];
  try {
    const result = await ctx.db
      .prepare(
        `SELECT t.name, COUNT(ft.friend_id) as count
         FROM tags t LEFT JOIN friend_tags ft ON ft.tag_id = t.id
         GROUP BY t.id ORDER BY count DESC LIMIT 20`,
      )
      .all<{ name: string; count: number }>();
    tagStats = result.results;
  } catch {
    /* fallback */
  }

  const table = tagStats.length > 0
    ? tagStats.map((t) => `- ${t.name}: ${t.count} 名`).join('\n')
    : 'タグなし';

  return runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    user: `タグ別友だち数：\n${table}\n\nセグメント分析と推奨施策を JSON で返してください。`,
    extraOutput: { tagsAnalyzed: tagStats.length },
  });
}

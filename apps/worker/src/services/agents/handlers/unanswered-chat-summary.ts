import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは LINE オペレーター業務のアドバイザーです。
未対応チャットの状況を見て、優先順位と対応方針を提示します。

【出力 JSON】
{
  "summary": "未対応の全体状況",
  "urgentCount": 緊急対応必要数,
  "priorities": [
    { "chatId": "...", "friend": "...", "lastMessageAt": "...", "elapsedHours": N, "priority": "urgent/high/medium", "suggestedReply": "推奨返信" }
  ],
  "patterns": "よくある質問パターン",
  "templateSuggestion": "テンプレ化すべき返信文案"
}`;

export async function handleUnansweredChatSummary(ctx: JobContext): Promise<JobResult> {
  let unanswered: Array<{ id: string; status: string; last_message_at: string | null }> = [];
  try {
    const result = await ctx.db
      .prepare(
        `SELECT id, status, last_message_at
         FROM chats
         WHERE status IN ('unread', 'in_progress')
         ORDER BY last_message_at DESC LIMIT 20`,
      )
      .all<{ id: string; status: string; last_message_at: string | null }>();
    unanswered = result.results;
  } catch {
    /* fallback */
  }

  const list = unanswered.length > 0
    ? unanswered.map((c) => `- chat ${c.id.slice(0, 8)} (${c.status}, last: ${c.last_message_at ?? 'unknown'})`).join('\n')
    : '未対応チャットなし';

  return runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    user: `未対応チャット ${unanswered.length} 件：\n${list}\n\n対応優先度と推奨返信を JSON で返してください。`,
    extraOutput: { unansweredCount: unanswered.length },
  });
}

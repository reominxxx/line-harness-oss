import { runAiJob } from './_shared.js';
import type { JobContext, JobResult } from '../types.js';

const SYSTEM = `あなたは顧客感情分析のスペシャリストです。
直近のチャット応対履歴から、顧客満足度の傾向と NPS 改善案を提示します。

【出力 JSON】
{
  "overallSentiment": "positive / neutral / negative の分布と傾向",
  "estimatedNps": 0-10 の推定値,
  "positiveSignals": ["顧客満足の根拠 1", "..."],
  "negativeSignals": ["不満の根拠 1", "..."],
  "improvements": ["接客改善案 1", "..."],
  "promptModuleSuggestions": "AI 人格設定（プロンプトモジュール）の修正提案"
}`;

export async function handleAnalyzeChatSentiment(ctx: JobContext): Promise<JobResult> {
  const input = JSON.parse(ctx.job.input_json || '{}') as { yearMonth?: string };

  // 直近のチャット応対サンプル
  let chatSamples: string[] = [];
  try {
    const result = await ctx.db
      .prepare(
        `SELECT message_text, intent, escalated
         FROM ai_chat_metadata
         WHERE line_account_id = ?
         ORDER BY created_at DESC LIMIT 30`,
      )
      .bind(ctx.lineAccountId)
      .all<{ message_text: string; intent: string; escalated: number }>();
    chatSamples = result.results.map(
      (r) => `[${r.intent}${r.escalated ? '/escalated' : ''}] ${(r.message_text ?? '').slice(0, 100)}`,
    );
  } catch {
    /* fallback */
  }

  return runAiJob(ctx, {
    feature: 'batch_analysis',
    model: 'claude-sonnet-4-6',
    system: SYSTEM,
    user: `直近のチャット応対サンプル（${chatSamples.length} 件）：

${chatSamples.join('\n') || 'データなし'}

感情分析と改善案を JSON で返してください。`,
    extraOutput: { yearMonth: input.yearMonth, sampleCount: chatSamples.length },
  });
}

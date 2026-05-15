/**
 * 配信メッセージ生成 handler
 *
 * KPI Planner から「月 N 本」の枠で呼ばれる。
 * プロンプトモジュール + 過去高成績配信 + KB から自然な配信文を生成。
 * デフォルト: review 必須（顧客に直接届くため）
 */

import { assembleSystemPrompt } from '@line-crm/db';
import { callClaude } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import { buildBroadcastGenPrompt } from '../prompts/broadcast/generate.js';
import type { JobContext, JobResult } from '../types.js';

export async function handleGenerateBroadcast(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as {
    slot?: number;
    ofTotal?: number;
    yearMonth?: string;
    topic?: string;
    targetSegment?: string;
    industry?: string;
  };

  // ブランドシステムプロンプト合成（プロンプトモジュール 8 枠）
  const { systemPrompt: brandSystemPrompt } = await assembleSystemPrompt(db, lineAccountId);

  // 過去 90 日の高開封率配信を参考に
  const examples = await collectSuccessfulBroadcastExamples(db);

  const { system, user } = buildBroadcastGenPrompt({
    brandSystemPrompt,
    topic: input.topic,
    targetSegment: input.targetSegment,
    pastSuccessExamples: examples,
    industry: input.industry,
    slot: input.slot ?? 1,
    ofTotal: input.ofTotal ?? 1,
    yearMonth: input.yearMonth ?? new Date().toISOString().slice(0, 7),
  });

  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 1500,
    temperature: 0.8,
  });

  await recordUsage(db, {
    lineAccountId,
    feature: 'copy_gen',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
  });

  // JSON パース（失敗時はテキストとして扱う）
  let parsed: Record<string, unknown> = { raw: result.text };
  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch (e) {
    console.warn('[generate-broadcast] JSON parse failed, using raw text');
    void e;
  }

  return {
    output: {
      ...parsed,
      yearMonth: input.yearMonth,
      slot: input.slot,
      ofTotal: input.ofTotal,
      generatedAt: new Date().toISOString(),
    },
    costYenX100: result.costYenX100,
    forceStatus: 'review', // 顧客に直接届くものは必ず人間レビュー
  };
}

async function collectSuccessfulBroadcastExamples(db: D1Database): Promise<string[]> {
  try {
    const result = await db
      .prepare(
        `SELECT b.name as title
         FROM broadcasts b
         LEFT JOIN broadcast_insights bi ON bi.broadcast_id = b.id
         WHERE bi.open_rate >= 30
         ORDER BY bi.open_rate DESC LIMIT 3`,
      )
      .all<{ title: string }>();
    return result.results.map((r) => r.title);
  } catch {
    return [];
  }
}

/**
 * 配信メッセージ生成 handler
 *
 * KPI Planner から「月 N 本」の枠で呼ばれる。
 * プロンプトモジュール + 過去高成績配信 + KB から自然な配信文を生成。
 * デフォルト: review 必須（顧客に直接届くため）
 */

import {
  assembleSystemPrompt,
  searchAgencyExamplesForBroadcast,
  type AgencyIndustry,
} from '@line-crm/db';
import { callClaude, type ClaudeSystemBlock } from '../../../lib/claude-client.js';
import { recordUsage } from '../../ai-cost-guard.js';
import {
  buildBroadcastGenPrompt,
  BROADCAST_GEN_SYSTEM_RULES,
} from '../prompts/broadcast/generate.js';
import { buildAgencyPlaybookText } from '../../agency-playbook/index.js';
import type { JobContext, JobResult } from '../types.js';

const VALID_INDUSTRIES = ['beauty', 'chiropractic', 'ecommerce', 'school', 'legal', 'other'] as const;

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

  // ブランドシステムプロンプト合成（プロンプトモジュール 10 枠）
  const { systemPrompt: brandSystemPrompt } = await assembleSystemPrompt(db, lineAccountId);

  // 過去 90 日の高開封率配信を参考に (テナント自身のデータ)
  const examples = await collectSuccessfulBroadcastExamples(db);

  // 全テナント共有の運用代行ノウハウ実例ライブラリから関連例を 3 件取得
  const industryFilter = (VALID_INDUSTRIES as readonly string[]).includes(input.industry ?? '')
    ? (input.industry as AgencyIndustry)
    : undefined;
  const agencyExamples = await searchAgencyExamplesForBroadcast(
    db,
    {
      industry: industryFilter,
      keywords: input.topic ? [input.topic] : [],
    },
    3,
  ).catch(() => []);
  const externalExamples = agencyExamples.map((e) => {
    const head = e.title ? `[${e.title}]` : '[実例]';
    return `${head} ${e.content.slice(0, 200)}`;
  });

  // buildBroadcastGenPrompt は { system, user } を返すが、本ハンドラでは
  // system を 3 ブロックに分解して Anthropic Prompt Caching を効かせる:
  //   [1] 運用代行ノウハウ Markdown ベースライン (内蔵、全テナント共有) ← cache
  //   [2] テナントブランド prompt (テナント単位で半静的) ← cache
  //   [3] 配信生成ルール (固定) ← cache
  // user 部分には今月情報・テーマ・実例を入れる (動的)
  const playbookText = buildAgencyPlaybookText(input.industry);
  const { user } = buildBroadcastGenPrompt({
    brandSystemPrompt,
    topic: input.topic,
    targetSegment: input.targetSegment,
    pastSuccessExamples: [...examples, ...externalExamples],
    industry: input.industry,
    slot: input.slot ?? 1,
    ofTotal: input.ofTotal ?? 1,
    yearMonth: input.yearMonth ?? new Date().toISOString().slice(0, 7),
  });

  const systemBlocks: ClaudeSystemBlock[] = [
    {
      type: 'text',
      text: `【運用代行ノウハウ (全テナント共通ベースライン)】\n\n${playbookText}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `【ブランド設定】\n\n${brandSystemPrompt}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: BROADCAST_GEN_SYSTEM_RULES,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system: systemBlocks,
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

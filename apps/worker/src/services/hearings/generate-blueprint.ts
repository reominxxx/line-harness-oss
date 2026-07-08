import { callClaude } from '../../lib/claude-client.js';
import type { Blueprint } from './blueprint-schema.js';

/**
 * ヒアリング → 月 N 本の配信設計書を生成する (最小スキーマ版)。
 *
 * 設計判断: 旧版は feature_decisions / roadmap / pain_points / scenario_steps など
 * 全てを 1 回の Claude 呼び出しで出力していたが、トークン制約に頻繁にひっかかった。
 * このバージョンは「ユーザーが本当に欲しいもの = 月 N 本の 1 本ごとの設計書」だけに絞る。
 * 他の項目は空配列で返し、UI 側で表示しないだけにする。
 */
export async function generateBlueprint(opts: {
  apiKey: string;
  transcript: string | null;
  csvText: string | null;
  monthlyBroadcastCount: number;
  accountContext?: {
    accountName?: string;
    currentFriendCount?: number;
  };
  onProgress?: (msg: string) => Promise<void> | void;
}): Promise<{ blueprint: Blueprint; costYenX100: number }> {
  const transcript = (opts.transcript ?? '').slice(0, 30_000);
  const csv = (opts.csvText ?? '').slice(0, 20_000);
  const monthlyN = Math.max(1, Math.min(12, Math.floor(opts.monthlyBroadcastCount)));
  if (!transcript && !csv) {
    throw new Error('少なくとも transcript または csvText を指定してください');
  }

  const system = `あなたは LINE 公式アカウント運用のプロです。
事業者のヒアリング内容を読み、月 N 本の配信設計書を 1 本ずつ作ります。

出力ルール:
- broadcast_designs の件数はユーザー指定の本数とちょうど一致させる (絶対厳守)。
- 各配信は重複せず、月内で「価値提供 → 教育 → 売り → リテンション」の流れを設計する。
- send_week は 1-4 で均等にバラけさせる。
- 業界規制 (薬機法 / 景表法 / 医療広告) に注意し、notes に懸念があれば書く。
- summary は 3 文以内で全体方針を簡潔に。
- すべて日本語で。`;

  const sources: string[] = [];
  if (opts.accountContext?.accountName) sources.push(`【アカウント】${opts.accountContext.accountName}`);
  if (opts.accountContext?.currentFriendCount != null) {
    sources.push(`【友だち数】${opts.accountContext.currentFriendCount} 名`);
  }
  if (transcript) sources.push(`【ヒアリング文字起こし】\n${transcript}`);
  if (csv) sources.push(`【ヒアリングシート CSV】\n${csv}`);
  sources.push(`【月の配信本数】${monthlyN} 本/月 — broadcast_designs を必ず ${monthlyN} 件出力`);

  const userText = `${sources.join('\n\n')}

generate_blueprint ツールを 1 回呼び出して、${monthlyN} 本ぶんの配信設計書を作ってください。`;

  const tool = {
    name: 'generate_blueprint',
    description: '月 N 本の LINE 配信設計書を出力する。',
    input_schema: BLUEPRINT_TOOL_INPUT_SCHEMA,
  } as const;

  const MAX_TOKENS = 8_000;
  const TIMEOUT_MS = 90_000;
  console.log('[generate-blueprint] start', { monthlyN, transcriptLen: transcript.length, csvLen: csv.length });
  await opts.onProgress?.(`2/4 Anthropic API へリクエスト送信 (Haiku 4.5, max_tokens=${MAX_TOKENS}, transcript=${transcript.length} 字)`);
  const result = await callClaude({
    apiKey: opts.apiKey,
    model: 'claude-haiku-4-5-20251001',
    system,
    messages: [{ role: 'user', content: userText }],
    tools: [tool],
    toolChoice: { type: 'tool', name: 'generate_blueprint' },
    maxTokens: MAX_TOKENS,
    temperature: 0.3,
    timeoutMs: TIMEOUT_MS,
  });
  console.log('[generate-blueprint] claude returned', {
    stopReason: result.stopReason,
    toolUses: result.toolUses.length,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
  });

  if (result.stopReason === 'max_tokens') {
    throw new Error(`Claude output truncated at max_tokens (${MAX_TOKENS}). 月配信本数を少なめにするか、再試行してください。`);
  }
  const use = result.toolUses[0];
  if (!use || use.name !== 'generate_blueprint') {
    throw new Error(`Claude did not return generate_blueprint tool_use (stop_reason=${result.stopReason})`);
  }
  const blueprint = normalizeBlueprint(use.input, monthlyN);
  return { blueprint, costYenX100: result.costYenX100 };
}

/** Claude 出力 input を Blueprint 形式に整形。最小スキーマ版では多くの field が空配列。 */
function normalizeBlueprint(raw: Record<string, unknown>, monthlyN: number): Blueprint {
  const obj = raw as Partial<Blueprint>;
  return {
    generated_at: new Date().toISOString(),
    version: 1,
    summary: obj.summary ?? '',
    monthly_broadcast_count: monthlyN,
    business_profile: {
      industry: '', business_type: '',
      staff_count: null, hours: null, location: null, customer_segment: null,
      avg_unit_price: null, monthly_visits: null, repeat_rate: null,
      current_friends: null, source_tool: null,
    },
    pain_points: [],
    goals: [],
    feature_decisions: [],
    central_strategy: '',
    coupon_plan: [],
    scenario_steps: [],
    segments: [],
    broadcast_calendar: [],
    broadcast_designs: obj.broadcast_designs ?? [],
    rich_menu_layout: null,
    action_items: [],
    risks: [],
    budget_estimate: null,
    roadmap: [],
  };
}

// 最小スキーマ: summary + broadcast_designs だけ。
// 1 設計あたり ~80-120 トークン × N 本 + summary 100 = N=8 で約 1200 トークン。
// max_tokens=8000 で 12 本でも余裕。
const BLUEPRINT_TOOL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string', description: '全体方針 (3 文以内)' },
    broadcast_designs: {
      type: 'array',
      description: '月内の配信設計。指定本数と必ず一致させること。',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: '1 始まりの通し番号' },
          send_week: { type: 'number', description: '配信週 1-4' },
          send_day_hint: { type: 'string', description: '推奨曜日・時間 (例: 金 19:00)' },
          message_type: {
            type: 'string',
            enum: ['text', 'image_text', 'flex_card', 'card_message', 'coupon', 'video'],
          },
          title: { type: 'string', description: '社内管理用タイトル (簡潔に)' },
          goal: { type: 'string', description: '目的 (1 文)' },
          target_segment: { type: 'string', description: '配信対象 (例: 全員 / 30 代女性)' },
          hook: { type: 'string', description: '冒頭フック (1 文)' },
          body_outline: { type: 'string', description: '本文の骨子 (2-3 文)' },
          cta: { type: 'string', description: 'CTA 文言とリンク先 (簡潔に)' },
          uses_feature: {
            type: 'array',
            items: { type: 'string' },
            description: 'L-port 機能タグ (例: coupon, rich_menu)',
          },
          expected_kpi: { type: 'string', description: '想定 KPI (例: 開封 35%)' },
          notes: { type: 'string', description: '注意事項 (薬機法等、なければ空文字)' },
        },
        required: [
          'index', 'send_week', 'send_day_hint', 'message_type',
          'title', 'goal', 'target_segment', 'hook', 'body_outline', 'cta', 'expected_kpi',
        ],
      },
    },
  },
  required: ['summary', 'broadcast_designs'],
};

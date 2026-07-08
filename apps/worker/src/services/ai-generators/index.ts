/**
 * AI テキスト生成の kind dispatcher。
 *
 * 「+新規作成」UI の各所から「✨ AI で文言を考えさせる」を押された際に呼ばれる。
 * kind ごとに専用 system / user prompt を組み立て、Claude を呼び出して返す。
 *
 * テナント別カスタマイズ:
 *   - 第 1 段 (現在): コード内の build*System / build*User をデフォルトとして使う
 *   - 第 2 段 (将来): D1 テーブル ai_generator_prompts (line_account_id, kind) で
 *     テナント別に system / user template を上書き可能にする。
 */

import {
  assembleSystemPrompt,
  searchAgencyExamplesForBroadcast,
  type AgencyIndustry,
  type AgencyBroadcastType,
} from '@line-crm/db';
import { callClaude, type ClaudeSystemBlock } from '../../lib/claude-client.js';
import { rerank } from '../../lib/reranker.js';
import { buildAgencyPlaybookText } from '../agency-playbook/index.js';
import { NO_MARKDOWN_RULE, COMPLIANCE_RULE, stripMarkdown } from '../ai-shared-prompts.js';
import {
  buildBroadcastSystem,
  buildBroadcastUser,
  type BroadcastGenContext,
} from './prompts/broadcast.js';
import {
  buildScenarioStepSystem,
  buildScenarioStepUser,
  type ScenarioStepGenContext,
} from './prompts/scenario_step.js';
import {
  buildAutoReplySystem,
  buildAutoReplyUser,
  type AutoReplyGenContext,
} from './prompts/auto_reply.js';
import {
  buildFlexSystem,
  buildFlexUser,
  type FlexGenContext,
} from './prompts/flex.js';

export type AiGenerateKind =
  | 'broadcast.text'
  | 'scenario.step_text'
  | 'auto_reply.text'
  | 'broadcast.flex'
  | 'scenario.step_flex'
  | 'auto_reply.flex';

export interface AiGenerateInput {
  kind: AiGenerateKind;
  // kind 固有の context (any 受けて kind 内で型保証)
  context: Record<string, unknown>;
  /** 追加ヒント (ユーザーが「もっと短く」等を渡すケース) */
  hint?: string;
  /** 顧客が「この写真を使って」と添付した画像 (data:image/... base64)。
   *  Claude vision に投げて画像理解付きの生成にする。 */
  imageDataUrl?: string;
  /** 既に生成された変種 (再生成時に同じものを避けるためのヒント) */
  previousVariants?: string[];
}

export interface AiGenerateResult {
  text: string;
  costYenX100: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateAiTextOptions {
  /** Jina Reranker API key。設定されている時のみ実例検索精度が大幅向上 */
  jinaApiKey?: string;
}

export async function generateAiText(
  db: D1Database,
  apiKey: string,
  lineAccountId: string,
  industry: string | undefined,
  input: AiGenerateInput,
  options: GenerateAiTextOptions = {},
): Promise<AiGenerateResult> {
  const { systemPrompt: brandPrompt } = await assembleSystemPrompt(db, lineAccountId);
  const playbookText = buildAgencyPlaybookText(industry);

  // 実例ライブラリ (agency_examples) を必ず裏側で参照。
  // kind とユーザーが入力した context からキーワード / 配信種別 / 時間帯を推測して検索。
  const validIndustries = ['beauty', 'chiropractic', 'ecommerce', 'school', 'legal', 'other'] as const;
  const industryFilter = validIndustries.includes(industry as (typeof validIndustries)[number])
    ? (industry as AgencyIndustry)
    : undefined;
  const broadcastTypeFilter = pickBroadcastTypeFromContext(input);
  const keywords = pickKeywordsFromContext(input);
  // 2 段検索: SQL で 30 件候補 → Jina Reranker で意味的に近い 5 件に絞る
  // (Lost in the Middle 対策で 5 件まで。Reranker 未設定なら先頭から 5 件)
  let examplesText = '';
  try {
    const SQL_CANDIDATE_LIMIT = 30;
    const FINAL_LIMIT = 5;
    const candidates = await searchAgencyExamplesForBroadcast(
      db,
      {
        industry: industryFilter,
        broadcastType: broadcastTypeFilter,
        keywords,
        lineAccountId, // 自テナントの過去配信アーカイブも参照
      },
      SQL_CANDIDATE_LIMIT,
    );

    let picked = candidates.slice(0, FINAL_LIMIT);
    if (candidates.length > FINAL_LIMIT) {
      // Rerank クエリは「ユーザーが今作りたいもの」: title / topic / targetSegment / keywords を結合
      const ctxRecord = input.context as Record<string, unknown>;
      const titleStr = typeof ctxRecord.title === 'string' ? ctxRecord.title : '';
      const topicStr = typeof ctxRecord.topic === 'string' ? ctxRecord.topic : '';
      const segStr = typeof ctxRecord.targetSegment === 'string' ? ctxRecord.targetSegment : '';
      const rerankQuery = [titleStr, topicStr, segStr, input.hint ?? '', keywords.join(' ')]
        .filter((s) => s && s.trim().length > 0)
        .join(' / ')
        .slice(0, 500);
      if (rerankQuery.length > 0) {
        const docs = candidates.map((e) => ({
          id: e.id,
          // タイトル + 本文先頭で意味マッチング (Reranker への入力は 400 字程度が標準)
          text: `${e.title ?? ''}\n${(e.content ?? '').slice(0, 600)}`,
        }));
        const reranked = await rerank(options.jinaApiKey, rerankQuery, docs, FINAL_LIMIT, {
          fallbackLimit: FINAL_LIMIT,
        });
        const idToCandidate = new Map(candidates.map((c) => [c.id, c]));
        picked = reranked
          .map((r) => idToCandidate.get(r.document.id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
      }
    }

    if (picked.length > 0) {
      examplesText = picked
        .map((e, i) => {
          const head = e.title ? `[${e.title}]` : `[実例 ${i + 1}]`;
          return `${head}\n${(e.content ?? '').slice(0, 400)}`;
        })
        .join('\n\n---\n\n');
    }
  } catch (e) {
    console.warn('[ai-generators] example search/rerank failed (non-fatal):', e);
  }

  let systemText: string;
  let userText: string;

  switch (input.kind) {
    case 'broadcast.text': {
      const ctx = input.context as Partial<BroadcastGenContext>;
      systemText = buildBroadcastSystem();
      userText = buildBroadcastUser({
        title: ctx.title,
        hint: input.hint ?? ctx.hint,
        targetSegment: ctx.targetSegment,
        brandPrompt,
        playbookText,
      });
      break;
    }
    case 'scenario.step_text': {
      const ctx = input.context as Partial<ScenarioStepGenContext>;
      systemText = buildScenarioStepSystem();
      userText = buildScenarioStepUser({
        scenarioName: ctx.scenarioName,
        scenarioPurpose: ctx.scenarioPurpose,
        stepOrder: ctx.stepOrder ?? 1,
        dayOffset: ctx.dayOffset,
        hourOfDay: ctx.hourOfDay,
        hint: input.hint ?? ctx.hint,
        brandPrompt,
        playbookText,
      });
      break;
    }
    case 'auto_reply.text': {
      const ctx = input.context as Partial<AutoReplyGenContext>;
      if (!ctx.keyword) throw new Error('keyword is required for auto_reply.text');
      systemText = buildAutoReplySystem();
      userText = buildAutoReplyUser({
        keyword: ctx.keyword,
        hint: input.hint ?? ctx.hint,
        brandPrompt,
        playbookText,
      });
      break;
    }
    case 'broadcast.flex':
    case 'scenario.step_flex':
    case 'auto_reply.flex': {
      const ctx = input.context as Partial<FlexGenContext>;
      systemText = buildFlexSystem();
      userText = buildFlexUser({
        title: ctx.title,
        topic: ctx.topic,
        targetSegment: ctx.targetSegment,
        hint: input.hint ?? ctx.hint,
        brandPrompt,
        playbookText,
      });
      break;
    }
    default:
      throw new Error(`unknown kind: ${String((input as { kind: string }).kind)}`);
  }

  // 画像が添付されている場合は、Claude vision で内容を読み取って文章作成に活かす指示を追加
  if (input.imageDataUrl) {
    userText += `\n\n【添付画像】
顧客から添付された画像 (上記) を読み取り、その内容 (写っているもの・雰囲気・ロゴ・商品名・キャッチコピー等) を文章に反映してください。
画像だけ単独で配信されるわけではなく、テキスト本文と一緒に届くので、本文と画像が補い合うように仕上げてください。`;
  }

  // 過去変種を user 末尾に付与 (重複回避)
  if (input.previousVariants && input.previousVariants.length > 0) {
    const list = input.previousVariants
      .slice(-3)
      .map((v, i) => `[案 ${i + 1}]\n${v}`)
      .join('\n\n');
    userText += `\n\n【過去に生成済みの案 (これらと違うものを出す)】\n${list}`;
  }

  const systemBlocks: ClaudeSystemBlock[] = [
    {
      type: 'text',
      text: systemText,
      cache_control: { type: 'ephemeral' },
    },
    // Markdown 禁止ルール (Flex は JSON 出力なので除外)
    ...(input.kind.endsWith('.flex') ? [] : [{
      type: 'text' as const,
      text: NO_MARKDOWN_RULE,
      cache_control: { type: 'ephemeral' as const },
    }]),
    // 法令・コンプライアンスルール (薬機法・景表法・特商法 + 業界マナー)
    // 配信文・シナリオ・自動応答・Flex 全てに共通で効かせる
    {
      type: 'text',
      text: COMPLIANCE_RULE,
      cache_control: { type: 'ephemeral' },
    },
  ];

  if (examplesText) {
    systemBlocks.push({
      type: 'text',
      text: `【参考実例 (運用代行実例ライブラリ - 自動引用)】
以下は過去の優良配信や運用代行ノウハウから抽出した参考例です。
そのまま流用せず、エッセンスを取り入れて今回の生成に活かしてください。

${examplesText}`,
      cache_control: { type: 'ephemeral' },
    });
  }

  // 画像が添付されていれば multimodal で渡す (Claude vision)
  const imagePart = parseImageDataUrl(input.imageDataUrl);
  const userContent = imagePart
    ? [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: imagePart.mediaType,
            data: imagePart.base64,
          },
        },
        { type: 'text' as const, text: userText },
      ]
    : userText;

  const isFlex =
    input.kind === 'broadcast.flex' ||
    input.kind === 'scenario.step_flex' ||
    input.kind === 'auto_reply.flex';

  // 画像 vision や Flex(JSON 2500 tokens) は重く、デフォルト 60 秒では足りないことがある。
  // Cloudflare 経由のクライアントリクエストは ~100 秒で 524 になり得るため、その手前 (90 秒) まで延長。
  const heavy = isFlex || Boolean(imagePart);
  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system: systemBlocks,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: isFlex ? 2500 : 900,
    temperature: isFlex ? 0.5 : 0.85,
    timeoutMs: heavy ? 90_000 : 60_000,
  });

  // Flex の場合は JSON 抽出 (```json フェンス除去 + パース検証)
  let text = result.text.trim();
  if (isFlex) {
    text = extractJson(text);
  } else {
    // 配信文/シナリオ文/自動応答テキスト等は Markdown 記号を強制除去 (最終防衛線)
    text = stripMarkdown(text);
  }

  return {
    text,
    costYenX100: result.costYenX100,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

/** Claude の応答から JSON 部分だけ抽出 (フェンス除去 + 最初の { から最後の } まで) */
function extractJson(raw: string): string {
  let s = raw.trim();
  // ```json ... ``` フェンス除去
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // 最初の { から最後の } まで切り出し
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }
  // パース確認 (失敗してもそのまま返す → クライアントで再編集できる)
  try {
    const parsed = JSON.parse(s);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const VALID_BROADCAST_TYPES = [
  'campaign',
  'reminder',
  'newsletter',
  'event',
  'limited_offer',
  'aftercare',
  'welcome',
  'reactivation',
] as const;

function pickBroadcastTypeFromContext(input: AiGenerateInput): AgencyBroadcastType | undefined {
  if (input.kind === 'broadcast.text') {
    const ctx = input.context as { broadcastType?: string };
    if (ctx.broadcastType && (VALID_BROADCAST_TYPES as readonly string[]).includes(ctx.broadcastType)) {
      return ctx.broadcastType as AgencyBroadcastType;
    }
  }
  if (input.kind === 'scenario.step_text') {
    return 'welcome';
  }
  return undefined;
}

/** data:image/png;base64,xxx... 形式の URL を mediaType + base64 に分解 */
function parseImageDataUrl(
  dataUrl: string | undefined,
): { mediaType: string; base64: string } | null {
  if (!dataUrl) return null;
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mediaType: m[1], base64: m[2] };
}

function pickKeywordsFromContext(input: AiGenerateInput): string[] {
  const ctx = input.context as {
    title?: string;
    scenarioName?: string;
    scenarioPurpose?: string;
    keyword?: string;
    topic?: string;
  };
  const keywords = [ctx.title, ctx.topic, ctx.scenarioName, ctx.scenarioPurpose, ctx.keyword, input.hint]
    .filter((s): s is string => typeof s === 'string' && s.trim().length >= 2)
    .map((s) => s.trim());
  return keywords;
}

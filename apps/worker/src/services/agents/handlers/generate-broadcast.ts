/**
 * 配信メッセージ生成 handler
 *
 * 入力レイヤー (掛け合わせ):
 *   1. 運用代行ノウハウ (層 1: agency-playbook Markdown、業界別、内蔵)
 *   2. ブランド設定 (テナント prompt_modules 10 種、assembleSystemPrompt)
 *   3. 商品データベース (テナント ai_products から関連商品)
 *   4. 実例ライブラリ (層 2: agency_examples、業界横断)
 *   5. テナント自身の高開封配信履歴
 *
 * 出力:
 *   - 配信文 + 件名 + 推奨送信時刻 + 画像が必要な場合は画像生成 (R2 保存)
 *
 * Anthropic Prompt Caching で静的部分は 5 分 ephemeral キャッシュされる。
 */

import {
  assembleSystemPrompt,
  searchAgencyExamplesForBroadcast,
  searchAiProductsByKeyword,
  listAiProducts,
  listRecentLearningNotes,
  formatLearningContextText,
  type AgencyIndustry,
  type AiProductRow,
} from '@line-crm/db';
import { callClaude, type ClaudeSystemBlock } from '../../../lib/claude-client.js';
import { generateImage } from '../../../lib/image-gen.js';
import { recordUsage } from '../../ai-cost-guard.js';
import {
  buildBroadcastGenPrompt,
  BROADCAST_GEN_SYSTEM_RULES,
} from '../prompts/broadcast/generate.js';
import { getBroadcastTypeRules } from '../prompts/broadcast/types/index.js';
import { buildAgencyPlaybookText } from '../../agency-playbook/index.js';
import type { JobContext, JobResult } from '../types.js';

const VALID_INDUSTRIES = ['beauty', 'chiropractic', 'ecommerce', 'school', 'legal', 'other'] as const;

interface BroadcastGenOutput {
  title?: string;
  content?: string;
  /** Flex Message bubble JSON 文字列。空欄ならテキスト/画像配信 */
  flexContent?: string;
  rationale?: string;
  recommendedSendTime?: string;
  recommendedSendReason?: string;
  suggestedTags?: string[];
  imageNeeded?: boolean;
  imagePrompt?: string;
  referencedProducts?: string[];
}

export async function handleGenerateBroadcast(ctx: JobContext): Promise<JobResult> {
  const { db, apiKey, lineAccountId, job } = ctx;
  const input = JSON.parse(job.input_json || '{}') as {
    slot?: number;
    ofTotal?: number;
    yearMonth?: string;
    topic?: string;
    targetSegment?: string;
    industry?: string;
    broadcastType?: string;
    monthTheme?: string;
    plannerRationale?: string;
    plannedSendAt?: string;
    /** プランナーから明示指定。true → 必ず画像生成 / false → 画像なし */
    forceImageGen?: boolean;
    /** プランナーが決めた表現スタイル: text / text_image / flex_single / flex_carousel / coupon / card_message */
    messageStyle?: string;
  };

  // 1. ブランドシステムプロンプト (10 モジュール合成)
  const { systemPrompt: brandSystemPrompt } = await assembleSystemPrompt(db, lineAccountId);

  // 2. テナント自身の過去高開封配信
  const examples = await collectSuccessfulBroadcastExamples(db);

  // 3. 業界横断の実例ライブラリ
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

  // 4. 商品データベース (テナント ai_products) からトピック / 業界キーワードでマッチ
  const products = await collectRelevantProducts(db, lineAccountId, input.topic, 5).catch(() => []);

  // 5. プロンプト合成 (system は 3 ブロックに分けて Prompt Caching)
  const playbookText = buildAgencyPlaybookText(input.industry);
  const { user: baseUser } = buildBroadcastGenPrompt({
    brandSystemPrompt,
    topic: input.topic,
    targetSegment: input.targetSegment,
    pastSuccessExamples: [...examples, ...externalExamples],
    industry: input.industry,
    broadcastType: input.broadcastType,
    monthTheme: input.monthTheme,
    plannerRationale: input.plannerRationale,
    slot: input.slot ?? 1,
    ofTotal: input.ofTotal ?? 1,
    yearMonth: input.yearMonth ?? new Date().toISOString().slice(0, 7),
    products: products.map((p) => ({
      name: p.name,
      price_yen: p.price_yen,
      description: p.description,
      product_url: p.product_url,
      category: p.category,
    })),
  });

  // プランナーから画像生成強制指定があれば user prompt の末尾に明示指示を追加
  let user = baseUser;
  if (input.forceImageGen === true) {
    user += `\n\n【画像生成: 強制 ON】\n運営者の指定により、この配信には必ず画像を付けます (gpt-image-2 で生成)。\n出力 JSON で必ず imageNeeded: true とし、imagePrompt フィールドに画像生成プロンプトを英語で具体的に書いてください。\n- 商品/サービスの雰囲気・色味・構図を明示\n- 文字なし (LINE 配信は本文と画像が別に届くため、画像内に日本語テキストを入れない)\n- 写実的 (photorealistic) / アニメ調 / ミニマル 等のスタイル指定`;
  } else if (input.forceImageGen === false) {
    user += `\n\n【画像生成: 強制 OFF】\nこの配信は画像なしで配信します。imageNeeded: false / imagePrompt: 空欄 で返してください。`;
  }

  // プランナーが決めた messageStyle を強制 — 全部テキストにならないようにする
  if (input.messageStyle && input.messageStyle !== 'text') {
    user += `\n\n【表現スタイル: ${input.messageStyle} 必須】\n`;
    switch (input.messageStyle) {
      case 'text_image':
        user += `テキスト + 1 枚画像で配信。content に本文、imageNeeded: true、imagePrompt 必須。flexContent は空。`;
        break;
      case 'flex_single':
        user += `Flex バブル 1 枚を必ず flexContent に入れる (hero 画像 + 太字タイトル + 説明 + 価格 + 緑 #06c755 CTA ボタン)。content は LINE 通知用の短い alt-text (20 字)。商品 URL があれば必ず CTA に入れる。imageNeeded: true。`;
        break;
      case 'flex_carousel':
        user += `Flex Carousel (type: "carousel", contents: [...bubble]) を flexContent に入れる。商品/メニュー/事例を 3-6 個並べる。各 bubble は hero 画像 + タイトル + 価格 + CTA。商品データベースから素材を取れ。content は短い alt-text。imageNeeded: true。`;
        break;
      case 'coupon':
        user += `クーポン型 Flex を flexContent に入れる。デザイン: hero 画像 + 大きな割引バッジ (例: "20% OFF" / "¥500 OFF") + 利用期限 + 利用条件 + 緑色 "クーポンを使う" CTA ボタン。色は赤系 #ff6b6b or 紫 #7950f2 でアクセント。content は通知用 alt-text。imageNeeded: true。`;
        break;
      case 'card_message':
        user += `商品/店舗/スタッフを 2-4 枚カード型 Flex Carousel で並べる。各 bubble は小さめサイズ (size: "kilo")、画像 + 名前 + タグ + 詳細ボタン。flexContent に carousel JSON、content に alt-text。imageNeeded: true。`;
        break;
    }
  }

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

  // 配信種別ごとの専用ルール (Big Move 2): broadcastType があれば追加 system block
  const typeRules = getBroadcastTypeRules(input.broadcastType);
  if (typeRules) {
    systemBlocks.push({
      type: 'text',
      text: typeRules,
      cache_control: { type: 'ephemeral' },
    });
  }

  // Big Move 5: 直近 2 ヶ月の学習ノートを注入 (テナント固有 PDCA)
  try {
    const learningNotes = await listRecentLearningNotes(db, lineAccountId, 2);
    const learningText = formatLearningContextText(learningNotes);
    if (learningText) {
      systemBlocks.push({
        type: 'text',
        text: learningText,
        cache_control: { type: 'ephemeral' },
      });
    }
  } catch {
    /* 学習ノートがなくても致命的でない */
  }

  // 6. Claude 呼び出し
  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system: systemBlocks,
    messages: [{ role: 'user', content: user }],
    maxTokens: 3000,
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

  // 7. JSON パース
  let parsed: BroadcastGenOutput = { content: result.text };
  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]) as BroadcastGenOutput;
  } catch (e) {
    console.warn('[generate-broadcast] JSON parse failed, using raw text');
    void e;
  }

  // 8. 画像生成
  //   - forceImageGen が true → 必ず生成 (プランナーが「この配信は画像あり」と決めた)
  //   - forceImageGen が false → 画像なし (プランナーが「画像なし」と決めた)
  //   - forceImageGen が undefined → Claude の判断 (parsed.imageNeeded) に従う
  const shouldGenerateImage =
    input.forceImageGen === true
      ? true
      : input.forceImageGen === false
        ? false
        : !!parsed.imageNeeded;
  let imageR2Key: string | null = null;
  let imageGenCostYenX100 = 0;
  if (shouldGenerateImage && parsed.imagePrompt && ctx.openaiApiKey && ctx.bucket) {
    try {
      const imageResult = await generateImage({
        apiKey: ctx.openaiApiKey,
        prompt: parsed.imagePrompt,
        size: '1024x1024',
      });
      // R2 保存
      const bytes = base64ToUint8Array(imageResult.imageBase64);
      const yearMonth = (input.yearMonth ?? new Date().toISOString().slice(0, 7)).replace('-', '/');
      imageR2Key = `broadcast-images/${yearMonth}/${crypto.randomUUID()}.png`;
      await ctx.bucket.put(imageR2Key, bytes, { httpMetadata: { contentType: 'image/png' } });
      // GPT-Image-2 のおおよそのコスト: 1024x1024 standard = $0.04 ≒ ¥6
      // x100 で 600
      imageGenCostYenX100 = 600;
      await recordUsage(db, {
        lineAccountId,
        feature: 'image_gen',
        model: 'gpt-image-2',
        inputTokens: 0,
        outputTokens: 0,
        costYenX100: imageGenCostYenX100,
      });
    } catch (e) {
      console.error('[generate-broadcast] image gen failed:', e);
      // 画像生成失敗しても配信文は返す
    }
  }

  // 9. Flex バリデーション + hero.url 差し替え
  //   - parsed.flexContent が空文字や非 JSON なら捨てる (post-action がエラーで詰まらないように)
  //   - 画像生成成功時は hero.url を新しい R2 画像 URL に差し替え (AI が仮 URL 入れてくる前提)
  let validatedFlex: string | null = null
  if (parsed.flexContent && parsed.flexContent.trim().length > 0) {
    try {
      const flex = JSON.parse(parsed.flexContent) as { hero?: { url?: string; type?: string } }
      if (imageR2Key && flex && typeof flex === 'object' && flex.hero?.type === 'image') {
        flex.hero.url = `https://${(ctx.workerUrl || 'line-harness-test.reoyakyu428z.workers.dev').replace(/^https?:\/\//, '')}/api/broadcast-images/${encodeURIComponent(imageR2Key)}`
      }
      validatedFlex = JSON.stringify(flex)
    } catch {
      // Flex JSON が壊れていたら捨ててテキストにフォールバック
      validatedFlex = null
    }
  }

  return {
    output: {
      ...parsed,
      flexContent: validatedFlex,
      // プランナー指定の配信日時があれば AI 推奨を上書き
      // (月初プランの一括生成で各配信日時を尊重するため)
      recommendedSendTime: input.plannedSendAt ?? parsed.recommendedSendTime,
      yearMonth: input.yearMonth,
      slot: input.slot,
      ofTotal: input.ofTotal,
      imageR2Key,
      // フロント側で picker.api/agency-examples/image/ 経由でなく
      // 直接 broadcast-image エンドポイント (後述) を使う想定
      imageUrl: imageR2Key
        ? `/api/broadcast-images/${encodeURIComponent(imageR2Key)}`
        : null,
      meta: {
        productsConsidered: products.length,
        agencyExamplesUsed: externalExamples.length,
        pastTenantExamplesUsed: examples.length,
        playbookIndustry: input.industry ?? null,
        imageGenerated: !!imageR2Key,
      },
      generatedAt: new Date().toISOString(),
    },
    costYenX100: result.costYenX100 + imageGenCostYenX100,
    forceStatus: 'review', // 顧客に直接届くものは必ず人間レビュー
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function collectRelevantProducts(
  db: D1Database,
  lineAccountId: string,
  topic: string | undefined,
  limit: number,
): Promise<AiProductRow[]> {
  // topic があれば検索、なければ最新登録順
  if (topic && topic.trim().length > 0) {
    const hits = await searchAiProductsByKeyword(db, lineAccountId, topic.trim(), limit);
    if (hits.length > 0) return hits;
  }
  // フォールバック: 最新の登録商品 (active のみ)
  return listAiProducts(db, lineAccountId, { activeOnly: true, limit });
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binStr = atob(base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

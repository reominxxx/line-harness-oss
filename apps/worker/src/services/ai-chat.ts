/**
 * AI 接客チャット core service
 *
 * 顧客からのメッセージを受けて、以下のパイプラインで処理:
 *
 *  1. インテント分類（ルールベース → Haiku でフォールバック）
 *  2. PII マスキング（AI に送る前に匿名化）
 *  3. プロンプト合成（assembleSystemPrompt で 8 モジュール合成）
 *  4. ナレッジ検索（簡易キーワード検索 → 将来は Vectorize）
 *  5. キャッシュ確認（同質問はキャッシュから返却）
 *  6. Claude 呼び出し（モデル自動選択）
 *  7. PII 復号
 *  8. 使用ログ・メーター更新
 *  9. 顧客プロファイル更新
 */

import {
  assembleSystemPrompt,
  searchKbChunksByKeyword,
  searchAiProductsByKeyword,
  jstNow,
} from '@line-crm/db';
import { callClaude, simpleHash, type ClaudeModel } from '../lib/claude-client.js';
import { maskPii, unmaskPii } from '../lib/pii-masker.js';
import {
  pickModelForIntent,
  quickClassify,
  recordUsage,
  checkBudget,
  type IntentClass,
} from './ai-cost-guard.js';

export interface AiChatRequest {
  lineAccountId: string;
  friendId: string;
  message: string;
  imageUrl?: string;
}

export interface AiChatResponse {
  reply: string;
  intent: IntentClass;
  model: ClaudeModel;
  cached: boolean;
  costYen: number;
  kbReferences: string[];
  productSuggestions: Array<{ id: string; name: string; price_yen: number | null; image_url: string | null }>;
  escalated: boolean;
}

/** キャッシュ TTL（30 日） */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function respondToChat(
  db: D1Database,
  apiKey: string,
  req: AiChatRequest,
): Promise<AiChatResponse> {
  const { lineAccountId, friendId, message, imageUrl } = req;
  const requestId = crypto.randomUUID();

  // 1. 予算チェック
  const budget = await checkBudget(db, lineAccountId);
  if (!budget.allowed) {
    return {
      reply: '申し訳ございません、ただいま自動応答を停止しております。スタッフからご連絡しますので少々お待ちください。',
      intent: 'unknown',
      model: 'claude-haiku-4-5-20251001',
      cached: false,
      costYen: 0,
      kbReferences: [],
      productSuggestions: [],
      escalated: true,
    };
  }

  // 2. インテント分類（ルールベース）
  const intent = imageUrl ? 'image_query' : quickClassify(message);
  const model = pickModelForIntent(intent);

  // 3. クレーム検知 → 人にエスカレ
  if (intent === 'complaint') {
    return {
      reply: 'お気持ちお察しいたします。詳しいお話を伺いたいので、担当よりすぐにご連絡いたします。少々お待ちいただけますでしょうか。',
      intent,
      model,
      cached: false,
      costYen: 0,
      kbReferences: [],
      productSuggestions: [],
      escalated: true,
    };
  }

  // 4. PII マスキング
  const { masked, tokens } = maskPii(message);

  // 5. キャッシュ確認（画像なしのテキスト質問のみ）
  if (!imageUrl) {
    const questionHash = await simpleHash(masked);
    const now = new Date();
    const cached = await db
      .prepare(
        `SELECT response FROM ai_response_cache
         WHERE line_account_id = ? AND question_hash = ?
           AND (expires_at IS NULL OR expires_at > ?)
         LIMIT 1`,
      )
      .bind(lineAccountId, questionHash, jstNow())
      .first<{ response: string }>();

    if (cached) {
      // ヒットカウント更新
      await db
        .prepare(
          `UPDATE ai_response_cache
           SET hit_count = hit_count + 1, last_used_at = ?
           WHERE line_account_id = ? AND question_hash = ?`,
        )
        .bind(jstNow(), lineAccountId, questionHash)
        .run();

      await recordUsage(db, {
        lineAccountId,
        friendId,
        feature: 'chat',
        model,
        inputTokens: 0,
        outputTokens: 0,
        costYenX100: 0,
        cached: true,
        requestId,
      });

      const unmasked = unmaskPii(cached.response, tokens);
      return {
        reply: unmasked,
        intent,
        model,
        cached: true,
        costYen: 0,
        kbReferences: [],
        productSuggestions: [],
        escalated: false,
      };
    }
    void now;
  }

  // 6. ナレッジ検索（簡易：キーワード抽出 → LIKE 検索）
  const keywords = extractKeywords(masked);
  const kbChunks: Array<{ id: string; content: string }> = [];
  const productMatches: AiChatResponse['productSuggestions'] = [];

  for (const kw of keywords.slice(0, 3)) {
    const chunks = await searchKbChunksByKeyword(db, lineAccountId, kw, 2);
    for (const ch of chunks) {
      if (!kbChunks.find((c) => c.id === ch.id)) {
        kbChunks.push({ id: ch.id, content: ch.content });
      }
    }
    if (intent === 'product_recommend') {
      const prods = await searchAiProductsByKeyword(db, lineAccountId, kw, 3);
      for (const p of prods) {
        if (!productMatches.find((x) => x.id === p.id)) {
          productMatches.push({
            id: p.id,
            name: p.name,
            price_yen: p.price_yen,
            image_url: p.image_url,
          });
        }
      }
    }
  }

  // 7. プロンプト合成
  const { systemPrompt } = await assembleSystemPrompt(db, lineAccountId);
  const fullSystem = buildFullSystem(systemPrompt, kbChunks, productMatches);

  // 8. Claude 呼び出し
  const userContent: Parameters<typeof callClaude>[0]['messages'][number]['content'] = imageUrl
    ? [
        { type: 'text', text: masked },
        { type: 'image', source: { type: 'url', url: imageUrl } },
      ]
    : masked;

  let result;
  try {
    result = await callClaude({
      apiKey,
      model,
      system: fullSystem || undefined,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 600,
      temperature: 0.7,
    });
  } catch (e) {
    console.error('[ai-chat] callClaude failed:', e);
    return {
      reply: '申し訳ございません、ただいま回答の生成に時間がかかっております。少しお待ちいただくか、もう一度お送りいただけますでしょうか。',
      intent,
      model,
      cached: false,
      costYen: 0,
      kbReferences: [],
      productSuggestions: [],
      escalated: true,
    };
  }

  // 9. PII 復号
  const reply = unmaskPii(result.text, tokens);

  // 10. キャッシュ保存（画像なし、汎用度高そうな質問のみ）
  if (!imageUrl && intent === 'simple_qa') {
    const questionHash = await simpleHash(masked);
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    try {
      await db
        .prepare(
          `INSERT INTO ai_response_cache (id, line_account_id, question_hash, question, response, model_used, hit_count, last_used_at, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
           ON CONFLICT(line_account_id, question_hash) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          lineAccountId,
          questionHash,
          masked.slice(0, 1000),
          result.text,
          result.model,
          jstNow(),
          expiresAt.toISOString(),
          jstNow(),
        )
        .run();
    } catch (e) {
      console.warn('[ai-chat] cache insert failed:', e);
    }
  }

  // 11. 使用ログ + メーター更新
  await recordUsage(db, {
    lineAccountId,
    friendId,
    feature: imageUrl ? 'vision' : 'chat',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
    cached: false,
    requestId,
    meterAxis: imageUrl ? 'vision' : 'chat',
  });

  // 12. ai_chat_metadata に記録
  await db
    .prepare(
      `INSERT INTO ai_chat_metadata (
         id, line_account_id, friend_id, chat_id, message_text, intent,
         model_used, input_tokens, output_tokens, cost_yen_x100,
         kb_chunks_used, cached_response, escalated, vision_used, pii_masked,
         response_time_ms, created_at
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      lineAccountId,
      friendId,
      reply.slice(0, 2000),
      intent,
      result.model,
      result.inputTokens,
      result.outputTokens,
      result.costYenX100,
      JSON.stringify(kbChunks.map((c) => c.id)),
      imageUrl ? 1 : 0,
      tokens.size > 0 ? 1 : 0,
      null,
      jstNow(),
    )
    .run();

  return {
    reply,
    intent,
    model: result.model,
    cached: false,
    costYen: result.costYenX100 / 100,
    kbReferences: kbChunks.map((c) => c.id),
    productSuggestions: productMatches,
    escalated: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFullSystem(
  base: string,
  kbChunks: Array<{ id: string; content: string }>,
  products: AiChatResponse['productSuggestions'],
): string {
  const parts: string[] = [];
  if (base) parts.push(base);

  if (kbChunks.length > 0) {
    parts.push(
      '【参考情報（社内ナレッジから抜粋）】\n' +
        kbChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n'),
    );
  }

  if (products.length > 0) {
    parts.push(
      '【関連商品（マスタから検索）】\n' +
        products
          .map((p) => `- ${p.name}${p.price_yen ? ` (¥${p.price_yen.toLocaleString()})` : ''}`)
          .join('\n'),
    );
  }

  parts.push(
    '【書き方ルール】\n' +
      '- LINE のトークルームに送る短いメッセージとして書いてください\n' +
      '- 1 メッセージ 150 字以内が目安\n' +
      '- 改行で間を取り、読みやすく\n' +
      '- 絵文字は自然な場面で 1〜2 個まで\n' +
      '- 箇条書きは使わない（LINE 会話では浮く）\n' +
      '- 「！」の連発は避ける',
  );

  return parts.join('\n\n');
}

/** 雑なキーワード抽出（日本語向け、品詞解析なし） */
function extractKeywords(text: string): string[] {
  // 助詞・句読点で分割、2 文字以上の塊だけ拾う
  const tokens = text
    .replace(/[、。．，！？!?「」『』（）\(\)\s　]+/g, ' ')
    .split(/[はがをのにでとへやもからまでより]+|\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 30);
  return Array.from(new Set(tokens));
}

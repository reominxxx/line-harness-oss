/**
 * AI 接客チャット core service
 *
 * 顧客からのメッセージを受けて、以下のパイプラインで処理:
 *
 *  1. インテント分類（ルールベース → Haiku でフォールバック）
 *  2. PII マスキング（AI に送る前に匿名化）
 *  3. プロンプト合成（assembleSystemPrompt で 10 モジュール合成）
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
import { getFriendContext } from './friend-context.js';
import {
  buildBasePrompt,
  buildCustomerContext,
  buildFinalReminder,
} from './ai-chat-base-prompt.js';

export interface AiChatRequest {
  lineAccountId: string;
  friendId: string;
  message: string;
  imageUrl?: string;
  /** true の時は ai_chat_metadata に記録しない（プレビュー用） */
  skipLogging?: boolean;
}

interface ChatAnalysis {
  intent: IntentClass;
  /** 検索に使う重要キーワード（最大 5 個） */
  keywords: string[];
  /** 商品 DB を検索すべきか */
  needsProducts: boolean;
  /** ナレッジを検索すべきか */
  needsKb: boolean;
}

/**
 * お客様メッセージを Haiku で解析:
 *   - intent 分類
 *   - 検索に使う重要キーワード抽出
 *   - 商品 DB / KB が必要かの判定
 *
 * これにより正規表現ベースの分類で取りこぼしていた表現
 * （「肌が荒れて困ってる」「予算 1 万くらいで何かない？」等）も
 * 正しく product_recommend に分類できる。
 *
 * 失敗時は呼び出し側で正規表現フォールバックする。
 */
async function analyzeMessage(apiKey: string, message: string): Promise<ChatAnalysis> {
  const system = `あなたはお客様からの LINE メッセージを解析するアシスタントです。
以下のメッセージを読み、JSON で返答してください。

【出力 JSON フォーマット】
{
  "intent": "reservation" | "product_recommend" | "complaint" | "simple_qa" | "complex_qa" | "small_talk" | "unknown",
  "keywords": ["...", "..."],
  "needsProducts": true | false,
  "needsKb": true | false
}

【intent の判定基準】
- "reservation": 予約・キャンセル・変更・日程相談など予約に関すること
- "product_recommend": 商品・メニュー・サービスのおすすめを求める、悩み相談から商品提案に繋がるもの、価格や種類の質問
- "complaint": クレーム・不満・返金要求・苦情・「ひどい」「もう行かない」等の強い否定
- "simple_qa": 営業時間・住所・アクセス・支払い方法など事実 1 つで答えられる質問
- "complex_qa": 複数の要素を考慮する必要がある質問、状況説明から判断が必要なもの
- "small_talk": 雑談・挨拶・感謝・他愛ない会話
- "unknown": 上記のどれにも当てはまらない

【keywords の出し方】
- メッセージ中の重要な名詞・固有名詞を 2〜5 個
- 助詞や副詞は除く、検索に使える形にする
- 日本語のまま、漢字・カタカナそのまま

【needsProducts】 商品・メニュー・サービスに関する話題なら true
【needsKb】 店舗情報・FAQ・運営ルールに関する話題なら true（多くの場合 true）

回答は JSON のみ、説明文や前置きは禁止。`;

  const result = await callClaude({
    apiKey,
    model: 'claude-haiku-4-5-20251001',
    system,
    messages: [{ role: 'user', content: message }],
    maxTokens: 300,
    temperature: 0.2,
  });

  const match = result.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('analyzeMessage: JSON not found');
  const parsed = JSON.parse(match[0]) as Partial<ChatAnalysis>;
  return {
    intent: (parsed.intent ?? 'unknown') as IntentClass,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5).map(String) : [],
    needsProducts: parsed.needsProducts !== false,
    needsKb: parsed.needsKb !== false,
  };
}

export interface AiChatResponse {
  reply: string;
  intent: IntentClass;
  model: ClaudeModel;
  cached: boolean;
  costYen: number;
  kbReferences: string[];
  productSuggestions: Array<{
    id: string
    name: string
    price_yen: number | null
    image_url: string | null
    product_url: string | null
    description: string | null
  }>;
  escalated: boolean;
}

/** キャッシュ TTL（30 日） */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function respondToChat(
  db: D1Database,
  apiKey: string,
  req: AiChatRequest,
): Promise<AiChatResponse> {
  const { lineAccountId, friendId, message, imageUrl, skipLogging } = req;
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

  // 2. インテント分類（Haiku ベース、失敗時はルールベースへフォールバック）
  let analysis: ChatAnalysis;
  if (imageUrl) {
    analysis = { intent: 'image_query', keywords: extractKeywords(message).slice(0, 5), needsProducts: true, needsKb: true };
  } else {
    try {
      analysis = await analyzeMessage(apiKey, message);
    } catch (e) {
      console.warn('[ai-chat] analyzeMessage failed, falling back to regex:', e);
      const intentFallback = quickClassify(message);
      analysis = {
        intent: intentFallback,
        keywords: extractKeywords(message).slice(0, 5),
        needsProducts: intentFallback === 'product_recommend',
        needsKb: true,
      };
    }
  }
  const intent = analysis.intent;
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

  // 6. ナレッジ + 商品 DB 検索
  // 「商品関連質問の時だけ」ではなく毎回検索する。ヒットなしなら何も context に
  // 入らないので副作用なし。ヒットあれば AI が文脈に応じて自然に活用できる。
  const keywords = analysis.keywords.length > 0 ? analysis.keywords : extractKeywords(masked).slice(0, 5);
  const kbChunks: Array<{ id: string; content: string }> = [];
  const productMatches: AiChatResponse['productSuggestions'] = [];

  for (const kw of keywords.slice(0, 4)) {
    if (analysis.needsKb !== false) {
      const chunks = await searchKbChunksByKeyword(db, lineAccountId, kw, 2);
      for (const ch of chunks) {
        if (!kbChunks.find((c) => c.id === ch.id)) {
          kbChunks.push({ id: ch.id, content: ch.content });
        }
      }
    }
    if (analysis.needsProducts !== false) {
      const prods = await searchAiProductsByKeyword(db, lineAccountId, kw, 3);
      for (const p of prods) {
        if (!productMatches.find((x) => x.id === p.id)) {
          productMatches.push({
            id: p.id,
            name: p.name,
            price_yen: p.price_yen,
            image_url: p.image_url,
            product_url: p.product_url,
            description: p.description,
          });
        }
      }
    }
  }

  // 7. プロンプト合成（基盤 → 顧客文脈 → 業界カスタマイズ → 末尾リマインドの 3 層構造）
  const [{ systemPrompt: industrySystem }, friendContext] = await Promise.all([
    assembleSystemPrompt(db, lineAccountId),
    getFriendContext(db, lineAccountId, friendId),
  ]);

  // 顧客文脈に含まれる過去メッセージ・タグ名にも PII が紛れる可能性があるため、
  // recentMessages.content を maskPii で同一トークン空間に入れる。
  // (signals.signal_summary や tags.name は基本的に PII を含まない設計だが念のため
  //  customerQuery と一緒のトークン辞書に入れる)
  const maskedRecentMessages = (friendContext.recentMessages ?? []).map((m) => {
    const { masked: mc, tokens: mTokens } = maskPii(m.content);
    // tokens を呼び出し側の tokens にマージしておく必要があるが、現状の maskPii は
    // 呼び出しごとに新規生成。簡易対応: マスク済 content だけ採用し、復号は不要
    // (system プロンプト内にしか出ない=応答に含まれにくい)
    void mTokens;
    return { ...m, content: mc };
  });

  const fullSystem = [
    buildBasePrompt(),
    buildCustomerContext({
      friend: friendContext.friend,
      signals: friendContext.signals,
      tags: friendContext.tags,
      recentMessages: maskedRecentMessages,
      products: productMatches,
      kbChunks,
      customerQuery: masked,
    }),
    industrySystem ? `【業界カスタマイズ】\n${industrySystem}` : '',
    buildFinalReminder(),
  ]
    .filter((s) => s && s.trim().length > 0)
    .join('\n\n');

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
  const reply = stripMarkdown(unmaskPii(result.text, tokens));

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
  // プレビュー時は friendId が架空（preview-friend）なので friends FK を回避するため null で記録
  await recordUsage(db, {
    lineAccountId,
    friendId: skipLogging ? undefined : friendId,
    feature: imageUrl ? 'vision' : 'chat',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
    cached: false,
    requestId,
    meterAxis: imageUrl ? 'vision' : 'chat',
  });

  // 12. ai_chat_metadata に記録（プレビューモードはスキップ — preview-friend は friends 行が無く FK 違反になる）
  if (!skipLogging) {
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
  }

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

/** LINE 応答から Markdown 記法を取り除く（モデルが指示を破った場合のフォールバック） */
function stripMarkdown(text: string): string {
  return text
    // 太字 / 斜体: **text** / __text__ / *text* (前後空白がある時のみアスタリスク単体を除去)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*(\S[^*\n]*\S|\S)\*(?=\s|$)/g, '$1$2')
    // 見出し
    .replace(/^#{1,6}\s+/gm, '')
    // 箇条書き先頭の "- " / "* "
    .replace(/^[\-\*]\s+/gm, '・')
    // インラインコード
    .replace(/`([^`]+)`/g, '$1')
    // マークダウンリンク [text](url) → text url
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2')
    // 残った * を念のため
    .replace(/\*/g, '')
    .trim();
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

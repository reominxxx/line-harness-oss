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
  countFriendAiChatSince,
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
import { rerank } from '../lib/reranker.js';
import { stripMarkdown } from './ai-shared-prompts.js';
import { AI_CHAT_TOOLS, executeTool } from './ai-chat-tools.js';

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
- "complaint": 明確なクレーム・返金要求・苦情・「最悪」「ひどい」「もう行かない」「二度と」等の強い怒りや否定。
   単に要望・依頼の口調が強いだけ（「〜して」「出して」「早く」等）は complaint ではなく、内容に応じて
   product_recommend / simple_qa / complex_qa に分類する。判断に迷う場合は complaint にしない。
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
    pricing_type?: string | null
    price_min?: number | null
    price_max?: number | null
    price_note?: string | null
    cta_type?: string | null
    cta_label?: string | null
    cta_url?: string | null
  }>;
  escalated: boolean;
}

/** キャッシュ TTL（30 日） */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RespondToChatOptions {
  /** Jina Reranker v2 API key. 未設定なら reranker は no-op (元順序維持) */
  jinaApiKey?: string;
}

export async function respondToChat(
  db: D1Database,
  apiKey: string,
  req: AiChatRequest,
  options: RespondToChatOptions = {},
): Promise<AiChatResponse> {
  const { lineAccountId, friendId, message, imageUrl, skipLogging } = req;
  const { jinaApiKey } = options;
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

  // 1.5. 友だち単位のレート制限
  //   1 人が何度も AI 応答を引き出すとコストが膨らむため、暦月あたりの課金応答回数に
  //   上限をかける。プレビュー (skipLogging) は運営者のテストなので対象外。
  if (friendId && !skipLogging && budget.perFriendMonthlyCap !== null) {
    // 当月 1 日 00:00 (JST) 以降を集計。jstNow() = 'YYYY-MM-DDT...' の先頭 7 文字が 'YYYY-MM'。
    const monthStart = `${jstNow().slice(0, 7)}-01T00:00:00.000+09:00`;
    const recentCount = await countFriendAiChatSince(db, lineAccountId, friendId, monthStart);
    if (recentCount >= budget.perFriendMonthlyCap) {
      return {
        reply: 'たくさんのお問い合わせありがとうございます。担当者よりあらためてご連絡いたしますので、少々お待ちくださいませ。',
        intent: 'unknown',
        model: 'claude-haiku-4-5-20251001',
        cached: false,
        costYen: 0,
        kbReferences: [],
        productSuggestions: [],
        escalated: true,
      };
    }
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
  // intent が商品提案系のときは AI 分類が needsProducts=false を返しても無視して商品検索を必ず走らせる。
  // analyzeMessage (Haiku) は短い質問で needsProducts のフィールドだけブレることがあり、
  // 「同じ質問なのに 1 回目だけ商品カードが出ない」という症状の原因になるため。
  if (intent === 'product_recommend' || intent === 'image_query') {
    analysis.needsProducts = true;
  }
  const model = pickModelForIntent(intent);

  // 3. クレーム判定について
  //   以前はここで intent==='complaint' を検知したら問答無用で
  //   「お気持ちお察しいたします。担当よりご連絡します」という定型文を即返していた。
  //   しかし Haiku の二値分類は「クーポンを使いたい」「早く出して」程度の強めの口調を
  //   complaint と誤判定することがあり、普通の質問にこの定型文が返る = 接客として最悪。
  //   そのため定型文ショートサーキットは撤去し、本物のクレームも含めて必ず実際の AI 回答に流す。
  //   クレーム時の振る舞い (共感しつつ自己判断せず担当へ引き継ぐ) はベースプロンプト側に
  //   ガイドとして組み込んであり、LLM が文脈を踏まえて自然な一次対応を行う。

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
  //
  // 戦略: 広く拾って Reranker で絞る
  //   - 各キーワードで 5 件まで取得 → ユニーク化で最大 20 件
  //   - Jina Reranker v2 multilingual でクエリとの関連度で再順位付け
  //   - KB は上位 3 件、商品は上位 4 件まで採用
  //   - JINA_API_KEY 未設定なら元順序の先頭から採用 (既存挙動)
  const keywords = analysis.keywords.length > 0 ? analysis.keywords : extractKeywords(masked).slice(0, 5);
  const rawKbChunks: Array<{ id: string; content: string }> = [];
  const rawProducts: AiChatResponse['productSuggestions'] = [];

  for (const kw of keywords.slice(0, 4)) {
    if (analysis.needsKb !== false) {
      const chunks = await searchKbChunksByKeyword(db, lineAccountId, kw, 5);
      for (const ch of chunks) {
        if (!rawKbChunks.find((c) => c.id === ch.id)) {
          rawKbChunks.push({ id: ch.id, content: ch.content });
        }
      }
    }
    if (analysis.needsProducts !== false) {
      const prods = await searchAiProductsByKeyword(db, lineAccountId, kw, 5);
      for (const p of prods) {
        if (!rawProducts.find((x) => x.id === p.id)) {
          rawProducts.push({
            id: p.id,
            name: p.name,
            price_yen: p.price_yen,
            image_url: p.image_url,
            product_url: p.product_url,
            description: p.description,
            pricing_type: p.pricing_type,
            price_min: p.price_min,
            price_max: p.price_max,
            price_note: p.price_note,
            cta_type: p.cta_type,
            cta_label: p.cta_label,
            cta_url: p.cta_url,
          });
        }
      }
    }
  }

  // Reranker でクエリ (= masked = ユーザー質問) に対する関連度で再順位付け
  const KB_TOP_K = 3;
  const PRODUCT_TOP_K = 4;
  // KB チャンクは「リランクが実際にスコア評価した文字数」と同じ上限でプロンプトに渡す。
  // ここを揃えないと、評価対象外の末尾まで毎回 (非キャッシュの動的ブロックとして) フル課金で
  // 送ることになり、品質に寄与しないトークンに金がかかる。1500 字は rerank の入力と一致。
  const KB_CONTEXT_MAX_CHARS = 1500;
  const [rerankedKb, rerankedProducts] = await Promise.all([
    rawKbChunks.length > KB_TOP_K
      ? rerank(
          jinaApiKey,
          masked,
          rawKbChunks.map((c) => ({ id: c.id, text: c.content.slice(0, 1500) })),
          KB_TOP_K,
          { fallbackLimit: KB_TOP_K },
        )
      : Promise.resolve(rawKbChunks.map((d) => ({ document: { id: d.id, text: d.content.slice(0, 1500) }, score: 0 }))),
    rawProducts.length > PRODUCT_TOP_K
      ? rerank(
          jinaApiKey,
          masked,
          rawProducts.map((p) => ({
            id: p.id,
            // 商品は name + description で意味的にマッチさせる
            text: `${p.name}${p.description ? ' / ' + p.description : ''}`.slice(0, 500),
          })),
          PRODUCT_TOP_K,
          { fallbackLimit: PRODUCT_TOP_K },
        )
      : Promise.resolve(rawProducts.map((p) => ({ document: { id: p.id, text: p.name }, score: 0 }))),
  ]);

  const kbChunks: Array<{ id: string; content: string }> = rerankedKb.map((r) => {
    const orig = rawKbChunks.find((c) => c.id === r.document.id)!;
    return { id: orig.id, content: orig.content.slice(0, KB_CONTEXT_MAX_CHARS) };
  });
  const productMatches: AiChatResponse['productSuggestions'] = rerankedProducts
    .map((r) => rawProducts.find((p) => p.id === r.document.id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  // 7. プロンプト合成（基盤 → 業界カスタマイズ → 顧客文脈 → 末尾リマインドの 3 層構造）
  //    Anthropic Prompt Caching: 静的ブロック (基盤 + 業界カスタマイズ + リマインド) は
  //    cache_control: ephemeral でキャッシュし、再利用時に入力コストを 90% off にする。
  //    動的ブロック (顧客文脈) はキャッシュしない (毎回内容が異なるため)。
  //
  //    重要: cache 対象ブロックを system 配列の "先頭側" に並べる。
  //    Anthropic のキャッシュは prefix マッチングなので、動的ブロックを後ろに置く。
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
    void mTokens;
    return { ...m, content: mc };
  });

  const customerContext = buildCustomerContext({
    friend: friendContext.friend,
    signals: friendContext.signals,
    tags: friendContext.tags,
    recentMessages: maskedRecentMessages,
    profileSummary: friendContext.profileSummary,
    products: productMatches,
    kbChunks,
    customerQuery: masked,
  });

  // system プロンプトを配列ブロックで構築し、静的部分のみ cache_control を付ける
  const systemBlocks: Array<{
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  }> = [];

  // [基盤] 全テナント共通の固定プロンプト → 全テナントで共有キャッシュされる
  //   ttl: '1h' = 5 分ではなく 1 時間保持。散発的なプレビューでも 2 回目以降は
  //   キャッシュ読み出し (入力 10% 課金) に乗り、毎回フルの書き込み課金になる無駄を防ぐ。
  systemBlocks.push({
    type: 'text',
    text: buildBasePrompt(),
    cache_control: { type: 'ephemeral', ttl: '1h' },
  });

  // [業界カスタマイズ] テナント単位で静的 → テナント単位でキャッシュされる
  if (industrySystem && industrySystem.trim().length > 0) {
    systemBlocks.push({
      type: 'text',
      text: `【業界カスタマイズ】\n${industrySystem}`,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
  }

  // [顧客文脈] 動的: キャッシュしない
  if (customerContext.trim().length > 0) {
    systemBlocks.push({ type: 'text', text: customerContext });
  }

  // [末尾リマインド] 静的だが小さいので、上の cache 内に含めず素のブロックとして
  // (cache 対象ブロックが少なすぎても効果が薄く、追加すると prefix が長くなって安定性が下がる)
  systemBlocks.push({ type: 'text', text: buildFinalReminder() });

  // 8. 強制リマインダーの動的注入
  //    プロンプトに「商品提案を優先」と書いても、業界モジュール (美容室の scenario:
  //    "カウンセリング誘導" 等) が強くて AI が無視するケースがある。
  //    以下の条件で user メッセージの末尾にシステム指示を強制注入する:
  //    (a) 商品 DB に該当商品あり
  //    (b) かつ、お客様の質問がおすすめ系 ('おすすめ' '提案' 'ほしい' 'ありますか'
  //        'いい' '人気' '何が' 'どれが') または直前 2 ターン AI が質問返しだった
  const userWantsRecommendation =
    /(おすすめ|提案|ほしい|欲しい|ありますか|教えて|いいの|人気|何が|どれが|どんなの)/i.test(masked);
  const lastTwoAiTurns = maskedRecentMessages
    .filter((m) => m.direction === 'out')
    .slice(-2);
  const recentlyAskedBack =
    lastTwoAiTurns.length >= 2 &&
    lastTwoAiTurns.every((m) => /[?？]/.test(m.content));
  const shouldForceProduct = productMatches.length > 0 && (userWantsRecommendation || recentlyAskedBack);

  const productNamesList = productMatches.map((p) => p.name).join(' / ');
  const forceProductInstruction = shouldForceProduct
    ? `\n\n---\n【強制ルール (絶対遵守)】
お客様の質問とこの会話履歴から、商品提案が必要です。
取扱商品 DB に下記の商品があります: ${productNamesList}

以下の制約で応答してください:
- 本文中に上記いずれかの商品名 (1〜2 個) を必ず出す
- "お肌のタイプは？" だけの質問返しはしない (3 連続禁止のルール)
- カウンセリング誘導・ヘアメニュー紹介で逃げない (今回は商品提案のフェーズ)
- 業界カスタマイズの scenario に "カウンセリング誘導" と書かれていても、
  今回は商品名を本文に出すことを優先する
- 価格・URL は本文に書かない (商品カードが UI に別表示される)
- 提案フレーズ例: "うるおいケアに人気の ${productMatches[0]?.name ?? '○○'} はいかがでしょうか"`
    : '';

  const userText = `${masked}${forceProductInstruction}`;
  const userContent: Parameters<typeof callClaude>[0]['messages'][number]['content'] = imageUrl
    ? [
        { type: 'text', text: userText },
        { type: 'image', source: { type: 'url', url: imageUrl } },
      ]
    : userText;

  // Tool Use ループ: Claude が「ツール呼びたい」と返してきたら DB を叩いて結果を返す。
  // 最大 3 ターンまで (無限ループ防止)。最終的に text 応答が得られたら抜ける。
  const conversation: Parameters<typeof callClaude>[0]['messages'] = [
    { role: 'user', content: userContent },
  ];
  let result;
  let toolRounds = 0;
  const MAX_TOOL_ROUNDS = 3;
  try {
    while (true) {
      result = await callClaude({
        apiKey,
        model,
        system: systemBlocks,
        messages: conversation,
        maxTokens: 500,
        temperature: 0.7,
        tools: AI_CHAT_TOOLS,
      });

      // ツール使用要求が無ければ通常応答として処理
      if (result.stopReason !== 'tool_use' || result.toolUses.length === 0) break;
      if (toolRounds >= MAX_TOOL_ROUNDS) {
        // 上限到達: 最後の result.text をそのまま採用
        console.warn('[ai-chat] tool_use loop max rounds reached');
        break;
      }
      toolRounds++;

      // Anthropic 仕様: 直前の assistant メッセージとして tool_use を含む content を積む
      const assistantContent: Parameters<typeof callClaude>[0]['messages'][number]['content'] = [];
      if (result.text) assistantContent.push({ type: 'text', text: result.text });
      for (const tu of result.toolUses) {
        assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
      }
      conversation.push({ role: 'assistant', content: assistantContent });

      // 各ツールを実行して tool_result を返す
      const toolResults: Parameters<typeof callClaude>[0]['messages'][number]['content'] = [];
      for (const tu of result.toolUses) {
        const out = await executeTool({ db, lineAccountId, friendId }, tu.name, tu.input);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: out });
      }
      conversation.push({ role: 'user', content: toolResults });
    }
  } catch (e) {
    console.error('[ai-chat] callClaude failed:', e);
    return {
      reply:
        budget.aiFallbackMessage ??
        '申し訳ございません、ただいま回答の生成に時間がかかっております。少しお待ちいただくか、もう一度お送りいただけますでしょうか。',
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
  let reply = stripMarkdown(unmaskPii(result.text, tokens));

  // 9.5 出力ガード — prompt injection で system prompt の中身が漏れた場合の最終防衛線
  // システムプロンプト内の固有マーカーが出力に混入していたら、安全な定型文に差し替え。
  if (containsPromptLeakage(reply)) {
    console.warn(
      `[ai-chat] prompt leakage detected for line_account=${lineAccountId} friend=${friendId}`,
    );
    reply =
      budget.aiFallbackMessage ??
      '申し訳ありません、その内容はお答えできかねます。担当者よりご案内いたしますね。';
  }

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

  // 商品カードは「AI が応答本文で実際に提案した商品」だけ表示する。
  // 検索でヒットしただけで本文に商品名が出てこない場合 (お悩み確認段階など)、
  // カードを出すと文章と矛盾するので除外する。
  // ただし完全一致だと「AUSEウォッシングクリーム（洗顔クリーム）」のような括弧付き
  // 登録名を AI が「AUSEウォッシングクリーム」と省略した時にカードが消えるので、
  // 括弧書きの除去 + 全角半角/空白の正規化を行った上で寛容に判定する。
  const recommendedProducts = productMatches.filter((p) => replyMentionsProduct(reply, p.name));

  // 商品訴求はスライダー (Flex carousel) で行う設計なので、本文に紛れた裸の URL は
  // 除去する。「詳しくはこちら → https://...」のような誘導句ごと落とす。
  // (LINE 配信・プレビュー・respond エンドポイント全てで一貫させるためここで処理)
  if (recommendedProducts.length > 0) {
    reply = stripBareUrls(reply);
  }

  return {
    reply,
    intent,
    model: result.model,
    cached: false,
    costYen: result.costYenX100 / 100,
    kbReferences: kbChunks.map((c) => c.id),
    productSuggestions: recommendedProducts,
    escalated: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// stripMarkdown は services/ai-shared-prompts.ts に共通化済 (import で利用)

/**
 * prompt injection 経由で system prompt が漏れた応答を検出する。
 * 内部マーカー(プロンプト本文に書いてあるが、自然な接客応答には絶対に現れない文字列)を検査。
 * 誤検知を避けるため、十分に "内部っぽい" マーカーのみ対象。
 */
export function containsPromptLeakage(text: string): boolean {
  const markers: RegExp[] = [
    /【絶対禁止リスト】/,
    /【安全ルール】/,
    /【プロンプトインジェクション/,
    /【出力フォーマット 絶対ルール】/,
    /【最初の 1 文 絶対ルール】/,
    /SECTION_[A-Z_]+/,
    /assembleSystemPrompt|buildBasePrompt|buildFinalReminder|buildCustomerContext/,
    /<past_message\b/i,
    /cache_control/i,
    /system_prompt|systemPrompt/,
    /You are a helpful assistant/i,
  ];
  return markers.some((re) => re.test(text));
}

/** 商品名マッチ用の正規化: NFKC (全角→半角) + 空白除去 + 小文字化 */
function normalizeForMatch(s: string): string {
  return s.normalize('NFKC').replace(/[\s　]+/g, '').toLowerCase();
}

/**
 * AI 応答本文がこの商品を実際に提案しているか判定する。
 * 登録名そのままでの一致に加え、括弧書きの補足 (例:「（洗顔クリーム）」) を
 * 除いた "コア名" でも一致を許容する。全角半角・空白の揺れも正規化で吸収。
 */
export function replyMentionsProduct(reply: string, name: string): boolean {
  const r = normalizeForMatch(reply);
  const full = normalizeForMatch(name);
  if (full.length >= 2 && r.includes(full)) return true;
  // 全角/半角の括弧書き補足を除いたコア名で再判定 (短すぎる名前は誤マッチ防止で除外)
  const core = normalizeForMatch(name.replace(/[（(][^（）()]*[）)]/g, ''));
  if (core.length >= 3 && r.includes(core)) return true;
  return false;
}

/**
 * 商品訴求時に AI 本文へ紛れ込んだ裸の URL を除去する。商品リンクはスライダー
 * (Flex carousel) のボタンで提示する設計なので、本文側に URL を残さない。
 * 「詳しくはこちら → https://...」のような誘導フレーズごと落とす。
 */
export function stripBareUrls(text: string): string {
  return text
    // 「詳しくはこちら → URL」「ご購入はこちら: URL」等の誘導句ごと除去
    .replace(/[^\n。、]*(?:こちら|詳しく|ご購入|購入|チェック|ご覧)[^\n]*?https?:\/\/[^\s）)」】]+/gi, '')
    // 残った裸の URL を除去
    .replace(/https?:\/\/[^\s）)」】]+/gi, '')
    // 除去で生じた矢印・記号の残骸を行末から掃除
    .replace(/[ \t]*[→➡:：\-—]+[ \t]*$/gm, '')
    // 空行の連続を 1 つに圧縮
    .replace(/\n{3,}/g, '\n\n')
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

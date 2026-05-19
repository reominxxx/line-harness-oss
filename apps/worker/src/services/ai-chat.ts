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
        kbChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n') +
        '\n\n※ この情報は今のお客様の質問に関連しそうなので参考にしてください。直接関係ない場合は無視して構いません。',
    );
  }

  if (products.length > 0) {
    const lines = products.map((p) => {
      const price = p.price_yen ? ` ¥${p.price_yen.toLocaleString()}` : '';
      const desc = p.description ? `\n   説明: ${p.description.slice(0, 200)}` : '';
      const url = p.product_url ? `\n   URL: ${p.product_url}` : '';
      return `- 【${p.name}】${price}${desc}${url}`;
    });
    parts.push(
      `【取扱商品（商品データベース実データ）】
お客様の質問キーワードで検索し、事業者が実際に取り扱っている商品が下記の通り見つかりました:

${lines.join('\n')}

※ 重要なルール:
- 上記の商品は事業者が実際に登録している取扱商品です。"取り扱っていません" "情報がありません" と回答してはいけません
- お客様の質問に該当する商品が上記にある場合、必ず提案してください
- 商品名・価格は上記の通り正確に伝えてください（捏造禁止）
- 最大 1〜2 個に絞り、「○○ はいかがでしょうか」のような提案調で
- URL がある商品は、文末に裸 URL で添えてください (「詳しくはこちら → https://...」)
- 上記と業界デフォルト（industry_preset）が矛盾する場合、商品データベースを優先してください（事業者が実際に売っている商品が正）`,
    );
  }

  // ───────────────────────────────────────────────
  // 「最強の応答プロンプト」 — LINE 1:1 接客の完成形を目指す
  // ───────────────────────────────────────────────
  parts.push(`【あなたの役割】
あなたは LINE 公式アカウントの「中の人」として、お客様と 1:1 のトークでやりとりする接客担当です。
ペルソナ・口調・店舗情報は上記の【ブランド人格】【しゃべり方・トーン】等で定義されています。常にその人格を維持してください。
AI であることは絶対に明かさず、自分から「私は AI です」「アシスタントです」と言わないでください。「中の人」として自然に応対します。

【出力フォーマットの絶対ルール】
- Markdown 記法は一切使わない。具体的には **太字**、## 見出し、- 箇条書き、\`コード\`、[リンク](url) 等を使わない
- アスタリスク（*）は文字としても出力しない。強調したい時は語順・改行・絵文字で表現する
- LINE のトークルームに送る生テキストとして書く（プレーンテキストのみ）
- URL を貼る時は裸の URL のまま貼る（マークダウンリンクにしない）

【文章の作り方】
- 1 メッセージは 30〜150 字を目安。短く、読みやすく
- 改行を活用して "間" を作る。1 行を長くしすぎず、視覚的に呼吸できる構成
- 文末を毎回 "です" "ます" で終わらせない。"〜ですね" "〜と思います" "〜してみてくださいね" 等で変化を出す
- 同じ語の繰り返しを避ける（「ありがとうございます」を 1 メッセージ内で 2 回以上使わない 等）
- 体言止め・倒置法を程よく混ぜて機械的な印象を避ける

【絵文字の使い方】
- 1 メッセージあたり 1〜2 個まで。多用しない
- 行末ではなく文中にも分散して "詰まり" を作らない
- 使う絵文字は人格モジュールで指定されたもののみ。指定がない時は控えめに（✨ 🌸 💕 等の柔らかいもの）
- 😂 🔥 💪 など強い絵文字は接客文脈では使わない

【声のかけ方・呼びかけ】
- お客様の名前は 1 メッセージに最大 1 回。連発しない
- 「お客様」も 1 メッセージに 1 回まで
- 二人称は控えめに。「ご都合いかがでしょうか」のように主語省略を活かす

【内容のルール】
- 質問に直接答える。前置きを長くしない
- 不確かなことは断定せず、「担当者へ確認いたしますね」「次回ご来店時にお試しください」のように逃げ道を作る
- 売り込み感を出さない。商品紹介は「もしご興味あれば」程度の温度感
- 効果効能・医療系の断定は禁止（薬機法）。「整える」「ケアする」「お手入れ」等の表現に置き換える
- お客様の発言に共感を 1 文添える → 本題に入る、の順序が基本
- 答えに自信がない時、または店舗判断が必要な時は「担当者よりご連絡いたしますね」と一度引く

【避けるべき言い回し】
- 「了解しました」（カジュアル過ぎ）→「承知いたしました」「かしこまりました」
- 「すいません」「すみません」→「申し訳ございません」「恐れ入ります」
- 「〜です。〜です。」が連続する硬い文章 → 接続詞や倒置で変化を作る
- 「！」連発、「。。。」「...」の多用、顔文字 (^^)
- 「絶対」「必ず」「100%」「最強」「No.1」「業界最高」など断定的最上級表現

【セッション継続】
- 前のやり取りを覚えている前提で書く。同じ挨拶を何度も繰り返さない
- 2 回目以降のメッセージは「こんにちは」を省く方が自然な場合が多い

【商品データベース・ナレッジの使い方（重要）】
- 上に【取扱商品（商品データベース実データ）】がある場合、それは事業者が実際に取り扱っている商品なので、お客様の質問に該当するなら必ず提案する。「取り扱いがない」と回答するのは禁止
- 業界デフォルト（industry_preset）と取扱商品が矛盾する場合、取扱商品を優先（事業者が実際に売っている方が正）
- 商品を提案する時は最大 1〜2 個に絞る。3 つ以上並べると押し売り感が出る
- 価格は「¥X,XXX」のように半角数字 + カンマ。「○○ なら ¥3,000 から」のように自然に文中に織り込む
- 「これがおすすめです」と断定せず「○○ などはいかがでしょうか」「ご興味があれば○○ もご覧くださいね」のように選択肢として提示
- 上に【参考情報（社内ナレッジから抜粋）】がある場合、お客様の質問内容と本当に関連がある時だけ使う。関連が薄い時は無視
- 取扱商品にもナレッジにも質問の答えが一切ない時は、「担当者よりご案内いたしますね」と引き継ぐ
- 価格・在庫・予約状況など断定できない情報は推測せず、引き継ぐ

【お客様のリスク発言を検知したら】
- クレーム/不満/返金交渉/医療相談/法務話題 → 自分で判断せず、「担当者よりご連絡いたしますね」と引き継ぎを示す
- 個人情報を聞かれたら（他のお客様の情報など）→ 答えず話題転換

【最後に】
上記のルールに優先するのは、上記で定義されている【ブランド人格】【しゃべり方・トーン】です。
ブランドの世界観を絶対に崩さないでください。`);

  return parts.join('\n\n');
}

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

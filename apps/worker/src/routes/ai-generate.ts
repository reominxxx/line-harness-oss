/**
 * AI テキスト生成の汎用エンドポイント。
 *
 * POST /api/ai-generate/text
 *   header: X-Line-Account-Id
 *   body:
 *     - kind: 'broadcast.text' | 'scenario.step_text' | 'auto_reply.text'
 *     - context: kind 固有の context (broadcast の場合は { title, targetSegment, ... })
 *     - hint?: 追加ヒント (再生成時に「もっと短く」等)
 *     - previousVariants?: 既出案 (重複回避)
 *   resp: { success: true, text: string, costYenX100: number, model: string }
 */

import { Hono } from 'hono';
import { getLineAccountById } from '@line-crm/db';
import { generateAiText, type AiGenerateKind } from '../services/ai-generators/index.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import { callClaude } from '../lib/claude-client.js';
import { stripMarkdown } from '../services/ai-shared-prompts.js';
import type { Env } from '../index.js';

export const aiGenerate = new Hono<Env>();

const VALID_KINDS: AiGenerateKind[] = [
  'broadcast.text',
  'scenario.step_text',
  'auto_reply.text',
  'broadcast.flex',
  'scenario.step_flex',
  'auto_reply.flex',
];

// AI 画像プロンプト生成
//   ユーザーが少しの項目を埋めるだけで、gpt-image-2 に投げる "良いプロンプト" を Claude が作る。
//   kind=style_guide: ブランドスタイルガイド (毎回画像生成に反映する固定文)
//   kind=creative:    今回作りたい画像の具体指示
aiGenerate.post('/api/ai-generate/image-prompt', async (c) => {
  const lineAccountId = c.req.header('x-line-account-id');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }
  const body = await c.req.json<{
    kind?: 'style_guide' | 'creative';
    inputs?: Record<string, unknown>;
    size?: '1024x1024' | '1024x1536' | '1536x1024' | '1536x864' | string;
    styleGuideText?: string;
  }>().catch(() => ({} as { kind?: 'style_guide' | 'creative'; inputs?: Record<string, unknown>; size?: string; styleGuideText?: string }));

  const kind = body.kind;
  const inputs = body.inputs ?? {};
  if (kind !== 'style_guide' && kind !== 'creative') {
    return c.json({ success: false, error: 'kind must be style_guide or creative' }, 400);
  }

  const inputDump = Object.entries(inputs)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(' / ') : String(v)}`)
    .join('\n');

  let systemPrompt: string;
  let userPrompt: string;

  if (kind === 'style_guide') {
    systemPrompt = `あなたは gpt-image-2 (画像生成 AI) 向けのプロンプト構築の専門家です。
店舗オーナーが入力したブランド情報から、毎回の画像生成に共通して効かせる「ブランドスタイルガイド」を 1 段落 (180〜260 字程度) で書きます。

【スタイルガイドの役割】
- 配色 / トーン / 雰囲気 / 構図嗜好 / 必ず入れたい要素 / 避けたい要素 を簡潔に明示
- どんな配信画像でも一貫したブランド感が出るよう、再利用可能な形にする
- 「文字を入れない」「画像端ギリギリに重要要素を置かない」「配色 2〜3 色に絞る」など gpt-image-2 のお作法も最後に短く添える
- 業種に応じた「らしさ」 (美容 → 上品・清潔感 / 整体 → 安心感・健康 / EC → 商品の魅力訴求 / 飲食 → 食欲をそそる / 士業 → 誠実・信頼 / スクール → 親しみ・成長) を反映する

【出力】
段落 1〜2 個のプレーンテキスト。Markdown 記号や箇条書き記号 (** ## - 等) は禁止。改行は使ってよい。`;
    userPrompt = `以下の情報からブランドスタイルガイドを書いてください:\n\n${inputDump || '(項目未入力)'}\n\nスタイルガイド本文のみ返してください (見出しや前置きは不要)。`;
  } else {
    // creative
    const sizeLabel = body.size === '1024x1024' ? 'スクエア (1:1)'
      : body.size === '1536x1024' ? '横長 (3:2)'
      : body.size === '1024x1536' ? '縦長 (2:3)'
      : body.size === '1536x864' ? 'ワイドバナー (16:9)'
      : '指定サイズ';
    const styleBlock = body.styleGuideText?.trim()
      ? `\n\n【適用するブランドスタイルガイド (毎回反映)】\n${body.styleGuideText.trim()}\n`
      : '';
    systemPrompt = `あなたは gpt-image-2 (画像生成 AI) 向けのプロンプト構築の専門家です。
店舗オーナーが「今回作りたい画像」のラフ情報を入れます。それを gpt-image-2 が確実に意図通り出すための具体プロンプトに変換します。

【含めるべき要素】
- サイズに応じた構図ヒント (1:1 ならフレームを意識した中央構図 / 3:2 なら左右の流れ / 2:3 なら縦の動き / 16:9 ならヘッダー感)
- 主役の被写体 (商品 / 人物 / モチーフ) の配置と扱い
- 配色とライティング (柔らかい光 / コントラスト強め / 自然光 など)
- 雰囲気 (清潔感 / ワクワク感 / 高級感 等)
- 季節感や時間帯のヒント (あれば)
- 含めない要素 (文字・ロゴ・人物の顔クローズアップ など、ユーザー指示があれば反映)
- gpt-image-2 のお作法を最後に短く: 文字は入れない、画像端ギリギリに重要要素を置かない、配色 2〜3 色に絞る、過度な装飾は避ける

【出力】
プレーンテキストで 200〜350 字程度の段落。Markdown 記号 (** ## - 等) や箇条書き記号は禁止。`;
    userPrompt = `画像サイズ: ${sizeLabel}${styleBlock}\n\n【今回作りたいもの (ユーザー入力)】\n${inputDump || '(項目未入力)'}\n\nプロンプト本文のみ返してください (見出しや前置きは不要)。`;
  }

  const result = await callClaude({
    apiKey,
    model: 'claude-haiku-4-5-20251001',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 800,
    temperature: 0.5,
  });

  await recordUsage(c.env.DB, {
    lineAccountId,
    feature: 'copy_gen',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
  });

  return c.json({
    success: true,
    prompt: stripMarkdown(result.text.trim()),
    costYenX100: result.costYenX100,
    model: result.model,
  });
});

// HP (ホームページ) を読み込んでブランド情報を自動抽出
//   ユーザーが入力した URL を fetch → 本文/配色を抽出 → Claude で
//   「ブランドを一言で」「ブランドカラー」「業種」「トーン」を構造化して返す。
//   フロントの style_guide フォームの各入力欄に流し込み、ユーザーが手で微調整できる。
const ALLOWED_INDUSTRIES = [
  '美容 (美容室・ネイル・エステ・まつげ)',
  '整体・治療院・パーソナルジム',
  'EC・物販',
  'スクール・教室・塾',
  '士業 (弁護士・税理士・司法書士等)',
  '飲食 (カフェ・レストラン)',
  'クリニック・医療系',
  'その他',
];
const ALLOWED_TONES = [
  '上品・清潔感',
  '親しみ・カジュアル',
  'モダン・洗練',
  'ナチュラル・優しい',
  'ポップ・元気',
  '高級感・重厚',
  'ミニマル・スタイリッシュ',
];

aiGenerate.post('/api/ai-generate/brand-from-url', async (c) => {
  const lineAccountId = c.req.header('x-line-account-id');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }

  const body = await c.req.json<{ url?: string }>().catch(() => ({} as { url?: string }));
  const rawUrl = body.url?.trim();
  if (!rawUrl) {
    return c.json({ success: false, error: 'url is required' }, 400);
  }

  // URL バリデーション + SSRF 緩和: http(s) のみ / ローカル・内部ホストを拒否
  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return c.json({ success: false, error: 'URL の形式が正しくありません' }, 400);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return c.json({ success: false, error: 'http/https の URL を入力してください' }, 400);
  }
  const host = target.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    host === '169.254.169.254' ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    /^\[/.test(host) // IPv6 literal
  ) {
    return c.json({ success: false, error: 'このホストは読み込めません' }, 400);
  }

  // HP を取得 (タイムアウト + サイズ上限)
  let html: string;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(target.toString(), {
      method: 'GET',
      headers: { 'User-Agent': 'L-port-BrandBot/1.0 (+https://line-port.com)', Accept: 'text/html' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      return c.json({ success: false, error: `HP の取得に失敗しました (HTTP ${res.status})` }, 502);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('text/html') && !ct.includes('text/plain') && ct !== '') {
      return c.json({ success: false, error: 'HTML ページではないため読み込めません' }, 415);
    }
    const buf = await res.arrayBuffer();
    // 先頭 600KB だけ見る (巨大ページのメモリ対策)
    html = new TextDecoder('utf-8').decode(buf.slice(0, 600_000));
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'HP の読み込みがタイムアウトしました' : 'HP に接続できませんでした';
    return c.json({ success: false, error: msg }, 502);
  }

  const extracted = extractBrandSignals(html);

  const systemPrompt = `あなたは企業サイトからブランド情報を読み取る専門家です。
渡されたホームページの抽出テキストと配色ヒントから、以下を日本語で推定します。
- brandOneLine: そのブランドを一言で表すキャッチ (例「大人の隠れ家サロン」「誠実な街の税理士事務所」)。20〜40 字程度。
- colors: ブランドカラーを 1〜3 色。配色ヒントの hex があれば優先し「ネイビー #1B2A4A + ゴールド」のように色名と hex を併記。判断できなければ本文の雰囲気から推定。
- industry: 次の選択肢から最も近いものを 1 つ厳密に選ぶ。該当なしは空文字。選択肢: ${ALLOWED_INDUSTRIES.join(' / ')}
- tone: 次の選択肢から最も近いものを 1 つ厳密に選ぶ。該当なしは空文字。選択肢: ${ALLOWED_TONES.join(' / ')}

必ず次の JSON のみを返す (前置き・コードフェンス・説明は禁止):
{"brandOneLine":"...","colors":"...","industry":"...","tone":"..."}`;

  const userPrompt = `【サイトURL】${target.toString()}
【タイトル】${extracted.title || '(なし)'}
【説明文】${extracted.description || '(なし)'}
【サイト名】${extracted.siteName || '(なし)'}
【配色ヒント(hex)】${extracted.colors.join(', ') || '(なし)'}
【本文抜粋】
${extracted.text.slice(0, 3500) || '(本文を取得できませんでした)'}`;

  let result;
  try {
    result = await callClaude({
      apiKey,
      model: 'claude-haiku-4-5-20251001',
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 400,
      temperature: 0.3,
    });
  } catch (e) {
    console.error('[ai-generate/brand-from-url] claude failed:', e);
    return c.json({ success: false, error: 'ブランド情報の解析に失敗しました' }, 500);
  }

  await recordUsage(c.env.DB, {
    lineAccountId,
    feature: 'copy_gen',
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costYenX100: result.costYenX100,
  });

  const parsed = parseBrandJson(result.text);
  if (!parsed) {
    return c.json({ success: false, error: '解析結果を読み取れませんでした。もう一度お試しください。' }, 500);
  }
  // industry / tone は選択肢に存在する値のみ採用 (フロントの select と一致させる)
  const industry = ALLOWED_INDUSTRIES.includes(parsed.industry ?? '') ? parsed.industry : '';
  const tone = ALLOWED_TONES.includes(parsed.tone ?? '') ? parsed.tone : '';

  return c.json({
    success: true,
    brandOneLine: (parsed.brandOneLine ?? '').slice(0, 100),
    colors: (parsed.colors ?? '').slice(0, 120),
    industry,
    tone,
    sourceTitle: extracted.title,
    costYenX100: result.costYenX100,
    model: result.model,
  });
});

// HTML からブランド推定に使う素材を抽出する (軽量・依存なし)
function extractBrandSignals(html: string): {
  title: string;
  description: string;
  siteName: string;
  colors: string[];
  text: string;
} {
  const pick = (re: RegExp): string => {
    const m = html.match(re);
    return m ? decodeEntities(m[1].trim()) : '';
  };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const siteName = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);

  // 配色ヒント: theme-color メタ + style/inline の hex を収集して頻度上位を返す
  const colorCounts = new Map<string, number>();
  const themeColor = pick(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i);
  if (themeColor) colorCounts.set(normalizeHex(themeColor), 100); // theme-color は強く優先
  for (const m of html.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const hex = normalizeHex(`#${m[1]}`);
    // 真っ白/真っ黒は配色として弱いので除外
    if (hex === '#ffffff' || hex === '#000000') continue;
    colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1);
  }
  const colors = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([hex]) => hex);

  // 本文: script/style/nav を除去してタグ剥がし
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');
  return { title, description, siteName, colors, text: decodeEntities(text).replace(/\s+/g, ' ').trim() };
}

function normalizeHex(hex: string): string {
  let h = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

function parseBrandJson(text: string): { brandOneLine?: string; colors?: string; industry?: string; tone?: string } | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// AI 画像生成 (gpt-image-2)
//   配信用クリエイティブ・バナー・告知画像を生成して R2 に保存、公開 URL を返す。
//   生成された URL は LINE messaging API の image タイプにそのまま渡せる。
aiGenerate.post('/api/ai-generate/image', async (c) => {
  const lineAccountId = c.req.header('x-line-account-id');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const openaiKey = (c.env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY;
  if (!openaiKey) {
    return c.json({ success: false, error: 'OPENAI_API_KEY not configured. wrangler secret put OPENAI_API_KEY を実行してください。' }, 503);
  }

  const body = await c.req.json<{
    prompt?: string;
    size?: '1024x1024' | '1024x1536' | '1536x1024';
    referenceImageBase64?: string;
  }>().catch(() => ({} as { prompt?: string; size?: '1024x1024' | '1024x1536' | '1536x1024'; referenceImageBase64?: string }));

  if (!body.prompt?.trim()) {
    return c.json({ success: false, error: 'prompt is required' }, 400);
  }

  try {
    const { generateImage } = await import('../lib/image-gen.js');
    const { imageBase64 } = await generateImage({
      apiKey: openaiKey,
      prompt: body.prompt.trim(),
      size: body.size ?? '1024x1024',
      previousImageBase64: body.referenceImageBase64,
    });

    // R2 に保存して /api/broadcast-images/<key> 経由で公開
    const bin = base64ToUint8Array(imageBase64);
    const key = `broadcast-images/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.png`;
    await c.env.IMAGES.put(key, bin, { httpMetadata: { contentType: 'image/png' } });
    const origin = c.env.WORKER_URL || new URL(c.req.url).origin;
    const imageUrl = `${origin}/api/broadcast-images/${encodeURIComponent(key)}`;

    // gpt-image-2 はサイズ依存: 1024x1024 ≈ $0.04, 1536x1024 ≈ $0.06
    const cents = body.size === '1024x1024' ? 4 : 6; // USD 0.01 単位
    const costYenX100 = Math.ceil(cents * 1.5 * 100); // 1 USD = 150 円換算

    await recordUsage(c.env.DB, {
      lineAccountId,
      feature: 'image_gen',
      model: 'gpt-image-2',
      inputTokens: 0,
      outputTokens: 0,
      costYenX100,
    });

    return c.json({
      success: true,
      imageUrl,
      r2Key: key,
      costYenX100,
    });
  } catch (e) {
    console.error('[ai-generate/image] failed:', e);
    return c.json({ success: false, error: e instanceof Error ? e.message : 'image generation failed' }, 500);
  }
});

function base64ToUint8Array(base64: string): Uint8Array {
  const binStr = atob(base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

aiGenerate.post('/api/ai-generate/text', async (c) => {
  const lineAccountId = c.req.header('x-line-account-id');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }

  const body = await c.req.json<{
    kind?: string;
    context?: Record<string, unknown>;
    hint?: string;
    imageDataUrl?: string;
    previousVariants?: string[];
  }>();

  if (!body.kind || !VALID_KINDS.includes(body.kind as AiGenerateKind)) {
    return c.json(
      { success: false, error: `invalid kind. allowed: ${VALID_KINDS.join(', ')}` },
      400,
    );
  }

  // テナントの業界を取得 (playbook 選択用)
  const account = await getLineAccountById(c.env.DB, lineAccountId);
  if (!account) {
    return c.json({ success: false, error: 'line account not found' }, 404);
  }
  const industry = (account as { agency_industry?: string | null }).agency_industry ?? undefined;

  try {
    const result = await generateAiText(c.env.DB, apiKey, lineAccountId, industry ?? undefined, {
      kind: body.kind as AiGenerateKind,
      context: body.context ?? {},
      hint: body.hint,
      imageDataUrl: body.imageDataUrl,
      previousVariants: body.previousVariants,
    }, { jinaApiKey: (c.env as { JINA_API_KEY?: string }).JINA_API_KEY });

    // コスト計上
    await recordUsage(c.env.DB, {
      lineAccountId,
      feature: 'copy_gen',
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costYenX100: result.costYenX100,
    });

    return c.json({
      success: true,
      text: result.text,
      costYenX100: result.costYenX100,
      model: result.model,
    });
  } catch (e) {
    console.error('[ai-generate/text] failed:', e);
    return c.json(
      { success: false, error: e instanceof Error ? e.message : 'generate failed' },
      500,
    );
  }
});

/**
 * リッチメニュー画像の AI 生成エンドポイント
 *
 * POST /api/rich-menu-images/generate
 *   body:
 *     - prompt: string                   ユーザー入力プロンプト
 *     - size: 'large' | 'compact'        リッチメニューサイズ
 *     - variationIndex?: number          バリエーション # (0-based)
 *     - totalCount?: number              総生成枚数（VARIATION_HINTS を入れる時用）
 *     - revisionRequest?: string         修正依頼文
 *     - previousImageBase64?: string     修正対象の元画像 (revisionRequest と一緒に渡す)
 *     - defaultsText?: string            スタイルガイド (毎回入れたい訴求)
 *   resp: { success: true, imageBase64: string, mimeType: string }
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const richMenuImagesAi = new Hono<Env & { Bindings: { OPENAI_API_KEY?: string } }>();

const VARIATION_HINTS = [
  'シンプル・ミニマルで余白を活かしたレイアウト。洗練されたスペースの使い方を意識する',
  'ビビッドなカラーとインパクト重視の大胆な構成。視線を一瞬でつかむデザイン',
  'ナチュラルで温かみのある雰囲気。柔らかいトーンと自然素材感のあるデザイン',
  'ダークトーンで高級感・上質感を演出。黒や深いネイビーを基調とした洗練されたデザイン',
  'パステルカラーで柔らかく親しみやすい印象。明るく爽やかなデザイン',
  '幾何学的なシェイプを活用したモダンなデザイン。直線や円を効果的に使用',
  'グラデーション背景を活用した洗練されたデザイン。色の移り変わりが印象的',
  'ポップでカジュアル、幅広い層に親しみやすいデザイン。カラフルで明るい雰囲気',
];

richMenuImagesAi.post('/api/rich-menu-images/generate', async (c) => {
  const apiKey = c.env.OPENAI_API_KEY;
  if (!apiKey) {
    return c.json(
      { success: false, error: 'OPENAI_API_KEY が未設定です。管理者にお問い合わせください。' },
      503,
    );
  }

  const body = await c.req.json<{
    prompt?: string;
    size?: 'large' | 'compact';
    variationIndex?: number;
    totalCount?: number;
    revisionRequest?: string;
    previousImageBase64?: string;
    defaultsText?: string;
  }>();
  const prompt = (body.prompt ?? '').trim();
  const size = body.size ?? 'large';
  const variationIndex = typeof body.variationIndex === 'number' ? body.variationIndex : undefined;
  const totalCount = typeof body.totalCount === 'number' ? body.totalCount : undefined;
  const revisionRequest = (body.revisionRequest ?? '').trim();
  const previousImageBase64 = body.previousImageBase64 ?? '';
  const defaultsText = (body.defaultsText ?? '').trim();

  if (!prompt && !revisionRequest) {
    return c.json({ success: false, error: 'prompt or revisionRequest is required' }, 400);
  }
  if (prompt.length > 4000 || revisionRequest.length > 4000) {
    return c.json({ success: false, error: 'prompt too long (max 4000 chars)' }, 400);
  }

  // gpt-image-2 対応サイズ: 1024x1024 / 1024x1536 / 1536x1024
  // リッチメニューは横長 → 1536x1024 を使う（クライアント側で 2500×1686 or 2500×843 にリサイズ）
  const apiSize: '1024x1024' | '1024x1536' | '1536x1024' = '1536x1024';

  const fullPrompt = revisionRequest
    ? buildRevisionPrompt(prompt, revisionRequest, defaultsText, size)
    : buildGenerationPrompt(prompt, size, defaultsText, variationIndex, totalCount);

  try {
    let imageBase64: string;

    if (revisionRequest && previousImageBase64) {
      // 修正モード: images/edits API
      const formData = new FormData();
      formData.append('model', 'gpt-image-2');
      formData.append('prompt', fullPrompt);
      formData.append('size', apiSize);
      // base64 → Blob → File
      const bin = base64ToUint8Array(previousImageBase64);
      formData.append('image', new Blob([bin], { type: 'image/png' }), 'previous.png');

      const resp = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[rich-menu-image-ai] OpenAI edit error', resp.status, errText.slice(0, 500));
        return c.json({ success: false, error: parseOpenAiError(errText) }, 502);
      }
      const json = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      imageBase64 = await extractBase64(json);
    } else {
      // 新規生成
      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-image-2',
          prompt: fullPrompt,
          size: apiSize,
          n: 1,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[rich-menu-image-ai] OpenAI gen error', resp.status, errText.slice(0, 500));
        return c.json({ success: false, error: parseOpenAiError(errText) }, 502);
      }
      const json = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
      imageBase64 = await extractBase64(json);
    }

    return c.json({ success: true, imageBase64, mimeType: 'image/png' });
  } catch (e) {
    console.error('[rich-menu-image-ai] generate failed:', e);
    return c.json(
      { success: false, error: e instanceof Error ? e.message : 'generate failed' },
      500,
    );
  }
});

function buildGenerationPrompt(
  userPrompt: string,
  size: 'large' | 'compact',
  defaultsText: string,
  variationIndex?: number,
  totalCount?: number,
): string {
  const layout =
    size === 'large'
      ? '画像はアスペクト比 3:2 の横長。LINE リッチメニュー Large (2500×1686) として使う前提。3×2 (6 タイル) または 2×3 のグリッド配置を意識した構成にすること。'
      : '画像は超横長（≒3:1 アスペクト）。LINE リッチメニュー Compact (2500×843) として使う前提。1×3 (3 タイル横並び) のグリッド配置を意識した構成にすること。';

  const variationHint =
    variationIndex !== undefined && totalCount !== undefined && totalCount > 1
      ? `\n【デザインバリエーション ${variationIndex + 1}/${totalCount}】\n${VARIATION_HINTS[variationIndex % VARIATION_HINTS.length]}\n`
      : '';

  const defaultsBlock = defaultsText
    ? `\n【スタイルガイド（必ず守る）】\n${defaultsText}\n`
    : '';

  return `LINE 公式アカウントのリッチメニュー画像を生成してください。
${variationHint}
【ユーザーからの依頼】
${userPrompt}

【レイアウト要件】
${layout}

【共通ルール】
- 文字は入れない（後でタップ領域に応じてオーバーレイで配置するため）
- グリッドの境界が視覚的に分かるように、各タイルにアイコン的なシンボルを 1 つずつ配置
- 重要な要素を画像端ギリギリに置かない（LINE で表示時に切れる可能性）
- プロフェッショナルで品のあるデザイン、過度な装飾は避ける
- 配色は 2〜3 色に絞り、ブランドの世界観を保つ
${defaultsBlock}`;
}

function buildRevisionPrompt(
  basePrompt: string,
  revisionRequest: string,
  defaultsText: string,
  size: 'large' | 'compact',
): string {
  const layout = size === 'large' ? '3×2 (6 タイル) 配置の横長 (3:2)' : '1×3 (3 タイル) 配置の超横長 (3:1)';
  const defaultsBlock = defaultsText ? `\n【維持すべきスタイルガイド】\n${defaultsText}\n` : '';
  return `以下の画像を修正してください。

【修正内容】
${revisionRequest}

【元の依頼】
${basePrompt}

【守るべき要件】
- レイアウト: ${layout}
- 文字を入れない（タップ領域オーバーレイ前提）
- グリッド境界が分かる
- 重要要素を端ギリギリに置かない
${defaultsBlock}`;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function extractBase64(json: { data?: Array<{ b64_json?: string; url?: string }> }): Promise<string> {
  const item = json.data?.[0];
  if (!item) throw new Error('画像データが空でした');
  if (item.b64_json) return item.b64_json;
  if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error('画像ダウンロードに失敗');
    const buf = await r.arrayBuffer();
    return arrayBufferToBase64(buf);
  }
  throw new Error('画像データ形式不明');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parseOpenAiError(errText: string): string {
  try {
    const parsed = JSON.parse(errText) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    /* ignore */
  }
  return 'OpenAI 画像生成に失敗しました';
}

/**
 * OpenAI GPT-Image-2 (ChatGPT Image 2) を使った画像生成クライアント
 *
 * Anthropic Claude (callClaude) は文章生成に、こちらは画像生成に使う。
 * 配信用の画像 (1024x1024 や 1536x1024) / リッチメニュー用画像 (1536x1024) を生成。
 *
 * 仕様:
 *   POST https://api.openai.com/v1/images/generations
 *   body: { model: 'gpt-image-2', prompt, size, n }
 *   response: { data: [{ b64_json: '...' }] }
 */

export type ImageGenSize = '1024x1024' | '1024x1536' | '1536x1024';

export interface ImageGenOptions {
  apiKey: string;
  prompt: string;
  size?: ImageGenSize;
  /** 既存画像をベースに修正生成する場合の base64 (PNG) */
  previousImageBase64?: string;
}

export interface ImageGenResult {
  /** base64 (PNG) */
  imageBase64: string;
  mimeType: 'image/png';
}

export async function generateImage(opts: ImageGenOptions): Promise<ImageGenResult> {
  const size: ImageGenSize = opts.size ?? '1024x1024';

  if (opts.previousImageBase64) {
    // 修正モード: images/edits API (multipart)
    const formData = new FormData();
    formData.append('model', 'gpt-image-2');
    formData.append('prompt', opts.prompt);
    formData.append('size', size);
    const bin = base64ToUint8Array(opts.previousImageBase64);
    formData.append('image', new Blob([bin], { type: 'image/png' }), 'previous.png');

    const resp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: formData,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI edit error ${resp.status}: ${parseOpenAiError(text)}`);
    }
    const json = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const imageBase64 = await extractBase64(json);
    return { imageBase64, mimeType: 'image/png' };
  }

  // 新規生成
  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-image-2', prompt: opts.prompt, size, n: 1 }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI gen error ${resp.status}: ${parseOpenAiError(text)}`);
  }
  const json = (await resp.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const imageBase64 = await extractBase64(json);
  return { imageBase64, mimeType: 'image/png' };
}

/** R2 に保存して公開 URL を返す */
export async function generateImageAndUpload(opts: {
  apiKey: string;
  prompt: string;
  size?: ImageGenSize;
  bucket: R2Bucket;
  pathPrefix: string;
  originForUrl: string;
  /** "/api/agency-examples/image/" のようなパス。R2 key から URL を組み立てる時に使う */
  urlPathPrefix: string;
}): Promise<{ image_url: string; r2_key: string }> {
  const { imageBase64 } = await generateImage({
    apiKey: opts.apiKey,
    prompt: opts.prompt,
    size: opts.size,
  });
  const bytes = base64ToUint8Array(imageBase64);
  const key = `${opts.pathPrefix}${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.png`;
  await opts.bucket.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
  const url = `${opts.originForUrl}${opts.urlPathPrefix}${encodeURIComponent(key)}`;
  return { image_url: url, r2_key: key };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64ToUint8Array(base64: string): Uint8Array {
  const binStr = atob(base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

async function extractBase64(json: {
  data?: Array<{ b64_json?: string; url?: string }>;
}): Promise<string> {
  const first = json.data?.[0];
  if (first?.b64_json) return first.b64_json;
  if (first?.url) {
    // url モードの場合、取得して base64 化
    const res = await fetch(first.url);
    if (!res.ok) throw new Error(`fetch image url failed: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin);
  }
  throw new Error('OpenAI response missing image data');
}

function parseOpenAiError(text: string): string {
  try {
    const obj = JSON.parse(text) as { error?: { message?: string; type?: string } };
    if (obj.error?.message) return obj.error.message;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 200);
}

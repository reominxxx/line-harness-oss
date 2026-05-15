/**
 * Anthropic Claude API クライアント（fetch ベース）
 *
 * SDK 依存を増やさず、Cloudflare Workers でそのまま動く軽量クライアント。
 * ストリーミング非対応、純粋な「投げて結果を受け取る」ユースケース向け。
 */

export type ClaudeModel =
  | 'claude-haiku-4-5-20251001'  // 軽量・高速・安価
  | 'claude-sonnet-4-6'           // 標準性能
  | 'claude-opus-4-7';            // 最高性能

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
      >;
}

export interface ClaudeCallOptions {
  apiKey: string;
  model: ClaudeModel;
  system?: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ClaudeCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costYenX100: number;
  model: ClaudeModel;
  stopReason: string;
}

/**
 * モデル別の円換算価格（× 100 倍で保存、1000 トークンあたり）
 * 為替レート $1 = ¥150 想定の概算。実コストは Anthropic ダッシュボード参照。
 */
const PRICING_PER_1K_X100: Record<ClaudeModel, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 15, output: 75 },   // $1/$5 per MTok
  'claude-sonnet-4-6':          { input: 45, output: 225 }, // $3/$15 per MTok
  'claude-opus-4-7':            { input: 225, output: 1125 }, // $15/$75 per MTok
};

export function estimateCostYenX100(
  model: ClaudeModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING_PER_1K_X100[model];
  const input = (inputTokens / 1000) * p.input;
  const output = (outputTokens / 1000) * p.output;
  return Math.ceil(input + output);
}

/** Anthropic API を呼び出す */
export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    messages: opts.messages,
  };
  if (opts.system) body.system = opts.system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  type AnthropicResponse = {
    content: Array<{ type: 'text'; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
    stop_reason: string;
  };
  const data = await response.json<AnthropicResponse>();

  const text = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
  const inputTokens = data.usage.input_tokens;
  const outputTokens = data.usage.output_tokens;
  const costYenX100 = estimateCostYenX100(opts.model, inputTokens, outputTokens);

  return {
    text,
    inputTokens,
    outputTokens,
    costYenX100,
    model: opts.model,
    stopReason: data.stop_reason,
  };
}

/**
 * 簡易ハッシュ（キャッシュキー生成用）
 * 注：暗号学的強度は不要。同じ質問が同じハッシュになることだけが重要。
 */
export async function simpleHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text.trim().toLowerCase());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

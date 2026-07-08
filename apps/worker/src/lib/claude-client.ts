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
        | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      >;
}

/**
 * Claude Tool Use (Function Calling) のツール定義
 * https://docs.anthropic.com/en/docs/build-with-claude/tool-use
 */
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[]; items?: unknown }>;
    required?: string[];
  };
}

/** Claude が出力する tool_use ブロック */
export interface ClaudeToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * system プロンプトのブロック。cache_control を付けると、Anthropic 側で
 * そのブロックを 5 分間 (ephemeral) キャッシュし、再利用時の入力コストが
 * 約 10% (= 90% off) になる。
 *
 * - 基盤プロンプト・業界モジュールなど "静的" なものはキャッシュ対象
 * - 顧客文脈・直近会話など "動的" なものはキャッシュしない (5 分でも変わる)
 */
export interface ClaudeSystemBlock {
  type: 'text';
  text: string;
  /**
   * ttl 省略時は 5 分 (ephemeral デフォルト)。'1h' を指定すると 1 時間保持され、
   * 散発的な呼び出し (例: 配信プレビューを数回試す) でもキャッシュ読み出しに乗りやすくなる。
   * 1h は書き込みコストが 5m より高い (write 2x) が、1 時間内に 2 回以上ヒットすれば得。
   */
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
}

export interface ClaudeCallOptions {
  apiKey: string;
  model: ClaudeModel;
  /** 単純文字列または cache_control 付きブロック配列 */
  system?: string | ClaudeSystemBlock[];
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Tool Use 用のツール定義 */
  tools?: ClaudeTool[];
  /** ツール選択戦略: 'auto'=AIが判断 / 'any'=必ずツール / { type:'tool', name } 強制 */
  toolChoice?: { type: 'auto' | 'any' } | { type: 'tool'; name: string };
}

export interface ClaudeCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** キャッシュ書き込みされたトークン (有料、約 +25%) */
  cacheCreationInputTokens: number;
  /** キャッシュから読み出されたトークン (約 10% コスト) */
  cacheReadInputTokens: number;
  costYenX100: number;
  model: ClaudeModel;
  stopReason: string;
  /** Claude が出力した tool_use ブロック (stopReason='tool_use' の時) */
  toolUses: ClaudeToolUse[];
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

/**
 * Anthropic prompt caching の課金倍率
 * - cache write: 通常入力の 1.25x (キャッシュ書き込み時)
 * - cache read:  通常入力の 0.1x  (キャッシュヒット時、ephemeral 5min)
 *
 * "regular input" には cache 関係なし (=1.0x) のトークンを渡す。
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function estimateCostYenX100(
  model: ClaudeModel,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens = 0,
  cacheReadTokens = 0,
): number {
  const p = PRICING_PER_1K_X100[model];
  const input = (inputTokens / 1000) * p.input;
  const output = (outputTokens / 1000) * p.output;
  const cacheWrite = (cacheCreationTokens / 1000) * p.input * CACHE_WRITE_MULTIPLIER;
  const cacheRead = (cacheReadTokens / 1000) * p.input * CACHE_READ_MULTIPLIER;
  return Math.ceil(input + output + cacheWrite + cacheRead);
}

/** Anthropic API を呼び出す
 *
 * @param opts.timeoutMs - fetch を AbortController で打ち切る上限 (ms)。
 *   Cloudflare Workers の waitUntil は ~30 秒で isolate ごと回収されるので、
 *   それより短い値 (例: 25_000) を指定すると、確実に timeout エラーを投げて
 *   catch ブロックで status='error' を DB に書く流れに到達できる。
 *   省略時は 60 秒 (互換性維持)。
 */
export async function callClaude(opts: ClaudeCallOptions & { timeoutMs?: number }): Promise<ClaudeCallResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    messages: opts.messages,
  };
  if (opts.system) body.system = opts.system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;
  if (opts.toolChoice) body.tool_choice = opts.toolChoice;

  // 1 時間キャッシュ (extended cache TTL) を使うブロックがあれば、対応する beta フラグを付ける。
  // GA 済みだが、後方互換のためヘッダを明示しておく (未知フラグでもエラーにはならない)。
  const usesExtendedTtl =
    Array.isArray(opts.system) &&
    opts.system.some((b) => b.cache_control?.ttl === '1h');

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
        ...(usesExtendedTtl ? { 'anthropic-beta': 'extended-cache-ttl-2025-04-11' } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Anthropic API timeout after ${timeoutMs / 1000}s`);
    }
    throw err;
  }
  clearTimeout(timeoutHandle);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  type AnthropicResponseContent =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
  type AnthropicResponse = {
    content: AnthropicResponseContent[];
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    stop_reason: string;
  };
  const data = await response.json<AnthropicResponse>();

  const text = data.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
  const toolUses = data.content
    .filter((c): c is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => c.type === 'tool_use')
    .map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input }));
  const inputTokens = data.usage.input_tokens;
  const outputTokens = data.usage.output_tokens;
  const cacheCreationInputTokens = data.usage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = data.usage.cache_read_input_tokens ?? 0;
  const costYenX100 = estimateCostYenX100(
    opts.model,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
  );

  return {
    text,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    costYenX100,
    model: opts.model,
    stopReason: data.stop_reason,
    toolUses,
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

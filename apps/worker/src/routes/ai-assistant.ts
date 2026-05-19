/**
 * 統一 AI アシスタント API
 *
 * サイドチャットからの対話を受けて、画面コンテキストを踏まえた
 * AI 応答 + 実行可能アクションを返す。
 *
 * POST /api/ai-assistant/execute
 *   body: {
 *     context: { page, selectedFriendId?, selectedBroadcastId?, ... },
 *     message: string,
 *     conversationId?: string,
 *   }
 *   response: {
 *     text: string,
 *     actions: [{ label, type, payload }],
 *     followUp?: string[],
 *     costYen: number,
 *   }
 */

import { Hono } from 'hono';
import { callClaude } from '../lib/claude-client.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import { assembleSystemPrompt } from '@line-crm/db';
import { maskPii } from '../lib/pii-masker.js';
import type { Env } from '../index.js';

export const aiAssistant = new Hono<Env & { Bindings: { ANTHROPIC_API_KEY?: string } }>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

// 管理画面の許可ルート（ここに無いパスへの navigate は禁止）
const ADMIN_ROUTES = [
  '/', '/accounts', '/agent', '/ai-cost', '/ai-products', '/ai-prompts', '/ai-signals',
  '/auto-replies', '/automations', '/booking/bookings', '/booking/menus', '/booking/staff',
  '/broadcasts', '/chat-preview', '/chats', '/client', '/compliance', '/conversions',
  '/duplicates', '/emergency', '/events', '/form-submissions', '/friend-add-settings',
  '/friends', '/health', '/imports', '/inflow-links', '/kb', '/kpi', '/notifications',
  '/pools', '/reminders', '/rich-menus', '/scenarios', '/scoring', '/staff', '/templates',
  '/tenants', '/users', '/webhooks',
] as const;

// 顧客画面の許可ルート
const CLIENT_ROUTES = [
  '/client', '/client/approvals', '/client/broadcasts', '/client/chat-log',
  '/client/export', '/client/reports',
] as const;

const PAGE_DESCRIPTIONS: Record<string, string> = {
  '/agent': '自動化ダッシュボード（AI ジョブの承認待ち・履歴一覧）',
  '/broadcasts': '一斉配信管理',
  '/scenarios': 'シナリオ（ステップ配信）',
  '/friends': '友だち管理',
  '/chats': '個別チャット',
  '/ai-prompts': 'AI 配信設定（プロンプトモジュール 8 種 + 業界プレイブック）',
  '/kb': 'ナレッジベース（AI が参照する情報）',
  '/ai-products': '商品マスタ',
  '/ai-signals': '顧客シグナル（VIP / ホット / 休眠 等の AI 分類）',
  '/kpi': '自動化設定（プラン・配信本数・自動化レベル）',
  '/ai-cost': 'AI 利用コスト管理',
  '/compliance': '監査ログ・個人情報削除リクエスト',
  '/imports': 'データインポート（L ステップ等から）',
  '/client': 'お客様トップ（顧客がログインして見る画面）',
  '/client/approvals': 'お客様の承認待ち一覧（顧客側）',
  '/client/broadcasts': 'お客様向け配信一覧（顧客側）',
  '/client/chat-log': 'お客様のチャット履歴（顧客側）',
  '/client/export': 'お客様データのエクスポート（顧客側）',
  '/client/reports': 'お客様向けレポート（顧客側）',
};

interface AiAction {
  label: string;
  type: string;
  payload?: Record<string, unknown>;
}

interface AssistantResponse {
  text: string;
  actions: AiAction[];
  followUp: string[];
}

aiAssistant.post('/api/ai-assistant/execute', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }

  const body = await c.req.json<{
    context?: {
      page?: string;
      selectedFriendId?: string | null;
      selectedBroadcastId?: string | null;
      visibleItems?: string[];
    };
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }>();

  if (!body.message || body.message.length < 1 || body.message.length > 4000) {
    return c.json({ success: false, error: 'message required (1-4000 chars)' }, 400);
  }

  // PII マスキング
  const maskedMessage = maskPii(body.message).masked;

  // 画面コンテキスト
  const page = body.context?.page ?? 'unknown';
  const pageDesc = PAGE_DESCRIPTIONS[page] ?? page;

  // ブランドシステムプロンプト
  let brandSystemPrompt = '';
  try {
    const { systemPrompt } = await assembleSystemPrompt(c.env.DB, lineAccountId);
    brandSystemPrompt = systemPrompt;
  } catch (e) {
    console.warn('[ai-assistant] brand prompt assembly failed:', e);
  }

  // 友だち情報（あれば）
  let friendInfo = '';
  if (body.context?.selectedFriendId) {
    const friend = await c.env.DB
      .prepare(`SELECT display_name, line_user_id, created_at FROM friends WHERE id = ? AND line_account_id = ?`)
      .bind(body.context.selectedFriendId, lineAccountId)
      .first<{ display_name: string | null; line_user_id: string | null; created_at: string }>();
    if (friend) {
      friendInfo = `\n【選択中の友だち】\n表示名: ${friend.display_name ?? '不明'}\n追加日: ${friend.created_at}`;
    }
  }

  const isClientRoute = page.startsWith('/client');

  const routeList = (isClientRoute ? CLIENT_ROUTES : ADMIN_ROUTES).join('\n  - ');

  const systemPrompt = isClientRoute
    ? `あなたは L-アシスト の顧客向けサポート AI です。
事業者（管理者）ではなく、お客様（友だち / 利用者）が使う画面でのサポートを担当します。

【現在の画面】
${page} — ${pageDesc}
${friendInfo}

【役割】
- 機能の使い方を案内する
- 質問に丁寧に答える
- 個人情報や機密情報は扱わない
- 配信や設定の変更などの管理操作は提案しない（管理者画面の機能）

【厳守】
- 簡潔に、3〜5 文以内で回答
- 敬語で柔らかい口調
- 答えられない質問は「事業者へお問い合わせください」と案内
- 質問が曖昧なら聞き返す

【レスポンス形式】
回答は JSON で返してください:
{
  "text": "回答文（マークダウン可）",
  "actions": [
    { "label": "ボタン文言", "type": "navigate", "payload": { "href": "/client/..." } }
  ],
  "followUp": ["次の質問候補 1", "次の質問候補 2"]
}

【navigate アクションのルール（厳守）】
href に指定できるのは以下の **顧客画面ルートだけ**。これ以外のパスは絶対に返さない。/xxx/create や /xxx/new のような子ページは存在しないので使わない。
  - ${routeList}

【アクション type の例】
- "navigate": 顧客画面内の移動（payload: { href }）
- "none": アクションなし（テキスト回答のみ）`
    : `あなたは L-アシスト（LINE 公式アカウント運用 AI プラットフォーム）の AI アシスタントです。
事業者を助けるため、画面コンテキストを踏まえて的確に回答してください。

【現在の画面】
${page} — ${pageDesc}
${friendInfo}

【ブランド設定】
${brandSystemPrompt.slice(0, 2000)}

【厳守】
- 簡潔に、3〜5 文以内で回答
- 業界規制（薬機法、景表法）を守る
- 配信文や接客文を提案する時は、実際の文面を提示する
- 大量の選択肢を並べるより、最良の 1〜3 案を返す
- 質問が曖昧なら聞き返す

【レスポンス形式】
回答は JSON で返してください:
{
  "text": "回答文（マークダウン可）",
  "actions": [
    { "label": "ボタン文言", "type": "アクション種別", "payload": { ... } }
  ],
  "followUp": ["次の質問候補 1", "次の質問候補 2"]
}

【navigate アクションのルール（厳守）】
href に指定できるのは以下の **管理画面ルートだけ**。これ以外のパスは絶対に返さない。/xxx/create や /xxx/new のような子ページは存在しないので使わない。
  - ${routeList}

【アクション type の例】
- "broadcast.create": 配信を作成（payload: { title, content, targetType }）
- "scenario.create": シナリオ作成（payload: { name, steps }）
- "navigate": ページ遷移（payload: { href、上記リストのみ }）
- "none": アクションなし（テキスト回答のみ）`;

  const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = (body.history ?? [])
    .slice(-6)
    .map((h) => ({
      role: h.role,
      content: h.role === 'user' ? maskPii(h.content).masked : h.content,
    }));

  try {
    const result = await callClaude({
      apiKey,
      model: 'claude-haiku-4-5-20251001',
      system: systemPrompt,
      messages: [
        ...historyMessages,
        { role: 'user', content: maskedMessage },
      ],
      maxTokens: 1500,
      temperature: 0.7,
    });

    await recordUsage(c.env.DB, {
      lineAccountId,
      feature: 'chat',
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costYenX100: result.costYenX100,
    });

    // JSON パース
    let parsed: AssistantResponse = { text: result.text, actions: [], followUp: [] };
    try {
      const match = result.text.match(/\{[\s\S]*\}/);
      if (match) {
        const obj = JSON.parse(match[0]) as Partial<AssistantResponse>;
        parsed = {
          text: typeof obj.text === 'string' ? obj.text : result.text,
          actions: Array.isArray(obj.actions) ? obj.actions.slice(0, 5) : [],
          followUp: Array.isArray(obj.followUp) ? obj.followUp.slice(0, 4) : [],
        };
      }
    } catch (e) {
      // JSON 失敗時はテキストのみ
      console.warn('[ai-assistant] JSON parse failed:', e);
    }

    return c.json({
      success: true,
      text: parsed.text,
      actions: parsed.actions,
      followUp: parsed.followUp,
      costYen: result.costYenX100 / 100,
      model: result.model,
    });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'AI 失敗' }, 500);
  }
});

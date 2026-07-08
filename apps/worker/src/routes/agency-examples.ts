/**
 * 全テナント共有の配信実例ライブラリ API
 *
 * GET    /api/agency-examples                 一覧 (フィルター: industry / broadcast_type / time_of_day / q)
 * GET    /api/agency-examples/:id             詳細
 * POST   /api/agency-examples                 新規作成 (手動入力 or AI 解析結果の確定)
 * PUT    /api/agency-examples/:id             更新
 * DELETE /api/agency-examples/:id             削除
 *
 * POST   /api/agency-examples/parse           テキスト / 画像 / URL から AI で構造化抽出
 * POST   /api/agency-examples/upload-image    R2 への画像アップロード (data URL or base64)
 */

import { Hono } from 'hono';
import {
  listAgencyExamples,
  getAgencyExample,
  createAgencyExample,
  updateAgencyExample,
  deleteAgencyExample,
  type AgencyIndustry,
  type AgencyBroadcastType,
  type AgencyTimeOfDay,
  type AgencyWeekday,
  type AgencySeason,
} from '@line-crm/db';
import { callClaude } from '../lib/claude-client.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import { staffIdForFk } from '../lib/staff-fk.js';
import type { Env } from '../index.js';

export const agencyExamples = new Hono<Env>();

const VALID_INDUSTRIES: AgencyIndustry[] = ['beauty', 'chiropractic', 'ecommerce', 'school', 'legal', 'other'];
const VALID_BROADCAST_TYPES: AgencyBroadcastType[] = [
  'campaign', 'reminder', 'newsletter', 'event', 'limited_offer', 'aftercare', 'welcome', 'reactivation',
];
const VALID_TIME_OF_DAYS: AgencyTimeOfDay[] = ['morning', 'noon', 'afternoon', 'evening', 'night'];
const VALID_WEEKDAYS: AgencyWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const VALID_SEASONS: AgencySeason[] = ['spring', 'summer', 'autumn', 'winter', 'newyear', 'xmas'];

function sanitizeEnum<T extends string>(value: unknown, valid: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  return (valid as readonly string[]).includes(value) ? (value as T) : null;
}

// ---------------------------------------------------------------------------
// 一覧
// ---------------------------------------------------------------------------
agencyExamples.get('/api/agency-examples', async (c) => {
  const url = new URL(c.req.url);
  const includePrivate = url.searchParams.get('include_private') === '1';
  const { rows, total } = await listAgencyExamples(c.env.DB, {
    industry: sanitizeEnum(url.searchParams.get('industry'), VALID_INDUSTRIES) ?? undefined,
    broadcastType:
      sanitizeEnum(url.searchParams.get('broadcast_type'), VALID_BROADCAST_TYPES) ?? undefined,
    timeOfDay: sanitizeEnum(url.searchParams.get('time_of_day'), VALID_TIME_OF_DAYS) ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    limit: Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200),
    offset: Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10), 0),
    includePrivate,
  });
  return c.json({ success: true, examples: rows, total });
});

// ---------------------------------------------------------------------------
// 詳細
// ---------------------------------------------------------------------------
agencyExamples.get('/api/agency-examples/:id', async (c) => {
  const row = await getAgencyExample(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, example: row });
});

// ---------------------------------------------------------------------------
// 新規作成
// ---------------------------------------------------------------------------
agencyExamples.post('/api/agency-examples', async (c) => {
  type Body = {
    industry?: string;
    broadcast_type?: string;
    time_of_day?: string;
    weekday?: string;
    season?: string;
    title?: string;
    content?: string;
    image_url?: string;
    source_url?: string;
    notes?: string;
    tags?: string[];
    is_public?: boolean;
  };
  const body = (await c.req.json<Body>().catch(() => ({}))) as Body;
  if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
    return c.json({ success: false, error: 'content is required' }, 400);
  }
  const staff = c.get('staff');
  const row = await createAgencyExample(c.env.DB, {
    industry: sanitizeEnum(body.industry, VALID_INDUSTRIES),
    broadcastType: sanitizeEnum(body.broadcast_type, VALID_BROADCAST_TYPES),
    timeOfDay: sanitizeEnum(body.time_of_day, VALID_TIME_OF_DAYS),
    weekday: sanitizeEnum(body.weekday, VALID_WEEKDAYS),
    season: sanitizeEnum(body.season, VALID_SEASONS),
    title: body.title ?? null,
    content: body.content,
    imageUrl: body.image_url ?? null,
    sourceUrl: body.source_url ?? null,
    notes: body.notes ?? null,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    isPublic: body.is_public !== false,
    addedBy: staffIdForFk(staff),
  });
  return c.json({ success: true, example: row });
});

// ---------------------------------------------------------------------------
// 更新
// ---------------------------------------------------------------------------
agencyExamples.put('/api/agency-examples/:id', async (c) => {
  type Body = Partial<{
    industry: string;
    broadcast_type: string;
    time_of_day: string;
    weekday: string;
    season: string;
    title: string | null;
    content: string;
    image_url: string | null;
    source_url: string | null;
    notes: string | null;
    tags: string[];
    is_public: boolean;
  }>;
  const body = (await c.req.json<Body>().catch(() => ({}))) as Body;
  const row = await updateAgencyExample(c.env.DB, c.req.param('id'), {
    industry: body.industry !== undefined ? sanitizeEnum(body.industry, VALID_INDUSTRIES) : undefined,
    broadcastType:
      body.broadcast_type !== undefined ? sanitizeEnum(body.broadcast_type, VALID_BROADCAST_TYPES) : undefined,
    timeOfDay:
      body.time_of_day !== undefined ? sanitizeEnum(body.time_of_day, VALID_TIME_OF_DAYS) : undefined,
    weekday: body.weekday !== undefined ? sanitizeEnum(body.weekday, VALID_WEEKDAYS) : undefined,
    season: body.season !== undefined ? sanitizeEnum(body.season, VALID_SEASONS) : undefined,
    title: body.title,
    content: body.content,
    imageUrl: body.image_url,
    sourceUrl: body.source_url,
    notes: body.notes,
    tags: body.tags,
    isPublic: body.is_public,
  });
  if (!row) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, example: row });
});

// ---------------------------------------------------------------------------
// 削除
// ---------------------------------------------------------------------------
agencyExamples.delete('/api/agency-examples/:id', async (c) => {
  await deleteAgencyExample(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// AI 解析: テキスト / 画像 / URL から構造化抽出
// ---------------------------------------------------------------------------
agencyExamples.post('/api/agency-examples/parse', async (c) => {
  type Body = {
    source: 'text' | 'image' | 'url';
    text?: string;
    image_url?: string;
    url?: string;
  };
  const body = (await c.req.json<Body>().catch(() => ({} as Body))) as Body;
  if (!body.source || !['text', 'image', 'url'].includes(body.source)) {
    return c.json({ success: false, error: 'invalid source' }, 400);
  }

  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);

  const system = `あなたは LINE 公式アカウントの配信実例を分類するアシスタントです。
ユーザーから渡された LINE トーク画面のスクショ / 配信文テキスト / Web ページから、
以下の JSON を抽出してください。確実に判定できる項目だけ埋め、自信がないものは null にしてください。

【出力 JSON】
{
  "industry": "beauty" | "chiropractic" | "ecommerce" | "school" | "legal" | "other" | null,
  "broadcast_type": "campaign" | "reminder" | "newsletter" | "event" | "limited_offer" | "aftercare" | "welcome" | "reactivation" | null,
  "time_of_day": "morning" | "noon" | "afternoon" | "evening" | "night" | null,
  "weekday": "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | null,
  "season": "spring" | "summer" | "autumn" | "winter" | "newyear" | "xmas" | null,
  "title": "30 字以内の見出し" | null,
  "content": "配信本文の要点 (※ 400 字以内に要約。サイトのメニュー一覧やリンク集など実例と無関係なテキストはカット)",
  "tags": ["自由タグ最大 5 個"],
  "notes": "気づいたポイント (押し売り感が無い等)、null OK"
}

【重要】
- content は **400 字以内** に必ず要約する。HTML を貼り付けたり、ナビゲーション・サイトメニューをそのまま入れない
- JSON のみを出力。前後に説明文や \`\`\`json コードフェンス を付けない (純粋な JSON 1 個だけ)`;

  let userContent: Parameters<typeof callClaude>[0]['messages'][number]['content'];
  if (body.source === 'image') {
    if (!body.image_url) return c.json({ success: false, error: 'image_url required' }, 400);
    userContent = [
      { type: 'text', text: 'この LINE 配信のスクショを分析してください。' },
      { type: 'image', source: { type: 'url', url: body.image_url } },
    ];
  } else if (body.source === 'url') {
    if (!body.url) return c.json({ success: false, error: 'url required' }, 400);
    let pageText = '';
    try {
      const res = await fetch(body.url);
      const html = await res.text();
      // ざっくり HTML タグ削除して text 抽出
      pageText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
    } catch (e) {
      return c.json({ success: false, error: `failed to fetch URL: ${e instanceof Error ? e.message : 'unknown'}` }, 502);
    }
    userContent = `参照 URL: ${body.url}\n\n---本文---\n${pageText}`;
  } else {
    if (!body.text || body.text.trim().length === 0) return c.json({ success: false, error: 'text required' }, 400);
    userContent = body.text;
  }

  try {
    const result = await callClaude({
      apiKey,
      model: body.source === 'image' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
      system,
      messages: [{ role: 'user', content: userContent }],
      // 旧 600 だと content フィールドに長文が来た瞬間 truncate → JSON 不完全 → parse 失敗を頻発。
      // 2000 に拡張、content も system prompt で 400 字制約付け
      maxTokens: 2000,
      temperature: 0.3,
    });
    // AI が ```json ... ``` で wrap して返すケースを剥がす
    let text = result.text.trim();
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) text = fenceMatch[1].trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return c.json({ success: false, error: 'AI did not return JSON', raw: result.text }, 502);
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return c.json({ success: false, error: 'AI JSON parse failed', raw: result.text }, 502);
    }
    // バリデーション (enum を許容値にだけ絞る)
    const sanitized = {
      industry: sanitizeEnum(parsed.industry, VALID_INDUSTRIES),
      broadcast_type: sanitizeEnum(parsed.broadcast_type, VALID_BROADCAST_TYPES),
      time_of_day: sanitizeEnum(parsed.time_of_day, VALID_TIME_OF_DAYS),
      weekday: sanitizeEnum(parsed.weekday, VALID_WEEKDAYS),
      season: sanitizeEnum(parsed.season, VALID_SEASONS),
      title: typeof parsed.title === 'string' ? parsed.title : null,
      content: typeof parsed.content === 'string' ? parsed.content : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string').slice(0, 5) : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : null,
    };
    // コスト記録 (intent feature を流用): 有効な line_account_id があれば記録
    // 'global' は FK 違反になるため、x-line-account-id が実在するアカウントを指す時のみ
    const headerAccountId = c.req.header('x-line-account-id') ?? '';
    if (headerAccountId && headerAccountId !== 'global') {
      const exists = await c.env.DB
        .prepare(`SELECT id FROM line_accounts WHERE id = ? LIMIT 1`)
        .bind(headerAccountId)
        .first<{ id: string }>();
      if (exists) {
        await recordUsage(c.env.DB, {
          lineAccountId: headerAccountId,
          feature: 'intent',
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costYenX100: result.costYenX100,
        });
      }
    }
    return c.json({
      success: true,
      parsed: sanitized,
      meta: {
        model: result.model,
        costYen: result.costYenX100 / 100,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'parse failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// 画像アップロード (data URL or base64 を受け取って R2 に保存し公開 URL を返す)
// ---------------------------------------------------------------------------
agencyExamples.post('/api/agency-examples/upload-image', async (c) => {
  type Body = { data: string; content_type?: string };
  const body = (await c.req.json<Body>().catch(() => ({} as Body))) as Body;
  if (!body.data) return c.json({ success: false, error: 'data required' }, 400);

  let base64 = body.data;
  let contentType = body.content_type ?? 'image/png';
  if (base64.startsWith('data:')) {
    const m = base64.match(/^data:([^;]+);base64,(.*)$/);
    if (m) {
      contentType = m[1];
      base64 = m[2];
    }
  }
  let bytes: Uint8Array;
  try {
    const binStr = atob(base64);
    bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  } catch {
    return c.json({ success: false, error: 'invalid base64' }, 400);
  }
  const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'bin';
  const key = `agency-examples/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
  const url = `${new URL(c.req.url).origin}/api/agency-examples/image/${encodeURIComponent(key)}`;
  return c.json({ success: true, image_url: url, r2_key: key });
});

// 画像配信 (Authorization 不要、推測困難な UUID パスなので公開)
agencyExamples.get('/api/agency-examples/image/:key{.+}', async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  if (!key.startsWith('agency-examples/')) return c.json({ success: false }, 404);
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.json({ success: false }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('cache-control', 'public, max-age=86400');
  return new Response(obj.body, { headers });
});

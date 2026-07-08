/**
 * YouTube 動画から運用代行ノウハウを取り込んで実例ライブラリに保存する。
 *
 * POST /api/youtube-ingest/preview
 *   body: { url: string }
 *   resp: { success, videoId, title, author, transcript, parsed: { title, content, industry, broadcastType, notes } }
 *   → ユーザーに確認させてから保存させる
 *
 * POST /api/youtube-ingest/save
 *   body: { url, parsed: {...}, transcriptSample?: string }
 *   resp: { success, example }
 *   → agency_examples に INSERT
 *
 * 字幕取得の仕組み:
 *   1. https://www.youtube.com/watch?v=ID の HTML を fetch
 *   2. ytInitialPlayerResponse の "captionTracks" JSON を抽出
 *   3. baseUrl に GET → XML (timedtext) 取得
 *   4. <text> タグから本文抽出
 *   日本語優先、無ければ英語、それも無ければ取得失敗。
 *   字幕取得が失敗してもタイトル+説明だけで Claude に投げる。
 */

import { Hono } from 'hono';
import { createAgencyExample, type AgencyIndustry, type AgencyBroadcastType } from '@line-crm/db';
import { callClaude } from '../lib/claude-client.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import type { Env } from '../index.js';

export const youtubeIngest = new Hono<Env>();

const SYSTEM_PROMPT = `あなたは LINE 公式アカウント運用代行のノウハウキュレーターです。
YouTube 動画 (運用代行・LINE マーケ・販促ノウハウ系) の字幕や説明を読んで、
L-portの "実例ライブラリ" に保存するための要約データを JSON で返してください。

【出力 JSON】
{
  "title": "見出し (60文字以内)",
  "content": "実例ライブラリ本文 (400〜700文字)。配信文を書く際の参考になる具体的なノウハウ・テンプレート・言い回し・順序・心理トリガー等を凝縮。動画の宣伝・脱線は除外。",
  "industry": "beauty | chiropractic | ecommerce | school | legal | other" (該当しなければ "other"),
  "broadcastType": "campaign | reminder | newsletter | event | limited_offer | aftercare | welcome | reactivation" (該当しなければ null),
  "notes": "効果・補足メモ (例: 開封率 35%、視聴数 12 万回 等わかる範囲で。なければ空文字)",
  "tags": ["自由タグ", "..."]
}

【守るべきこと】
- 動画タイトルそのままは使わない。中身を読んでノウハウのエッセンスをまとめる
- 動画ホストの名前・チャンネル名は混ぜない (ブランド固有の宣伝は除外)
- 実用的な配信テンプレや言い回しがあれば、そのまま使える形で content に含める`;

interface ParsedExample {
  title?: string;
  content?: string;
  industry?: string;
  broadcastType?: string | null;
  notes?: string;
  tags?: string[];
}

interface VideoMetadata {
  title: string;
  author: string;
  transcript: string;
  transcriptLang: string | null;
}

// プレビュー: 字幕取得 + Claude 要約 → 結果をフロントに返す (まだ保存しない)
youtubeIngest.post('/api/youtube-ingest/preview', async (c) => {
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);

  const body = await c.req.json<{ url?: string }>();
  const url = (body.url ?? '').trim();
  if (!url) return c.json({ success: false, error: 'url is required' }, 400);

  const videoId = extractVideoId(url);
  if (!videoId) return c.json({ success: false, error: '有効な YouTube URL ではありません' }, 400);

  let meta: VideoMetadata;
  try {
    meta = await fetchVideoMetadata(videoId);
  } catch (e) {
    return c.json(
      { success: false, error: e instanceof Error ? e.message : '動画情報の取得に失敗' },
      502,
    );
  }

  // Claude に投げる本文 (字幕無いときはタイトル+author だけ)
  const userText = meta.transcript
    ? `【動画タイトル】${meta.title}\n【チャンネル】${meta.author}\n【字幕言語】${meta.transcriptLang ?? '不明'}\n\n【字幕本文 (一部抜粋可)】\n${meta.transcript.slice(0, 10000)}`
    : `【動画タイトル】${meta.title}\n【チャンネル】${meta.author}\n\n字幕が取得できなかったので、タイトルだけからノウハウを推測してください (推測なので content に "(タイトルベース推定)" と書いて)`;

  const result = await callClaude({
    apiKey,
    model: 'claude-sonnet-4-6',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
    maxTokens: 1500,
    temperature: 0.4,
  });

  const lineAccountId = c.req.header('x-line-account-id');
  if (lineAccountId) {
    try {
      await recordUsage(c.env.DB, {
        lineAccountId,
        feature: 'batch_analysis',
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costYenX100: result.costYenX100,
      });
    } catch {
      /* not critical */
    }
  }

  let parsed: ParsedExample = {};
  try {
    const m = result.text.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]) as ParsedExample;
  } catch {
    return c.json(
      {
        success: false,
        error: 'AI 応答の JSON 解析に失敗',
        rawText: result.text,
        videoId,
        title: meta.title,
        author: meta.author,
      },
      500,
    );
  }

  return c.json({
    success: true,
    videoId,
    title: meta.title,
    author: meta.author,
    transcriptLang: meta.transcriptLang,
    transcriptLength: meta.transcript.length,
    transcriptSample: meta.transcript.slice(0, 500),
    parsed,
    costYenX100: result.costYenX100,
  });
});

// 保存: フロントが編集した結果を agency_examples に INSERT
youtubeIngest.post('/api/youtube-ingest/save', async (c) => {
  const body = await c.req.json<{
    url?: string;
    parsed?: ParsedExample;
  }>();
  if (!body.url || !body.parsed?.content) {
    return c.json({ success: false, error: 'url と parsed.content が必須' }, 400);
  }

  const industry = isValidIndustry(body.parsed.industry) ? (body.parsed.industry as AgencyIndustry) : null;
  const broadcastType = isValidBroadcastType(body.parsed.broadcastType)
    ? (body.parsed.broadcastType as AgencyBroadcastType)
    : null;

  const example = await createAgencyExample(c.env.DB, {
    industry,
    broadcastType,
    title: body.parsed.title ?? null,
    content: body.parsed.content,
    sourceUrl: body.url,
    notes: body.parsed.notes ?? null,
    tags: body.parsed.tags ?? [],
    isPublic: true,
  });

  return c.json({ success: true, example });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  // 1. oembed で title / author
  const oembedRes = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
  );
  if (!oembedRes.ok) {
    throw new Error('動画が見つかりません (oEmbed 失敗)');
  }
  const oembed = (await oembedRes.json()) as { title?: string; author_name?: string };
  const title = oembed.title ?? '(タイトル取得失敗)';
  const author = oembed.author_name ?? '(チャンネル不明)';

  // 2. ページ HTML から captionTracks を抽出
  let transcript = '';
  let transcriptLang: string | null = null;
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const m = html.match(/"captionTracks":(\[[^\]]+\])/);
      if (m) {
        const tracks = JSON.parse(m[1]) as Array<{ baseUrl?: string; languageCode?: string; kind?: string }>;
        const preferred =
          tracks.find((t) => t.languageCode === 'ja') ??
          tracks.find((t) => t.languageCode === 'en') ??
          tracks[0];
        if (preferred?.baseUrl) {
          transcriptLang = preferred.languageCode ?? null;
          const xmlRes = await fetch(preferred.baseUrl);
          if (xmlRes.ok) {
            const xml = await xmlRes.text();
            const lines = [...xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((mm) =>
              decodeHtmlEntities(mm[1]),
            );
            transcript = lines.join(' ').replace(/\s+/g, ' ').trim();
          }
        }
      }
    }
  } catch {
    /* 字幕取得失敗は致命的ではない */
  }

  return { title, author, transcript, transcriptLang };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

const VALID_INDUSTRIES = ['beauty', 'chiropractic', 'ecommerce', 'school', 'legal', 'other'];
const VALID_BROADCAST_TYPES = [
  'campaign',
  'reminder',
  'newsletter',
  'event',
  'limited_offer',
  'aftercare',
  'welcome',
  'reactivation',
];

function isValidIndustry(v: unknown): boolean {
  return typeof v === 'string' && VALID_INDUSTRIES.includes(v);
}
function isValidBroadcastType(v: unknown): boolean {
  return typeof v === 'string' && VALID_BROADCAST_TYPES.includes(v);
}

/**
 * セグメントタグ API
 *
 * アカウント別のカスタムセグメントタグ (例: 鼻悩み / 肌乾燥) の CRUD と、
 * AI による全友だち一括判定を提供する。
 *
 * GET    /api/segment-tags                          一覧 (X-Line-Account-Id)
 * POST   /api/segment-tags                          新規作成
 * GET    /api/segment-tags/:id                      個別取得
 * PATCH  /api/segment-tags/:id                      更新
 * DELETE /api/segment-tags/:id                      削除
 * GET    /api/segment-tags/:id/friends              タグ付与済友だち一覧
 * POST   /api/segment-tags/:id/run-ai               AI 判定実行 (全友だち)
 * POST   /api/segment-tags/:id/generate-broadcast   このセグメント向け配信案を生成
 * POST   /api/segment-tags/:id/friends/:friendId    手動付与
 * DELETE /api/segment-tags/:id/friends/:friendId    手動解除
 */

import { Hono } from 'hono';
import {
  listSegmentTags,
  getSegmentTag,
  createSegmentTag,
  updateSegmentTag,
  deleteSegmentTag,
  listFriendsBySegmentTag,
  assignFriendSegmentTag,
  removeFriendSegmentTag,
  markSegmentTagRun,
  recountSegmentTagAssignments,
} from '@line-crm/db';
import { callClaude } from '../lib/claude-client.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import { NO_MARKDOWN_RULE, COMPLIANCE_RULE, stripMarkdown } from '../services/ai-shared-prompts.js';
import { ENGAGEMENT_SEGMENTS, engagementCondition } from '../services/engagement.js';
import type { Env } from '../index.js';

export const segmentTags = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

// 一覧
segmentTags.get('/api/segment-tags', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const items = await listSegmentTags(c.env.DB, accountId);
  return c.json({ success: true, items });
});

// エンゲージメント仮想セグメント (休眠 / 見込み / ホット) を直近30日の反応回数から
// その場集計して返す。DB 非保存・常に最新。セグメント配信ページが実セグメントと
// 並べて表示するために使う。
segmentTags.get('/api/segment-tags/engagement', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const items = await Promise.all(
    ENGAGEMENT_SEGMENTS.map(async (seg) => {
      const row = await c.env.DB
        .prepare(
          `SELECT COUNT(*) AS count FROM friends f
            WHERE f.line_account_id = ? AND f.is_following = 1
              AND ${engagementCondition(seg.level, 'f')}`,
        )
        .bind(accountId)
        .first<{ count: number }>();
      return {
        id: seg.id,
        level: seg.level,
        name: seg.name,
        color: seg.color,
        description: seg.description,
        count: row?.count ?? 0,
      };
    }),
  );
  return c.json({ success: true, items });
});

// 個別
segmentTags.get('/api/segment-tags/:id', async (c) => {
  const tag = await getSegmentTag(c.env.DB, c.req.param('id'));
  if (!tag) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, tag });
});

// 新規作成
segmentTags.post('/api/segment-tags', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const body = await c.req.json<{ name?: string; criteria?: string; color?: string; isAiManaged?: boolean }>();
  if (!body.name?.trim()) return c.json({ success: false, error: 'name is required' }, 400);
  if (!body.criteria?.trim()) return c.json({ success: false, error: 'criteria is required' }, 400);
  try {
    const tag = await createSegmentTag(c.env.DB, {
      lineAccountId: accountId,
      name: body.name.trim(),
      criteria: body.criteria.trim(),
      color: body.color,
      isAiManaged: body.isAiManaged,
    });
    return c.json({ success: true, tag });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed to create';
    if (/UNIQUE/i.test(msg)) return c.json({ success: false, error: '同名のタグが既に存在します' }, 409);
    return c.json({ success: false, error: msg }, 500);
  }
});

// 更新
segmentTags.patch('/api/segment-tags/:id', async (c) => {
  const body = await c.req.json<{ name?: string; criteria?: string; color?: string; isAiManaged?: boolean }>();
  const tag = await updateSegmentTag(c.env.DB, c.req.param('id'), body);
  if (!tag) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, tag });
});

// 削除
segmentTags.delete('/api/segment-tags/:id', async (c) => {
  await deleteSegmentTag(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

// タグ付与済友だち一覧
segmentTags.get('/api/segment-tags/:id/friends', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10), 500);
  const friends = await listFriendsBySegmentTag(c.env.DB, c.req.param('id'), limit);
  return c.json({ success: true, friends });
});

// 手動付与
segmentTags.post('/api/segment-tags/:id/friends/:friendId', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  await assignFriendSegmentTag(c.env.DB, {
    friendId: c.req.param('friendId'),
    segmentTagId: c.req.param('id'),
    lineAccountId: accountId,
    assignedBy: 'manual',
  });
  const count = await recountSegmentTagAssignments(c.env.DB, c.req.param('id'));
  await markSegmentTagRun(c.env.DB, c.req.param('id'), count);
  return c.json({ success: true });
});

// 手動解除
segmentTags.delete('/api/segment-tags/:id/friends/:friendId', async (c) => {
  await removeFriendSegmentTag(c.env.DB, c.req.param('friendId'), c.req.param('id'));
  const count = await recountSegmentTagAssignments(c.env.DB, c.req.param('id'));
  await markSegmentTagRun(c.env.DB, c.req.param('id'), count);
  return c.json({ success: true });
});

// AI 判定実行 (全友だち)
segmentTags.post('/api/segment-tags/:id/run-ai', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const tag = await getSegmentTag(c.env.DB, c.req.param('id'));
  if (!tag) return c.json({ success: false, error: 'not found' }, 404);
  if (tag.line_account_id !== accountId) return c.json({ success: false, error: 'tag belongs to other account' }, 403);
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const body = await c.req.json<{ limit?: number; dryRun?: boolean }>().catch(() => ({} as { limit?: number; dryRun?: boolean }));
  const limit = Math.min(body.limit ?? 60, 100);

  // 対象友だち: フォロー中 + プロファイル要約あり優先 + チャット履歴あり
  const result = await c.env.DB
    .prepare(
      `SELECT f.id, f.display_name,
              fps.chat_topic_summary, fps.interest_tags_json,
              fps.total_purchases, fps.total_spent_yen,
              fps.purchase_history_json,
              (SELECT GROUP_CONCAT(content, ' / ')
               FROM (
                 SELECT content FROM messages_log
                 WHERE friend_id = f.id AND direction = 'incoming'
                 ORDER BY created_at DESC LIMIT 8
               )) as recent_incoming
       FROM friends f
       LEFT JOIN friend_profile_summary fps ON fps.friend_id = f.id
       WHERE f.is_following = 1
       ORDER BY f.updated_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      display_name: string | null;
      chat_topic_summary: string | null;
      interest_tags_json: string | null;
      total_purchases: number | null;
      total_spent_yen: number | null;
      purchase_history_json: string | null;
      recent_incoming: string | null;
    }>();

  const friends = result.results;
  if (friends.length === 0) {
    return c.json({ success: true, assignedCount: 0, evaluatedCount: 0, note: '対象友だちが見つかりません' });
  }

  // AI に判定させる
  const SYSTEM = `あなたは顧客セグメンテーションの専門家です。
店舗オーナーが定義したセグメントタグの基準に照らして、各友だちが該当するかを判定します。

【判定基準】
タグ名: ${tag.name}
基準: ${tag.criteria}

【出力】
JSON 配列で、各友だちについて以下のフィールドを返してください。
- friend_id: 入力の friend_id (頭8文字でOK)
- match: true / false  ← 該当するかどうか
- confidence: 0-100 整数  ← 確信度
- reason: 30-60 字の判定理由 (該当しない場合も理由を書く)

該当しない友だちは match: false でOK。
推測の根拠が弱い場合は confidence を下げてください。
チャット履歴が空の友だちはほぼ false にしてください。`;

  const userPayload = friends.map((f, i) => {
    const summary = f.chat_topic_summary ?? '(要約なし)';
    const interests = f.interest_tags_json ?? '[]';
    const recent = (f.recent_incoming ?? '').slice(0, 400);
    return `${i + 1}. friend_id=${f.id.slice(0, 8)} ${f.display_name ?? '(no name)'}
   会話要約: ${summary}
   関心: ${interests}
   購入: 回数${f.total_purchases ?? 0} 累計${f.total_spent_yen ?? 0}円
   直近受信: ${recent || '(なし)'}`;
  }).join('\n\n');

  const aiResult = await callClaude({
    apiKey,
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    messages: [{ role: 'user', content: `以下 ${friends.length} 名を判定してください:\n\n${userPayload}` }],
    maxTokens: 4000,
    temperature: 0.2,
  });

  await recordUsage(c.env.DB, {
    lineAccountId: accountId,
    feature: 'batch_analysis',
    model: aiResult.model,
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    costYenX100: aiResult.costYenX100,
  });

  // パース
  let parsed: Array<{ friend_id?: string; match?: boolean; confidence?: number; reason?: string }> = [];
  try {
    const match = aiResult.text.match(/\[[\s\S]*\]/);
    if (match) parsed = JSON.parse(match[0]);
  } catch (e) {
    console.warn('[segment-tags run-ai] JSON parse failed:', e);
  }

  if (body.dryRun) {
    return c.json({
      success: true,
      dryRun: true,
      evaluatedCount: friends.length,
      results: parsed,
      cost_yen_x100: aiResult.costYenX100,
    });
  }

  // 既存の AI 付与を全て一度クリア (manual は残す) → 新結果を反映
  await c.env.DB
    .prepare(`DELETE FROM friend_segment_tags WHERE segment_tag_id = ? AND assigned_by = 'ai'`)
    .bind(tag.id)
    .run();

  let assignedCount = 0;
  for (const item of parsed) {
    if (!item.match || !item.friend_id) continue;
    const matched = friends.find((f) => f.id.startsWith(item.friend_id!) || item.friend_id!.startsWith(f.id.slice(0, 8)));
    if (!matched) continue;
    try {
      await assignFriendSegmentTag(c.env.DB, {
        friendId: matched.id,
        segmentTagId: tag.id,
        lineAccountId: accountId,
        assignedBy: 'ai',
        confidence: typeof item.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(item.confidence))) : null,
        reason: item.reason?.slice(0, 200) ?? null,
      });
      assignedCount++;
    } catch (e) {
      console.error('[segment-tags run-ai] assign failed:', e);
    }
  }

  const total = await recountSegmentTagAssignments(c.env.DB, tag.id);
  await markSegmentTagRun(c.env.DB, tag.id, total);

  return c.json({
    success: true,
    evaluatedCount: friends.length,
    assignedCount,
    totalAssigned: total,
    cost_yen_x100: aiResult.costYenX100,
  });
});

// セグメント名から判定基準 (criteria) を AI で生成
segmentTags.post('/api/segment-tags/generate-criteria', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const body = await c.req.json<{ name?: string; businessHint?: string }>().catch(() => ({} as { name?: string; businessHint?: string }));
  if (!body.name?.trim()) return c.json({ success: false, error: 'name is required' }, 400);

  // 業種・事業内容のヒント取得 (hearing_sheet があれば優先、なければ industry_preset)
  const hintRow = await c.env.DB
    .prepare(
      `SELECT m.module_type, v.content
       FROM prompt_modules m
       LEFT JOIN prompt_module_versions v ON m.current_version_id = v.id
       WHERE m.line_account_id = ?
         AND m.module_type IN ('hearing_sheet', 'industry_preset', 'business_kb')
         AND v.content IS NOT NULL
       ORDER BY CASE m.module_type
         WHEN 'hearing_sheet' THEN 1
         WHEN 'industry_preset' THEN 2
         WHEN 'business_kb' THEN 3 END
       LIMIT 1`,
    )
    .bind(accountId)
    .first<{ module_type: string; content: string }>();
  const businessContext = body.businessHint?.trim() || hintRow?.content?.slice(0, 1500) || '';

  const SYSTEM = `あなたは LINE 公式アカウント運用代行のチーフプランナーです。
店舗オーナーが定義したセグメント名から、AI が友だちを判定するための「判定基準」を自然文で書き出してください。

【良い判定基準の特徴】
- 何を見れば該当判定できるかが具体的 (会話・購入履歴・関心の表明など)
- 業種・事業内容に即した具体例を 3〜5 個入れる
- 曖昧でない (「○○について言及した」「○○メニューに関する質問をした」のような観測可能な行動ベース)
- 100〜250 字程度。長すぎず短すぎず

【出力フォーマット】
冒頭に "<セグメント名> に該当する顧客:" のように 1 行サマリ。
その後に "・観測可能な条件" を 3〜5 個箇条書き。

それ以外の解説や前置きは不要、判定基準のみ返してください。

${NO_MARKDOWN_RULE}`;

  const businessLine = businessContext ? `\n\n【参考: この事業について】\n${businessContext}` : '';
  const user = `セグメント名: ${body.name.trim()}${businessLine}

このセグメント名から、AI が判定に使える基準を書いてください。`;

  const aiResult = await callClaude({
    apiKey,
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    maxTokens: 600,
    temperature: 0.4,
  });

  await recordUsage(c.env.DB, {
    lineAccountId: accountId,
    feature: 'copy_gen',
    model: aiResult.model,
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    costYenX100: aiResult.costYenX100,
  });

  return c.json({
    success: true,
    criteria: stripMarkdown(aiResult.text.trim()),
    cost_yen_x100: aiResult.costYenX100,
  });
});

// セグメント向け配信案生成 (Claude に投げて draft 返却のみ、保存はしない)
segmentTags.post('/api/segment-tags/:id/generate-broadcast', async (c) => {
  const accountId = getLineAccountId(c);
  if (!accountId) return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  const tag = await getSegmentTag(c.env.DB, c.req.param('id'));
  if (!tag) return c.json({ success: false, error: 'not found' }, 404);
  if (tag.line_account_id !== accountId) return c.json({ success: false, error: 'tag belongs to other account' }, 403);
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 500);

  const body = await c.req.json<{ topic?: string; tone?: string }>().catch(() => ({} as { topic?: string; tone?: string }));

  const SYSTEM = `あなたは LINE 公式アカウントの配信文ライターです。
特定セグメントに対して、刺さる短文（150〜250 字程度）の配信メッセージを生成します。
- 過度な煽りや決め付けは避ける
- 受け取り手の状況を理解している前提で、具体的な提案を 1 つに絞る
- 絵文字は使ってよいが多用しない (1〜2 個まで)
- 末尾に弱い CTA (例: 「気になったら一言ください」など)

${NO_MARKDOWN_RULE}

${COMPLIANCE_RULE}`;

  const user = `セグメントタグ: ${tag.name}
セグメント定義: ${tag.criteria}
${body.topic ? `配信トピック: ${body.topic}\n` : ''}${body.tone ? `トーン指示: ${body.tone}\n` : ''}

このセグメントに最適化された配信文を 1 本書いてください。配信文のみ返し、解説は不要です。`;

  const aiResult = await callClaude({
    apiKey,
    model: 'claude-haiku-4-5-20251001',
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    maxTokens: 800,
    temperature: 0.7,
  });

  await recordUsage(c.env.DB, {
    lineAccountId: accountId,
    feature: 'copy_gen',
    model: aiResult.model,
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    costYenX100: aiResult.costYenX100,
  });

  return c.json({
    success: true,
    draft: stripMarkdown(aiResult.text.trim()),
    cost_yen_x100: aiResult.costYenX100,
  });
});

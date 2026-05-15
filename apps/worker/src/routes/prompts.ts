/**
 * Prompt Modules API routes
 *
 * GET    /api/prompts                     全モジュール一覧
 * GET    /api/prompts/:type                指定モジュール取得（現在版含む）
 * PUT    /api/prompts/:type                モジュールを upsert + 新バージョン作成
 * PATCH  /api/prompts/:type/active        モジュールの active を切替
 * GET    /api/prompts/:type/versions      バージョン履歴
 * POST   /api/prompts/:type/revert/:vid   過去バージョンに戻す
 * GET    /api/prompts/assemble            8 モジュールを合成した system prompt を返す
 */

import { Hono } from 'hono';
import { staffIdForFk } from '../lib/staff-fk.js';
import { callClaude } from '../lib/claude-client.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import {
  PROMPT_MODULE_TYPES,
  listPromptModules,
  getPromptModule,
  upsertPromptModule,
  setPromptModuleActive,
  createPromptModuleVersion,
  listPromptModuleVersions,
  getPromptModuleVersion,
  revertToVersion,
  assembleSystemPrompt,
  type PromptModuleType,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const prompts = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

function isValidType(t: string): t is PromptModuleType {
  return PROMPT_MODULE_TYPES.includes(t as PromptModuleType);
}

// 全モジュール一覧
prompts.get('/api/prompts', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const modules = await listPromptModules(c.env.DB, lineAccountId);
  return c.json({ success: true, modules, types: PROMPT_MODULE_TYPES });
});

// 指定モジュール取得（現在版の本文付き）
prompts.get('/api/prompts/:type', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const type = c.req.param('type');
  if (!isValidType(type)) {
    return c.json({ success: false, error: 'Invalid module type' }, 400);
  }
  const module = await getPromptModule(c.env.DB, lineAccountId, type);
  if (!module) {
    return c.json({ success: true, module: null, currentVersion: null });
  }
  let currentVersion = null;
  if (module.current_version_id) {
    currentVersion = await getPromptModuleVersion(c.env.DB, module.current_version_id);
  }
  return c.json({ success: true, module, currentVersion });
});

// モジュールを upsert + 新バージョン作成
prompts.put('/api/prompts/:type', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const type = c.req.param('type');
  if (!isValidType(type)) {
    return c.json({ success: false, error: 'Invalid module type' }, 400);
  }
  const body = await c.req.json<{ content: string; note?: string }>();
  if (!body.content || typeof body.content !== 'string') {
    return c.json({ success: false, error: 'content required' }, 400);
  }
  if (body.content.length > 50_000) {
    return c.json({ success: false, error: 'content too long (50,000 chars max)' }, 400);
  }

  const staff = c.get('staff');
  const module = await upsertPromptModule(c.env.DB, lineAccountId, type);
  const version = await createPromptModuleVersion(c.env.DB, {
    moduleId: module.id,
    lineAccountId,
    content: body.content,
    authorId: staffIdForFk(staff) ?? undefined,
    note: body.note,
  });
  return c.json({ success: true, module, version });
});

// active 切替
prompts.patch('/api/prompts/:type/active', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const type = c.req.param('type');
  if (!isValidType(type)) {
    return c.json({ success: false, error: 'Invalid module type' }, 400);
  }
  const body = await c.req.json<{ active: boolean }>();
  if (typeof body.active !== 'boolean') {
    return c.json({ success: false, error: 'active (boolean) required' }, 400);
  }
  const module = await getPromptModule(c.env.DB, lineAccountId, type);
  if (!module) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await setPromptModuleActive(c.env.DB, module.id, lineAccountId, body.active);
  return c.json({ success: true });
});

// バージョン履歴
prompts.get('/api/prompts/:type/versions', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const type = c.req.param('type');
  if (!isValidType(type)) {
    return c.json({ success: false, error: 'Invalid module type' }, 400);
  }
  const module = await getPromptModule(c.env.DB, lineAccountId, type);
  if (!module) {
    return c.json({ success: true, versions: [] });
  }
  const versions = await listPromptModuleVersions(c.env.DB, module.id);
  return c.json({ success: true, versions });
});

// 過去バージョンに戻す
prompts.post('/api/prompts/:type/revert/:vid', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const type = c.req.param('type');
  const vid = c.req.param('vid');
  if (!isValidType(type)) {
    return c.json({ success: false, error: 'Invalid module type' }, 400);
  }
  const module = await getPromptModule(c.env.DB, lineAccountId, type);
  if (!module) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  try {
    await revertToVersion(c.env.DB, module.id, lineAccountId, vid);
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'revert failed' }, 400);
  }
  return c.json({ success: true });
});

// AI 下書き生成（同期型、即時返却）
prompts.post('/api/prompts/:type/draft', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }
  const type = c.req.param('type');
  if (!isValidType(type)) {
    return c.json({ success: false, error: 'Invalid module type' }, 400);
  }
  const body = await c.req.json<{ industry?: string; businessHint?: string; existingContent?: string }>().catch(() => ({} as { industry?: string; businessHint?: string; existingContent?: string }));

  const systemPrompts: Record<string, string> = {
    industry_preset: '業界の特徴・お客様像・特有の言い回し・避けるべき表現をまとめた業界デフォルト設定を作成してください。',
    personality: '事業者の「中の人」のキャラクター（人格）を定義してください。100〜200 字。',
    voice_tone: 'メッセージのトーン、敬語レベル、絵文字使い方、口癖を指定してください。50〜150 字。',
    business_kb: 'サービス内容、料金、住所、営業時間など、AI が回答時に参照する情報をまとめた骨格を作成してください。',
    faq: 'この事業でよくありそうな質問と回答を 5〜10 個作成してください。',
    scenario: '予約相談時、商品紹介時、来店後フォロー、誕生月対応など、シーン別の対応方針を提案してください。',
    restrictions: '言ってはいけない表現（薬機法・景表法・業界マナー）と、避けるべき言い回しをまとめてください。',
    escalation: 'AI ではなく人間に対応を引き継ぐべき条件を 5〜8 個リストアップしてください。',
  };

  const userMessage = `次のモジュール「${type}」の下書きを書いてください。

【モジュールの目的】
${systemPrompts[type] ?? ''}

【業界】
${body.industry ?? '（指定なし）'}

【ヒント】
${body.businessHint ?? '（なし）'}

${body.existingContent ? `【既存の内容（参考）】\n${body.existingContent}\n\n上記を踏まえて改善案を作成してください。` : ''}

Markdown / プレーンテキストどちらでもよいので、すぐに使える形で書いてください。`;

  try {
    const result = await callClaude({
      apiKey,
      model: 'claude-sonnet-4-6',
      system: 'あなたは LINE 公式アカウント運用のプロです。事業者向けに「中の人」設定の下書きを書きます。日本人の事業者が読んで自然な文章で。',
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2000,
      temperature: 0.7,
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
      content: result.text,
      costYen: result.costYenX100 / 100,
      model: result.model,
    });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'draft generation failed' }, 500);
  }
});

// 8 モジュール合成 system prompt
prompts.get('/api/prompts/assemble/preview', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const assembled = await assembleSystemPrompt(c.env.DB, lineAccountId);
  return c.json({ success: true, ...assembled });
});

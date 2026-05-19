/**
 * 業界プレイブック API
 *
 * GET    /api/playbooks                      利用可能なプレイブック一覧
 * GET    /api/playbooks/:key                 詳細プレビュー
 * POST   /api/playbooks/:key/apply           テナントに適用
 * POST   /api/playbooks/suggest              テナント情報から業界を AI 推測
 */

import { Hono } from 'hono';
import { listPlaybooks, getPlaybook } from '../services/playbooks/registry.js';
import { applyPlaybook } from '../services/playbooks/apply.js';
import { listPromptModules, getPromptModuleVersion } from '@line-crm/db';
import { callClaude } from '../lib/claude-client.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import type { Env } from '../index.js';

export const playbooks = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

playbooks.get('/api/playbooks', async (c) => {
  const items = listPlaybooks().map((p) => ({
    key: p.key,
    label: p.label,
    emoji: p.emoji,
    description: p.description,
    promptModuleCount: p.promptModules.length,
    kpiCount: p.kpis.length,
    scenarioCount: p.scenarios.length,
  }));
  return c.json({ success: true, playbooks: items });
});

playbooks.get('/api/playbooks/:key', async (c) => {
  const key = c.req.param('key');
  const playbook = getPlaybook(key);
  if (!playbook) {
    return c.json({ success: false, error: 'Playbook not found' }, 404);
  }
  return c.json({ success: true, playbook });
});

/**
 * テナント情報 (アカウント名・説明 / 既存 AI 配信設定 / 直近 incoming メッセージ) から
 * 業界を Haiku で推測する。5 候補 + other を返す。確信度は high/medium/low。
 */
playbooks.post('/api/playbooks/suggest', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }

  const account = await c.env.DB
    .prepare(`SELECT id, name FROM line_accounts WHERE id = ?`)
    .bind(lineAccountId)
    .first<{ id: string; name: string | null }>();

  const modules = await listPromptModules(c.env.DB, lineAccountId);
  const moduleContents: { type: string; content: string }[] = [];
  for (const m of modules) {
    if (!m.current_version_id) continue;
    const v = await getPromptModuleVersion(c.env.DB, m.current_version_id);
    if (v?.content?.trim()) {
      moduleContents.push({ type: m.module_type, content: v.content });
    }
  }

  const recent = await c.env.DB
    .prepare(
      `SELECT content FROM messages_log
        WHERE line_account_id = ? AND direction = 'in' AND message_type = 'text'
        ORDER BY created_at DESC LIMIT 10`,
    )
    .bind(lineAccountId)
    .all<{ content: string }>();

  const candidates = listPlaybooks().map((p) => ({
    key: p.key,
    label: p.label,
    description: p.description,
  }));

  const system = `あなたは LINE 公式アカウントの運用代行業者です。
以下の情報から、このアカウントの業界を 5 つの候補から推測してください。

候補:
${candidates.map((cand) => `- ${cand.key}: ${cand.label} (${cand.description})`).join('\n')}
- other: 上記いずれにも当てはまらない

必ず以下の JSON 形式のみを出力してください (前後の説明文を付けない):
{
  "suggestedKey": "beauty|chiropractic|ecommerce|school|legal|other",
  "confidence": "high|medium|low",
  "reasoning": "推測理由 (50〜120 文字)"
}`;

  const userParts: string[] = [];
  if (account?.name) userParts.push(`アカウント名: ${account.name}`);
  if (moduleContents.length > 0) {
    userParts.push('既存の AI 配信設定:');
    for (const m of moduleContents) {
      userParts.push(`[${m.type}]\n${m.content.slice(0, 500)}`);
    }
  }
  if (recent.results.length > 0) {
    userParts.push('お客様からの最近のメッセージ (上位 10 件):');
    recent.results.forEach((m, i) => {
      userParts.push(`${i + 1}. ${m.content.slice(0, 200)}`);
    });
  }

  if (userParts.length === 0) {
    return c.json({
      success: true,
      suggestion: {
        suggestedKey: 'other',
        label: 'その他',
        emoji: '🏷',
        confidence: 'low',
        reasoning:
          '推測材料となる情報が不足しています。アカウント名・説明・AI 配信設定を入力してから再実行してください。',
      },
      costYen: 0,
    });
  }

  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
  }

  try {
    const result = await callClaude({
      apiKey,
      model: 'claude-haiku-4-5-20251001',
      system,
      messages: [{ role: 'user', content: userParts.join('\n\n') }],
      maxTokens: 256,
      temperature: 0.3,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return c.json({ success: false, error: 'AI did not return JSON', raw: result.text }, 502);
    }

    let parsed: { suggestedKey: string; confidence: string; reasoning: string };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return c.json({ success: false, error: 'AI JSON parse failed', raw: result.text }, 502);
    }

    const validKeys = ['beauty', 'chiropractic', 'ecommerce', 'school', 'legal', 'other'];
    if (!validKeys.includes(parsed.suggestedKey)) parsed.suggestedKey = 'other';
    const validConfidence = ['high', 'medium', 'low'];
    if (!validConfidence.includes(parsed.confidence)) parsed.confidence = 'low';

    await recordUsage(c.env.DB, {
      lineAccountId,
      feature: 'intent',
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costYenX100: result.costYenX100,
    });

    const matched = parsed.suggestedKey !== 'other' ? getPlaybook(parsed.suggestedKey) : null;

    return c.json({
      success: true,
      suggestion: {
        suggestedKey: parsed.suggestedKey,
        label: matched?.label ?? 'その他',
        emoji: matched?.emoji ?? '🏷',
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
      },
      costYen: result.costYenX100 / 100,
    });
  } catch (e) {
    return c.json(
      { success: false, error: e instanceof Error ? e.message : 'suggest failed' },
      500,
    );
  }
});

playbooks.post('/api/playbooks/:key/apply', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const key = c.req.param('key');
  const playbook = getPlaybook(key);
  if (!playbook) {
    return c.json({ success: false, error: 'Playbook not found' }, 404);
  }
  const body = await c.req.json<{ year_month?: string; overwrite_kpi?: boolean }>().catch(() => ({} as { year_month?: string; overwrite_kpi?: boolean }));

  try {
    const result = await applyPlaybook(c.env.DB, lineAccountId, playbook, {
      yearMonth: body.year_month,
      overwriteKpi: body.overwrite_kpi,
    });
    return c.json({ success: true, playbook: { key: playbook.key, label: playbook.label }, ...result });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'apply failed' }, 500);
  }
});

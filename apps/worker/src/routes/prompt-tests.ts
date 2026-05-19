/**
 * プロンプト品質テスト API
 *
 * POST /api/prompt-tests/suggest-fix
 *   失敗したテストシナリオと応答テキスト・NG チェック結果を受け取り、
 *   Claude にどのプロンプトモジュールをどう修正すれば良いかを JSON で返させる。
 */

import { Hono } from 'hono';
import { listPromptModules, getPromptModuleVersion } from '@line-crm/db';
import { callClaude } from '../lib/claude-client.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import type { Env } from '../index.js';

export const promptTests = new Hono<Env>();

function getLineAccountId(c: { req: { header: (k: string) => string | undefined } }): string | null {
  return c.req.header('x-line-account-id') ?? null;
}

const SUGGEST_SYSTEM = `あなたは AI 応答プロンプトのチューニング専門家です。
LINE 公式アカウント運用代行プラットフォームで、AI が顧客応答するためのプロンプト設計を改善する役割。

プロンプトは 3 層構造:
  [層 1] 基盤プロンプト (コード内蔵、全テナント共通) ← 開発者がコード変更しないと修正不可
    - 役割定義 / 顧客文脈の読み方 / 応答品質ルール / 安全ルール / 絶対禁止リスト
  [層 2] 業界カスタマイズ (テナント別 prompt_modules、10 種、管理画面から編集可) ← テナントが編集可能
    - industry_preset / personality / voice_tone / business_kb / faq / scenario /
      restrictions / escalation / internal_manual / product_recommend
  [層 3] 顧客文脈 (動的、編集不要)

ユーザーから提供されるのは:
- 失敗したテストシナリオ (お客様の質問 / 期待する振る舞い)
- 実際に AI が返した応答テキスト
- 自動チェックで NG だった項目のリスト
- 現在のテナントの prompt_modules 内容

あなたの役割は、なぜ NG な応答になったかを分析し、最も効果的な修正案を 1〜2 個提示すること。
原則:
- テナント編集可能な層 2 (prompt_modules) で解決できるなら、必ずそちらを優先
- 層 1 (基盤プロンプト) の変更が必要なら、明示してコード変更が必要と伝える
- 修正案は具体的 (どのモジュールに、どの文言を、追加 / 修正 / 削除する)

【出力 JSON フォーマット】
{
  "analysis": "なぜこの応答が NG になったか、根本原因の分析 (100 字以内)",
  "suggestions": [
    {
      "moduleType": "personality" | "voice_tone" | "business_kb" | "faq" | "scenario" |
                    "restrictions" | "escalation" | "internal_manual" | "product_recommend" |
                    "industry_preset" | "base_prompt" | "agency_playbook",
      "editType": "add" | "modify" | "remove",
      "targetSection": "編集対象セクション名 (もし add なら省略可)",
      "currentText": "現在の該当テキスト (modify/remove の場合のみ、100 字以内)",
      "newText": "追加・修正後のテキスト (add/modify の場合のみ、200 字以内)",
      "rationale": "この修正でなぜ NG が解消されるか (60 字以内)",
      "isCodeChange": true | false
    }
  ]
}

isCodeChange = true は moduleType が "base_prompt" または "agency_playbook" の時のみ。
それ以外 (prompt_modules 系) は false。

JSON のみを出力 (前後の説明文を付けない)。`;

promptTests.post('/api/prompt-tests/suggest-fix', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }

  type Body = {
    scenario: {
      label?: string;
      query: string;
      expectIncludeAny?: string[];
      expectExclude?: string[];
      expectProductCard?: string;
    };
    reply: string;
    productSuggestions?: string[];
    failedChecks: Array<{ label: string; detail?: string }>;
  };
  const body = (await c.req.json<Body>().catch(() => null)) as Body | null;
  if (!body || !body.scenario?.query || !body.reply) {
    return c.json({ success: false, error: 'scenario.query and reply required' }, 400);
  }

  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);

  // 現在のテナント prompt_modules を取得 (context として AI に渡す)
  const modules = await listPromptModules(c.env.DB, lineAccountId);
  const moduleSnippets: string[] = [];
  for (const m of modules) {
    if (!m.current_version_id) continue;
    const v = await getPromptModuleVersion(c.env.DB, m.current_version_id);
    if (v?.content?.trim()) {
      moduleSnippets.push(`【${m.module_type}】\n${v.content.slice(0, 400)}`);
    }
  }

  const userContent = `■ 失敗したテストシナリオ
ラベル: ${body.scenario.label ?? '(なし)'}
お客様の質問: 「${body.scenario.query}」
期待する含有ワード: ${body.scenario.expectIncludeAny?.join(', ') ?? '(なし)'}
期待する非含有ワード: ${body.scenario.expectExclude?.join(', ') ?? '(なし)'}
期待する商品カード: ${body.scenario.expectProductCard ?? '(なし)'}

■ 実際の AI 応答
${body.reply}

■ 商品カード表示
${(body.productSuggestions ?? []).join(' / ') || '(なし)'}

■ 自動チェックで NG だった項目
${body.failedChecks.map((c, i) => `${i + 1}. ${c.label}${c.detail ? ` (${c.detail})` : ''}`).join('\n')}

■ 現在のテナント prompt_modules (層 2)
${moduleSnippets.join('\n\n') || '(未設定)'}

上記の情報から、応答品質を改善するための具体的な修正案を JSON で返してください。
最も効果的な 1〜2 個に絞ること。`;

  try {
    const result = await callClaude({
      apiKey,
      model: 'claude-sonnet-4-6',
      system: SUGGEST_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1200,
      temperature: 0.3,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return c.json({ success: false, error: 'AI did not return JSON', raw: result.text }, 502);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return c.json({ success: false, error: 'JSON parse failed', raw: result.text }, 502);
    }

    await recordUsage(c.env.DB, {
      lineAccountId,
      feature: 'intent',
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costYenX100: result.costYenX100,
    });

    return c.json({
      success: true,
      fix: parsed,
      meta: {
        model: result.model,
        costYen: result.costYenX100 / 100,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  } catch (e) {
    return c.json(
      { success: false, error: e instanceof Error ? e.message : 'suggest-fix failed' },
      500,
    );
  }
});

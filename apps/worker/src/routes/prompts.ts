/**
 * Prompt Modules API routes
 *
 * GET    /api/prompts                     全モジュール一覧
 * GET    /api/prompts/:type                指定モジュール取得（現在版含む）
 * PUT    /api/prompts/:type                モジュールを upsert + 新バージョン作成
 * PATCH  /api/prompts/:type/active        モジュールの active を切替
 * GET    /api/prompts/:type/versions      バージョン履歴
 * POST   /api/prompts/:type/revert/:vid   過去バージョンに戻す
 * GET    /api/prompts/assemble            10 モジュールを合成した system prompt を返す
 */

import { Hono } from 'hono';
import { staffIdForFk } from '../lib/staff-fk.js';
import { callClaude } from '../lib/claude-client.js';
import { recordUsage } from '../services/ai-cost-guard.js';
import { getMasterTemplate } from '../services/prompts/master-templates.js';
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
  getTenantMetering,
  setAiFallbackMessage,
  setAiCustomSystemPrompt,
  setAiAutoReplyEnabled,
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

// AI が回答できない時の固定フォールバック文を取得
//   静的パスなので :type ルートより優先される (Hono は static > param)
prompts.get('/api/prompts/fallback-message', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const m = await getTenantMetering(c.env.DB, lineAccountId);
  return c.json({ success: true, fallbackMessage: m?.ai_fallback_message ?? null });
});

// AI が回答できない時の固定フォールバック文を保存（空文字で解除）
prompts.put('/api/prompts/fallback-message', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req
    .json<{ message?: string | null }>()
    .catch(() => ({} as { message?: string | null }));
  const message = typeof body.message === 'string' ? body.message : null;
  if (message && message.length > 1000) {
    return c.json({ success: false, error: 'message too long (1,000 chars max)' }, 400);
  }
  const existing = await getTenantMetering(c.env.DB, lineAccountId);
  if (!existing) {
    return c.json(
      { success: false, error: 'Metering not initialized. POST /api/metering/init first.' },
      404,
    );
  }
  await setAiFallbackMessage(c.env.DB, lineAccountId, message);
  return c.json({ success: true, fallbackMessage: message && message.trim().length > 0 ? message : null });
});

// アカウント単位の AI 自動返信 ON/OFF を取得
//   0 = このアカウントでは AI 接客自動返信を発火しない (全手動)
prompts.get('/api/prompts/ai-auto-reply', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const m = await getTenantMetering(c.env.DB, lineAccountId);
  // metering 未初期化 (プラン未契約) は AI 自体が動かないので enabled=false 相当で返す
  return c.json({ success: true, enabled: m ? m.ai_auto_reply_enabled !== 0 : false });
});

// アカウント単位の AI 自動返信 ON/OFF を保存
prompts.put('/api/prompts/ai-auto-reply', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req
    .json<{ enabled?: boolean }>()
    .catch(() => ({} as { enabled?: boolean }));
  if (typeof body.enabled !== 'boolean') {
    return c.json({ success: false, error: 'enabled (boolean) required' }, 400);
  }
  const existing = await getTenantMetering(c.env.DB, lineAccountId);
  if (!existing) {
    return c.json(
      { success: false, error: 'Metering not initialized. POST /api/metering/init first.' },
      404,
    );
  }
  await setAiAutoReplyEnabled(c.env.DB, lineAccountId, body.enabled);
  return c.json({ success: true, enabled: body.enabled });
});

// CSV 一括取り込みで生成する「統合 system prompt」の取得
//   非空ならこのプロンプトが prompt_modules 合成より優先される
prompts.get('/api/prompts/unified', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const m = await getTenantMetering(c.env.DB, lineAccountId);
  return c.json({ success: true, prompt: m?.ai_custom_system_prompt ?? null });
});

// 統合 system prompt を保存（空文字で解除 → モジュール合成モードに戻る）
prompts.put('/api/prompts/unified', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const body = await c.req
    .json<{ prompt?: string | null }>()
    .catch(() => ({} as { prompt?: string | null }));
  const prompt = typeof body.prompt === 'string' ? body.prompt : null;
  if (prompt && prompt.length > 50_000) {
    return c.json({ success: false, error: 'prompt too long (50,000 chars max)' }, 400);
  }
  const existing = await getTenantMetering(c.env.DB, lineAccountId);
  if (!existing) {
    return c.json(
      { success: false, error: 'Metering not initialized. POST /api/metering/init first.' },
      404,
    );
  }
  await setAiCustomSystemPrompt(c.env.DB, lineAccountId, prompt);
  return c.json({ success: true, prompt: prompt && prompt.trim().length > 0 ? prompt : null });
});

// CSV で取り込んだ事業情報から、最適な統合 system prompt を 1 本 AI 生成する
prompts.post('/api/prompts/unified/generate', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const apiKey = (c.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }
  const body = await c.req
    .json<{ businessInfo?: string }>()
    .catch(() => ({} as { businessInfo?: string }));
  // 巨大入力 (サイト本文を取り込んだ CSV 等) は生成が遅くなり worker 実行上限に
  // 触れて 500 になりやすいので、安全な長さに切り詰める (≒ 1.2 万トークン相当)。
  const businessInfo = (body.businessInfo ?? '').trim().slice(0, 24_000);
  if (!businessInfo) {
    return c.json({ success: false, error: 'businessInfo required' }, 400);
  }

  const systemPrompt = `あなたは LINE 公式アカウント運用代行のチーフプランナー兼プロンプトエンジニアです。
事業者から渡された「事業情報」(CSV から取り込んだ自由項目の集合) を読み解き、
その事業の AI 接客チャットが使う **system prompt を 1 本だけ** 完成形で書き上げてください。

【重要な方針】
- 決まった 13 項目テンプレに無理に分割しない。事業情報から読み取れた要素だけを、その事業に最も効く構成で組み立てる。
- 情報が無い項目は勝手に創作しない (省略するか「未確認」と明示)。
- AI 接客が実際に読む前提の、実運用で即使える濃度・具体性にする。
- 含めるべき観点 (事業情報にある範囲で): ブランド人格 / 口調・トーン・絵文字ルール / 事業・商品・料金の知識 / よくある質問 / 禁止事項 (薬機法・景表法など) / 人へエスカレする条件 / 商品提案の流儀 / 模範応答例。
- Markdown 見出しで構造化し、読みやすく。
- 前後の挨拶や「以下が〜です」等の説明文は一切付けず、system prompt 本文だけを出力する。
- **簡潔さ重視**。冗長な説明・繰り返し・蛇足を避け、実運用に必要な要素を密度高くまとめる。
  全体で 1,500〜2,200 字程度を目安にし、長くなりすぎないこと。途中で切れず必ず最後まで完結させる。`;

  const userMessage = `次の事業情報から、この事業専用の AI 接客 system prompt を 1 本にまとめて書いてください。

【取り込んだ事業情報】
${businessInfo}

事業情報に書かれている内容を最大限活かし、足りない部分は無理に埋めず、実運用ですぐ使える system prompt を Markdown で出力してください。`;

  try {
    const result = await callClaude({
      apiKey,
      model: 'claude-sonnet-4-6',
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2600,
      temperature: 0.5,
      timeoutMs: 80_000,
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
      prompt: result.text,
      costYen: result.costYenX100 / 100,
      model: result.model,
    });
  } catch (e) {
    console.error('[unified/generate] failed', { lineAccountId, error: e instanceof Error ? e.message : e });
    return c.json({ success: false, error: e instanceof Error ? e.message : 'generate failed' }, 500);
  }
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
// サイト URL を取得して text 抽出 (AI 下書き生成の事業情報補強用)
prompts.post('/api/prompts/extract-site-text', async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => ({} as { url?: string }));
  if (!body.url || !/^https?:\/\//i.test(body.url)) {
    return c.json({ success: false, error: 'valid url required' }, 400);
  }
  try {
    const res = await fetch(body.url, {
      headers: { 'User-Agent': 'L-port Business Info Extractor/1.0' },
      cf: { cacheTtl: 1800 } as RequestInitCfProperties, // 30 分 edge cache
    });
    if (!res.ok) {
      return c.json({ success: false, error: `HTTP ${res.status} fetching URL` }, 400);
    }
    const html = await res.text();
    // <title>, <meta description>, <meta og:*>, body 本文を抽出
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '';
    const ogDescription = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '';
    const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '';
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')   // ナビゲーション除去 (商品メニュー等)
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000); // ナビ除去後の本文を 4000 字までに

    const extracted = [
      title && `【サイト名】${title}`,
      ogSiteName && `【ブランド名】${ogSiteName}`,
      (description || ogDescription) && `【サイト説明】${description || ogDescription}`,
      bodyText && `【本文抜粋】\n${bodyText}`,
    ].filter(Boolean).join('\n\n');

    return c.json({ success: true, text: extracted, sourceUrl: body.url });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'extract failed' }, 500);
  }
});

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
    internal_manual: 'スタッフ向けの応対手順・内部ルール・運用フローを骨格として作成してください。\n例: 予約変更の手順 / クレーム初動 / 在庫切れ時の案内 / VIP 対応手順 など。\nセクション見出し付きで 200〜800 字程度。AI も参照する前提で、判断基準を明確に。',
    product_recommend: 'AI が商品データベースから商品を紹介する時の流儀・温度感を定義してください。\n以下を含めること:\n- 1 メッセージあたりの提案数の目安 (押し売り回避)\n- 提案の言い回し (断定 vs 提案調) と価格表示ルール\n- 在庫切れ / 該当なし時の振る舞い\n- 商品ページ URL の添え方 (裸 URL or マークダウン)\n200〜600 字程度。',
    hearing_sheet: '初回 MTG のヒアリングシート (基本情報・ブランド・顧客像・商品・運用前提) を、AI 配信 / AI チャットがそのまま参照できる構造化メモとして整理してください。\nセクション見出し (■ 基本情報 / ■ ブランド・トーン / ■ 顧客・ペルソナ / ■ 商品・サービス / ■ 既存運用 / ■ KPI / ■ 運用体制) を立て、各項目に箇条書きで簡潔に。500〜1500 字程度。',
    chat_examples: `この事業特有の AI 接客 Few-shot Examples を 3〜5 本作成してください。
Few-shot Examples とは、「お客様の質問」→「理想的な AI 応答」のペアで、AI に応答品質の基準を示すサンプルです。

【含めるべきパターン】
- 商品 / サービス提案を引き出す相談
- 予約・申込の問い合わせ
- 価格や条件の質問
- ネガティブ・難しい質問 (キャンセル / クレーム / アレルギー等、業界に応じて)
- 漠然とした相談 (ヒアリング掘りが必要なケース)

【出力フォーマット】
例 N: <シーン名>

お客様: <自然な質問>

✅ 良い例:
<理想的な応答 (絵文字含む実際のメッセージ調)>

学べる点:
- <この例から学べる原則を 2〜3 行>

---

3〜5 例を上記フォーマットで連続して書く。1500〜3500 字程度。`,
  };

  // マスターテンプレを基に AI が事業内容で適応させる方式
  // hearing_sheet 等テンプレなしのモジュールは旧来の白紙生成にフォールバック
  const masterTemplate = getMasterTemplate(type);

  const systemPrompt = masterTemplate
    ? `あなたは LINE 公式アカウント運用代行のチーフプランナーです。
提供される「マスターテンプレ」は業界横断で通用する最強の骨格 (構造・方針・チェック項目) です。

あなたの仕事はゼロから書くことではなく、マスターテンプレを **構造と方針を維持したまま**、
ユーザーが指定する事業内容に合わせて [角括弧] のプレースホルダと具体例だけを書き換えることです。

【厳守ルール】
1. 見出し階層 (#、##) は維持
2. テンプレに無い新しいセクションを勝手に追加しない
3. [角括弧] のプレースホルダは事業内容で具体化 (まだ情報がなければ「未指定」と書く)
4. 箇条書きの数・順序は基本維持 (足し引きは事業内容に明らかに必要な場合のみ)
5. 言い回しの例文は事業のトーンに合わせて書き換え可
6. 不要な項目は削除可 (例: 駐車場のない事業で駐車場項目)
7. 出力は Markdown のまま。前後の挨拶や説明文は付けない`
    : 'あなたは LINE 公式アカウント運用のプロです。事業者向けに「中の人」設定の下書きを書きます。日本人の事業者が読んで自然な文章で。';

  const userMessage = masterTemplate
    ? `次のモジュール「${type}」を、下記の事業内容に合わせて適応させてください。

【マスターテンプレ (このまま使えるベース骨格。構造を維持して具体化する)】
${masterTemplate}

【適応対象の事業内容】
${body.industry || body.businessHint || '(具体的な事業内容が未指定のため、抽象度を保ったまま整える)'}

${body.existingContent ? `【既存の内容 (参考、良い部分は残す)】\n${body.existingContent}\n` : ''}
マスターテンプレの構造を維持しながら、上記事業に合わせて [角括弧] と具体例を書き換えて Markdown で出力してください。`
    : `次のモジュール「${type}」の下書きを書いてください。

【モジュールの目的】
${systemPrompts[type] ?? ''}

【業界 / 事業内容】
${body.industry ?? '（指定なし）'}

【ヒント】
${body.businessHint ?? '（なし）'}

${body.existingContent ? `【既存の内容（参考）】\n${body.existingContent}\n\n上記を踏まえて改善案を作成してください。` : ''}

Markdown / プレーンテキストどちらでもよいので、すぐに使える形で書いてください。`;

  try {
    const result = await callClaude({
      apiKey,
      model: 'claude-sonnet-4-6',
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2500,
      temperature: masterTemplate ? 0.4 : 0.7,
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

// マスターテンプレを返す (UI から「テンプレを見る」用)
prompts.get('/api/prompts/:type/master-template', async (c) => {
  const type = c.req.param('type');
  if (!isValidType(type)) {
    return c.json({ success: false, error: 'Invalid module type' }, 400);
  }
  const template = getMasterTemplate(type);
  return c.json({ success: true, type, template });
});

// 10 モジュール合成 system prompt
prompts.get('/api/prompts/assemble/preview', async (c) => {
  const lineAccountId = getLineAccountId(c);
  if (!lineAccountId) {
    return c.json({ success: false, error: 'X-Line-Account-Id header required' }, 400);
  }
  const assembled = await assembleSystemPrompt(c.env.DB, lineAccountId);
  return c.json({ success: true, ...assembled });
});

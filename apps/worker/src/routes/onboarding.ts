import { Hono } from 'hono';
import type { Env } from '../index.js';

const onboarding = new Hono<Env>();

const JST_NOW = `strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`;

interface OnboardingTaskRow {
  id: string;
  line_account_id: string;
  category: string;
  title: string;
  description: string | null;
  order_index: number;
  is_done: number;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

function serialize(row: OnboardingTaskRow) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    category: row.category,
    title: row.title,
    description: row.description ?? '',
    orderIndex: row.order_index,
    isDone: row.is_done === 1,
    doneAt: row.done_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 新規顧客に流し込む「やるべきこと」テンプレート。カテゴリ順 = 表示順。
const TEMPLATE: { category: string; title: string; description?: string }[] = [
  // 契約・初期
  { category: '契約・初期', title: '契約締結（6ヶ月最低契約・初期費用¥0の確認）' },
  { category: '契約・初期', title: '顧客情報をL-portに登録（LINEアカウント作成）' },
  { category: '契約・初期', title: '請求設定（銀行振込）・初回入金の確認' },
  // ヒアリング
  { category: 'ヒアリング', title: 'ヒアリングシートを顧客へ送付', description: 'docs/L-port-hearing-sheet.csv をスプレッドシート化して送付' },
  { category: 'ヒアリング', title: 'ヒアリングシートを回収' },
  { category: 'ヒアリング', title: '不足項目を追加ヒアリング（MTG）' },
  { category: 'ヒアリング', title: '運用設計書（blueprint）を生成・社内確認', description: 'ヒアリング機能でCSV取り込み→AI設計書生成' },
  // LINE連携
  { category: 'LINE連携', title: 'LINE公式アカウントの開設状況を確認' },
  { category: 'LINE連携', title: 'Messaging APIチャネル作成・トークン取得' },
  { category: 'LINE連携', title: 'channel_access_token / channel_secret をL-portに登録' },
  { category: 'LINE連携', title: 'LINE Login / LIFF を設定（必要時）' },
  { category: 'LINE連携', title: 'Webhook URLを設定し疎通確認' },
  { category: 'LINE連携', title: 'あいさつ・応答設定をAIモードへ切替' },
  // AI設定
  { category: 'AI設定', title: '業界デフォルトを設定' },
  { category: 'AI設定', title: 'ブランド人格を設定' },
  { category: 'AI設定', title: 'しゃべり方・トーンを設定' },
  { category: 'AI設定', title: '事業・商品情報（business_kb）を入力' },
  { category: 'AI設定', title: 'FAQを登録（5〜10件）' },
  { category: 'AI設定', title: '禁止事項・NGを設定' },
  { category: 'AI設定', title: '人へのエスカレ条件を設定' },
  { category: 'AI設定', title: '商品提案ルールを設定' },
  { category: 'AI設定', title: '模範応答例（few-shot）を登録' },
  { category: 'AI設定', title: 'テスト会話でAI品質を確認' },
  // 制作
  { category: '制作', title: 'AI商品DBに主要商品を登録' },
  { category: '制作', title: 'リッチメニュー画像を制作' },
  { category: '制作', title: 'リッチメニューを設定・公開' },
  { category: '制作', title: 'ウェルカムシナリオを作成（友だち追加時）' },
  { category: '制作', title: '自動応答キーワードを設定' },
  { category: '制作', title: '初回クーポンを作成' },
  { category: '制作', title: '商品紹介カード（Flex）を作成' },
  // セグメント・タグ
  { category: 'セグメント・タグ', title: 'タグ設計（新規/リピーター/VIP 等）' },
  { category: 'セグメント・タグ', title: 'セグメントタグを設定（AI自動付与）' },
  { category: 'セグメント・タグ', title: 'テスト配信先（test_recipients）を設定' },
  // 配信・運用開始
  { category: '配信・運用開始', title: 'プラン整合（月間配信本数・KPI）を確認' },
  { category: '配信・運用開始', title: '課金設定（プラン/月額/予算上限/per_friend上限）を設定' },
  { category: '配信・運用開始', title: '初回配信を制作・スケジュール' },
  { category: '配信・運用開始', title: 'テスト配信 → 本番配信' },
  { category: '配信・運用開始', title: 'AI接客を本番ON' },
  // 定例・改善
  { category: '定例・改善', title: '初月レポートを作成・共有' },
  { category: '定例・改善', title: '改善MTG（Standardプラン）' },
  { category: '定例・改善', title: '翌月の配信計画を作成' },
];

// GET /api/onboarding/tasks?lineAccountId=xxx
onboarding.get('/api/onboarding/tasks', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM onboarding_tasks WHERE line_account_id = ? ORDER BY order_index ASC, created_at ASC`,
    )
      .bind(lineAccountId)
      .all<OnboardingTaskRow>();
    return c.json({ success: true, data: (results ?? []).map(serialize) });
  } catch (err) {
    console.error('GET /api/onboarding/tasks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/onboarding/tasks - 項目を追加
onboarding.post('/api/onboarding/tasks', async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId?: string;
      category?: string;
      title?: string;
      description?: string;
    }>();
    if (!body.lineAccountId || !body.title) {
      return c.json({ success: false, error: 'lineAccountId and title are required' }, 400);
    }
    const id = crypto.randomUUID();
    const category = body.category?.trim() || 'その他';
    const maxRow = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(order_index), -1) AS m FROM onboarding_tasks WHERE line_account_id = ?`,
    )
      .bind(body.lineAccountId)
      .first<{ m: number }>();
    const orderIndex = (maxRow?.m ?? -1) + 1;
    await c.env.DB.prepare(
      `INSERT INTO onboarding_tasks (id, line_account_id, category, title, description, order_index)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, body.lineAccountId, category, body.title.trim(), body.description?.trim() || null, orderIndex)
      .run();
    const row = await c.env.DB.prepare(`SELECT * FROM onboarding_tasks WHERE id = ?`)
      .bind(id)
      .first<OnboardingTaskRow>();
    return c.json({ success: true, data: row ? serialize(row) : null }, 201);
  } catch (err) {
    console.error('POST /api/onboarding/tasks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/onboarding/tasks/:id - 更新（完了トグル / 編集 / 並び替え）
onboarding.patch('/api/onboarding/tasks/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      title?: string;
      description?: string;
      category?: string;
      isDone?: boolean;
      orderIndex?: number;
    }>();

    const sets: string[] = [];
    const binds: unknown[] = [];
    if (typeof body.title === 'string') {
      sets.push('title = ?');
      binds.push(body.title.trim());
    }
    if (typeof body.description === 'string') {
      sets.push('description = ?');
      binds.push(body.description.trim() || null);
    }
    if (typeof body.category === 'string') {
      sets.push('category = ?');
      binds.push(body.category.trim() || 'その他');
    }
    if (typeof body.orderIndex === 'number') {
      sets.push('order_index = ?');
      binds.push(body.orderIndex);
    }
    if (typeof body.isDone === 'boolean') {
      sets.push('is_done = ?');
      binds.push(body.isDone ? 1 : 0);
      sets.push(`done_at = ${body.isDone ? JST_NOW : 'NULL'}`);
    }
    if (sets.length === 0) {
      return c.json({ success: false, error: 'no fields to update' }, 400);
    }
    sets.push(`updated_at = ${JST_NOW}`);
    binds.push(id);

    await c.env.DB.prepare(`UPDATE onboarding_tasks SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
    const row = await c.env.DB.prepare(`SELECT * FROM onboarding_tasks WHERE id = ?`)
      .bind(id)
      .first<OnboardingTaskRow>();
    if (!row) return c.json({ success: false, error: 'not found' }, 404);
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    console.error('PATCH /api/onboarding/tasks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/onboarding/tasks/:id
onboarding.delete('/api/onboarding/tasks/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare(`DELETE FROM onboarding_tasks WHERE id = ?`).bind(id).run();
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/onboarding/tasks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/onboarding/tasks/apply-template - テンプレを流し込む（既存タイトルはスキップ）
onboarding.post('/api/onboarding/tasks/apply-template', async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: string }>();
    if (!body.lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    const existing = await c.env.DB.prepare(
      `SELECT title FROM onboarding_tasks WHERE line_account_id = ?`,
    )
      .bind(body.lineAccountId)
      .all<{ title: string }>();
    const have = new Set((existing.results ?? []).map((r) => r.title));

    const maxRow = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(order_index), -1) AS m FROM onboarding_tasks WHERE line_account_id = ?`,
    )
      .bind(body.lineAccountId)
      .first<{ m: number }>();
    let order = (maxRow?.m ?? -1) + 1;

    const toInsert = TEMPLATE.filter((t) => !have.has(t.title));
    if (toInsert.length === 0) {
      return c.json({ success: true, data: { inserted: 0 } });
    }
    const stmt = c.env.DB.prepare(
      `INSERT INTO onboarding_tasks (id, line_account_id, category, title, description, order_index)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const batch = toInsert.map((t) =>
      stmt.bind(crypto.randomUUID(), body.lineAccountId, t.category, t.title, t.description ?? null, order++),
    );
    await c.env.DB.batch(batch);
    return c.json({ success: true, data: { inserted: toInsert.length } }, 201);
  } catch (err) {
    console.error('POST /api/onboarding/tasks/apply-template error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { onboarding };

/**
 * AI 接客チャット用 Tool Calling (Function Calling) 定義と実行
 *
 * Claude が「予約空き時間を確認したい」「料金表が知りたい」と判断したら、
 * これらの関数を AI が直接呼んで DB を叩き、結果を踏まえて応答を組み立てる。
 *
 * 設計方針:
 *   - 各ツールは "純粋関数" (副作用なし、参照のみ)。書き込みは AI に持たせない
 *     (予約成立など重要操作は人間 / LIFF 経由に統一)
 *   - 出力は 1〜2 行で要約された自然文。生 JSON を AI に投げない (トークン節約 + 解釈ぶれ防止)
 *   - 失敗時は "情報を取得できませんでした" を返し、AI が "確認します" と人間にエスカレできる
 */

import type { ClaudeTool } from '../lib/claude-client.js';

/** AI が呼べるツール一覧 (system prompt と一緒に Claude に渡す) */
export const AI_CHAT_TOOLS: ClaudeTool[] = [
  {
    name: 'get_menus',
    description: '取り扱いメニュー (料金・所要時間) の一覧。お客様から「メニュー一覧」「いくら?」「どんな施術がある?」と聞かれた時に使う。カテゴリ指定で絞り込み可能。',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'メニューカテゴリで絞り込む場合 (例: カット, カラー)。指定なしで全件' },
        limit: { type: 'number', description: '上限件数。デフォルト 10' },
      },
    },
  },
  {
    name: 'search_products',
    description: '取扱商品 DB をキーワードで検索。お客様から「○○ってある?」「△△に効く商品は?」と聞かれた時に使う。',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '検索キーワード (商品名・カテゴリ・効能等)' },
        limit: { type: 'number', description: '上限件数。デフォルト 5' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'get_booking_availability',
    description: '指定日 (or 期間) の予約空き状況。お客様から「来週空いてる?」「○月○日空いてる?」と聞かれた時に使う。',
    input_schema: {
      type: 'object',
      properties: {
        date_from: { type: 'string', description: '開始日 (YYYY-MM-DD)。指定なしで今日' },
        date_to: { type: 'string', description: '終了日 (YYYY-MM-DD)。指定なしで date_from から 7 日後まで' },
        menu_id: { type: 'string', description: '特定メニューに紐づく空きを見たい場合のメニューID (任意)' },
      },
    },
  },
  {
    name: 'get_business_hours',
    description: '営業時間・定休日。お客様から「何時まで?」「今日やってる?」「日曜営業してる?」と聞かれた時に使う。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_friend_purchase_history',
    description: 'このお客様の購入履歴・来店履歴 (friend_profile_summary 経由)。「前回○○頼んだ?」「いつから通ってる?」など顧客自身に関する質問の時に使う。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// 実行ハンドラ
// ---------------------------------------------------------------------------

export interface ToolExecContext {
  db: D1Database;
  lineAccountId: string;
  friendId: string;
}

/** ツール実行ディスパッチャ。AI から渡された name と input で関数を呼び、自然文を返す。 */
export async function executeTool(
  ctx: ToolExecContext,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'get_menus':
        return await toolGetMenus(ctx, input);
      case 'search_products':
        return await toolSearchProducts(ctx, input);
      case 'get_booking_availability':
        return await toolGetBookingAvailability(ctx, input);
      case 'get_business_hours':
        return await toolGetBusinessHours(ctx);
      case 'get_friend_purchase_history':
        return await toolGetFriendPurchaseHistory(ctx);
      default:
        return `(unknown tool: ${name})`;
    }
  } catch (e) {
    console.warn(`[ai-chat-tools] ${name} failed:`, e);
    return `(${name} 実行失敗。担当者にエスカレーション推奨)`;
  }
}

async function toolGetMenus(ctx: ToolExecContext, input: Record<string, unknown>): Promise<string> {
  const category = typeof input.category === 'string' ? input.category.trim() : '';
  const limit = Math.min(typeof input.limit === 'number' ? input.limit : 10, 30);

  let sql = `SELECT name, category_label, duration_minutes, base_price
             FROM menus WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL`;
  const binds: unknown[] = [ctx.lineAccountId];
  if (category) {
    sql += ` AND (category_label LIKE ? OR name LIKE ?)`;
    binds.push(`%${category}%`, `%${category}%`);
  }
  sql += ` ORDER BY sort_order ASC LIMIT ?`;
  binds.push(limit);

  const res = await ctx.db.prepare(sql).bind(...binds).all<{
    name: string;
    category_label: string | null;
    duration_minutes: number;
    base_price: number;
  }>();

  if (res.results.length === 0) {
    return category ? `カテゴリ「${category}」に該当するメニューは見つかりませんでした。` : 'メニュー登録がまだありません。';
  }
  const lines = res.results.map((m) => {
    const cat = m.category_label ? `[${m.category_label}] ` : '';
    return `${cat}${m.name} (${m.duration_minutes}分・¥${m.base_price.toLocaleString('ja-JP')})`;
  });
  return `取扱メニュー ${res.results.length} 件:\n${lines.join('\n')}`;
}

async function toolSearchProducts(ctx: ToolExecContext, input: Record<string, unknown>): Promise<string> {
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
  const limit = Math.min(typeof input.limit === 'number' ? input.limit : 5, 10);
  if (!keyword) return 'キーワードが指定されていません。';

  const res = await ctx.db
    .prepare(
      `SELECT name, price_yen, description FROM ai_products
       WHERE line_account_id = ? AND is_active = 1
         AND (name LIKE ? OR description LIKE ? OR category LIKE ?)
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(ctx.lineAccountId, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit)
    .all<{ name: string; price_yen: number | null; description: string | null }>();

  if (res.results.length === 0) {
    return `「${keyword}」に該当する商品は取扱がありません。`;
  }
  const lines = res.results.map((p) => {
    const price = p.price_yen != null ? `¥${p.price_yen.toLocaleString('ja-JP')}` : '価格未設定';
    const desc = p.description ? ` - ${p.description.slice(0, 60)}` : '';
    return `${p.name} (${price})${desc}`;
  });
  return `「${keyword}」検索結果 ${res.results.length} 件:\n${lines.join('\n')}`;
}

async function toolGetBookingAvailability(ctx: ToolExecContext, input: Record<string, unknown>): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = typeof input.date_from === 'string' ? input.date_from : today;
  const dateTo = typeof input.date_to === 'string' ? input.date_to : (() => {
    const d = new Date(dateFrom);
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();

  // スタッフのシフトを取って、bookings と突き合わせて空き枠を粗く計算
  const shifts = await ctx.db
    .prepare(
      `SELECT s.staff_id, s.work_date, s.start_time, s.end_time, st.display_name
       FROM staff_shifts s
       INNER JOIN staff st ON st.id = s.staff_id
       WHERE st.line_account_id = ? AND st.is_active = 1
         AND s.work_date >= ? AND s.work_date <= ?
       ORDER BY s.work_date ASC, s.start_time ASC
       LIMIT 50`,
    )
    .bind(ctx.lineAccountId, dateFrom, dateTo)
    .all<{ staff_id: string; work_date: string; start_time: string; end_time: string; display_name: string }>();

  if (shifts.results.length === 0) {
    return `${dateFrom}〜${dateTo} に出勤予定のスタッフがいません (定休日・未シフトの可能性)。`;
  }

  // 簡易版: その日の "シフト時間帯" を空きとして提示 (細かい予約被り計算は LIFF 予約フォームに任せる)
  const byDate = new Map<string, string[]>();
  for (const s of shifts.results) {
    const arr = byDate.get(s.work_date) ?? [];
    arr.push(`${s.start_time}-${s.end_time} (${s.display_name})`);
    byDate.set(s.work_date, arr);
  }
  const lines = Array.from(byDate.entries()).slice(0, 7).map(([d, arr]) => `${d}: ${arr.join(' / ')}`);
  return `${dateFrom}〜${dateTo} の出勤枠 (詳細な空きは予約フォームでご確認を):\n${lines.join('\n')}`;
}

async function toolGetBusinessHours(ctx: ToolExecContext): Promise<string> {
  const row = await ctx.db
    .prepare(`SELECT key, value FROM account_settings WHERE line_account_id = ? AND key IN ('business_hours', 'closed_days')`)
    .bind(ctx.lineAccountId)
    .all<{ key: string; value: string }>();

  if (row.results.length === 0) {
    return '営業時間の設定が未登録です (担当者にご確認ください)。';
  }
  const map = new Map(row.results.map((r) => [r.key, r.value]));
  const hours = map.get('business_hours') ?? '未設定';
  const closed = map.get('closed_days') ?? '不定休';
  return `営業時間: ${hours} / 定休日: ${closed}`;
}

async function toolGetFriendPurchaseHistory(ctx: ToolExecContext): Promise<string> {
  const summary = await ctx.db
    .prepare(
      `SELECT total_purchases, total_spent_yen, days_since_last_purchase,
              purchase_history_json, last_significant_event, last_significant_at
       FROM friend_profile_summary WHERE friend_id = ? LIMIT 1`,
    )
    .bind(ctx.friendId)
    .first<{
      total_purchases: number;
      total_spent_yen: number;
      days_since_last_purchase: number | null;
      purchase_history_json: string | null;
      last_significant_event: string | null;
      last_significant_at: string | null;
    }>();

  if (!summary) {
    return 'このお客様の購入履歴データはまだ集約されていません (初回 or 集計待ち)。';
  }
  const parts: string[] = [];
  parts.push(`累計購入: ${summary.total_purchases} 回 / ¥${summary.total_spent_yen.toLocaleString('ja-JP')}`);
  if (summary.days_since_last_purchase != null) {
    parts.push(`最終購入から ${summary.days_since_last_purchase} 日`);
  }
  if (summary.last_significant_event) {
    parts.push(`直近の重要イベント: ${summary.last_significant_event}`);
  }
  if (summary.purchase_history_json) {
    try {
      const arr = JSON.parse(summary.purchase_history_json) as Array<{ name?: string; price?: number; at?: string }>;
      const recent = arr.slice(0, 3).map((p) => p.name ?? '(no name)').join(' / ');
      if (recent) parts.push(`直近購入: ${recent}`);
    } catch { /* ignore */ }
  }
  return parts.join('\n');
}

/**
 * L ステップ等の他ツールからの一括インポート API
 *
 * 想定する CSV フォーマット（L ステップ標準エクスポート互換）:
 *
 * 1. friends.csv:
 *    表示名,ユーザーID,登録日時,タグ
 *    "山田太郎","U1234abcd...","2024-01-15 10:30","VIP|新規"
 *
 * 2. tags.csv:
 *    タグ名,色
 *    "VIP","#ff6600"
 *
 * POST /api/imports/lstep/friends   body: { csv: string, accountId: string }
 * POST /api/imports/lstep/tags      body: { csv: string, accountId: string }
 *
 * 結果: { created: N, updated: M, skipped: K, errors: [...] }
 */

import { Hono } from 'hono';
import type { Env } from '../index.js';

export const imports = new Hono<Env>();

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuote = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuote = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuote = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (cell !== '' || row.length > 0) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      }
      // \r\n は次の \n もスキップ
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

interface ColMap {
  displayName?: number;
  lineUserId?: number;
  registeredAt?: number;
  tags?: number;
  tagName?: number;
  color?: number;
  broadcastTitle?: number;
  broadcastContent?: number;
  broadcastSentAt?: number;
}

function detectColumns(header: string[]): ColMap {
  const map: ColMap = {};
  header.forEach((h, idx) => {
    const norm = h.trim().toLowerCase();
    // 友だち系: L ステップ / エルメ / UTAGE / 一般
    if (
      norm === '表示名' || norm === '名前' || norm === '氏名' || norm === 'お名前' ||
      norm === 'display_name' || norm === 'displayname' || norm === 'name' ||
      norm === 'ニックネーム' || norm === 'nickname'
    ) {
      map.displayName = idx;
    } else if (
      norm === 'ユーザーid' || norm === 'ユーザーid（line）' ||
      norm === 'user_id' || norm === 'lineid' || norm === 'line id' ||
      norm === 'line_user_id' || norm === 'lineuserid' || norm === 'line user id' ||
      norm === 'line ユーザーid' || norm === 'line ユーザーid' ||
      norm === 'lineユーザーid' || norm === 'line uid'
    ) {
      map.lineUserId = idx;
    } else if (
      norm === '登録日時' || norm === '登録日' || norm === '友だち追加日' || norm === '友だち登録日' ||
      norm === 'registered_at' || norm === 'created_at' || norm === '追加日時'
    ) {
      map.registeredAt = idx;
    } else if (
      norm === 'タグ' || norm === 'tags' || norm === 'タグ一覧' ||
      norm === 'ラベル' || norm === 'labels' || norm === '属性'
    ) {
      map.tags = idx;
    } else if (
      norm === 'タグ名' || norm === 'tag_name' || norm === 'ラベル名'
    ) {
      map.tagName = idx;
    } else if (
      norm === '色' || norm === 'color' || norm === 'カラー'
    ) {
      map.color = idx;
    } else if (
      norm === 'タイトル' || norm === '配信タイトル' || norm === 'title' || norm === '件名' ||
      norm === 'メッセージ名' || norm === '配信名' || norm === 'キャンペーン名' || norm === 'subject'
    ) {
      map.broadcastTitle = idx;
    } else if (
      norm === '本文' || norm === '内容' || norm === '配信内容' || norm === 'メッセージ' ||
      norm === 'content' || norm === 'message' || norm === 'body' || norm === 'text' ||
      norm === '本文テキスト'
    ) {
      map.broadcastContent = idx;
    } else if (
      norm === '配信日時' || norm === '送信日時' || norm === '配信日' || norm === '送信日' ||
      norm === '送信時刻' || norm === 'sent_at' || norm === 'sent_date' || norm === '送信時'
    ) {
      map.broadcastSentAt = idx;
    }
  });
  return map;
}

imports.post('/api/imports/lstep/friends', async (c) => {
  const body = await c.req.json<{ csv: string; accountId: string }>();
  if (!body.csv || !body.accountId) {
    return c.json({ success: false, error: 'csv and accountId required' }, 400);
  }
  const account = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE id = ?`)
    .bind(body.accountId)
    .first();
  if (!account) {
    return c.json({ success: false, error: 'invalid accountId' }, 400);
  }

  const rows = parseCsv(body.csv);
  if (rows.length === 0) {
    return c.json({ success: false, error: 'csv is empty' }, 400);
  }
  const header = rows[0];
  const map = detectColumns(header);
  if (map.displayName === undefined && map.lineUserId === undefined) {
    return c.json(
      { success: false, error: '表示名 または ユーザーID 列が見つかりません。ヘッダーを確認してください。' },
      400,
    );
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: Array<{ line: number; reason: string }> = [];

  // タグ前処理: CSV 内で使われているタグ名を抽出し、未作成のものは事前作成
  const tagNameSet = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    if (map.tags === undefined) break;
    const tagsCell = rows[r][map.tags];
    if (!tagsCell) continue;
    for (const t of tagsCell.split(/[|｜,、]/).map((s) => s.trim()).filter(Boolean)) {
      tagNameSet.add(t);
    }
  }
  const tagIdByName = new Map<string, string>();
  for (const name of tagNameSet) {
    const existing = await c.env.DB
      .prepare(`SELECT id FROM tags WHERE name = ? AND line_account_id = ?`)
      .bind(name, body.accountId)
      .first<{ id: string }>();
    if (existing) {
      tagIdByName.set(name, existing.id);
    } else {
      const id = crypto.randomUUID();
      await c.env.DB
        .prepare(`INSERT INTO tags (id, name, color, line_account_id) VALUES (?, ?, ?, ?)`)
        .bind(id, name, '#6b7280', body.accountId)
        .run();
      tagIdByName.set(name, id);
    }
  }

  // 行ごとに処理
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const displayName = map.displayName !== undefined ? row[map.displayName]?.trim() : '';
    const lineUserId = map.lineUserId !== undefined ? row[map.lineUserId]?.trim() : '';

    if (!displayName && !lineUserId) {
      skipped++;
      continue;
    }

    try {
      let friendId: string;

      // LINE userId が "U..." 形式ならそれで重複チェック
      if (lineUserId && /^U[0-9a-f]{32}$/i.test(lineUserId)) {
        const existing = await c.env.DB
          .prepare(`SELECT id FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
          .bind(lineUserId, body.accountId)
          .first<{ id: string }>();
        if (existing) {
          friendId = existing.id;
          await c.env.DB
            .prepare(`UPDATE friends SET display_name = COALESCE(?, display_name) WHERE id = ?`)
            .bind(displayName || null, friendId)
            .run();
          updated++;
        } else {
          friendId = crypto.randomUUID();
          await c.env.DB
            .prepare(
              `INSERT INTO friends (id, line_user_id, display_name, line_account_id, status, follow_status)
               VALUES (?, ?, ?, ?, 'active', 'followed')`,
            )
            .bind(friendId, lineUserId, displayName || null, body.accountId)
            .run();
          created++;
        }
      } else {
        // line_user_id が無い場合は display_name で重複チェック（弱い）
        const existing = displayName
          ? await c.env.DB
              .prepare(`SELECT id FROM friends WHERE display_name = ? AND line_account_id = ? AND line_user_id IS NULL`)
              .bind(displayName, body.accountId)
              .first<{ id: string }>()
          : null;
        if (existing) {
          friendId = existing.id;
          skipped++;
          continue;
        }
        friendId = crypto.randomUUID();
        await c.env.DB
          .prepare(
            `INSERT INTO friends (id, display_name, line_account_id, status, follow_status)
             VALUES (?, ?, ?, 'active', 'followed')`,
          )
          .bind(friendId, displayName || `(no name #${r})`, body.accountId)
          .run();
        created++;
      }

      // タグ付与
      if (map.tags !== undefined && row[map.tags]) {
        const tagNames = row[map.tags].split(/[|｜,、]/).map((s) => s.trim()).filter(Boolean);
        for (const tn of tagNames) {
          const tagId = tagIdByName.get(tn);
          if (!tagId) continue;
          await c.env.DB
            .prepare(
              `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id) VALUES (?, ?)`,
            )
            .bind(friendId, tagId)
            .run();
        }
      }
    } catch (e) {
      errors.push({ line: r + 1, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return c.json({
    success: true,
    summary: { created, updated, skipped, errors: errors.length },
    errors: errors.slice(0, 30),
    tagsCreated: tagIdByName.size,
  });
});

imports.post('/api/imports/lstep/tags', async (c) => {
  const body = await c.req.json<{ csv: string; accountId: string }>();
  if (!body.csv || !body.accountId) {
    return c.json({ success: false, error: 'csv and accountId required' }, 400);
  }
  const rows = parseCsv(body.csv);
  if (rows.length === 0) return c.json({ success: false, error: 'csv is empty' }, 400);

  const map = detectColumns(rows[0]);
  if (map.tagName === undefined) {
    return c.json({ success: false, error: 'タグ名 列が見つかりません' }, 400);
  }

  let created = 0;
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const name = rows[r][map.tagName]?.trim();
    if (!name) {
      skipped++;
      continue;
    }
    const color = map.color !== undefined ? rows[r][map.color]?.trim() || '#6b7280' : '#6b7280';
    const existing = await c.env.DB
      .prepare(`SELECT id FROM tags WHERE name = ? AND line_account_id = ?`)
      .bind(name, body.accountId)
      .first();
    if (existing) {
      skipped++;
      continue;
    }
    await c.env.DB
      .prepare(`INSERT INTO tags (id, name, color, line_account_id) VALUES (?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), name, color, body.accountId)
      .run();
    created++;
  }
  return c.json({ success: true, summary: { created, skipped } });
});

/**
 * Lステップ等の配信履歴 CSV を取り込み、kb_documents に
 * source_type = 'past_broadcast' として登録する。
 *
 * 想定 CSV:
 *   配信日時,タイトル,本文,対象タグ
 *   "2024-01-15 10:30","新春キャンペーン","本年もよろしく…","VIP"
 *
 * 同じタイトル + 配信日時の重複はスキップ。
 */
imports.post('/api/imports/lstep/broadcasts', async (c) => {
  const body = await c.req.json<{ csv: string; accountId: string }>();
  if (!body.csv || !body.accountId) {
    return c.json({ success: false, error: 'csv and accountId required' }, 400);
  }
  const account = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE id = ?`)
    .bind(body.accountId)
    .first();
  if (!account) {
    return c.json({ success: false, error: 'invalid accountId' }, 400);
  }

  const rows = parseCsv(body.csv);
  if (rows.length === 0) return c.json({ success: false, error: 'csv is empty' }, 400);

  const map = detectColumns(rows[0]);
  if (map.broadcastContent === undefined) {
    return c.json(
      { success: false, error: '本文 列が見つかりません。ヘッダーを確認してください。' },
      400,
    );
  }

  let created = 0;
  let skipped = 0;
  const errors: Array<{ line: number; reason: string }> = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const content = (map.broadcastContent !== undefined ? row[map.broadcastContent] : '')?.trim();
    if (!content) {
      skipped++;
      continue;
    }
    const sentAt = (map.broadcastSentAt !== undefined ? row[map.broadcastSentAt] : '')?.trim() || '';
    const rawTitle = (map.broadcastTitle !== undefined ? row[map.broadcastTitle] : '')?.trim() || '';
    const title = rawTitle || (sentAt ? `[過去配信] ${sentAt}` : `[過去配信] #${r}`);

    try {
      // 重複チェック: 同じテナント x 同じタイトル x 同じ本文先頭 80 文字
      const dupKey = content.slice(0, 80);
      const existing = await c.env.DB
        .prepare(
          `SELECT id FROM kb_documents
           WHERE line_account_id = ?
             AND source_type = 'past_broadcast'
             AND title = ?
             AND substr(content, 1, 80) = ?
           LIMIT 1`,
        )
        .bind(body.accountId, title, dupKey)
        .first();
      if (existing) {
        skipped++;
        continue;
      }

      const id = crypto.randomUUID();
      const metadata = JSON.stringify({
        sent_at: sentAt || null,
        source: 'lstep_csv_import',
      });
      await c.env.DB
        .prepare(
          `INSERT INTO kb_documents
            (id, line_account_id, source_type, title, content, metadata_json, active)
           VALUES (?, ?, 'past_broadcast', ?, ?, ?, 1)`,
        )
        .bind(id, body.accountId, title, content, metadata)
        .run();
      created++;
    } catch (e) {
      errors.push({ line: r + 1, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return c.json({
    success: true,
    summary: { created, skipped, errors: errors.length },
    errors: errors.slice(0, 30),
  });
});

imports.post('/api/imports/lstep/preview', async (c) => {
  const body = await c.req.json<{ csv: string }>();
  if (!body.csv) return c.json({ success: false, error: 'csv required' }, 400);

  const rows = parseCsv(body.csv);
  if (rows.length === 0) return c.json({ success: false, error: 'csv is empty' }, 400);

  const header = rows[0];
  const map = detectColumns(header);
  const sample = rows.slice(1, 6); // 最大 5 行プレビュー

  let kind: 'friends' | 'tags' | 'broadcasts' | 'unknown' = 'unknown';
  // 配信判定優先: title + content が両方あれば配信履歴
  if (map.broadcastContent !== undefined && (map.broadcastTitle !== undefined || map.broadcastSentAt !== undefined)) {
    kind = 'broadcasts';
  } else if (map.lineUserId !== undefined || map.displayName !== undefined) {
    kind = 'friends';
  } else if (map.tagName !== undefined) {
    kind = 'tags';
  }

  return c.json({
    success: true,
    kind,
    columnsDetected: map,
    header,
    totalRows: rows.length - 1,
    sample,
  });
});

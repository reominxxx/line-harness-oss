/**
 * AI 接客チャット用に「顧客 1 人分の文脈データ」を一括取得するヘルパー。
 *
 * AI チャットの system プロンプトに動的に埋め込む顧客プロファイル・シグナル・
 * タグ・直近会話履歴をまとめて並列に取得する。
 *
 * 単独テストしやすいよう ai-chat.ts から分離。
 */

import {
  getFriendById,
  getAiFriendSignal,
  getFriendTags,
  getFriendProfileSummary,
} from '@line-crm/db';
import type { Friend, AiFriendSignalRow, Tag, FriendProfileSummaryRow } from '@line-crm/db';

export interface RecentMessage {
  direction: 'in' | 'out';
  content: string;
  message_type: string;
  source: string | null;
  created_at: string;
}

export interface FriendContext {
  friend: Friend | null;
  signals: AiFriendSignalRow | null;
  tags: Tag[];
  recentMessages: RecentMessage[];
  /** 長期プロファイル要約 (購入履歴・会話テーマ要約・興味タグ) */
  profileSummary: FriendProfileSummaryRow | null;
}

/**
 * 顧客 1 人分の文脈データを並列フェッチ。
 *
 * 各 fetch は独立して失敗しても他に影響しない (catch して null/[] にフォールバック)。
 * AI チャットの応答品質に影響するが「絶対必須」ではないため、欠落時は base プロンプト
 * 側で「データなし」として扱えば良い。
 */
export async function getFriendContext(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  recentMessageLimit = 5,
): Promise<FriendContext> {
  const [friend, signals, tags, recentMessages, profileSummary] = await Promise.all([
    getFriendById(db, friendId).catch(() => null),
    getAiFriendSignal(db, friendId).catch(() => null),
    getFriendTags(db, friendId).catch(() => [] as Tag[]),
    fetchRecentMessages(db, lineAccountId, friendId, recentMessageLimit).catch(() => []),
    getFriendProfileSummary(db, friendId).catch(() => null),
  ]);

  return { friend, signals, tags, recentMessages, profileSummary };
}

async function fetchRecentMessages(
  db: D1Database,
  lineAccountId: string,
  friendId: string,
  limit: number,
): Promise<RecentMessage[]> {
  const result = await db
    .prepare(
      `SELECT direction, content, message_type, source, created_at
         FROM messages_log
        WHERE line_account_id = ? AND friend_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(lineAccountId, friendId, limit)
    .all<{
      direction: string;
      content: string;
      message_type: string;
      source: string | null;
      created_at: string;
    }>();

  // 取得順 (新しい→古い) を反転して、AI には時系列順 (古い→新しい) で渡す
  return result.results
    .map((r) => ({
      direction: (r.direction === 'incoming' ? 'in' : 'out') as 'in' | 'out',
      content: r.content,
      message_type: r.message_type,
      source: r.source,
      created_at: r.created_at,
    }))
    .reverse();
}

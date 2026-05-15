/**
 * イベント駆動 AI ジョブのエンキュー
 *
 * 友だち追加 / コンバージョン発生 / 休眠検知などのイベントから
 * agent_jobs にジョブを enqueue する。
 *
 * 実行自体は既存の executor が cron で処理。即時実行ではない（イベント時に
 * 過剰な AI 呼び出しを防ぐため）。
 *
 * 設計判断:
 *   - tenant_automation_policy.automation_level で自動投入の積極性を制御
 *     - 'careful':     何も自動投入しない（手動運用前提）
 *     - 'standard':    新規友だち時のみウェルカム生成、CV 時はお礼
 *     - 'aggressive':  上記 + 休眠呼び戻し / レビュー依頼まで自動
 *   - 同じ friend に対する同種ジョブの重複防止（直近 7 日間）
 *   - すべて origin: 'automation' で enqueue
 */

import { createAgentJob, jstNow } from '@line-crm/db';

interface PolicyRow {
  automation_level: 'careful' | 'standard' | 'aggressive';
}

async function getPolicyLevel(
  db: D1Database,
  lineAccountId: string,
): Promise<'careful' | 'standard' | 'aggressive'> {
  const row = await db
    .prepare(`SELECT automation_level FROM tenant_automation_policy WHERE line_account_id = ?`)
    .bind(lineAccountId)
    .first<PolicyRow>();
  return row?.automation_level ?? 'careful';
}

async function isDuplicateRecentJob(
  db: D1Database,
  lineAccountId: string,
  jobType: string,
  friendIdKey: string,
  windowDays = 7,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM agent_jobs
       WHERE line_account_id = ?
         AND job_type = ?
         AND input_json LIKE ?
         AND created_at >= datetime('now', '-' || ? || ' days', '+9 hours')
       LIMIT 1`,
    )
    .bind(lineAccountId, jobType, `%"friend_id":"${friendIdKey}"%`, windowDays)
    .first();
  return Boolean(row);
}

/**
 * 友だち追加時のイベント
 *
 * standard 以上: AI に「業界別ウェルカムメッセージ」を生成させて review に
 * aggressive:    standard と同じ
 *
 * 既存の friend_add シナリオ enrollment（webhook 側）と併走可能。
 * AI 配信は「個別パーソナライズしたもう一押し」の役割。
 */
export async function enqueueOnFriendAdd(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    displayName?: string | null;
  },
): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
  const level = await getPolicyLevel(db, input.lineAccountId);
  if (level === 'careful') return { enqueued: false, reason: 'policy=careful' };

  const dup = await isDuplicateRecentJob(db, input.lineAccountId, 'generate_broadcast', input.friendId, 30);
  if (dup) return { enqueued: false, reason: 'duplicate' };

  // スケジュールは 2 時間後（一度落ち着かせてから配信予約）
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const job = await createAgentJob(db, {
    lineAccountId: input.lineAccountId,
    jobType: 'generate_broadcast',
    origin: 'automation',
    input: {
      friend_id: input.friendId,
      display_name: input.displayName ?? null,
      topic: 'ウェルカム（新規友だち追加へのパーソナライズ）',
      target: '今日追加された新規友だち',
      tone: '親しみのある初対面',
      trigger: 'friend_add',
    },
    scheduledAt,
  });
  return { enqueued: true, jobId: job.id };
}

/**
 * CV（コンバージョン）発生時のイベント
 *
 * standard 以上: お礼配信案を生成
 * aggressive:    お礼 + レビュー依頼を生成
 */
export async function enqueueOnConversion(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    cvPointId?: string | null;
    cvLabel?: string | null;
  },
): Promise<{ enqueued: boolean; jobIds?: string[]; reason?: string }> {
  const level = await getPolicyLevel(db, input.lineAccountId);
  if (level === 'careful') return { enqueued: false, reason: 'policy=careful' };

  const dup = await isDuplicateRecentJob(db, input.lineAccountId, 'generate_broadcast', input.friendId, 3);
  if (dup) return { enqueued: false, reason: 'duplicate' };

  const ids: string[] = [];

  // お礼配信（24h 後に予約）
  const thanksAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const thanksJob = await createAgentJob(db, {
    lineAccountId: input.lineAccountId,
    jobType: 'generate_broadcast',
    origin: 'automation',
    input: {
      friend_id: input.friendId,
      cv_point_id: input.cvPointId ?? null,
      topic: `CV お礼: ${input.cvLabel ?? '購入・予約'}`,
      target: '直近 24h で CV した友だち（個別）',
      tone: '心を込めたお礼、押し売りなし',
      trigger: 'conversion',
    },
    scheduledAt: thanksAt,
  });
  ids.push(thanksJob.id);

  if (level === 'aggressive') {
    // レビュー依頼（7 日後に予約）
    const reviewAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const reviewJob = await createAgentJob(db, {
      lineAccountId: input.lineAccountId,
      jobType: 'request_reviews',
      origin: 'automation',
      input: {
        friend_id: input.friendId,
        cv_point_id: input.cvPointId ?? null,
        trigger: 'conversion_followup',
      },
      scheduledAt: reviewAt,
    });
    ids.push(reviewJob.id);
  }

  return { enqueued: true, jobIds: ids };
}

/**
 * 休眠検知時のイベント（dormant detection cron が呼ぶ想定）
 *
 * aggressive のみ自動投入。standard / careful では手動運用。
 */
export async function enqueueOnDormantDetected(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    dormantDays: number;
  },
): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
  const level = await getPolicyLevel(db, input.lineAccountId);
  if (level !== 'aggressive') return { enqueued: false, reason: `policy=${level}` };

  const dup = await isDuplicateRecentJob(db, input.lineAccountId, 'wake_dormant', input.friendId, 60);
  if (dup) return { enqueued: false, reason: 'duplicate' };

  const job = await createAgentJob(db, {
    lineAccountId: input.lineAccountId,
    jobType: 'wake_dormant',
    origin: 'automation',
    input: {
      friend_id: input.friendId,
      dormant_days: input.dormantDays,
      trigger: 'dormant_detected',
    },
    scheduledAt: jstNow(),
  });
  return { enqueued: true, jobId: job.id };
}

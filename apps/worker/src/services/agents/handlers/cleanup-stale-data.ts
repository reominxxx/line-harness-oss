/**
 * 古いデータの自動削除 handler
 *
 * - ai_response_cache: expires_at 超過、または created_at が 30 日超
 * - messages_log: 90 日超（ただし保持要件により上書き可）
 * - ai_usage_log: 2 年超
 * - audit_log: 5 年超
 *
 * 自動公開（提案じゃなくて純粋な削除作業）。
 * 月 1 回 cron で走らせる想定。
 */

import { jstNow } from '@line-crm/db';
import type { JobContext, JobResult } from '../types.js';

interface CleanupResult {
  cacheDeleted: number;
  messagesArchived: number;
  usageArchived: number;
  auditArchived: number;
}

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;
const DAYS_90_MS = 90 * 24 * 60 * 60 * 1000;
const DAYS_730_MS = 730 * 24 * 60 * 60 * 1000;
const DAYS_1825_MS = 1825 * 24 * 60 * 60 * 1000;

export async function handleCleanupStaleData(ctx: JobContext): Promise<JobResult> {
  const { db } = ctx;
  const input = JSON.parse(ctx.job.input_json || '{}') as { dryRun?: boolean };
  const result: CleanupResult = {
    cacheDeleted: 0,
    messagesArchived: 0,
    usageArchived: 0,
    auditArchived: 0,
  };

  const now = Date.now();
  const cutoffCache = new Date(now - DAYS_30_MS).toISOString();
  const cutoffMessages = new Date(now - DAYS_90_MS).toISOString();
  const cutoffUsage = new Date(now - DAYS_730_MS).toISOString();
  const cutoffAudit = new Date(now - DAYS_1825_MS).toISOString();

  if (input.dryRun) {
    // カウントのみ返す
    const r1 = await db
      .prepare(`SELECT COUNT(*) as c FROM ai_response_cache WHERE created_at < ? OR (expires_at IS NOT NULL AND expires_at < ?)`)
      .bind(cutoffCache, jstNow())
      .first<{ c: number }>();
    const r2 = await db
      .prepare(`SELECT COUNT(*) as c FROM messages_log WHERE created_at < ?`)
      .bind(cutoffMessages)
      .first<{ c: number }>();
    const r3 = await db
      .prepare(`SELECT COUNT(*) as c FROM ai_usage_log WHERE created_at < ?`)
      .bind(cutoffUsage)
      .first<{ c: number }>();
    const r4 = await db
      .prepare(`SELECT COUNT(*) as c FROM audit_log WHERE created_at < ?`)
      .bind(cutoffAudit)
      .first<{ c: number }>();

    return {
      output: {
        dryRun: true,
        wouldDelete: {
          cache: r1?.c ?? 0,
          messages: r2?.c ?? 0,
          usage: r3?.c ?? 0,
          audit: r4?.c ?? 0,
        },
      },
      costYenX100: 0,
      forceStatus: 'completed',
    };
  }

  // ai_response_cache: 期限切れ or 30日超
  try {
    const r = await db
      .prepare(`DELETE FROM ai_response_cache WHERE created_at < ? OR (expires_at IS NOT NULL AND expires_at < ?)`)
      .bind(cutoffCache, jstNow())
      .run();
    result.cacheDeleted = (r.meta as { changes?: number })?.changes ?? 0;
  } catch (e) {
    console.error('[cleanup] cache:', e);
  }

  // messages_log: 90 日超
  try {
    const r = await db
      .prepare(`DELETE FROM messages_log WHERE created_at < ?`)
      .bind(cutoffMessages)
      .run();
    result.messagesArchived = (r.meta as { changes?: number })?.changes ?? 0;
  } catch (e) {
    console.error('[cleanup] messages_log:', e);
  }

  // ai_usage_log: 2 年超
  try {
    const r = await db
      .prepare(`DELETE FROM ai_usage_log WHERE created_at < ?`)
      .bind(cutoffUsage)
      .run();
    result.usageArchived = (r.meta as { changes?: number })?.changes ?? 0;
  } catch (e) {
    console.error('[cleanup] ai_usage_log:', e);
  }

  // audit_log: 5 年超
  try {
    const r = await db
      .prepare(`DELETE FROM audit_log WHERE created_at < ?`)
      .bind(cutoffAudit)
      .run();
    result.auditArchived = (r.meta as { changes?: number })?.changes ?? 0;
  } catch (e) {
    console.error('[cleanup] audit_log:', e);
  }

  return {
    output: {
      ...result,
      cutoffs: {
        cache: cutoffCache,
        messages: cutoffMessages,
        usage: cutoffUsage,
        audit: cutoffAudit,
      },
    },
    costYenX100: 0,
    forceStatus: 'completed',
  };
}

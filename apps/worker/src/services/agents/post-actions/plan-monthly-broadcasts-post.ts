/**
 * plan_monthly_broadcasts の post-action
 *
 * 月初プランナーが生成した broadcasts 配列を、それぞれ generate_broadcast ジョブとして
 * agent_jobs に enqueue する。各ジョブには broadcastType / topic / targetSegment が
 * 渡されるので、配信種別ごとの専用プロンプトが効くようになる (Big Move 2 と連動)。
 */

import { createAgentJob, type AgentJobOrigin } from '@line-crm/db';
import type { PostActionContext, PostActionResult } from './index.js';

interface PlannerBroadcast {
  slot: number;
  broadcastType: string;
  topic: string;
  targetSegment: string;
  scheduledDate: string | null;
  scheduledHour: number;
  rationale: string;
}

export async function handlePlanMonthlyBroadcastsPost(
  ctx: PostActionContext,
): Promise<PostActionResult> {
  const { job, db, lineAccountId } = ctx;
  if (!job.output_json) return { ok: false, error: 'no output_json' };

  let parsed: {
    monthTheme?: string;
    yearMonth?: string;
    totalCount?: number;
    industry?: string;
    broadcasts?: PlannerBroadcast[];
  };
  try {
    parsed = JSON.parse(job.output_json);
  } catch {
    return { ok: false, error: 'output_json parse failed' };
  }

  if (!Array.isArray(parsed.broadcasts) || parsed.broadcasts.length === 0) {
    return { ok: false, error: 'no broadcasts in plan' };
  }

  const yearMonth = parsed.yearMonth ?? new Date().toISOString().slice(0, 7);
  const enqueuedIds: string[] = [];
  const errors: string[] = [];

  for (const b of parsed.broadcasts) {
    const scheduledAt = computeScheduledAt(yearMonth, b.scheduledDate, b.scheduledHour);
    try {
      const newJob = await createAgentJob(db, {
        lineAccountId,
        jobType: 'generate_broadcast',
        input: {
          slot: b.slot,
          ofTotal: parsed.broadcasts!.length,
          yearMonth,
          topic: b.topic,
          broadcastType: b.broadcastType,
          targetSegment: b.targetSegment,
          industry: parsed.industry,
          monthTheme: parsed.monthTheme,
          plannerRationale: b.rationale,
        },
        origin: 'kpi_planner' as AgentJobOrigin,
        relatedKpiId: job.related_kpi_id,
        scheduledAt,
      });
      enqueuedIds.push(newJob.id);
    } catch (e) {
      errors.push(
        `slot ${b.slot} (${b.broadcastType}/${b.topic}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  return {
    ok: enqueuedIds.length > 0,
    createdResource: enqueuedIds.join(','),
    createdResourceType: 'agent_jobs',
    notes: `配信プラン ${parsed.broadcasts.length} 本中 ${enqueuedIds.length} 本を enqueue${
      errors.length > 0 ? ` (${errors.length} エラー)` : ''
    }`,
    error: errors.length > 0 ? errors.join(' / ') : undefined,
  };
}

/**
 * yearMonth + scheduledDate + scheduledHour から実行時刻 (ISO 8601 UTC) を計算。
 * scheduledDate が null や月外なら、yearMonth 内に均等割で配置するフォールバック。
 */
function computeScheduledAt(
  yearMonth: string,
  scheduledDate: string | null,
  hourJst: number,
): string {
  const safeHour = Math.min(Math.max(hourJst, 0), 23);
  let dateStr = scheduledDate;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !dateStr.startsWith(yearMonth)) {
    // フォールバック: 月初翌日にする
    const [y, m] = yearMonth.split('-').map(Number);
    dateStr = `${y}-${String(m).padStart(2, '0')}-02`;
  }
  // JST → UTC 変換 (JST = UTC+9 なので 9 時間引く)
  const utcHour = safeHour - 9;
  let dt = new Date(`${dateStr}T${String(Math.max(utcHour, 0)).padStart(2, '0')}:00:00Z`);
  if (utcHour < 0) {
    // JST 0〜8 時 → 前日 UTC
    dt = new Date(dt.getTime() - 24 * 60 * 60 * 1000);
    dt.setUTCHours(utcHour + 24);
  }
  // 既に過去なら 24h 後にずらす
  if (dt.getTime() < Date.now()) {
    dt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  return dt.toISOString();
}

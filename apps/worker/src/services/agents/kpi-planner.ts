/**
 * KPI Planner
 *
 * 月初 cron で呼ばれて、テナントの KPI 目標 → 必要な agent_jobs を生成する。
 * AI を使わない決定論的なルールベース実装（コスト 0 で動く）。
 * 将来的には Claude を使った賢い分解に進化させる余地あり。
 */

import {
  listKpiGoals,
  createAgentJob,
  type KpiMetric,
} from '@line-crm/db';

export interface PlanResult {
  jobsCreated: number;
  jobIds: string[];
}

export async function planForTenant(
  db: D1Database,
  lineAccountId: string,
  yearMonth: string,
): Promise<PlanResult> {
  const goals = await listKpiGoals(db, lineAccountId, yearMonth);
  if (goals.length === 0) return { jobsCreated: 0, jobIds: [] };

  const jobIds: string[] = [];

  // 月初に必ず生成するジョブ群（前月レポート）
  // yearMonth が今月の場合に限り、前月レポートを生成
  const today = new Date();
  const isFirstWeekOfMonth = today.getUTCDate() <= 7;
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (yearMonth === currentMonth && isFirstWeekOfMonth) {
    const prev = previousMonth(currentMonth);
    const reportJob = await createAgentJob(db, {
      lineAccountId,
      jobType: 'generate_monthly_report',
      input: { yearMonth: prev },
      origin: 'kpi_planner',
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    });
    jobIds.push(reportJob.id);
  }

  // KPI 別にタスク分解
  for (const goal of goals) {
    const remaining = Math.max(goal.target_value - goal.current_value, 0);
    if (remaining === 0) continue;

    const decomposed = decomposeKpi(goal.metric, remaining, yearMonth);
    for (const sub of decomposed) {
      const job = await createAgentJob(db, {
        lineAccountId,
        jobType: sub.jobType,
        input: sub.input,
        origin: 'kpi_planner',
        relatedKpiId: goal.id,
        scheduledAt: sub.scheduledAt,
      });
      jobIds.push(job.id);
    }
  }

  return { jobsCreated: jobIds.length, jobIds };
}

interface SubJob {
  jobType: string;
  input: Record<string, unknown>;
  scheduledAt: string;
}

function decomposeKpi(metric: KpiMetric, remaining: number, yearMonth: string): SubJob[] {
  const now = new Date();
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = now.getUTCDate();
  const remainingDays = Math.max(daysInMonth - today + 1, 1);

  switch (metric) {
    case 'broadcast_count': {
      // 残本数を残日数で均等割。スケジュールは火・木・土の 19 時を優先
      const interval = Math.ceil(remainingDays / Math.max(remaining, 1));
      return Array.from({ length: remaining }, (_, i) => {
        const dayOffset = i * interval + 2; // 2 日後から開始
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + dayOffset);
        date.setUTCHours(10, 0, 0, 0); // JST 19 時 = UTC 10 時
        return {
          jobType: 'generate_broadcast',
          input: {
            slot: i + 1,
            ofTotal: remaining,
            yearMonth,
          },
          scheduledAt: date.toISOString(),
        };
      });
    }

    case 'friend_growth': {
      // 友だち増は 2 つの集客キャンペーン + リッチメニュー CTA 改善
      return [
        {
          jobType: 'generate_acquisition_campaign',
          input: { target: remaining, yearMonth },
          scheduledAt: scheduleAfterDays(2),
        },
        {
          jobType: 'update_rich_menu_cta',
          input: { yearMonth },
          scheduledAt: scheduleAfterDays(3),
        },
      ];
    }

    case 'cv_count': {
      // CV はファネル分析 + ウォームリード掘り起こし
      return [
        {
          jobType: 'analyze_funnel',
          input: { yearMonth },
          scheduledAt: scheduleAfterDays(1),
        },
        {
          jobType: 'wake_warm_leads',
          input: { target: Math.ceil(remaining * 1.5), yearMonth },
          scheduledAt: scheduleAfterDays(2),
        },
      ];
    }

    case 'reactivation_count': {
      // 休眠掘り起こしは個別文面で N 件
      return Array.from({ length: Math.min(remaining, 20) }, (_, i) => ({
        jobType: 'wake_dormant',
        input: { batchIndex: i, yearMonth },
        scheduledAt: scheduleAfterDays(Math.floor(i / 5) + 1),
      }));
    }

    case 'open_rate':
    case 'click_rate':
      return [
        {
          jobType: 'analyze_broadcast_performance',
          input: { yearMonth, focus: metric },
          scheduledAt: scheduleAfterDays(1),
        },
      ];

    case 'nps':
      return [
        {
          jobType: 'analyze_chat_sentiment',
          input: { yearMonth },
          scheduledAt: scheduleAfterDays(1),
        },
      ];

    case 'reservation_count':
      return [
        {
          jobType: 'optimize_booking_promotion',
          input: { target: remaining, yearMonth },
          scheduledAt: scheduleAfterDays(2),
        },
      ];

    case 'review_count':
      return [
        {
          jobType: 'request_reviews',
          input: { target: remaining, yearMonth },
          scheduledAt: scheduleAfterDays(2),
        },
      ];

    default:
      return [];
  }
}

function scheduleAfterDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(0, 0, 0, 0); // 翌日午前 9 時 JST
  return d.toISOString();
}

function previousMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

/** 全テナント向けの月次計画実行（cron から呼ばれる） */
export async function planForAllTenants(
  db: D1Database,
  yearMonth?: string,
): Promise<{ tenantsPlanned: number; totalJobsCreated: number }> {
  const month = yearMonth ?? new Date().toISOString().slice(0, 7);
  const tenants = await db
    .prepare(`SELECT id FROM line_accounts WHERE is_active = 1`)
    .all<{ id: string }>();
  let totalJobs = 0;
  let tenantsPlanned = 0;
  for (const t of tenants.results) {
    try {
      const r = await planForTenant(db, t.id, month);
      totalJobs += r.jobsCreated;
      if (r.jobsCreated > 0) tenantsPlanned++;
    } catch (e) {
      console.error(`[kpi-planner] tenant ${t.id} failed:`, e);
    }
  }
  return { tenantsPlanned, totalJobsCreated: totalJobs };
}

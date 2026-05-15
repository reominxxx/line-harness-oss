'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type TenantMetering } from '@/lib/ai-api'

interface TenantStats {
  accountId: string
  accountName: string
  basicId?: string
  pictureUrl?: string | null
  metering: TenantMetering | null
  reviewQueueCount: number
  pendingJobsCount: number
  failedJobsCount: number
  monthCost: number
  loading: boolean
  error?: string
}

const PLAN_LABEL: Record<string, string> = {
  lite: 'Lite',
  standard: 'Standard',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export default function TenantsPage() {
  const { accounts, setSelectedAccountId } = useAccount()
  const [stats, setStats] = useState<Record<string, TenantStats>>({})
  const [loading, setLoading] = useState(false)

  const loadAll = useCallback(async () => {
    if (accounts.length === 0) return
    setLoading(true)
    const next: Record<string, TenantStats> = {}
    await Promise.all(accounts.map(async (a) => {
      next[a.id] = {
        accountId: a.id,
        accountName: a.displayName || a.name,
        basicId: a.basicId ?? undefined,
        pictureUrl: a.pictureUrl,
        metering: null,
        reviewQueueCount: 0,
        pendingJobsCount: 0,
        failedJobsCount: 0,
        monthCost: 0,
        loading: true,
      }
      try {
        const [meterRes, reviewRes, pendingRes, failedRes, usageRes] = await Promise.all([
          aiApi.metering.current(a.id).catch(() => null),
          aiApi.agentJobs.list(a.id, { status: 'review', limit: 100 }).catch(() => ({ jobs: [] })),
          aiApi.agentJobs.list(a.id, { status: 'pending', limit: 100 }).catch(() => ({ jobs: [] })),
          aiApi.agentJobs.list(a.id, { status: 'failed', limit: 100 }).catch(() => ({ jobs: [] })),
          aiApi.metering.usage(a.id).catch(() => null),
        ])
        next[a.id] = {
          accountId: a.id,
          accountName: a.displayName || a.name,
          basicId: a.basicId ?? undefined,
          pictureUrl: a.pictureUrl,
          metering: meterRes?.metering ?? null,
          reviewQueueCount: reviewRes.jobs.length,
          pendingJobsCount: pendingRes.jobs.length,
          failedJobsCount: failedRes.jobs.length,
          monthCost: ((usageRes?.summary as { total_cost_yen?: number } | undefined)?.total_cost_yen) ?? 0,
          loading: false,
        }
      } catch (e) {
        next[a.id].loading = false
        next[a.id].error = e instanceof Error ? e.message : 'load failed'
      }
    }))
    setStats(next)
    setLoading(false)
  }, [accounts])

  useEffect(() => { void loadAll() }, [loadAll])

  const totals = {
    accounts: Object.keys(stats).length,
    review: Object.values(stats).reduce((s, t) => s + t.reviewQueueCount, 0),
    pending: Object.values(stats).reduce((s, t) => s + t.pendingJobsCount, 0),
    failed: Object.values(stats).reduce((s, t) => s + t.failedJobsCount, 0),
    cost: Object.values(stats).reduce((s, t) => s + t.monthCost, 0),
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="マルチテナント運用" />
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="p-6 max-w-6xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">全 LINE アカウント（顧客）を 1 画面で横断管理</p>

          {/* 集計 */}
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">サマリー</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6">
            <SummaryCard label="テナント数" value={totals.accounts} />
            <SummaryCard label="承認待ち" value={totals.review} accent="text-amber-700" />
            <SummaryCard label="待機中" value={totals.pending} accent="text-blue-700" />
            <SummaryCard label="失敗" value={totals.failed} accent={totals.failed > 0 ? 'text-rose-700' : ''} />
            <SummaryCard label="今月コスト" value={`¥${totals.cost.toFixed(2)}`} />
          </div>

          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">テナント一覧</h2>
            <button onClick={() => void loadAll()} disabled={loading} className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50">再読み込み</button>
          </div>

          {accounts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-md text-center py-16 text-sm text-gray-400">
              LINE アカウントがまだ登録されていません
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
              {accounts.map((a) => {
                const s = stats[a.id]
                return (
                  <div key={a.id} className="p-4">
                    <div className="flex items-start gap-4">
                      {a.pictureUrl ? (
                        <img src={a.pictureUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium text-sm" style={{ background: 'linear-gradient(135deg, #1e2a4a 0%, #4a5b8a 100%)' }}>
                          {(a.displayName || a.name).charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-gray-900 truncate">{a.displayName || a.name}</h3>
                          {s?.metering && (
                            <span className="text-[11px] text-gray-600 px-1.5 py-0.5 bg-gray-100 rounded">{PLAN_LABEL[s.metering.plan]}</span>
                          )}
                          {a.basicId && <span className="text-[11px] text-gray-400">{a.basicId}</span>}
                        </div>
                        {s?.error ? (
                          <div className="text-xs text-rose-600">{s.error}</div>
                        ) : s?.loading ? (
                          <div className="text-xs text-gray-400">読み込み中…</div>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-2">
                            <Stat label="承認待ち" value={s?.reviewQueueCount ?? 0} accent={s && s.reviewQueueCount > 0 ? 'text-amber-700' : ''} />
                            <Stat label="待機中" value={s?.pendingJobsCount ?? 0} accent={s && s.pendingJobsCount > 0 ? 'text-blue-700' : ''} />
                            <Stat label="失敗" value={s?.failedJobsCount ?? 0} accent={s && s.failedJobsCount > 0 ? 'text-rose-700' : ''} />
                            <Stat label="今月コスト" value={`¥${s?.monthCost.toFixed(2) ?? '0.00'}`} />
                            <Stat label="超過課金" value={`¥${s?.metering?.overage_charge_yen ?? 0}`} accent={s?.metering && s.metering.overage_charge_yen > 0 ? 'text-orange-700' : ''} />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setSelectedAccountId(a.id)}
                        className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50 shrink-0"
                      >操作する</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-md px-4 py-3">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${accent ?? 'text-gray-900'}`}>{value}</div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`text-base font-medium tabular-nums ${accent ?? 'text-gray-900'}`}>{value}</div>
    </div>
  )
}

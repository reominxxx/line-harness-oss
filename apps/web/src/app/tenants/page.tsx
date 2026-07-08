'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type TenantMetering } from '@/lib/ai-api'
import { api, type CustomerKey } from '@/lib/api'

/** お客様ログインの入口 URL を team ホストから推測して返す */
function customerLoginUrl(): string {
  if (typeof window === 'undefined') return 'https://app.line-port.com/client/login'
  const h = window.location.hostname
  if (h === 'staging-team.line-port.com') return 'https://staging.line-port.com/client/login'
  if (h === 'team.line-port.com') return 'https://app.line-port.com/client/login'
  return `${window.location.origin}/client/login`
}

interface AccountStats {
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
  starter: 'Starter',
}

export default function AccountsOverviewPage() {
  const { accounts, setSelectedAccountId } = useAccount()
  const [stats, setStats] = useState<Record<string, AccountStats>>({})
  const [loading, setLoading] = useState(false)
  const [keyModalAccount, setKeyModalAccount] = useState<{ id: string; name: string } | null>(null)

  const loadAll = useCallback(async () => {
    if (accounts.length === 0) return
    setLoading(true)
    const next: Record<string, AccountStats> = {}
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
      <Header title="アカウント運用" />
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="p-6 max-w-6xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">全 LINE アカウント（顧客）を 1 画面で横断管理</p>

          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">サマリー</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6">
            <SummaryCard label="アカウント数" value={totals.accounts} />
            <SummaryCard label="承認待ち" value={totals.review} accent="text-amber-700" />
            <SummaryCard label="待機中" value={totals.pending} accent="text-blue-700" />
            <SummaryCard label="失敗" value={totals.failed} accent={totals.failed > 0 ? 'text-rose-700' : ''} />
            <SummaryCard label="今月コスト" value={`¥${totals.cost.toFixed(2)}`} />
          </div>

          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">アカウント一覧</h2>
            <button onClick={() => void loadAll()} disabled={loading} className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50 disabled:opacity-50">再読み込み</button>
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
                        // eslint-disable-next-line @next/next/no-img-element
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
                            <span className="text-[11px] text-gray-600 px-1.5 py-0.5 bg-gray-100 rounded">{PLAN_LABEL[s.metering.plan] ?? s.metering.plan}</span>
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
                      <div className="flex flex-col gap-2 shrink-0">
                        <button
                          onClick={() => setSelectedAccountId(a.id)}
                          className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50"
                        >操作する</button>
                        <button
                          onClick={() => setKeyModalAccount({ id: a.id, name: a.displayName || a.name })}
                          className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50"
                        >お客様ログイン</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
      {keyModalAccount && (
        <CustomerKeyModal
          accountId={keyModalAccount.id}
          accountName={keyModalAccount.name}
          onClose={() => setKeyModalAccount(null)}
        />
      )}
    </div>
  )
}

function CustomerKeyModal({ accountId, accountName, onClose }: { accountId: string; accountName: string; onClose: () => void }) {
  const [keys, setKeys] = useState<CustomerKey[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 発行/再発行直後の平文キー (この 1 度しか表示できない)
  const [issued, setIssued] = useState<{ keyId: string; apiKey: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.lineAccounts.customerKeys.list(accountId)
      if (res.success) setKeys(res.data)
      else setError(res.error || '取得に失敗しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  const issue = async () => {
    setBusy(true); setError(null)
    try {
      const res = await api.lineAccounts.customerKeys.create(accountId)
      if (res.success) {
        setIssued({ keyId: res.data.id, apiKey: res.data.apiKey })
        await load()
      } else setError(res.error || '発行に失敗しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '発行に失敗しました')
    } finally { setBusy(false) }
  }

  const regenerate = async (keyId: string) => {
    if (!confirm('このキーを再発行しますか？既存のキーは使えなくなります。')) return
    setBusy(true); setError(null)
    try {
      const res = await api.lineAccounts.customerKeys.regenerate(accountId, keyId)
      if (res.success) {
        setIssued({ keyId, apiKey: res.data.apiKey })
        await load()
      } else setError(res.error || '再発行に失敗しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '再発行に失敗しました')
    } finally { setBusy(false) }
  }

  const remove = async (keyId: string) => {
    if (!confirm('このお客様ログインを削除しますか？ログインできなくなります。')) return
    setBusy(true); setError(null)
    try {
      const res = await api.lineAccounts.customerKeys.remove(accountId, keyId)
      if (res.success) {
        if (issued?.keyId === keyId) setIssued(null)
        await load()
      } else setError(res.error || '削除に失敗しました')
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました')
    } finally { setBusy(false) }
  }

  const loginUrl = customerLoginUrl()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">お客様ログインキー</h3>
            <p className="text-xs text-gray-500 mt-0.5">{accountName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            お客様に発行するログイン用アクセスキーです。このキーでログインすると、
            <strong className="text-gray-700">{accountName}</strong> のデータのみ閲覧できます（他アカウントは一切見えません）。
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs">
            <span className="text-gray-500">ログイン URL：</span>
            <a href={loginUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{loginUrl}</a>
          </div>

          {issued && (
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
              <p className="text-xs font-medium text-emerald-800 mb-1">アクセスキーを発行しました（この画面でのみ表示されます）</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white border border-emerald-200 rounded px-2 py-1.5 text-xs break-all">{issued.apiKey}</code>
                <button
                  onClick={() => void navigator.clipboard?.writeText(issued.apiKey)}
                  className="shrink-0 bg-emerald-600 text-white px-2.5 py-1.5 rounded text-xs hover:bg-emerald-700"
                >コピー</button>
              </div>
              <p className="text-[11px] text-emerald-700 mt-1.5">このキーはお客様に安全な方法でお渡しください。閉じると再表示できません。</p>
            </div>
          )}

          {error && <div className="text-xs text-rose-600">{error}</div>}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">発行済みキー</h4>
              <button
                onClick={() => void issue()}
                disabled={busy}
                className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
              >＋ 新しいキーを発行</button>
            </div>
            {loading ? (
              <div className="text-xs text-gray-400 py-4 text-center">読み込み中…</div>
            ) : keys.length === 0 ? (
              <div className="text-xs text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded">まだ発行されていません</div>
            ) : (
              <div className="border border-gray-200 rounded divide-y divide-gray-100">
                {keys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-800 truncate">{k.name}</div>
                      <div className="text-[11px] text-gray-400">
                        {k.lastLoginAt ? `最終ログイン ${k.lastLoginAt.slice(0, 10)}` : '未ログイン'}・発行 {k.createdAt.slice(0, 10)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => void regenerate(k.id)}
                        disabled={busy}
                        className="text-gray-600 border border-gray-300 px-2 py-1 rounded text-xs hover:bg-gray-50 disabled:opacity-50"
                      >再発行</button>
                      <button
                        onClick={() => void remove(k.id)}
                        disabled={busy}
                        className="text-rose-600 border border-rose-200 px-2 py-1 rounded text-xs hover:bg-rose-50 disabled:opacity-50"
                      >削除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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

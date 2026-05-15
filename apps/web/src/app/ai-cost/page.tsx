'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type TenantMetering } from '@/lib/ai-api'

const PLANS: Array<{ key: 'lite' | 'standard' | 'pro' | 'enterprise'; label: string; price: string }> = [
  { key: 'lite', label: 'Lite', price: '¥39,800' },
  { key: 'standard', label: 'Standard', price: '¥98,000' },
  { key: 'pro', label: 'Pro', price: '¥198,000' },
  { key: 'enterprise', label: 'Enterprise', price: '個別' },
]

const METER_AXES: Array<{
  key: keyof TenantMetering
  used_key: keyof TenantMetering
  label: string
}> = [
  { key: 'monthly_broadcast_quota', used_key: 'used_broadcast', label: '配信通数' },
  { key: 'monthly_chat_quota', used_key: 'used_chat', label: 'AI チャット応答' },
  { key: 'monthly_vision_quota', used_key: 'used_vision', label: '画像理解' },
  { key: 'monthly_imagegen_quota', used_key: 'used_imagegen', label: '画像生成' },
  { key: 'monthly_kb_doc_quota', used_key: 'used_kb_doc', label: 'ナレッジ件数' },
]

interface UsageSummary {
  total_cost_yen: number
  total_calls: number
  cached_calls: number
  by_feature: Record<string, { calls: number; cost_yen: number }>
}

export default function AiCostPage() {
  const { selectedAccountId } = useAccount()
  const [metering, setMetering] = useState<TenantMetering | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [initing, setIniting] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const accountId = selectedAccountId
  const month = new Date().toISOString().slice(0, 7)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [meterRes, usageRes] = await Promise.all([
        aiApi.metering.current(accountId),
        aiApi.metering.usage(accountId, month),
      ])
      setMetering(meterRes.metering)
      setUsage(usageRes.summary as UsageSummary)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId, month])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleInitPlan = async (plan: typeof PLANS[number]['key']) => {
    if (!accountId) return
    if (!confirm(`プランを「${PLANS.find((p) => p.key === plan)?.label}」に設定します。よろしいですか？`)) return
    setIniting(true)
    try {
      const res = await aiApi.metering.init(accountId, plan)
      setMetering(res.metering)
      setToast({ kind: 'success', text: `${plan} プランを設定しました` })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '設定失敗' })
    } finally {
      setIniting(false)
    }
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="課金・コスト" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="課金・コスト" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          {/* プラン選択 */}
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">プラン</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
            {PLANS.map((p) => {
              const isCurrent = metering?.plan === p.key
              return (
                <button
                  key={p.key}
                  onClick={() => handleInitPlan(p.key)}
                  disabled={initing}
                  className={`bg-white border rounded-md px-4 py-3 text-left transition-colors ${isCurrent ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-medium text-gray-700">{p.label}</div>
                      <div className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{p.price}</div>
                      <div className="text-[11px] text-gray-400">/ 月</div>
                    </div>
                    {isCurrent && <span className="text-[11px] bg-gray-900 text-white px-1.5 py-0.5 rounded">現在</span>}
                  </div>
                </button>
              )
            })}
          </div>

          {!metering && !loading && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 mb-6">
              プランがまだ設定されていません。上のいずれかを押して初期化してください。
            </div>
          )}

          {/* 残量メーター */}
          {metering && (
            <>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                今月（{metering.current_month || month}）の使用状況
              </h2>
              <div className="bg-white border border-gray-200 rounded-md p-5 mb-6">
                <div className="space-y-4">
                  {METER_AXES.map((m) => {
                    const used = (metering[m.used_key] as number) ?? 0
                    const quota = (metering[m.key] as number) ?? 0
                    const percentage = quota > 0 ? Math.min((used / quota) * 100, 100) : 0
                    const isOver = used > quota
                    const barColor = isOver ? 'bg-rose-500' : percentage > 80 ? 'bg-amber-500' : 'bg-gray-900'
                    return (
                      <div key={String(m.key)}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-gray-700">{m.label}</span>
                          <div className="text-xs tabular-nums">
                            <span className={isOver ? 'text-rose-700 font-medium' : 'text-gray-900 font-medium'}>{used.toLocaleString()}</span>
                            <span className="text-gray-400"> / {quota.toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-8">
                <div className="bg-white border border-gray-200 rounded-md px-4 py-3">
                  <div className="text-[11px] text-gray-500 mb-1">プラン定額</div>
                  <div className="text-2xl font-semibold text-gray-900 tabular-nums">
                    {PLANS.find((p) => p.key === metering.plan)?.price ?? '—'}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-md px-4 py-3">
                  <div className="text-[11px] text-gray-500 mb-1">今月の超過課金</div>
                  <div className={`text-2xl font-semibold tabular-nums ${metering.overage_charge_yen > 0 ? 'text-orange-700' : 'text-gray-900'}`}>
                    ¥{metering.overage_charge_yen.toLocaleString()}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* AI 使用ログサマリ */}
          {usage && (
            <>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">機能別 AI 使用状況（今月）</h2>
              <div className="bg-white border border-gray-200 rounded-md p-5">
                <div className="grid grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                  <div>
                    <div className="text-[11px] text-gray-500">総呼び出し</div>
                    <div className="text-2xl font-semibold tabular-nums text-gray-900">{usage.total_calls.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500">うちキャッシュ</div>
                    <div className="text-2xl font-semibold tabular-nums text-emerald-700">{usage.cached_calls.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500">合計コスト</div>
                    <div className="text-2xl font-semibold tabular-nums text-gray-900">¥{usage.total_cost_yen.toFixed(2)}</div>
                  </div>
                </div>

                <table className="w-full mt-4 text-sm">
                  <thead className="text-[11px] text-gray-500">
                    <tr>
                      <th className="text-left py-2 font-medium">機能</th>
                      <th className="text-right py-2 font-medium">呼び出し数</th>
                      <th className="text-right py-2 font-medium">コスト</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(usage.by_feature).map(([feature, stats]) => (
                      <tr key={feature} className="border-t border-gray-100">
                        <td className="py-2 capitalize text-gray-700">{feature.replace(/_/g, ' ')}</td>
                        <td className="py-2 text-right tabular-nums text-gray-900">{stats.calls.toLocaleString()}</td>
                        <td className="py-2 text-right tabular-nums text-gray-900">¥{stats.cost_yen.toFixed(2)}</td>
                      </tr>
                    ))}
                    {Object.keys(usage.by_feature).length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-6 text-gray-400 text-xs">
                          まだ AI 使用ログはありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AiFriendSignal } from '@/lib/ai-api'

const RANKS: Array<{ key: NonNullable<AiFriendSignal['vip_rank']>; label: string; accent: string; desc: string }> = [
  { key: 'vip', label: 'VIP', accent: 'bg-violet-500', desc: '上得意客' },
  { key: 'hot', label: 'ホット', accent: 'bg-rose-500', desc: '今すぐ買いそう' },
  { key: 'warm', label: 'ウォーム', accent: 'bg-amber-400', desc: '関心あり' },
  { key: 'cold', label: 'コールド', accent: 'bg-sky-400', desc: '低反応' },
  { key: 'dormant', label: '休眠', accent: 'bg-gray-400', desc: '長期未接触' },
  { key: 'new', label: 'NEW', accent: 'bg-emerald-500', desc: '新規' },
]

interface Summary {
  rank_counts: Record<string, number>
  avg_purchase_intent: number
  avg_churn_risk: number
  avg_ltv_estimate_yen: number
}

export default function AiSignalsPage() {
  const { selectedAccountId } = useAccount()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [hotLeads, setHotLeads] = useState<AiFriendSignal[]>([])
  const [dormants, setDormants] = useState<AiFriendSignal[]>([])
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [sumRes, hotRes, dormRes] = await Promise.all([
        aiApi.signals.summary(accountId),
        aiApi.signals.hot(accountId, 70, 20),
        aiApi.signals.byRank(accountId, 'dormant', 20),
      ])
      setSummary(sumRes)
      setHotLeads(hotRes.items)
      setDormants(dormRes.items)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="顧客シグナル" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="顧客シグナル" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-5">
            <p className="text-sm text-gray-500">AI が顧客の行動を分析してランク・スコアを自動算出</p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!accountId) return
                  if (!confirm('全友だちの intent score を AI が再計算します（約 ¥3〜10 のコスト）。よろしいですか？')) return
                  try {
                    const job = await aiApi.agentJobs.create(accountId, { job_type: 'calculate_intent_scores' })
                    await aiApi.agentJobs.run(accountId, job.job.id)
                    setToast({ kind: 'success', text: 'シグナル計算完了' })
                    await load()
                  } catch (e) {
                    setToast({ kind: 'error', text: e instanceof Error ? e.message : '計算失敗' })
                  }
                }}
                className="text-sm border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50"
              >シグナル再計算</button>
              <button onClick={() => void load()} disabled={loading} className="text-sm border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50">再読み込み</button>
            </div>
          </div>

          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">ランク別</h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-8">
            {RANKS.map((r) => {
              const count = summary?.rank_counts[r.key] ?? 0
              return (
                <div key={r.key} className="bg-white border border-gray-200 rounded-md px-3 py-3 hover:border-gray-300 transition-colors">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${r.accent}`} />
                    <span className="text-xs font-medium text-gray-700">{r.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-semibold text-gray-900 tabular-nums">{count}</span>
                    <span className="text-xs text-gray-400">人</span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">{r.desc}</div>
                </div>
              )
            })}
          </div>

          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">サマリー</h2>
          <div className="grid grid-cols-3 gap-2 mb-8">
            <div className="bg-white border border-gray-200 rounded-md px-4 py-3">
              <div className="text-[11px] text-gray-500 mb-1">平均購入意欲</div>
              <div className="text-2xl font-semibold text-gray-900 tabular-nums">{Math.round(summary?.avg_purchase_intent ?? 0)}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-md px-4 py-3">
              <div className="text-[11px] text-gray-500 mb-1">平均離脱リスク</div>
              <div className="text-2xl font-semibold text-gray-900 tabular-nums">{Math.round(summary?.avg_churn_risk ?? 0)}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-md px-4 py-3">
              <div className="text-[11px] text-gray-500 mb-1">平均 LTV 予測</div>
              <div className="text-2xl font-semibold text-gray-900 tabular-nums">¥{Math.round(summary?.avg_ltv_estimate_yen ?? 0).toLocaleString()}</div>
            </div>
          </div>

          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">ホットリード（intent ≥ 70）</h2>
          <div className="bg-white border border-gray-200 rounded-md mb-8">
            {hotLeads.length === 0 ? (
              <div className="text-center py-10 text-xs text-gray-400">該当顧客なし</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-2.5 px-4 font-medium">friend_id</th>
                    <th className="text-right py-2.5 px-4 font-medium">intent</th>
                    <th className="text-right py-2.5 px-4 font-medium">churn risk</th>
                    <th className="text-right py-2.5 px-4 font-medium">LTV 予測</th>
                    <th className="text-left py-2.5 px-4 font-medium">サマリー</th>
                  </tr>
                </thead>
                <tbody>
                  {hotLeads.map((s) => (
                    <tr key={s.friend_id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-mono text-xs text-gray-700">{s.friend_id.slice(0, 12)}…</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-medium text-gray-900">{s.purchase_intent}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-gray-700">{s.churn_risk}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-gray-700">¥{s.ltv_estimate_yen?.toLocaleString() ?? '—'}</td>
                      <td className="py-2.5 px-4 text-xs text-gray-500 truncate max-w-md">{s.signal_summary ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">休眠顧客（掘り起こし対象）</h2>
          <div className="bg-white border border-gray-200 rounded-md">
            {dormants.length === 0 ? (
              <div className="text-center py-10 text-xs text-gray-400">該当顧客なし</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-2.5 px-4 font-medium">friend_id</th>
                    <th className="text-right py-2.5 px-4 font-medium">最終チャット</th>
                    <th className="text-left py-2.5 px-4 font-medium">サマリー</th>
                  </tr>
                </thead>
                <tbody>
                  {dormants.map((s) => (
                    <tr key={s.friend_id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-mono text-xs text-gray-700">{s.friend_id.slice(0, 12)}…</td>
                      <td className="py-2.5 px-4 text-right text-xs text-gray-500">{s.last_chat_at ? new Date(s.last_chat_at).toLocaleDateString('ja-JP') : '—'}</td>
                      <td className="py-2.5 px-4 text-xs text-gray-500 truncate max-w-md">{s.signal_summary ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

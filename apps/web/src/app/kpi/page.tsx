'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type KpiGoal, type KpiMetric } from '@/lib/ai-api'

const METRIC_DEFS: Array<{
  key: KpiMetric
  label: string
  unit: string
  defaultTarget: number
  description: string
}> = [
  { key: 'broadcast_count', label: '月配信本数', unit: '本', defaultTarget: 8, description: '今月送る一斉配信の本数' },
  { key: 'friend_growth', label: '友だち純増', unit: '人', defaultTarget: 50, description: '友だち追加 − ブロック' },
  { key: 'cv_count', label: 'コンバージョン', unit: '件', defaultTarget: 20, description: '購入 / 予約 / 申込件数' },
  { key: 'reactivation_count', label: '休眠掘り起こし', unit: '件', defaultTarget: 10, description: '休眠顧客のリアクション件数' },
  { key: 'reservation_count', label: '予約件数', unit: '件', defaultTarget: 30, description: 'カレンダー経由の予約件数' },
  { key: 'review_count', label: 'レビュー獲得', unit: '件', defaultTarget: 5, description: 'Google レビュー等の獲得' },
  { key: 'open_rate', label: '平均開封率', unit: '%', defaultTarget: 40, description: '配信メッセージの開封率' },
  { key: 'click_rate', label: '平均CTR', unit: '%', defaultTarget: 8, description: '配信内リンクのクリック率' },
  { key: 'nps', label: 'NPS', unit: '点', defaultTarget: 8, description: '顧客推奨度（10 点満点）' },
]

export default function KpiPage() {
  const { selectedAccountId } = useAccount()
  const [yearMonth, setYearMonth] = useState(new Date().toISOString().slice(0, 7))
  const [goals, setGoals] = useState<Record<string, KpiGoal>>({})
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const result = await aiApi.kpi.list(accountId, yearMonth)
      const map: Record<string, KpiGoal> = {}
      const draftMap: Record<string, number> = {}
      for (const g of result.goals) {
        map[g.metric] = g
        draftMap[g.metric] = g.target_value
      }
      setGoals(map)
      setDrafts(draftMap)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId, yearMonth])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleSave = async (metric: KpiMetric) => {
    if (!accountId) return
    const value = drafts[metric]
    if (typeof value !== 'number' || value < 0) {
      setToast({ kind: 'error', text: '0 以上の数値を入力してください' })
      return
    }
    setSaving(metric)
    try {
      const result = await aiApi.kpi.upsert(accountId, {
        year_month: yearMonth,
        metric,
        target_value: value,
      })
      setGoals((prev) => ({ ...prev, [metric]: result.goal }))
      setToast({ kind: 'success', text: '保存しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSaving(null)
    }
  }

  const handleApplyDefault = (metric: KpiMetric) => {
    const def = METRIC_DEFS.find((m) => m.key === metric)
    if (!def) return
    setDrafts((prev) => ({ ...prev, [metric]: def.defaultTarget }))
  }

  const handleRunPlanner = async () => {
    if (!accountId) return
    setPlanning(true)
    try {
      const result = await aiApi.kpi.runPlanner(accountId, yearMonth)
      setToast({
        kind: 'success',
        text: `プランナー実行完了：${result.jobsCreated} 件のジョブが生成されました`,
      })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : 'プランナー実行失敗' })
    } finally {
      setPlanning(false)
    }
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="KPI 目標" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="KPI 目標" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-5xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">
            目標値を保存するとプランナーが必要な施策を自動でタスク分解、AI Executor が cron で順次実行します
          </p>

          <div className="bg-white border border-gray-200 rounded-md px-4 py-3 mb-5 flex items-center gap-3">
            <label className="text-xs font-medium text-gray-700">対象月</label>
            <input
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm"
            />
            <button
              onClick={handleRunPlanner}
              disabled={planning}
              className="ml-auto bg-gray-900 text-white px-4 py-1.5 rounded text-sm hover:bg-gray-700 disabled:bg-gray-300"
            >{planning ? '実行中…' : 'プランナー実行（ジョブ生成）'}</button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-sm text-gray-400">読み込み中…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {METRIC_DEFS.map((m) => {
                const goal = goals[m.key]
                const draft = drafts[m.key] ?? 0
                const progress = goal && goal.target_value > 0
                  ? Math.min((goal.current_value / goal.target_value) * 100, 100)
                  : 0
                const isModified = goal ? draft !== goal.target_value : draft > 0

                return (
                  <div key={m.key} className="bg-white border border-gray-200 rounded-md p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-medium text-gray-900 text-sm">{m.label}</h3>
                        <p className="text-[11px] text-gray-500 mt-0.5">{m.description}</p>
                      </div>
                      {goal && (
                        <span className="text-[11px] text-gray-500 tabular-nums">
                          {goal.current_value} / {goal.target_value} {m.unit}
                        </span>
                      )}
                    </div>

                    {goal && (
                      <div className="mb-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-900" style={{ width: `${progress}%` }} />
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={draft}
                        min={0}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [m.key]: Number(e.target.value) }))
                        }
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm tabular-nums"
                      />
                      <span className="text-xs text-gray-500">{m.unit}</span>
                      <button
                        onClick={() => handleApplyDefault(m.key)}
                        className="text-[11px] text-gray-700 hover:underline"
                        title={`おすすめ ${m.defaultTarget} ${m.unit}`}
                      >推奨</button>
                      <button
                        onClick={() => handleSave(m.key)}
                        disabled={saving === m.key || !isModified}
                        className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-700 disabled:bg-gray-300"
                      >{saving === m.key ? '…' : '保存'}</button>
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

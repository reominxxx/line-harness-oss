'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi } from '@/lib/ai-api'

type PlanTier = 'starter' | 'pro' | 'enterprise'
type AutomationLevel = 'careful' | 'standard' | 'aggressive'

const PLAN_OPTIONS: Array<{ value: PlanTier; label: string; defaultBroadcasts: number; price: string }> = [
  { value: 'starter', label: 'Starter（標準運用代行）', defaultBroadcasts: 4, price: '¥39,800' },
  { value: 'pro', label: 'Pro（品質保証 + 戦略運用）', defaultBroadcasts: 8, price: '¥98,000' },
  { value: 'enterprise', label: 'Enterprise（カスタム設計 + DB 連携）', defaultBroadcasts: 12, price: '¥198,000〜' },
]

const AUTOMATION_LEVEL_OPTIONS: Array<{ value: AutomationLevel; label: string; desc: string }> = [
  { value: 'careful', label: '慎重', desc: '全ジョブを人間レビュー必須' },
  { value: 'standard', label: '標準', desc: '配信文章のみレビュー、その他自動公開' },
  { value: 'aggressive', label: '積極', desc: 'AI 精度を信頼してほぼ全自動' },
]

export default function AutomationSettingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [planTier, setPlanTier] = useState<PlanTier>('starter')
  const [monthlyBroadcasts, setMonthlyBroadcasts] = useState(4)
  const [automationLevel, setAutomationLevel] = useState<AutomationLevel>('careful')
  const [notifyTarget, setNotifyTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await aiApi.automationPolicy.get(accountId)
      const policy = res.policy as Record<string, unknown> | null
      if (policy) {
        if (typeof policy.plan_tier === 'string') setPlanTier(policy.plan_tier as PlanTier)
        if (typeof policy.monthly_broadcast_count === 'number') setMonthlyBroadcasts(policy.monthly_broadcast_count)
        if (typeof policy.automation_level === 'string') setAutomationLevel(policy.automation_level as AutomationLevel)
        if (typeof policy.notification_target === 'string') setNotifyTarget(policy.notification_target)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const handlePlanChange = (newPlan: PlanTier) => {
    setPlanTier(newPlan)
    const defaultBroadcasts = PLAN_OPTIONS.find((p) => p.value === newPlan)?.defaultBroadcasts ?? 4
    setMonthlyBroadcasts(defaultBroadcasts)
  }

  const handleSave = async () => {
    if (!accountId) return
    setSaving(true)
    try {
      await aiApi.automationPolicy.upsert(accountId, {
        plan_tier: planTier,
        monthly_broadcast_count: monthlyBroadcasts,
        automation_level: automationLevel,
        notification_channel: 'line',
        notification_target: notifyTarget,
      })
      setToast({ kind: 'success', text: '設定を保存しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSaving(false)
    }
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="自動化設定" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="自動化設定" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-3xl mx-auto space-y-6">
          <p className="text-sm text-gray-500">
            {selectedAccount?.displayName ?? selectedAccount?.name} のプラン・配信本数・自動化レベルを設定します
          </p>

          {/* プラン選択 */}
          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">契約プラン</h2>
            <p className="text-xs text-gray-500 mb-4">
              プランを選ぶと、推奨の月配信本数が自動でセットされます（後から調整可）
            </p>
            <div className="space-y-2">
              {PLAN_OPTIONS.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center gap-3 px-4 py-3 border rounded-lg cursor-pointer transition-colors ${
                    planTier === p.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={p.value}
                    checked={planTier === p.value}
                    onChange={() => handlePlanChange(p.value)}
                    className="accent-gray-900"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">{p.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">推奨配信 月 {p.defaultBroadcasts} 本 / {p.price}</div>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* 月配信本数 */}
          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">月の配信本数</h2>
            <p className="text-xs text-gray-500 mb-4">
              プランで設定する月の配信本数の目安です。<br />
              ※ 現在 AI による配信案の自動生成は停止中。一斉配信は手動で作成してください
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={String(monthlyBroadcasts)}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, '')
                  if (raw === '') {
                    setMonthlyBroadcasts(0)
                    return
                  }
                  const n = parseInt(raw, 10)
                  setMonthlyBroadcasts(Math.min(60, n))
                }}
                onBlur={() => {
                  if (monthlyBroadcasts < 1) setMonthlyBroadcasts(1)
                }}
                className="w-20 px-3 py-2 border border-gray-300 rounded text-sm tabular-nums text-center"
              />
              <span className="text-sm text-gray-700">本 / 月</span>
              <span className="text-xs text-gray-400 ml-2">
                （目安: 週 {Math.round((monthlyBroadcasts / 4) * 10) / 10} 本のペース）
              </span>
            </div>
          </section>

          {/* 自動化レベル */}
          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">自動化レベル</h2>
            <p className="text-xs text-gray-500 mb-4">
              AI 生成物に対する人間レビューの厳しさ
            </p>
            <div className="space-y-2">
              {AUTOMATION_LEVEL_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 px-4 py-3 border rounded-lg cursor-pointer transition-colors ${
                    automationLevel === opt.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="automation_level"
                    value={opt.value}
                    checked={automationLevel === opt.value}
                    onChange={() => setAutomationLevel(opt.value)}
                    className="accent-gray-900 mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* 通知先 LINE */}
          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">通知先 LINE user_id</h2>
            <p className="text-xs text-gray-500 mb-3">
              承認待ちジョブ発生時にプッシュ通知を送る LINE アカウント（U で始まる 33 文字）
            </p>
            <input
              type="text"
              value={notifyTarget}
              onChange={(e) => setNotifyTarget(e.target.value)}
              placeholder="U1234567890abcdef..."
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
            />
          </section>

          {/* 保存ボタン */}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="text-sm bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              リセット
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="text-sm bg-gray-900 hover:bg-gray-700 text-white px-5 py-2 rounded disabled:bg-gray-300"
            >
              {saving ? '保存中…' : '設定を保存'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

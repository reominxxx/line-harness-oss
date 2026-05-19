'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi } from '@/lib/ai-api'

type AutomationLevel = 'careful' | 'standard' | 'aggressive'

const AUTOMATION_LEVEL_OPTIONS: Array<{ value: AutomationLevel; label: string; desc: string }> = [
  { value: 'careful', label: '慎重', desc: '全ジョブを人間レビュー必須' },
  { value: 'standard', label: '標準', desc: '配信文章のみレビュー、その他自動公開' },
  { value: 'aggressive', label: '積極', desc: 'AI 精度を信頼してほぼ全自動' },
]

export default function AutomationSettingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [monthlyBroadcasts, setMonthlyBroadcasts] = useState<number | null>(null)
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

  const handleSave = async () => {
    if (!accountId) return
    setSaving(true)
    try {
      await aiApi.automationPolicy.upsert(accountId, {
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
            {selectedAccount?.displayName ?? selectedAccount?.name} の自動化レベル・通知先を設定します
          </p>

          {/* 配信本数の案内 (ai-cost へ誘導) */}
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
            <div className="flex items-start gap-3">
              <span className="text-lg">💰</span>
              <div className="flex-1">
                <div className="font-medium text-blue-900">月額料金・月の配信本数の設定は移動しました</div>
                <p className="text-xs text-blue-800 mt-1">
                  営業時に決めた月額料金・配信本数・配信通数の上限は{' '}
                  <a href="/ai-cost" className="underline font-medium">課金・コスト</a> で設定できます。
                  {monthlyBroadcasts != null && (
                    <> 現在の設定: <span className="font-medium">月 {monthlyBroadcasts} 本</span></>
                  )}
                </p>
              </div>
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

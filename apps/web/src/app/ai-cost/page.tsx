'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type TenantMetering } from '@/lib/ai-api'

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

interface FormState {
  monthly_fee_yen: string
  monthly_broadcast_quota: string
  monthly_chat_quota: string
  monthly_vision_quota: string
  monthly_imagegen_quota: string
  monthly_kb_doc_quota: string
  monthly_budget_cap_yen: string
}

function meteringToForm(m: TenantMetering): FormState {
  return {
    monthly_fee_yen: m.monthly_fee_yen != null ? String(m.monthly_fee_yen) : '',
    monthly_broadcast_quota: String(m.monthly_broadcast_quota),
    monthly_chat_quota: String(m.monthly_chat_quota),
    monthly_vision_quota: String(m.monthly_vision_quota),
    monthly_imagegen_quota: String(m.monthly_imagegen_quota),
    monthly_kb_doc_quota: String(m.monthly_kb_doc_quota),
    monthly_budget_cap_yen: m.monthly_budget_cap_yen != null ? String(m.monthly_budget_cap_yen) : '',
  }
}

function parseIntOrZero(v: string): number {
  const n = parseInt(v.replace(/[^0-9-]/g, ''), 10)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function parseIntOrNull(v: string): number | null {
  const t = v.replace(/[^0-9-]/g, '')
  if (t === '') return null
  const n = parseInt(t, 10)
  return Number.isFinite(n) ? Math.max(0, n) : null
}

export default function AiCostPage() {
  const { selectedAccountId } = useAccount()
  const [metering, setMetering] = useState<TenantMetering | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [initing, setIniting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)
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
      setForm(meterRes.metering ? meteringToForm(meterRes.metering) : null)
      setUsage(usageRes.summary as unknown as UsageSummary)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId, month])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleInit = async () => {
    if (!accountId) return
    if (!confirm('このアカウントの料金・配信枠を初期化します。初期値（Lite 相当: 配信 5,000 / AI 500 等）を入れて編集できる状態にします。よろしいですか？')) return
    setIniting(true)
    try {
      const res = await aiApi.metering.init(accountId, 'lite')
      setMetering(res.metering)
      setForm(meteringToForm(res.metering))
      setToast({ kind: 'success', text: '初期化しました。下の各項目を編集して保存してください' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '初期化失敗' })
    } finally {
      setIniting(false)
    }
  }

  const handleSave = async () => {
    if (!accountId || !form) return
    setSaving(true)
    try {
      const res = await aiApi.metering.update(accountId, {
        monthly_fee_yen: parseIntOrNull(form.monthly_fee_yen),
        monthly_broadcast_quota: parseIntOrZero(form.monthly_broadcast_quota),
        monthly_chat_quota: parseIntOrZero(form.monthly_chat_quota),
        monthly_vision_quota: parseIntOrZero(form.monthly_vision_quota),
        monthly_imagegen_quota: parseIntOrZero(form.monthly_imagegen_quota),
        monthly_kb_doc_quota: parseIntOrZero(form.monthly_kb_doc_quota),
        monthly_budget_cap_yen: parseIntOrNull(form.monthly_budget_cap_yen),
      })
      setMetering(res.metering)
      setForm(meteringToForm(res.metering))
      setToast({ kind: 'success', text: '料金・配信枠を保存しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSaving(false)
    }
  }

  const isDirty = (() => {
    if (!metering || !form) return false
    const cur = meteringToForm(metering)
    return (Object.keys(cur) as Array<keyof FormState>).some((k) => cur[k] !== form[k])
  })()

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
          <div
            className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${
              toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'
            }`}
          >
            {toast.text}
          </div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          {!metering && !loading && (
            <div className="bg-white border border-gray-200 rounded-md p-6 text-center">
              <p className="text-sm text-gray-700 mb-3">
                このアカウントの料金・配信枠がまだ設定されていません。
              </p>
              <button
                onClick={handleInit}
                disabled={initing}
                className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
              >
                {initing ? '初期化中…' : '初期化する'}
              </button>
            </div>
          )}

          {metering && form && (
            <>
              {/* 料金・配信枠の編集フォーム */}
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  料金・配信枠（営業時に個別設定）
                </h2>
                {isDirty && (
                  <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                    未保存の変更あり
                  </span>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-md p-5 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <FormField
                    label="月額料金（運用代行費）"
                    suffix="円 / 月"
                    placeholder="例: 98000"
                    value={form.monthly_fee_yen}
                    onChange={(v) => setForm({ ...form, monthly_fee_yen: v })}
                    helper="営業時に決めた月額料金を入力（空欄でも可）"
                  />
                  <FormField
                    label="AI 利用予算上限"
                    suffix="円 / 月"
                    placeholder="例: 30000（空欄なら上限なし）"
                    value={form.monthly_budget_cap_yen}
                    onChange={(v) => setForm({ ...form, monthly_budget_cap_yen: v })}
                    helper="AI 呼び出しコストの月次上限。超過時は応答が止まる"
                  />
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <div className="text-[11px] text-gray-500 mb-3">月次の含有枠</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField
                      label="配信通数"
                      suffix="通 / 月"
                      placeholder="例: 5000"
                      value={form.monthly_broadcast_quota}
                      onChange={(v) => setForm({ ...form, monthly_broadcast_quota: v })}
                    />
                    <FormField
                      label="AI チャット応答"
                      suffix="回 / 月"
                      placeholder="例: 500"
                      value={form.monthly_chat_quota}
                      onChange={(v) => setForm({ ...form, monthly_chat_quota: v })}
                    />
                    <FormField
                      label="画像理解"
                      suffix="回 / 月"
                      placeholder="例: 50"
                      value={form.monthly_vision_quota}
                      onChange={(v) => setForm({ ...form, monthly_vision_quota: v })}
                    />
                    <FormField
                      label="画像生成"
                      suffix="枚 / 月"
                      placeholder="例: 20"
                      value={form.monthly_imagegen_quota}
                      onChange={(v) => setForm({ ...form, monthly_imagegen_quota: v })}
                    />
                    <FormField
                      label="ナレッジ件数"
                      suffix="件"
                      placeholder="例: 100"
                      value={form.monthly_kb_doc_quota}
                      onChange={(v) => setForm({ ...form, monthly_kb_doc_quota: v })}
                    />
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4 mt-4 flex items-center justify-end gap-2">
                  {isDirty && (
                    <button
                      onClick={() => setForm(meteringToForm(metering))}
                      disabled={saving}
                      className="text-sm px-3 py-1.5 text-gray-600 hover:text-gray-900 disabled:opacity-50"
                    >
                      変更を取り消す
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || !isDirty}
                    className="bg-gray-900 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50"
                  >
                    {saving ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>

              {/* 残量メーター */}
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
                    const barColor = isOver
                      ? 'bg-rose-500'
                      : percentage > 80
                        ? 'bg-amber-500'
                        : 'bg-gray-900'
                    return (
                      <div key={String(m.key)}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-gray-700">{m.label}</span>
                          <div className="text-xs tabular-nums">
                            <span className={isOver ? 'text-rose-700 font-medium' : 'text-gray-900 font-medium'}>
                              {used.toLocaleString()}
                            </span>
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
                  <div className="text-[11px] text-gray-500 mb-1">月額料金</div>
                  <div className="text-2xl font-semibold text-gray-900 tabular-nums">
                    {metering.monthly_fee_yen != null
                      ? `¥${metering.monthly_fee_yen.toLocaleString()}`
                      : '—'}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-md px-4 py-3">
                  <div className="text-[11px] text-gray-500 mb-1">今月の超過課金（AI コスト）</div>
                  <div
                    className={`text-2xl font-semibold tabular-nums ${
                      metering.overage_charge_yen > 0 ? 'text-orange-700' : 'text-gray-900'
                    }`}
                  >
                    ¥{metering.overage_charge_yen.toLocaleString()}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* AI 使用ログサマリ */}
          {usage && (
            <>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                機能別 AI 使用状況（今月）
              </h2>
              <div className="bg-white border border-gray-200 rounded-md p-5">
                <div className="grid grid-cols-3 gap-4 pb-4 border-b border-gray-100">
                  <div>
                    <div className="text-[11px] text-gray-500">総呼び出し</div>
                    <div className="text-2xl font-semibold tabular-nums text-gray-900">
                      {usage.total_calls.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500">うちキャッシュ</div>
                    <div className="text-2xl font-semibold tabular-nums text-emerald-700">
                      {usage.cached_calls.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500">合計コスト</div>
                    <div className="text-2xl font-semibold tabular-nums text-gray-900">
                      ¥{usage.total_cost_yen.toFixed(2)}
                    </div>
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
                        <td className="py-2 text-right tabular-nums text-gray-900">
                          {stats.calls.toLocaleString()}
                        </td>
                        <td className="py-2 text-right tabular-nums text-gray-900">
                          ¥{stats.cost_yen.toFixed(2)}
                        </td>
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

function FormField({
  label,
  suffix,
  placeholder,
  value,
  onChange,
  helper,
}: {
  label: string
  suffix: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  helper?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:border-gray-900"
        />
        <span className="text-xs text-gray-500 whitespace-nowrap">{suffix}</span>
      </div>
      {helper && <p className="text-[11px] text-gray-400 mt-1">{helper}</p>}
    </div>
  )
}

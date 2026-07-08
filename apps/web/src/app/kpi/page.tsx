'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type TenantMetering } from '@/lib/ai-api'

type AutomationLevel = 'careful' | 'standard' | 'aggressive'

const AUTOMATION_LEVEL_OPTIONS: Array<{ value: AutomationLevel; label: string; desc: string }> = [
  { value: 'careful', label: '慎重', desc: '全ジョブを人間レビュー必須' },
  { value: 'standard', label: '標準', desc: '配信文章のみレビュー、その他自動公開' },
  { value: 'aggressive', label: '積極', desc: 'AI 精度を信頼してほぼ全自動' },
]

const METER_AXES: Array<{
  key: keyof TenantMetering
  used_key: keyof TenantMetering
  label: string
}> = [
  { key: 'monthly_broadcast_quota', used_key: 'used_broadcast', label: '配信通数' },
  { key: 'monthly_chat_quota', used_key: 'used_chat', label: 'AI チャット応答' },
  { key: 'monthly_imagegen_quota', used_key: 'used_imagegen', label: '画像生成' },
]

interface FormState {
  monthly_fee_yen: string
  monthly_broadcast_count: string
  monthly_broadcast_quota: string
  monthly_chat_quota: string
  monthly_vision_quota: string
  monthly_imagegen_quota: string
  monthly_kb_doc_quota: string
  monthly_budget_cap_yen: string
  cycle_started_at: string
}

/** JST ISO ('YYYY-MM-DDTHH:mm:ss.sss+09:00') を datetime-local 用の 'YYYY-MM-DDTHH:mm' に変換 */
function jstIsoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = iso.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)
  return m ? m[1] : ''
}

function meteringToForm(m: TenantMetering, monthlyBroadcastCount: number | null): FormState {
  return {
    monthly_fee_yen: m.monthly_fee_yen != null ? String(m.monthly_fee_yen) : '',
    monthly_broadcast_count: monthlyBroadcastCount != null ? String(monthlyBroadcastCount) : '',
    monthly_broadcast_quota: String(m.monthly_broadcast_quota),
    monthly_chat_quota: String(m.monthly_chat_quota),
    monthly_vision_quota: String(m.monthly_vision_quota),
    monthly_imagegen_quota: String(m.monthly_imagegen_quota),
    monthly_kb_doc_quota: String(m.monthly_kb_doc_quota),
    monthly_budget_cap_yen: m.monthly_budget_cap_yen != null ? String(m.monthly_budget_cap_yen) : '',
    cycle_started_at: jstIsoToLocalInput(m.cycle_started_at),
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

export default function AutomationSettingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [metering, setMetering] = useState<TenantMetering | null>(null)
  const [monthlyBroadcastCount, setMonthlyBroadcastCount] = useState<number | null>(null)
  const [automationLevel, setAutomationLevel] = useState<AutomationLevel>('careful')
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(false)
  const [initing, setIniting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAutomation, setSavingAutomation] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const accountId = selectedAccountId
  const month = new Date().toISOString().slice(0, 7)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [meterRes, policyRes] = await Promise.all([
        aiApi.metering.current(accountId),
        aiApi.automationPolicy.get(accountId).catch(() => ({ policy: null })),
      ])
      const policy = policyRes.policy as Record<string, unknown> | null
      const broadcastCount =
        policy && typeof policy.monthly_broadcast_count === 'number'
          ? (policy.monthly_broadcast_count as number)
          : null
      if (policy && typeof policy.automation_level === 'string') {
        setAutomationLevel(policy.automation_level as AutomationLevel)
      }
      setMetering(meterRes.metering)
      setMonthlyBroadcastCount(broadcastCount)
      setForm(meterRes.metering ? meteringToForm(meterRes.metering, broadcastCount) : null)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

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
      setForm(meteringToForm(res.metering, monthlyBroadcastCount))
      setToast({ kind: 'success', text: '初期化しました。下の各項目を編集して保存してください' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '初期化失敗' })
    } finally {
      setIniting(false)
    }
  }

  const handleSavePricing = async () => {
    if (!accountId || !form) return
    setSaving(true)
    try {
      const broadcastCount = parseIntOrNull(form.monthly_broadcast_count)
      const [meterRes] = await Promise.all([
        aiApi.metering.update(accountId, {
          monthly_fee_yen: parseIntOrNull(form.monthly_fee_yen),
          monthly_broadcast_quota: parseIntOrZero(form.monthly_broadcast_quota),
          monthly_chat_quota: parseIntOrZero(form.monthly_chat_quota),
          monthly_vision_quota: parseIntOrZero(form.monthly_vision_quota),
          monthly_imagegen_quota: parseIntOrZero(form.monthly_imagegen_quota),
          monthly_kb_doc_quota: parseIntOrZero(form.monthly_kb_doc_quota),
          monthly_budget_cap_yen: parseIntOrNull(form.monthly_budget_cap_yen),
          cycle_started_at: form.cycle_started_at.trim() === '' ? null : form.cycle_started_at,
        }),
        broadcastCount != null
          ? aiApi.automationPolicy.upsert(accountId, { monthly_broadcast_count: broadcastCount })
          : Promise.resolve(null),
      ])
      setMetering(meterRes.metering)
      setMonthlyBroadcastCount(broadcastCount)
      setForm(meteringToForm(meterRes.metering, broadcastCount))
      setToast({ kind: 'success', text: '料金・配信枠を保存しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAutomation = async () => {
    if (!accountId) return
    setSavingAutomation(true)
    try {
      await aiApi.automationPolicy.upsert(accountId, {
        automation_level: automationLevel,
      })
      setToast({ kind: 'success', text: '自動化レベルを保存しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSavingAutomation(false)
    }
  }

  const isDirty = (() => {
    if (!metering || !form) return false
    const cur = meteringToForm(metering, monthlyBroadcastCount)
    return (Object.keys(cur) as Array<keyof FormState>).some((k) => cur[k] !== form[k])
  })()

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
          <div
            className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${
              toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'
            }`}
          >
            {toast.text}
          </div>
        )}

        <div className="p-6 max-w-6xl mx-auto space-y-6">
          <p className="text-sm text-gray-500">
            {selectedAccount?.displayName ?? selectedAccount?.name} の料金・配信枠・自動化レベルを設定します
          </p>

          {/* 1. 料金・配信枠（営業時に個別設定） */}
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
            <section>
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

              <div className="bg-white border border-gray-200 rounded-md p-5">
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
                  <FormField
                    label="計量サイクル開始日時"
                    type="datetime-local"
                    suffix=""
                    value={form.cycle_started_at}
                    onChange={(v) => setForm({ ...form, cycle_started_at: v })}
                    helper="設定するとこの日時から1ヶ月ごとに使用量・予算をリセット。空欄なら毎月1日リセット"
                  />
                </div>

                <div className="border-t border-gray-100 pt-4 mb-4">
                  <div className="text-[11px] text-gray-500 mb-3">月の配信本数（AI 配信案の自動生成・配信進捗の分母）</div>
                  <FormField
                    label="月の配信本数"
                    suffix="本 / 月"
                    placeholder="例: 8"
                    value={form.monthly_broadcast_count}
                    onChange={(v) => setForm({ ...form, monthly_broadcast_count: v })}
                    helper="営業時に決めた月の配信本数。/agent や進捗バーの分母になります"
                  />
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <div className="text-[11px] text-gray-500 mb-3">月次の含有枠</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField
                      label="配信通数（送信メッセージ）"
                      suffix="通 / 月"
                      placeholder="例: 5000"
                      value={form.monthly_broadcast_quota}
                      onChange={(v) => setForm({ ...form, monthly_broadcast_quota: v })}
                      helper="LINE に送信できるメッセージ通数の上限"
                    />
                    <FormField
                      label="AI チャット応答"
                      suffix="回 / 月"
                      placeholder="例: 500"
                      value={form.monthly_chat_quota}
                      onChange={(v) => setForm({ ...form, monthly_chat_quota: v })}
                    />
                    <FormField
                      label="画像生成"
                      suffix="枚 / 月"
                      placeholder="例: 20"
                      value={form.monthly_imagegen_quota}
                      onChange={(v) => setForm({ ...form, monthly_imagegen_quota: v })}
                    />
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4 mt-4 flex items-center justify-end gap-2">
                  {isDirty && (
                    <button
                      onClick={() => setForm(meteringToForm(metering, monthlyBroadcastCount))}
                      disabled={saving}
                      className="text-sm px-3 py-1.5 text-gray-600 hover:text-gray-900 disabled:opacity-50"
                    >
                      変更を取り消す
                    </button>
                  )}
                  <button
                    onClick={handleSavePricing}
                    disabled={saving || !isDirty}
                    className="bg-gray-900 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50"
                  >
                    {saving ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* 2. 今月の使用状況 */}
          {metering && (
            <section>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                今月（{metering.current_month || month}）の使用状況
              </h2>
              <div className="bg-white border border-gray-200 rounded-md p-5">
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

            </section>
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
  type = 'text',
}: {
  label: string
  suffix: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  helper?: string
  type?: 'text' | 'datetime-local'
}) {
  const isDateTime = type === 'datetime-local'
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type={type}
          inputMode={isDateTime ? undefined : 'numeric'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 border border-gray-200 rounded px-2.5 py-1.5 text-sm tabular-nums focus:outline-none focus:border-gray-900"
        />
        {suffix && <span className="text-xs text-gray-500 whitespace-nowrap">{suffix}</span>}
      </div>
      {helper && <p className="text-[11px] text-gray-400 mt-1">{helper}</p>}
    </div>
  )
}

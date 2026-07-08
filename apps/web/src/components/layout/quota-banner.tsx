'use client'

import { useEffect, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'

// 残枠がこの割合以下 (=使用率80%以上) になったら警告を出す。
const WARN_RATIO = 0.8
const DANGER_RATIO = 0.95

interface QuotaState {
  remaining: number | null
  limit: number | null
  used: number | null
  usedRatio: number | null
}

/**
 * LINE 課金メッセージの残枠が少なくなったら管理画面に警告バナーを出す。
 * 上限が無制限プラン / 取得失敗 (usedRatio=null) のときは何も出さない。
 */
export default function QuotaBanner() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [quota, setQuota] = useState<QuotaState | null>(null)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedAccountId) {
      setQuota(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await api.lineAccounts.quota(selectedAccountId)
        if (!cancelled && res.success && res.data) setQuota(res.data)
      } catch {
        /* 取得失敗時は通知を出さない (fail-silent) */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  if (!quota || quota.usedRatio == null || quota.usedRatio < WARN_RATIO) return null
  // アカウント単位で閉じられる (別アカウントに切り替えたら再表示)
  if (dismissedFor === selectedAccountId) return null

  const danger = quota.usedRatio >= DANGER_RATIO
  const pct = Math.round(quota.usedRatio * 100)
  const accountName = selectedAccount?.displayName ?? selectedAccount?.name ?? 'このアカウント'

  return (
    <div
      className={`border-b px-4 py-2.5 flex items-center justify-between gap-3 text-sm ${
        danger ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span aria-hidden="true">{danger ? '🚨' : '⚠️'}</span>
        <span className={danger ? 'text-red-900' : 'text-amber-900'}>
          <strong>{accountName}</strong> の配信枠が
          {danger ? '残りわずかです' : '上限に近づいています'}（使用率 <strong>{pct}%</strong>
          {quota.remaining != null && (
            <>
              ・残り <strong>{quota.remaining.toLocaleString()}</strong> 通
            </>
          )}
          ）。{danger ? '超過分は配信されません。' : 'プランの追加をご検討ください。'}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDismissedFor(selectedAccountId)}
        aria-label="この配信上限の通知を閉じる"
        className={`shrink-0 px-2 -mr-2 ${danger ? 'text-red-600 hover:text-red-800' : 'text-amber-600 hover:text-amber-800'}`}
      >
        ✕
      </button>
    </div>
  )
}

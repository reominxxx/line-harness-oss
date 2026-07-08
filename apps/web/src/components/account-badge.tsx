'use client'

import { useAccount } from '@/contexts/account-context'

/**
 * このアイテムがどの LINE アカウントに紐づいているかを示すバッジ。
 * accountId を渡せばその ID で解決し、省略時は現在選択中のアカウントを使う
 * (クーポン / カード型メッセージの編集画面はアカウントスコープで読み込むため、
 *  選択中アカウント = そのアイテムの所属アカウントになる)。
 */
export function AccountBadge({ accountId }: { accountId?: string | null }) {
  const { accounts, selectedAccount } = useAccount()
  const account = accountId ? accounts.find((a) => a.id === accountId) ?? null : selectedAccount
  if (!account) return null
  return (
    <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-700">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <span>
        このアイテムは <strong className="font-semibold">{account.name}</strong> アカウントに紐づいています
      </span>
    </div>
  )
}

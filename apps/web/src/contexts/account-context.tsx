'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { api } from '@/lib/api'

const STORAGE_KEY = 'lh_selected_account'

export interface AccountWithStats {
  id: string
  channelId: string
  name: string
  displayName?: string
  pictureUrl?: string
  basicId?: string
  isActive: boolean
  country: string | null
  role: string | null
  displayOrder: number
  liffId?: string | null
  stats?: {
    friendCount: number
    activeScenarios: number
    messagesThisMonth: number
  }
}

interface AccountContextValue {
  accounts: AccountWithStats[]
  selectedAccountId: string | null
  selectedAccount: AccountWithStats | null
  setSelectedAccountId: (id: string) => void
  refreshAccounts: () => Promise<void>
  loading: boolean
  /** listLite が失敗した場合のメッセージ。null なら成功 or 未試行 */
  error: string | null
  locked: boolean
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function AccountProvider({
  children,
  lockToFirst = false,
}: {
  children: ReactNode
  lockToFirst?: boolean
}) {
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [selectedAccountId, setSelectedAccountIdState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setSelectedAccountId = useCallback(
    (id: string) => {
      if (lockToFirst) return
      setSelectedAccountIdState(id)
      try {
        localStorage.setItem(STORAGE_KEY, id)
      } catch {
        // localStorage unavailable
      }
    },
    [lockToFirst],
  )

  const refreshAccounts = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await api.lineAccounts.listLite()
      if (res.success && res.data.length > 0) {
        const fullList = res.data as AccountWithStats[]
        const list = lockToFirst ? fullList.slice(0, 1) : fullList
        setAccounts(list)

        if (lockToFirst) {
          setSelectedAccountIdState(list[0].id)
          return
        }

        // If current selection is invalid (e.g. deleted), fall back to first
        setSelectedAccountIdState((prev) => {
          if (prev && list.some((a) => a.id === prev)) return prev
          // Restore from localStorage or default to first
          let stored: string | null = null
          try {
            stored = localStorage.getItem(STORAGE_KEY)
          } catch {
            // localStorage unavailable
          }
          const valid = stored && list.some((a) => a.id === stored)
          return valid ? stored : list[0].id
        })
      } else {
        setAccounts([])
        setSelectedAccountIdState(null)
        if (!res.success) setError('アカウント一覧の取得に失敗しました')
      }
    } catch (e) {
      // タイムアウトやネットワーク失敗を画面に出す (固まり防止)
      setError(e instanceof Error ? e.message : 'アカウント取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [lockToFirst])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts])

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  return (
    <AccountContext.Provider
      value={{ accounts, selectedAccountId, selectedAccount, setSelectedAccountId, refreshAccounts, loading, error, locked: lockToFirst }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used within AccountProvider')
  return ctx
}

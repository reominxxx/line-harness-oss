'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

interface EventItem {
  friendId: string
  displayName: string | null
  pictureUrl: string | null
  label: string | null
  sub: string | null
  messageType: string | null
  occurredAt: string | null
}

const TABS = [
  { type: 'tap', label: 'リッチメニュー/ボタン', labelHeader: 'タップ内容' },
  { type: 'link', label: 'リンククリック', labelHeader: 'リンク名' },
  { type: 'chat', label: 'チャット返信', labelHeader: 'メッセージ' },
  { type: 'form', label: 'フォーム/アンケート', labelHeader: 'フォーム名' },
  { type: 'coupon_use', label: 'クーポン利用', labelHeader: 'クーポン名' },
  { type: 'coupon_lottery', label: 'クーポン抽選', labelHeader: 'クーポン名' },
  { type: 'cv', label: 'コンバージョン', labelHeader: 'CV名' },
] as const

const PAGE_SIZE = 50

// sub 列 (source / result / event_type) を人間可読に。
function subLabel(type: string, sub: string | null): string | null {
  if (!sub) return null
  if (type === 'coupon_lottery') return sub === 'won' ? '当選' : sub === 'lost' ? '落選' : sub
  if (type === 'tap') {
    if (sub === 'postback') return 'リッチメニュー/ボタン'
    if (sub === 'open_link_postback') return 'リンクボタン'
    if (sub === 'coupon_postback') return 'クーポンボタン'
  }
  return sub
}

export default function EngagementPage() {
  const { selectedAccountId } = useAccount()
  const [type, setType] = useState<string>('tap')
  const [items, setItems] = useState<EventItem[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTab = TABS.find((t) => t.type === type) ?? TABS[0]

  const load = useCallback(
    async (t: string, p: number, append: boolean) => {
      if (!selectedAccountId) return
      setLoading(true)
      setError(null)
      try {
        const res = await api.engagement.events({
          accountId: selectedAccountId,
          type: t,
          page: p,
          pageSize: PAGE_SIZE,
        })
        if (!res.success) {
          setError(res.error ?? '取得に失敗しました')
          return
        }
        setItems((prev) => (append ? [...prev, ...res.items] : res.items))
        setHasMore(res.hasMore)
      } catch (e) {
        setError(e instanceof Error ? e.message : '取得に失敗しました')
      } finally {
        setLoading(false)
      }
    },
    [selectedAccountId],
  )

  useEffect(() => {
    setPage(1)
    void load(type, 1, false)
  }, [type, load])

  const changeTab = (t: string) => {
    if (t === type) return
    setItems([])
    setHasMore(false)
    setType(t)
  }

  const loadMore = () => {
    const next = page + 1
    setPage(next)
    void load(type, next, true)
  }

  return (
    <div>
      <Header
        title="エンゲージメント計測"
        description="リッチメニュー・クーポン・リンクなど自動計測している友だちの反応を、種類ごとに「誰が・いつ」で確認"
      />

      {/* タブ */}
      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.type}
            onClick={() => changeTab(tab.type)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              type === tab.type
                ? 'border-[#06C755] text-[#06C755] font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 本体 */}
      {!selectedAccountId ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
          アカウントを選択してください
        </div>
      ) : error ? (
        <div className="bg-red-50 rounded-lg border border-red-200 p-6 text-center text-red-600 text-sm">
          {error}
        </div>
      ) : loading && items.length === 0 ? (
        <div className="text-sm text-gray-400 px-1">読み込み中...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
          まだ反応がありません
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="px-4 py-2.5 font-medium">友だち</th>
                <th className="px-4 py-2.5 font-medium">{activeTab.labelHeader}</th>
                <th className="px-4 py-2.5 font-medium">種別</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">日時</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const sub = subLabel(type, it.sub)
                return (
                  <tr key={`${it.friendId}-${it.occurredAt}-${i}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {it.pictureUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover bg-gray-100" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-[11px] text-gray-500">
                            {(it.displayName ?? '?').slice(0, 1)}
                          </div>
                        )}
                        <span className="text-gray-900">{it.displayName || '名前未取得'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700 max-w-xs">
                      <span className="line-clamp-2 break-words">{it.label || '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {sub ? (
                        <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] whitespace-nowrap">
                          {sub}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">{it.occurredAt || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {hasMore && (
            <div className="p-3 text-center border-t border-gray-100">
              <button
                onClick={loadMore}
                disabled={loading}
                className="text-sm px-4 py-1.5 text-gray-600 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
              >
                {loading ? '読み込み中...' : 'もっと読み込む'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

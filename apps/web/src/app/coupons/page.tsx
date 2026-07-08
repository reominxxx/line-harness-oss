'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type Tab = 'active' | 'ended' | 'draft'

function classifyCoupon(c: { status: string; valid_to: string }): Tab {
  if (c.status === 'draft') return 'draft'
  if (c.status === 'archived') return 'ended'
  if (c.status === 'published') {
    const ended = new Date(c.valid_to).getTime() < Date.now()
    return ended ? 'ended' : 'active'
  }
  return 'ended'
}

interface CouponRow {
  id: string
  name: string
  valid_from: string
  valid_to: string
  status: 'draft' | 'published' | 'archived'
  discount_mode: 'yen' | 'percent' | 'strikethrough' | 'none' | null
  discount_yen: number | null
  discount_percent: number | null
  strikethrough_before: number | null
  strikethrough_after: number | null
  max_uses_per_friend: number
  image_url: string | null
  updated_at: string
}

const STATUS_BADGE: Record<CouponRow['status'], { label: string; cls: string }> = {
  draft: { label: '下書き', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  published: { label: '公開中', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  archived: { label: 'アーカイブ', cls: 'bg-gray-100 text-gray-400 border-gray-200' },
}

function offerText(c: CouponRow): string {
  if (c.discount_mode === 'yen' && c.discount_yen != null) return `¥${c.discount_yen.toLocaleString('ja-JP')} OFF`
  if (c.discount_mode === 'percent' && c.discount_percent != null) return `${c.discount_percent}% OFF`
  if (c.discount_mode === 'strikethrough' && c.strikethrough_before != null && c.strikethrough_after != null) {
    return `¥${c.strikethrough_before.toLocaleString('ja-JP')} → ¥${c.strikethrough_after.toLocaleString('ja-JP')}`
  }
  return 'クーポン'
}

function periodLabel(c: CouponRow): string {
  const from = new Date(c.valid_from).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  const to = new Date(c.valid_to).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  return `${from} 〜 ${to}`
}

export default function CouponsListPage() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<CouponRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('active')

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; items: CouponRow[] }>(`/api/coupons`, {
        headers: { 'X-Line-Account-Id': selectedAccountId },
      })
      if (res.success) setItems(res.items)
    } catch { /* silent */ }
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(
    () => ({
      active: items.filter((c) => classifyCoupon(c) === 'active').length,
      ended: items.filter((c) => classifyCoupon(c) === 'ended').length,
      draft: items.filter((c) => classifyCoupon(c) === 'draft').length,
    }),
    [items],
  )

  const filtered = useMemo(
    () => items.filter((c) => classifyCoupon(c) === tab),
    [items, tab],
  )

  const handleDelete = async (id: string) => {
    if (!confirm('このクーポンを削除しますか?\n配信済みのメッセージのリンクは無効になります。')) return
    try {
      await fetchApi(`/api/coupons/${id}`, { method: 'DELETE' })
      await load()
    } catch { /* silent */ }
  }

  if (!selectedAccountId) {
    return <div><Header title="クーポン" /><p className="text-sm text-gray-500 text-center py-12">アカウントを選択してください</p></div>
  }

  return (
    <div>
      <Header
        title="クーポン"
        description="期間限定の割引クーポンを作成し、配信メッセージや LIFF から顧客に渡せます。"
        action={
          <button
            onClick={() => router.push('/coupons/edit')}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg min-h-[44px]"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規作成
          </button>
        }
      />

      {/* タブ */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-4">
        {(
          [
            { key: 'active', label: '有効期間前・有効', count: counts.active },
            { key: 'ended', label: '期限切れ・終了', count: counts.ended },
            { key: 'draft', label: '下書き', count: counts.draft },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] text-gray-400">{t.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-sm text-gray-400">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-sm text-gray-500 mb-3">
            {tab === 'active'
              ? '有効なクーポンがまだありません'
              : tab === 'ended'
                ? '期限切れ・終了したクーポンはありません'
                : '下書きのクーポンはありません'}
          </p>
          {tab === 'active' && (
            <>
              <p className="text-xs text-gray-400 mb-5">「初回 ¥500 OFF」「友だち追加でドリンク1杯無料」などの集客クーポンを作れます</p>
              <button
                onClick={() => router.push('/coupons/edit')}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg"
                style={{ backgroundColor: '#06C755' }}
              >
                + 最初のクーポンを作成
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const badge = STATUS_BADGE[c.status]
            return (
              <div key={c.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-sm transition-shadow flex flex-col">
                {c.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image_url} alt="" className="w-full aspect-[2/1] object-cover bg-slate-100" />
                ) : (
                  <div className="w-full aspect-[2/1] bg-emerald-50 flex items-center justify-center text-emerald-300 text-3xl">🎟️</div>
                )}
                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>{badge.label}</span>
                    <span className="text-[10px] text-gray-400">{c.max_uses_per_friend === 1 ? '1回のみ' : '無制限'}</span>
                  </div>
                  <h3 className="font-semibold text-sm text-gray-900 mb-1 truncate">{c.name}</h3>
                  <p className="text-base font-bold text-emerald-700 mb-1">{offerText(c)}</p>
                  <p className="text-[11px] text-gray-500 mb-3">{periodLabel(c)}</p>
                  <div className="flex gap-1 mt-auto">
                    <button
                      onClick={() => router.push(`/coupons/edit?id=${c.id}`)}
                      className="flex-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded px-2 py-1.5"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

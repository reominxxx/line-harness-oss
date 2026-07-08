'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type HearingListItem = {
  id: string
  title: string
  status: 'draft' | 'pending' | 'generating' | 'ready' | 'error'
  ai_cost_yen_x100: number
  created_at: string
  updated_at: string
}

const STATUS_BADGE: Record<HearingListItem['status'], { label: string; cls: string }> = {
  draft: { label: '下書き', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  pending: { label: '待機', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
  generating: { label: '設計中', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  ready: { label: '完成', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  error: { label: 'エラー', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
}

/**
 * 自動化ダッシュボード (/agent) の核として上部に表示する設計書パネル。
 * - 最近の設計書 (hearings) 一覧
 * - 新規作成への CTA
 * - 設計中は自動 refetch
 *
 * 設計書ページ (/hearings) と同じ API / データを共有。
 */
export default function HearingsInlinePanel() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<HearingListItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; hearings: HearingListItem[] }>(
        '/api/hearings',
        { headers: { 'X-Line-Account-Id': selectedAccountId } },
      )
      if (res.success) setItems(res.hearings)
    } catch {/* silent */}
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  // 設計中のものを 4 秒ごとに refetch
  useEffect(() => {
    const inFlight = items.some((i) => i.status === 'generating' || i.status === 'pending')
    if (!inFlight) return
    const t = setInterval(() => { void load() }, 4_000)
    return () => clearInterval(t)
  }, [items, load])

  if (!selectedAccountId) return null

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          📐 配信設計書 ({items.length})
        </h2>
        <p className="text-[11px] text-gray-400">
          MTG 録音 + 月の配信本数を入れると AI が 1 本ごとの配信プランを生成 (プレビュー付き)
        </p>
      </div>
      {loading && items.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-md p-6 text-center text-sm text-gray-400">
          読み込み中...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-300 rounded-md p-6 text-center">
          <p className="text-sm text-gray-500 mb-2">まだ設計書はありません</p>
          <Link
            href="/hearings/new"
            className="inline-block text-xs font-medium bg-slate-900 text-white px-4 py-2 rounded hover:bg-slate-700"
          >
            最初の設計書を作る
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
          {items.slice(0, 5).map((h) => {
            const badge = STATUS_BADGE[h.status]
            return (
              <div key={h.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
                <Link
                  href={`/hearings/detail?id=${h.id}`}
                  className="flex-1 min-w-0 text-sm text-slate-900 font-medium hover:underline truncate"
                >
                  {h.title}
                </Link>
                <span className={`text-[11px] px-2 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                <span className="text-[11px] text-gray-400 tabular-nums w-20 text-right">¥{(h.ai_cost_yen_x100 / 100).toFixed(2)}</span>
                <span className="text-[11px] text-gray-400 w-32 text-right">{new Date(h.updated_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <Link
                  href={`/hearings/detail?id=${h.id}`}
                  className="text-[11px] text-gray-500 hover:text-gray-900 shrink-0"
                >開く →</Link>
              </div>
            )
          })}
          {items.length > 5 && (
            <Link
              href="/hearings"
              className="block text-center text-[11px] text-gray-500 hover:text-gray-900 py-2 hover:bg-gray-50"
            >
              すべての設計書を見る ({items.length} 件)
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

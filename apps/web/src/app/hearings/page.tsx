'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
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
  pending: { label: '待機中', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
  generating: { label: '設計中', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  ready: { label: '完成', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  error: { label: 'エラー', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
}

export default function HearingsListPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<HearingListItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; hearings: HearingListItem[] }>(
        `/api/hearings`,
        { headers: { 'X-Line-Account-Id': selectedAccountId } },
      )
      if (res.success) setItems(res.hearings)
    } catch {/* silent */}
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  // 設計中のものを 4 秒ごとに refetch (バックグラウンド完了監視)
  useEffect(() => {
    const generating = items.some((i) => i.status === 'generating')
    if (!generating) return
    const t = setInterval(() => { void load() }, 4_000)
    return () => clearInterval(t)
  }, [items, load])

  return (
    <div className="min-h-screen bg-slate-50">
      <Header title="設計書" description="ヒアリング音声から L-port の運用設計書を生成" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">設計書</h1>
            <p className="text-xs text-slate-500 mt-1">
              MTG の文字起こしから AI が L-port の運用設計書を作成します。月の配信本数を指定すると、1 本ごとの設計まで出力されます。
            </p>
          </div>
          <Link
            href="/hearings/new"
            className="px-3 py-2 text-sm font-medium rounded-md text-white bg-slate-900 hover:bg-slate-700"
          >
            ＋ 新規ヒアリング
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : items.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center">
            <p className="text-sm text-slate-500 mb-3">まだ設計書はありません</p>
            <Link
              href="/hearings/new"
              className="inline-block px-4 py-2 text-sm font-medium rounded-md text-white bg-slate-900 hover:bg-slate-700"
            >
              最初の設計書を作る
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">タイトル</th>
                  <th className="text-left px-4 py-2">状態</th>
                  <th className="text-left px-4 py-2">AI コスト</th>
                  <th className="text-left px-4 py-2">更新</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((h) => {
                  const badge = STATUS_BADGE[h.status]
                  return (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/hearings/detail?id=${h.id}`}
                          className="text-slate-900 font-medium hover:underline"
                        >
                          {h.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block text-[11px] px-2 py-0.5 rounded border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 tabular-nums">
                        ¥{(h.ai_cost_yen_x100 / 100).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {new Date(h.updated_at).toLocaleString('ja-JP')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/hearings/detail?id=${h.id}`}
                          className="text-xs text-slate-500 hover:text-slate-900"
                        >
                          開く →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

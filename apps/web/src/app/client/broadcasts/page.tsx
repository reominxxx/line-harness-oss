'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '@/contexts/account-context'
import { api, type ApiBroadcast } from '@/lib/api'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  sent: { label: '配信済み', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  scheduled: { label: '予約済み', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  draft: { label: '下書き', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  failed: { label: '失敗', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled: { label: 'キャンセル', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
}

export default function ClientBroadcastsPage() {
  const { selectedAccountId } = useAccount()
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'sent' | 'scheduled'>('all')

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await api.broadcasts.list({ accountId })
      if (res.success && res.data) {
        setBroadcasts(res.data)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  const filtered = broadcasts.filter((b) => {
    if (filter === 'all') return true
    return b.status === filter
  })

  const counts = {
    all: broadcasts.length,
    sent: broadcasts.filter((b) => b.status === 'sent').length,
    scheduled: broadcasts.filter((b) => b.status === 'scheduled').length,
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">配信履歴</h1>
        <p className="text-sm text-slate-500 mt-1">
          これまでに送った配信と、今後送る予定の配信を確認できます
        </p>
      </section>

      <div className="flex items-center gap-2">
        {([
          { key: 'all', label: 'すべて' },
          { key: 'sent', label: '配信済み' },
          { key: 'scheduled', label: '予約済み' },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-sm px-3.5 py-1.5 rounded-full transition-colors ${
              filter === f.key
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center">
          <div className="text-5xl mb-3">📨</div>
          <p className="text-base font-medium text-slate-700 mb-1">配信履歴はまだありません</p>
          <p className="text-sm text-slate-500">配信が始まると、こちらに表示されます</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {filtered.map((b) => {
            const badge = STATUS_BADGE[b.status] ?? STATUS_BADGE.draft
            const isExpanded = expanded === b.id
            const date = b.sentAt ?? b.scheduledAt ?? b.createdAt
            return (
              <div key={b.id}>
                <div className="px-5 py-4 hover:bg-slate-50/50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                        <span className="font-semibold text-sm text-slate-900 truncate">
                          {b.title || '(無題)'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {date ? new Date(date).toLocaleString('ja-JP', {
                          month: 'numeric', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        }) : '—'}
                      </p>
                    </div>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : b.id)}
                      className="text-xs text-slate-600 hover:text-slate-900 shrink-0"
                    >
                      {isExpanded ? '閉じる' : '内容を見る'}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-5 pb-5 pt-1 bg-slate-50/50">
                    <div className="bg-white border border-slate-200 rounded-lg p-4 max-h-72 overflow-auto">
                      <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                        {b.messageContent ?? '—'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

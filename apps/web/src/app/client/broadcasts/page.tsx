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
        <SampleBroadcasts />
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

function SampleBroadcasts() {
  const [openId, setOpenId] = useState<string | null>(null)
  const samples = [
    {
      id: 'sample-1',
      status: 'sent' as const,
      title: '春の新メニューのお知らせ',
      date: '2026-04-15 19:00',
      content: `こんにちは、〇〇店です🌸

春限定の新メニューが登場しました！

🍵 桜抹茶ラテ — 期間限定
🌷 春野菜のキッシュプレート

詳細はこちら → https://example.com/spring
今月末まで！ぜひお試しください。`,
    },
    {
      id: 'sample-2',
      status: 'sent' as const,
      title: 'GW 営業日程のご案内',
      date: '2026-04-25 12:00',
      content: `いつもありがとうございます。
GW の営業日程をお知らせします。

🗓 4/29 (祝)〜5/5 (祝): 通常営業
🗓 5/6 (火): 定休日

混み合う時間帯はご予約がおすすめです🙇‍♀️`,
    },
    {
      id: 'sample-3',
      status: 'scheduled' as const,
      title: '〇〇キャンペーン最終日リマインド',
      date: '2026-05-19 11:00',
      content: `【最終日】〇〇キャンペーンは本日 23 時で終了します！

クーポンコード: SPRING2026
👉 ご利用はこちらから https://example.com/coupon

お見逃しなく✨`,
    },
  ]

  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-start gap-2">
        <span className="text-amber-600 text-sm">💡</span>
        <p className="text-xs text-amber-900 leading-relaxed">
          まだ配信履歴がありません。下記は <strong>サンプル</strong> です。実際に配信が走ると、内容・日時・状態がここに記録されます。
        </p>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
        {samples.map((s) => {
          const isOpen = openId === s.id
          const badge =
            s.status === 'sent'
              ? { label: '配信済み', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
              : { label: '予約済み', cls: 'bg-blue-50 text-blue-700 border-blue-200' }
          return (
            <div key={s.id}>
              <div className="px-5 py-4 hover:bg-slate-50/50">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">サンプル</span>
                      <span className="font-semibold text-sm text-slate-900 truncate">{s.title}</span>
                    </div>
                    <p className="text-xs text-slate-500">{s.date}</p>
                  </div>
                  <button
                    onClick={() => setOpenId(isOpen ? null : s.id)}
                    className="text-xs text-slate-600 hover:text-slate-900 shrink-0"
                  >
                    {isOpen ? '閉じる' : '内容を見る'}
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="px-5 pb-5 pt-1 bg-slate-50/50">
                  <div className="bg-white border border-slate-200 rounded-lg p-4 max-h-72 overflow-auto">
                    <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">{s.content}</pre>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

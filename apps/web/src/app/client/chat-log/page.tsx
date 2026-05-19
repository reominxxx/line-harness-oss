'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '@/contexts/account-context'
import { aiApi } from '@/lib/ai-api'

interface AiChatItem {
  id: string
  friend_id: string
  message_text: string | null
  intent: string | null
  model_used: string | null
  cost_yen_x100: number | null
  cached_response: number
  escalated: number
  vision_used: number
  quality_rating: number
  quality_note: string | null
  rated_at: string | null
  created_at: string
}

export default function ClientChatLogPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<AiChatItem[]>([])
  const [summary, setSummary] = useState<{ total: number; positive: number; negative: number; unrated: number }>({
    total: 0, positive: 0, negative: 0, unrated: 0,
  })
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unrated' | 'positive' | 'negative'>('all')
  const [rating, setRating] = useState<string | null>(null)
  const [noteInput, setNoteInput] = useState<{ id: string; note: string } | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const ratingParam = filter === 'unrated' ? 0 : filter === 'positive' ? 1 : filter === 'negative' ? -1 : undefined
      const [recentRes, sumRes] = await Promise.all([
        aiApi.chat.recent(accountId, { limit: 50, rating: ratingParam }),
        aiApi.chat.qualitySummary(accountId),
      ])
      setItems(recentRes.items)
      setSummary(sumRes.summary)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [accountId, filter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const handleRate = async (id: string, value: -1 | 1, note?: string) => {
    if (!accountId) return
    setRating(id)
    try {
      await aiApi.chat.rate(accountId, id, value, note)
      setToast({ kind: 'success', text: value === 1 ? '👍 ありがとうございます' : '👎 フィードバックを記録しました' })
      setNoteInput(null)
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '評価失敗' })
    } finally {
      setRating(null)
    }
  }

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  const satisfactionRate =
    summary.positive + summary.negative > 0
      ? Math.round((summary.positive / (summary.positive + summary.negative)) * 100)
      : null

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-2.5 rounded-lg shadow-lg text-white text-sm ${
          toast.kind === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
        }`}>{toast.text}</div>
      )}

      <section>
        <h1 className="text-2xl font-bold tracking-tight">応対履歴</h1>
        <p className="text-sm text-slate-500 mt-1">
          お客様への応対結果を一覧で確認できます
        </p>
      </section>

      {/* Quality summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          onClick={() => setFilter('all')}
          className={`bg-white border rounded-xl p-4 text-left transition-all ${
            filter === 'all' ? 'border-slate-900 shadow-sm' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs text-slate-500 mb-1">直近 30 日応答数</div>
          <div className="text-2xl font-bold tabular-nums text-slate-900">{summary.total}</div>
        </button>
        <button
          onClick={() => setFilter('positive')}
          className={`bg-white border rounded-xl p-4 text-left transition-all ${
            filter === 'positive' ? 'border-emerald-500 shadow-sm' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs text-slate-500 mb-1">👍 良かった</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-600">{summary.positive}</div>
        </button>
        <button
          onClick={() => setFilter('negative')}
          className={`bg-white border rounded-xl p-4 text-left transition-all ${
            filter === 'negative' ? 'border-rose-500 shadow-sm' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="text-xs text-slate-500 mb-1">👎 微妙</div>
          <div className="text-2xl font-bold tabular-nums text-rose-600">{summary.negative}</div>
        </button>
        <div className="bg-gradient-to-br from-slate-900 to-slate-700 rounded-xl p-4 text-white">
          <div className="text-xs text-slate-300 mb-1">満足度</div>
          <div className="text-2xl font-bold tabular-nums">
            {satisfactionRate !== null ? `${satisfactionRate}%` : '—'}
          </div>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: 'all', label: 'すべて' },
          { key: 'unrated', label: '未評価', count: summary.unrated },
          { key: 'positive', label: '👍 良かった', count: summary.positive },
          { key: 'negative', label: '👎 微妙', count: summary.negative },
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
            {f.label}{'count' in f && f.count !== undefined ? ` (${f.count})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center">
          <div className="text-5xl mb-3">💬</div>
          <p className="text-base font-medium text-slate-700 mb-1">該当する応対履歴がありません</p>
          <p className="text-sm text-slate-500">
            AI が応対を行うと、こちらに表示されます
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isPositive = item.quality_rating === 1
            const isNegative = item.quality_rating === -1
            const isEditing = noteInput?.id === item.id
            return (
              <div key={item.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                      お客様 ID: {item.friend_id.slice(0, 8)}…
                    </span>
                    {item.intent && (
                      <span className="text-[10px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded">
                        {item.intent}
                      </span>
                    )}
                    {item.escalated === 1 && (
                      <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded">
                        人間へ引継
                      </span>
                    )}
                    {item.vision_used === 1 && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                        画像理解
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400 ml-auto">
                      {new Date(item.created_at).toLocaleString('ja-JP', {
                        month: 'numeric', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {item.message_text && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3">
                      <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                        {item.message_text}
                      </p>
                    </div>
                  )}
                  {item.quality_note && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-3">
                      <p className="text-[11px] text-amber-900">📝 {item.quality_note}</p>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={noteInput.note}
                        onChange={(e) => setNoteInput({ id: item.id, note: e.target.value })}
                        placeholder="どのあたりが微妙でしたか？（任意）"
                        rows={2}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg resize-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setNoteInput(null)}
                          className="text-xs text-slate-500 px-3 py-1.5 hover:text-slate-900"
                        >
                          キャンセル
                        </button>
                        <button
                          onClick={() => handleRate(item.id, -1, noteInput.note)}
                          disabled={rating === item.id}
                          className="text-xs bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-md disabled:opacity-50"
                        >
                          {rating === item.id ? '送信中…' : '送信'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500">
                        この応答どうでしたか？
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRate(item.id, 1)}
                          disabled={rating === item.id}
                          className={`text-sm px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                            isPositive
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'bg-white border border-slate-300 text-slate-700 hover:bg-emerald-50 hover:border-emerald-300'
                          }`}
                        >
                          👍 良かった{isPositive ? '（記録済み）' : ''}
                        </button>
                        <button
                          onClick={() => setNoteInput({ id: item.id, note: '' })}
                          disabled={rating === item.id}
                          className={`text-sm px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                            isNegative
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-white border border-slate-300 text-slate-700 hover:bg-rose-50 hover:border-rose-300'
                          }`}
                        >
                          👎 微妙{isNegative ? '（記録済み）' : ''}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}

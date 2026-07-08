'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '@/contexts/account-context'
import { api, type ApiBroadcast } from '@/lib/api'
import FlexPreviewComponent from '@/components/flex-preview'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  sent: { label: '配信済み', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  scheduled: { label: '予約済み', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  draft: { label: '下書き', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  failed: { label: '失敗', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled: { label: 'キャンセル', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
}

interface RelatedMessage {
  id: string
  friendId: string
  friendName: string | null
  friendPictureUrl: string | null
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  source: string | null
  createdAt: string
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** broadcasts.messageContent をメッセージ種別に応じて見やすく描画 */
function BroadcastBodyPreview({ broadcast }: { broadcast: ApiBroadcast }) {
  const type = broadcast.messageType
  const content = broadcast.messageContent ?? ''

  if (type === 'text') {
    return (
      <div className="bg-emerald-100 text-slate-900 rounded-2xl rounded-tl-sm px-4 py-3 max-w-md text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
        {content}
      </div>
    )
  }

  if (type === 'image') {
    let parsed: { originalContentUrl?: string; previewImageUrl?: string } = {}
    try { parsed = JSON.parse(content) } catch { /* malformed */ }
    const url = parsed.previewImageUrl ?? parsed.originalContentUrl
    if (!url) {
      return <div className="text-xs text-slate-400 italic">(画像 URL なし)</div>
    }
    return (
      <div className="max-w-xs">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="配信画像"
          className="rounded-2xl rounded-tl-sm border border-slate-200 shadow-sm object-contain max-h-80"
        />
      </div>
    )
  }

  if (type === 'flex') {
    // 共通の Flex プレビューコンポーネントで描画 (bubble / carousel どちらにも対応)
    return (
      <div className="max-w-md">
        <FlexPreviewComponent content={content} maxWidth={320} />
        <details className="mt-2">
          <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600">▼ Flex JSON を見る</summary>
          <pre className="text-[10px] text-slate-500 mt-2 whitespace-pre-wrap font-mono leading-snug bg-slate-50 border border-slate-200 rounded p-2 max-h-64 overflow-auto">
            {(() => { try { return JSON.stringify(JSON.parse(content), null, 2) } catch { return content } })()}
          </pre>
        </details>
      </div>
    )
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 whitespace-pre-wrap">
      {content}
    </div>
  )
}

/** 関連チャットを友だちごとにグルーピングして時系列表示 */
function RelatedChats({ messages }: { messages: RelatedMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-xs text-slate-400 italic text-center py-6">
        この配信後 24 時間以内には、まだお客様からの応答や追加のやり取りが記録されていません。
      </p>
    )
  }

  // friendId でグルーピング
  const byFriend = new Map<string, { name: string | null; pictureUrl: string | null; msgs: RelatedMessage[] }>()
  for (const m of messages) {
    if (!byFriend.has(m.friendId)) {
      byFriend.set(m.friendId, { name: m.friendName, pictureUrl: m.friendPictureUrl, msgs: [] })
    }
    byFriend.get(m.friendId)!.msgs.push(m)
  }

  return (
    <div className="space-y-4">
      {Array.from(byFriend.entries()).map(([friendId, group]) => (
        <div key={friendId} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100">
            {group.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={group.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-slate-200" />
            )}
            <span className="text-sm font-medium text-slate-800">
              {group.name ?? '(no name)'}
            </span>
            <span className="text-[11px] text-slate-400 ml-auto">
              {group.msgs.length} 件のやり取り
            </span>
          </div>
          <div className="space-y-2">
            {group.msgs.map((m) => (
              <div key={m.id} className={`flex ${m.direction === 'incoming' ? 'justify-start' : 'justify-end'}`}>
                <div className="max-w-[75%]">
                  <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                    m.direction === 'incoming'
                      ? 'bg-slate-100 text-slate-900 rounded-tl-sm'
                      : m.source === 'ai_chat'
                      ? 'bg-violet-50 text-violet-900 border border-violet-100 rounded-tr-sm'
                      : 'bg-emerald-100 text-emerald-900 rounded-tr-sm'
                  }`}>
                    {m.content}
                  </div>
                  <div className={`text-[10px] text-slate-400 mt-0.5 ${m.direction === 'incoming' ? 'text-left' : 'text-right'}`}>
                    {m.direction === 'outgoing' && m.source === 'ai_chat' && '🤖 AI · '}
                    {formatTime(m.createdAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ClientBroadcastsPage() {
  const { selectedAccountId } = useAccount()
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [relatedMap, setRelatedMap] = useState<Record<string, RelatedMessage[]>>({})
  const [relatedLoading, setRelatedLoading] = useState<string | null>(null)

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

  const toggleExpand = async (b: ApiBroadcast) => {
    if (expanded === b.id) {
      setExpanded(null)
      return
    }
    setExpanded(b.id)
    if (b.status === 'sent' && !relatedMap[b.id]) {
      setRelatedLoading(b.id)
      try {
        const r = await api.broadcasts.relatedMessages(b.id, 60)
        if (r.success && r.data) {
          setRelatedMap((prev) => ({ ...prev, [b.id]: r.data!.messages }))
        }
      } catch { /* silent */ }
      finally { setRelatedLoading(null) }
    }
  }

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">配信履歴</h1>
        <p className="text-xs text-slate-500 mt-1">
          配信内容と、その配信を受け取ったお客様からの 24 時間以内の応答・AI チャットを確認できます。
        </p>
      </section>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : broadcasts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="text-3xl mb-3">📭</div>
          <p className="text-sm text-slate-600 font-medium">まだ配信履歴がありません</p>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            配信を行うと、配信内容とお客様からの反応がここに記録されます。
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {broadcasts.map((b) => {
            const badge = STATUS_BADGE[b.status] ?? STATUS_BADGE.draft
            const isExpanded = expanded === b.id
            const date = b.sentAt ?? b.scheduledAt ?? b.createdAt
            return (
              <div key={b.id}>
                <div className="px-5 py-4 hover:bg-slate-50/50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                        <span className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                          {b.messageType === 'text' ? 'テキスト' : b.messageType === 'image' ? '画像' : 'Flex'}
                        </span>
                        <span className="font-semibold text-sm text-slate-900 truncate">
                          {b.title || '(無題)'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {date ? formatTime(date) : '—'}
                        {b.status === 'sent' && b.totalCount > 0 && (
                          <span className="ml-3 text-slate-600">
                            送信 {b.successCount.toLocaleString('ja-JP')} / {b.totalCount.toLocaleString('ja-JP')}
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleExpand(b)}
                      className="text-xs text-slate-600 hover:text-slate-900 shrink-0"
                    >
                      {isExpanded ? '閉じる' : '内容を見る'}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-5 pb-5 pt-2 bg-slate-50/40 space-y-5">
                    {/* 配信内容 (吹き出し表示) */}
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                        <span>📤</span>
                        <span>配信内容</span>
                      </h3>
                      <BroadcastBodyPreview broadcast={b} />
                    </div>

                    {/* 関連チャット (応答・AI返信) */}
                    {b.status === 'sent' && (
                      <div>
                        <h3 className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                          <span>💬</span>
                          <span>配信後のやり取り (24h以内)</span>
                        </h3>
                        {relatedLoading === b.id ? (
                          <div className="text-center py-6 text-xs text-slate-400">読み込み中…</div>
                        ) : (
                          <RelatedChats messages={relatedMap[b.id] ?? []} />
                        )}
                      </div>
                    )}
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

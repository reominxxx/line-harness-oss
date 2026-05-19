'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import { api, type ApiBroadcast } from '@/lib/api'

interface Summary {
  friendsCount: number
  sentThisMonth: number
  sentThisWeek: number
  scheduledCount: number
  recentBroadcasts: ApiBroadcast[]
  upcomingBroadcasts: ApiBroadcast[]
  chatResponseCount: number
}

export default function ClientHomePage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const broadcastsRes = await api.broadcasts.list({ accountId })
      const broadcasts = broadcastsRes.success && broadcastsRes.data ? broadcastsRes.data : []

      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - 7)

      const sent = broadcasts.filter((b) => b.status === 'sent' && b.sentAt)
      const scheduled = broadcasts.filter((b) => b.status === 'scheduled' && b.scheduledAt)

      const sentThisMonth = sent.filter((b) => new Date(b.sentAt!) >= monthStart).length
      const sentThisWeek = sent.filter((b) => new Date(b.sentAt!) >= weekStart).length

      const recentBroadcasts = [...sent]
        .sort((a, b) => new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime())
        .slice(0, 4)
      const upcomingBroadcasts = [...scheduled]
        .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
        .slice(0, 3)

      let friendsCount = 0
      let chatResponseCount = 0
      try {
        const friendsRes = await api.friends.count({ accountId })
        if (friendsRes.success && friendsRes.data) friendsCount = friendsRes.data.count
      } catch {
        /* ignore */
      }
      try {
        const chatsRes = await api.chats.list({ accountId })
        if (chatsRes.success && chatsRes.data) {
          chatResponseCount = chatsRes.data.filter((c) => c.status !== 'unread').length
        }
      } catch {
        /* ignore */
      }

      setSummary({
        friendsCount,
        sentThisMonth,
        sentThisWeek,
        scheduledCount: scheduled.length,
        recentBroadcasts,
        upcomingBroadcasts,
        chatResponseCount,
      })
    } catch {
      // 顧客画面ではエラーは静かに
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  if (!accountId) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-3">🔐</div>
        <p className="text-sm text-slate-500">アカウントを選択してください</p>
      </div>
    )
  }

  const today = new Date()
  const greeting =
    today.getHours() < 11 ? 'おはようございます' : today.getHours() < 18 ? 'こんにちは' : 'こんばんは'
  const dateLabel = today.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })
  const monthLabel = `${today.getMonth() + 1}月`
  const accountName = selectedAccount?.displayName ?? selectedAccount?.name ?? 'お客様'

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6 sm:p-8">
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute -right-6 -bottom-8 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-1.5">
            <span>{dateLabel}</span>
            <span>·</span>
            <span>{greeting}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {accountName} さんの運用状況
          </h1>
          <p className="text-sm text-slate-300 mt-1.5">
            今月の配信・応対の結果をまとめています
          </p>
        </div>
      </section>

      {/* KPI cards */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          {monthLabel}の成果
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            tone="emerald"
            icon="👥"
            label="友だち"
            value={summary?.friendsCount}
            unit="人"
            loading={loading}
          />
          <KpiCard
            tone="blue"
            icon="📨"
            label={`${monthLabel}の配信`}
            value={summary?.sentThisMonth}
            unit="本"
            loading={loading}
            sub={summary && summary.sentThisWeek > 0 ? `直近7日: ${summary.sentThisWeek}本` : undefined}
          />
          <KpiCard
            tone="violet"
            icon="💬"
            label="応対した会話"
            value={summary?.chatResponseCount}
            unit="件"
            loading={loading}
          />
          <KpiCard
            tone="amber"
            icon="🕒"
            label="今後の予約配信"
            value={summary?.scheduledCount}
            unit="件"
            loading={loading}
          />
        </div>
      </section>

      {/* 2 column: 直近の配信 / 予約 */}
      <section className="grid lg:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              直近の配信
            </h2>
            <Link href="/client/broadcasts" className="text-xs text-slate-500 hover:text-slate-900">
              すべて見る →
            </Link>
          </div>
          {loading ? (
            <SkeletonBlock />
          ) : !summary || summary.recentBroadcasts.length === 0 ? (
            <EmptyState icon="📨" message="まだ配信実績はありません" />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
              {summary.recentBroadcasts.map((b) => (
                <Link
                  key={b.id}
                  href="/client/broadcasts"
                  className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center text-sm shrink-0">
                    📨
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {b.title || '(無題)'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {b.sentAt ? formatDate(b.sentAt) : '—'}
                    </div>
                  </div>
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full shrink-0">
                    配信済み
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              予約済みの配信
            </h2>
            <span className="text-xs text-slate-400">
              {summary?.scheduledCount ?? 0} 件
            </span>
          </div>
          {loading ? (
            <SkeletonBlock />
          ) : !summary || summary.upcomingBroadcasts.length === 0 ? (
            <EmptyState icon="🕒" message="予約中の配信はありません" />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
              {summary.upcomingBroadcasts.map((b) => (
                <div key={b.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center text-sm shrink-0">
                    🕒
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {b.title || '(無題)'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {b.scheduledAt ? formatDate(b.scheduledAt) : '—'}
                    </div>
                  </div>
                  <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full shrink-0">
                    予約済み
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Quick links */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          詳しく見る
        </h2>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { href: '/client/reports', icon: '📊', label: '月次レポート', desc: 'グラフで成果を確認', tone: 'emerald' },
            { href: '/client/broadcasts', icon: '📨', label: '配信履歴', desc: 'いつ何を送ったか', tone: 'blue' },
            { href: '/client/chat-log', icon: '💬', label: '応対履歴', desc: 'お客様への応対の記録', tone: 'violet' },
          ].map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="group bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-400 hover:shadow-md transition-all"
            >
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg mb-3 ${
                  q.tone === 'emerald'
                    ? 'bg-emerald-50 text-emerald-700'
                    : q.tone === 'blue'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-violet-50 text-violet-700'
                }`}
              >
                {q.icon}
              </div>
              <div className="font-semibold text-sm text-slate-900 mb-0.5">{q.label}</div>
              <div className="text-[11px] text-slate-500 mb-3">{q.desc}</div>
              <div className="text-xs text-slate-400 group-hover:text-slate-900 transition-colors">
                開く →
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function formatDate(s: string): string {
  return new Date(s).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function KpiCard({
  tone,
  icon,
  label,
  value,
  unit,
  loading,
  sub,
}: {
  tone: 'emerald' | 'blue' | 'violet' | 'amber'
  icon: string
  label: string
  value: number | undefined
  unit: string
  loading: boolean
  sub?: string
}) {
  const accent = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
    amber: 'bg-amber-50 text-amber-700',
  }[tone]

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-slate-500">{label}</span>
        <div className={`w-7 h-7 rounded-md flex items-center justify-center text-xs ${accent}`}>
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">
          {loading ? '…' : (value ?? 0).toLocaleString()}
        </span>
        <span className="text-xs text-slate-500">{unit}</span>
      </div>
      {sub && <div className="text-[10px] text-slate-400 mt-1">{sub}</div>}
    </div>
  )
}

function SkeletonBlock() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 flex items-center justify-center">
      <span className="text-sm text-slate-400">読み込み中…</span>
    </div>
  )
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
      <div className="text-3xl mb-2 opacity-50">{icon}</div>
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  )
}

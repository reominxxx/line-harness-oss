'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type KpiGoal, type AgentJob } from '@/lib/ai-api'

const METRIC_LABEL: Record<string, string> = {
  broadcast_count: '配信本数',
  friend_growth: '友だち純増',
  cv_count: 'コンバージョン',
  reactivation_count: '休眠掘り起こし',
  open_rate: '平均開封率',
  click_rate: '平均CTR',
  nps: 'NPS',
  reservation_count: '予約件数',
  review_count: 'レビュー獲得',
}

const METRIC_UNIT: Record<string, string> = {
  broadcast_count: '本',
  friend_growth: '人',
  cv_count: '件',
  reactivation_count: '件',
  open_rate: '%',
  click_rate: '%',
  nps: '',
  reservation_count: '件',
  review_count: '件',
}

export default function ClientHomePage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [goals, setGoals] = useState<KpiGoal[]>([])
  const [reviewCount, setReviewCount] = useState(0)
  const [latestActivities, setLatestActivities] = useState<AgentJob[]>([])
  const [loading, setLoading] = useState(false)

  const accountId = selectedAccountId
  const yearMonth = new Date().toISOString().slice(0, 7)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [goalsRes, reviewRes, recentRes] = await Promise.all([
        aiApi.kpi.list(accountId, yearMonth),
        aiApi.agentJobs.list(accountId, { status: 'review', limit: 50 }),
        aiApi.agentJobs.list(accountId, { status: 'completed', limit: 8 }),
      ])
      setGoals(goalsRes.goals)
      setReviewCount(reviewRes.jobs.length)
      setLatestActivities(recentRes.jobs)
    } catch {
      // 顧客画面ではエラーは静かに
    } finally {
      setLoading(false)
    }
  }, [accountId, yearMonth])

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
  const greeting = today.getHours() < 11 ? 'おはようございます' : today.getHours() < 18 ? 'こんにちは' : 'こんばんは'

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <section>
        <p className="text-sm text-slate-500">{greeting}</p>
        <h1 className="text-2xl font-bold tracking-tight mt-1">
          {selectedAccount?.displayName ?? selectedAccount?.name ?? 'お客様'} さんの運用状況
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {yearMonth.replace('-', ' 年 ')} 月 のサマリー
        </p>
      </section>

      {/* Approval banner */}
      {reviewCount > 0 && (
        <Link
          href="/client/approvals"
          className="block bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5 hover:from-amber-100 hover:to-orange-100 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700">
                ✋
              </div>
              <div>
                <div className="font-semibold text-amber-900">
                  {reviewCount} 件の確認をお願いします
                </div>
                <div className="text-xs text-amber-700 mt-0.5">
                  AI が作成したコンテンツの確認待ち
                </div>
              </div>
            </div>
            <div className="text-amber-700 text-sm font-medium">
              確認する →
            </div>
          </div>
        </Link>
      )}

      {/* KPI cards */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
          今月の目標達成状況
        </h2>
        {goals.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
            <p className="text-sm text-slate-500">
              今月の目標はまだ設定されていません
            </p>
            <p className="text-xs text-slate-400 mt-2">
              担当者から目標設定のご案内をお送りします
            </p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {goals.map((g) => {
              const pct = g.target_value > 0 ? Math.min((g.current_value / g.target_value) * 100, 100) : 0
              const isComplete = pct >= 100
              return (
                <div key={g.id} className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-slate-500 font-medium">
                      {METRIC_LABEL[g.metric] ?? g.metric}
                    </span>
                    {isComplete && (
                      <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                        達成
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-3xl font-bold tabular-nums text-slate-900">
                      {g.current_value}
                    </span>
                    <span className="text-sm text-slate-400">
                      / {g.target_value}{METRIC_UNIT[g.metric]}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        isComplete
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                          : 'bg-gradient-to-r from-slate-800 to-slate-600'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1.5 text-right tabular-nums">
                    {pct.toFixed(0)}%
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Recent activities */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            最近の運用ハイライト
          </h2>
          <Link href="/client/broadcasts" className="text-xs text-slate-500 hover:text-slate-900">
            配信履歴 →
          </Link>
        </div>
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
            読み込み中…
          </div>
        ) : latestActivities.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-400">
            まだ実績がありません
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {latestActivities.map((j) => (
              <div key={j.id} className="px-5 py-3.5 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-sm shrink-0">
                  {getJobEmoji(j.job_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {getJobLabel(j.job_type)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {new Date(j.completed_at ?? j.created_at).toLocaleString('ja-JP', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full shrink-0">
                  完了
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Quick links */}
      <section>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
          できること
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { href: '/client/reports', icon: '📊', label: '月次レポート', desc: 'AI 分析の結果' },
            { href: '/client/broadcasts', icon: '📨', label: '配信履歴', desc: 'いつ何を配信したか' },
            { href: '/client/approvals', icon: '✅', label: '承認する', desc: 'AI 提案の確認' },
            { href: '/client/chat-log', icon: '💬', label: '応対履歴', desc: 'AI のお客様対応' },
          ].map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 hover:shadow-sm transition-all"
            >
              <div className="text-2xl mb-2">{q.icon}</div>
              <div className="font-medium text-sm text-slate-900">{q.label}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{q.desc}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function getJobLabel(jobType: string): string {
  const map: Record<string, string> = {
    generate_broadcast: '配信案を作成',
    generate_monthly_report: '月次レポートを作成',
    generate_weekly_report: '週次レポートを作成',
    wake_dormant: '休眠顧客への配信',
    wake_warm_leads: '見込み客への一押し',
    analyze_funnel: 'ファネル分析',
    analyze_chat_sentiment: 'お客様の声を分析',
    analyze_broadcast_performance: '配信効果を分析',
    optimize_schedule: '配信スケジュール最適化',
    request_reviews: 'レビュー依頼配信',
    hot_lead_notify: 'ホットリード通知',
    segment_friends: '顧客セグメント分析',
    birthday_greeting: 'お誕生日メッセージ',
    pre_reservation_survey: '事前アンケート',
  }
  return map[jobType] ?? jobType
}

function getJobEmoji(jobType: string): string {
  if (jobType.includes('report')) return '📊'
  if (jobType.includes('broadcast') || jobType.includes('wake')) return '📨'
  if (jobType.includes('analyze') || jobType.includes('segment')) return '🔍'
  if (jobType.includes('review')) return '⭐'
  if (jobType.includes('birthday')) return '🎂'
  if (jobType.includes('lead') || jobType.includes('notify')) return '🔥'
  return '✨'
}

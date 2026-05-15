'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AgentJob, type KpiGoal } from '@/lib/ai-api'
import MiniBarChart, { type BarDatum } from '@/components/charts/mini-bar-chart'

const STATUS_STYLES: Record<string, string> = {
  pending: 'text-gray-600 bg-gray-100',
  running: 'text-blue-700 bg-blue-50',
  review: 'text-amber-700 bg-amber-50',
  approved: 'text-emerald-700 bg-emerald-50',
  rejected: 'text-rose-700 bg-rose-50',
  completed: 'text-gray-700 bg-gray-100',
  failed: 'text-rose-700 bg-rose-100',
  cancelled: 'text-gray-500 bg-gray-50',
}

const JOB_TYPE_LABELS: Record<string, string> = {
  generate_monthly_report: '月次レポート',
  generate_weekly_report: '週次レポート',
  generate_broadcast: '配信案作成',
  wake_dormant: '休眠掘り起こし',
  wake_warm_leads: 'ウォームリード一押し',
  analyze_funnel: 'ファネル分析',
  create_scenario: '新シナリオ案',
  generate_acquisition_campaign: '集客キャンペーン案',
  update_rich_menu_cta: 'リッチメニュー改善',
  optimize_booking_promotion: '予約促進最適化',
  request_reviews: 'レビュー依頼',
  analyze_chat_sentiment: 'チャット感情分析',
  analyze_broadcast_performance: '配信パフォーマンス分析',
  analyze_scenarios: 'シナリオ全体分析',
  optimize_schedule: '配信スケジュール最適化',
  hot_lead_notify: 'ホットリード通知',
  segment_friends: 'セグメント分析',
  scoring_design: 'スコアリング設計',
  cv_setup: 'CV 計測設計',
  template_create: 'テンプレート作成',
  reminder_setup: 'リマインダー設計',
  unanswered_chat_summary: '未対応チャット集計',
  ban_risk_check: 'BAN リスク診断',
  automation_design: 'オートメーション設計',
  calculate_intent_scores: 'シグナル計算',
}

function getJobLabel(jobType: string): string {
  return JOB_TYPE_LABELS[jobType] ?? jobType
}

export default function AgentDashboardPage() {
  const { selectedAccountId } = useAccount()
  const [reviewJobs, setReviewJobs] = useState<AgentJob[]>([])
  const [completedToday, setCompletedToday] = useState<AgentJob[]>([])
  const [pendingJobs, setPendingJobs] = useState<AgentJob[]>([])
  const [goals, setGoals] = useState<KpiGoal[]>([])
  const [dailyStats, setDailyStats] = useState<Array<{
    date: string; total: number; completed: number; failed: number; review: number; cost_yen_x100: number
  }>>([])
  const [loading, setLoading] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)

  const accountId = selectedAccountId
  const yearMonth = new Date().toISOString().slice(0, 7)
  const [notifyTarget, setNotifyTarget] = useState('')
  const [savingNotify, setSavingNotify] = useState(false)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [reviewRes, completedRes, pendingRes, goalsRes, policyRes, statsRes] = await Promise.all([
        aiApi.agentJobs.list(accountId, { status: 'review', limit: 50 }),
        aiApi.agentJobs.list(accountId, { status: 'completed', limit: 30 }),
        aiApi.agentJobs.list(accountId, { status: 'pending', limit: 30 }),
        aiApi.kpi.list(accountId, yearMonth),
        aiApi.automationPolicy.get(accountId).catch(() => ({ policy: null })),
        aiApi.agentJobs.dailyStats(accountId, 14).catch(() => ({ success: false, days: 0, stats: [] })),
      ])
      setReviewJobs(reviewRes.jobs)
      setCompletedToday(
        completedRes.jobs.filter((j) =>
          j.completed_at?.startsWith(new Date().toISOString().slice(0, 10)),
        ),
      )
      setPendingJobs(pendingRes.jobs)
      setGoals(goalsRes.goals)
      setNotifyTarget(policyRes.policy?.notification_target ?? '')
      setDailyStats(statsRes.stats ?? [])
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId, yearMonth])

  const handleSaveNotifyTarget = async () => {
    if (!accountId) return
    setSavingNotify(true)
    try {
      await aiApi.automationPolicy.upsert(accountId, {
        notification_channel: 'line',
        notification_target: notifyTarget,
      })
      setToast({ kind: 'success', text: '通知先を保存しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSavingNotify(false)
    }
  }

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleApprove = async (id: string) => {
    if (!accountId) return
    setActioning(id)
    try {
      await aiApi.agentJobs.approve(accountId, id)
      setToast({ kind: 'success', text: '承認しました' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '承認失敗' })
    } finally {
      setActioning(null)
    }
  }

  const handleReject = async (id: string) => {
    if (!accountId) return
    setActioning(id)
    try {
      await aiApi.agentJobs.reject(accountId, id)
      setToast({ kind: 'success', text: '却下しました' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '却下失敗' })
    } finally {
      setActioning(null)
    }
  }

  const handleRun = async (id: string) => {
    if (!accountId) return
    setActioning(id)
    try {
      const result = await aiApi.agentJobs.run(accountId, id)
      setToast({
        kind: result.success ? 'success' : 'error',
        text: result.success ? `実行: ${result.status}` : `失敗: ${result.error}`,
      })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '実行失敗' })
    } finally {
      setActioning(null)
    }
  }

  const handleExecutorTick = async () => {
    if (!accountId) return
    setRunning(true)
    try {
      const result = await aiApi.agentJobs.executorTick(accountId)
      setToast({
        kind: 'success',
        text: `Executor: 取得${result.picked} 完了${result.succeeded} レビュー${result.reviewQueued} 失敗${result.failed} スキップ${result.skipped}`,
      })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : 'Executor 失敗' })
    } finally {
      setRunning(false)
    }
  }

  const renderOutput = (job: AgentJob) => {
    if (!job.output_json) return <span className="text-xs text-gray-400">出力なし</span>
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(job.output_json)
    } catch {
      return <pre className="text-xs whitespace-pre-wrap text-gray-700">{job.output_json}</pre>
    }
    if ('messages' in parsed && Array.isArray(parsed.messages)) {
      const messages = parsed.messages as Array<{ display_name?: string; message?: string }>
      return (
        <div className="space-y-2">
          {messages.slice(0, 3).map((m, i) => (
            <div key={i} className="bg-gray-50 border border-gray-100 p-2.5 rounded text-xs">
              <div className="font-medium text-gray-700 mb-1">{m.display_name ?? `#${i + 1}`}</div>
              <div className="text-gray-700 whitespace-pre-wrap">{m.message}</div>
            </div>
          ))}
          {messages.length > 3 && (
            <div className="text-xs text-gray-400">他 {messages.length - 3} 件…</div>
          )}
        </div>
      )
    }
    if ('content' in parsed) {
      return (
        <div className="bg-gray-50 border border-gray-100 p-3 rounded">
          {'title' in parsed && (
            <div className="font-medium text-sm mb-2 text-gray-900">{parsed.title as string}</div>
          )}
          <div className="text-sm whitespace-pre-wrap text-gray-700">{parsed.content as string}</div>
        </div>
      )
    }
    if ('reportMarkdown' in parsed) {
      return (
        <pre className="text-xs whitespace-pre-wrap bg-gray-50 border border-gray-100 p-3 rounded max-h-96 overflow-auto text-gray-700">
          {parsed.reportMarkdown as string}
        </pre>
      )
    }
    return (
      <pre className="text-xs whitespace-pre-wrap bg-gray-50 border border-gray-100 p-3 rounded max-h-64 overflow-auto text-gray-700">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    )
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="自動化ダッシュボード" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="自動化ダッシュボード" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm max-w-md ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          {/* ヘッダー行 */}
          <div className="flex items-center justify-between mb-5">
            <div className="text-sm text-gray-500">
              対象月 <span className="text-gray-900 font-medium">{yearMonth}</span>
              <span className="mx-2 text-gray-300">·</span>
              承認待ち <span className="text-gray-900 font-medium">{reviewJobs.length}</span> 件
              <span className="mx-2 text-gray-300">·</span>
              待機中 <span className="text-gray-900 font-medium">{pendingJobs.length}</span> 件
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void load()}
                disabled={loading}
                className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
              >再読み込み</button>
              <button
                onClick={handleExecutorTick}
                disabled={running}
                className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-700 disabled:bg-gray-300"
              >{running ? '実行中…' : 'Executor を 1 tick 実行'}</button>
            </div>
          </div>

          {/* 通知先 LINE user_id */}
          <section className="bg-white border border-gray-200 rounded-md p-4 mb-6">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">通知先 LINE（承認待ち発生時に push）</h2>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={notifyTarget}
                onChange={(e) => setNotifyTarget(e.target.value)}
                placeholder="LINE user_id（U で始まる 33 文字）"
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm font-mono"
              />
              <button
                onClick={handleSaveNotifyTarget}
                disabled={savingNotify}
                className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-700 disabled:bg-gray-300"
              >{savingNotify ? '…' : '保存'}</button>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              この LINE アカウントを友だち追加した自分の user_id を入れると、AI が承認待ちジョブを生成した時にプッシュ通知が届きます。空欄なら通知しません。
            </p>
          </section>

          {/* 14 日推移グラフ */}
          {dailyStats.length > 0 && (
            <section className="bg-white border border-gray-200 rounded-md p-4 mb-6">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">直近 14 日の実行推移</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-700 font-medium">ジョブ実行数（完了）</span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      合計 {dailyStats.reduce((s, d) => s + d.completed, 0)} 件
                    </span>
                  </div>
                  <MiniBarChart
                    data={fillDays(dailyStats, 14).map<BarDatum>((d) => ({
                      label: d.date.slice(5).replace('-', '/'),
                      value: d.completed,
                      meta: `失敗 ${d.failed} 件 / レビュー ${d.review} 件`,
                    }))}
                    color="rgb(15, 23, 42)"
                    height={100}
                    unit=" 件"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-700 font-medium">AI コスト推移</span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      合計 ¥{(dailyStats.reduce((s, d) => s + (d.cost_yen_x100 || 0), 0) / 100).toFixed(2)}
                    </span>
                  </div>
                  <MiniBarChart
                    data={fillDays(dailyStats, 14).map<BarDatum>((d) => ({
                      label: d.date.slice(5).replace('-', '/'),
                      value: Math.round((d.cost_yen_x100 || 0) / 100),
                      meta: `¥${((d.cost_yen_x100 || 0) / 100).toFixed(2)}`,
                    }))}
                    color="rgb(5, 150, 105)"
                    height={100}
                    unit=" 円"
                  />
                </div>
              </div>
            </section>
          )}

          {/* KPI 進捗 */}
          {goals.length > 0 && (
            <section className="bg-white border border-gray-200 rounded-md p-4 mb-6">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">今月の KPI 進捗</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {goals.map((g) => {
                  const pct = g.target_value > 0
                    ? Math.min((g.current_value / g.target_value) * 100, 100)
                    : 0
                  return (
                    <div key={g.id}>
                      <div className="flex justify-between items-baseline text-sm mb-1.5">
                        <span className="font-medium text-gray-700 text-xs">{METRIC_LABEL[g.metric] ?? g.metric}</span>
                        <span className="text-gray-500 text-xs tabular-nums">
                          <span className="text-gray-900 font-medium">{g.current_value}</span> / {g.target_value}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gray-900 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* 承認待ち */}
          <section className="mb-6">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              承認待ち ({reviewJobs.length})
            </h2>
            {reviewJobs.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-md p-6 text-center text-sm text-gray-400">
                承認待ちはありません
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
                {reviewJobs.map((job) => {
                  const isExpanded = expandedJobId === job.id
                  return (
                    <div key={job.id} className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900 text-sm">{getJobLabel(job.job_type)}</span>
                            <span className={`text-[11px] px-1.5 py-0.5 rounded ${STATUS_STYLES[job.status]}`}>{job.status}</span>
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {new Date(job.completed_at ?? job.created_at).toLocaleString('ja-JP')}
                            <span className="mx-1.5">·</span>
                            ¥{(job.cost_yen_x100 / 100).toFixed(2)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                            className="text-xs text-gray-700 hover:text-gray-900"
                          >{isExpanded ? '閉じる' : '中身を見る'}</button>
                          <button
                            onClick={() => handleReject(job.id)}
                            disabled={actioning === job.id}
                            className="text-xs border border-gray-300 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
                          >却下</button>
                          <button
                            onClick={() => handleApprove(job.id)}
                            disabled={actioning === job.id}
                            className="text-xs bg-gray-900 text-white px-3 py-1 rounded hover:bg-gray-700 disabled:opacity-50"
                          >{actioning === job.id ? '…' : '承認'}</button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-gray-100">{renderOutput(job)}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 待機中 */}
          {pendingJobs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                待機中 ({pendingJobs.length})
              </h2>
              <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-gray-500 border-b border-gray-200">
                      <th className="px-4 py-2 font-medium">種別</th>
                      <th className="px-4 py-2 font-medium">予定実行</th>
                      <th className="px-4 py-2 font-medium">起源</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingJobs.map((job) => (
                      <tr key={job.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900">{getJobLabel(job.job_type)}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{new Date(job.scheduled_at).toLocaleString('ja-JP')}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{job.origin}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => handleRun(job.id)}
                            disabled={actioning === job.id}
                            className="text-xs border border-gray-300 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
                          >{actioning === job.id ? '…' : '今すぐ実行'}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 本日の自動実行 */}
          <section>
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              本日の自動実行 ({completedToday.length})
            </h2>
            {completedToday.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-md p-6 text-center text-sm text-gray-400">
                本日の自動実行履歴はありません
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
                {completedToday.map((job) => (
                  <div key={job.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900">{getJobLabel(job.job_type)}</div>
                      <div className="text-[11px] text-gray-400">
                        {new Date(job.completed_at ?? job.created_at).toLocaleTimeString('ja-JP')}
                        <span className="mx-1.5">·</span>
                        ¥{(job.cost_yen_x100 / 100).toFixed(2)}
                      </div>
                    </div>
                    <button
                      onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                      className="text-xs text-gray-700 hover:text-gray-900"
                    >{expandedJobId === job.id ? '閉じる' : '詳細'}</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

interface DailyStat {
  date: string
  total: number
  completed: number
  failed: number
  review: number
  cost_yen_x100: number
}

function fillDays(stats: DailyStat[], days: number): DailyStat[] {
  const map = new Map(stats.map((s) => [s.date, s]))
  const result: DailyStat[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const date = d.toISOString().slice(0, 10)
    result.push(
      map.get(date) ?? { date, total: 0, completed: 0, failed: 0, review: 0, cost_yen_x100: 0 },
    )
  }
  return result
}

const METRIC_LABEL: Record<string, string> = {
  broadcast_count: '月配信本数',
  friend_growth: '友だち純増',
  cv_count: 'コンバージョン',
  reactivation_count: '休眠掘り起こし',
  open_rate: '平均開封率',
  click_rate: '平均CTR',
  nps: 'NPS',
  reservation_count: '予約件数',
  review_count: 'レビュー獲得',
}

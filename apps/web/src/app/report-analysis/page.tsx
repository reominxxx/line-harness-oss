'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useAccount } from '@/contexts/account-context'
import { aiApi } from '@/lib/ai-api'

type Severity = 'high' | 'medium' | 'low'

interface Strength {
  title: string
  detail: string
  metric?: string
}

interface Issue {
  title: string
  detail: string
  severity: Severity
  metric?: string
}

interface Strategy {
  priority: number
  title: string
  why: string
  how: string[]
  expected: string
}

interface BroadcastPlan {
  week: string
  theme: string
  type: string
  segment: string
  goal: string
}

interface ActionItem {
  category: string
  task: string
  owner: string
  due: string
  status: 'todo' | 'doing'
}

interface Analysis {
  overallScore: number
  verdict: 'good' | 'warn' | 'bad'
  headline: string
  strengths: Strength[]
  issues: Issue[]
  strategies: Strategy[]
  plan: BroadcastPlan[]
  actions: ActionItem[]
}

interface Metrics {
  friendsAtStart: number
  friendsAtEnd: number
  friendsAdded: number
  friendsBlocked: number
  broadcastsSent: number
  broadcastOpenRate: number | null
  broadcastClickRate: number | null
  cvCount: number
  hotLeadsCount: number
  dormantWokeCount: number
}

interface ReportResult {
  yearMonth: string
  label: string
  analysis: Analysis
  metrics: Metrics
  generatedAt: string
}

// 過去 12 ヶ月の選択肢 (YYYY-MM)
function monthOptions(now = new Date()): { ym: string; label: string }[] {
  const out: { ym: string; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ ym, label: `${d.getFullYear()}年${d.getMonth() + 1}月` })
  }
  return out
}

function ymLabel(ym: string, options: { ym: string; label: string }[]): string {
  const found = options.find((o) => o.ym === ym)
  if (found) return found.label
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 1000) / 10}%`
}

/** agent_jobs の output_json を ReportResult に変換 (analysis が無ければ null) */
function toResult(
  outputJson: string | null,
  inputYm: string,
  options: { ym: string; label: string }[],
): ReportResult | null {
  if (!outputJson) return null
  try {
    const out = JSON.parse(outputJson) as {
      yearMonth?: string
      analysis?: Analysis | null
      metrics?: Metrics
      generatedAt?: string
    }
    if (!out.analysis || !out.metrics) return null
    const ym = out.yearMonth ?? inputYm
    return {
      yearMonth: ym,
      label: ymLabel(ym, options),
      analysis: out.analysis,
      metrics: out.metrics,
      generatedAt: out.generatedAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export default function ReportAnalysisPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const options = useMemo(() => monthOptions(), [])
  // デフォルトは前月 (締まった月を対象にすることが多い)
  const [selectedYm, setSelectedYm] = useState<string>(options[1]?.ym ?? options[0].ym)
  const [generating, setGenerating] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ReportResult | null>(null)

  const accountId = selectedAccountId

  // マウント時・月変更時: DB に保存済みの最新レポートを復元 (ページ遷移しても消えない)
  useEffect(() => {
    let cancelled = false
    if (!accountId) return
    setRestoring(true)
    setError(null)
    ;(async () => {
      try {
        const res = await aiApi.agentJobs.list(accountId, {
          jobType: 'generate_monthly_report',
          limit: 40,
        })
        if (cancelled) return
        const jobs = res.success ? res.jobs : []
        // 当月分で output を持つ最新ジョブ (list は created_at desc 想定)
        let restored: ReportResult | null = null
        for (const j of jobs) {
          let jobYm = ''
          try {
            jobYm = (JSON.parse(j.input_json || '{}') as { yearMonth?: string }).yearMonth ?? ''
          } catch {
            jobYm = ''
          }
          const target = jobYm || ''
          if (target && target !== selectedYm) continue
          const r = toResult(j.output_json, selectedYm, options)
          if (r && r.yearMonth === selectedYm) {
            restored = r
            break
          }
        }
        setReport(restored)
      } catch {
        if (!cancelled) setReport(null)
      } finally {
        if (!cancelled) setRestoring(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [accountId, selectedYm, options])

  const handleGenerate = useCallback(async () => {
    if (!accountId) return
    setGenerating(true)
    setError(null)
    try {
      const created = await aiApi.agentJobs.create(accountId, {
        job_type: 'generate_monthly_report',
        input: { yearMonth: selectedYm },
      })
      const ran = await aiApi.agentJobs.run(accountId, created.job.id)
      const job = ran.job
      if (ran.status === 'failed' || !job?.output_json) {
        setError(ran.error || 'レポート生成に失敗しました。時間をおいて再度お試しください。')
        return
      }
      const r = toResult(job.output_json, selectedYm, options)
      if (!r) {
        setError('レポートの解析に失敗しました。対象月のデータが不足している可能性があります。')
        return
      }
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'レポート生成中にエラーが発生しました。')
    } finally {
      setGenerating(false)
    }
  }, [accountId, selectedYm, options])

  const handlePrint = useCallback(() => {
    if (typeof window !== 'undefined') window.print()
  }, [])

  const scoreColor = useMemo(() => {
    const s = report?.analysis.overallScore ?? 0
    if (s >= 80) return 'text-emerald-600'
    if (s >= 60) return 'text-amber-600'
    return 'text-rose-600'
  }, [report])

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  const m = report?.metrics
  const a = report?.analysis

  return (
    <div className="space-y-6 print:space-y-4">
      {/* ヘッダー */}
      <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 print:flex-row">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">レポート分析</h1>
          <p className="text-xs text-slate-500 mt-1">
            対象月の運用データから <strong>改善・戦略・次月アクション</strong>を AI が整理します
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            対象期間: {report ? report.label : ymLabel(selectedYm, options)}
            {selectedAccount?.name ? ` / 対象アカウント: ${selectedAccount.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <select
            value={selectedYm}
            onChange={(e) => setSelectedYm(e.target.value)}
            disabled={generating}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white disabled:opacity-50"
          >
            {options.map((o) => (
              <option key={o.ym} value={o.ym}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-sm bg-emerald-600 text-white px-4 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {generating ? '生成中…' : report ? '再生成' : 'レポートを生成'}
          </button>
          {report && (
            <button
              onClick={handlePrint}
              className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700"
            >
              PDF 保存
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 print:hidden">
          <p className="text-sm text-rose-800">{error}</p>
        </div>
      )}

      {generating && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="inline-block w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-600">{ymLabel(selectedYm, options)} の運用データを分析しています…</p>
          <p className="text-xs text-slate-400 mt-1">通常 10〜30 秒ほどかかります。</p>
        </div>
      )}

      {!generating && restoring && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      )}

      {!generating && !restoring && !report && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="text-3xl mb-3">📊</div>
          <p className="text-sm text-slate-600 font-medium">分析する月を選んで「レポートを生成」を押してください</p>
          <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
            選んだ月の配信実績・友だち推移・KPI をもとに、
            <br />
            強み・課題・来月の打ち手を AI がまとめます。
          </p>
        </div>
      )}

      {!generating && !restoring && report && a && m && (
        <>
          {/* 総合スコア + サマリー数値 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 print:break-inside-avoid">
            <div className="grid md:grid-cols-[auto_1fr] gap-6 items-center">
              <div className="text-center md:border-r md:pr-6 md:border-slate-100">
                <div className="text-[11px] text-slate-500 mb-1">今月の運用評価</div>
                <div className={`text-5xl font-bold tabular-nums ${scoreColor}`}>{a.overallScore}</div>
                <div className="text-[11px] text-slate-400 mt-1">/ 100 点</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryStat
                  label="友だち数"
                  value={m.friendsAtEnd.toLocaleString()}
                  unit="人"
                  delta={`${m.friendsAtEnd - m.friendsAtStart >= 0 ? '+' : ''}${m.friendsAtEnd - m.friendsAtStart}`}
                  good={m.friendsAtEnd - m.friendsAtStart >= 0}
                  bad={m.friendsAtEnd - m.friendsAtStart < 0}
                />
                <SummaryStat label="友だち追加" value={m.friendsAdded.toLocaleString()} unit="人" />
                <SummaryStat label="今月のブロック" value={m.friendsBlocked.toLocaleString()} unit="人" />
                <SummaryStat label="配信本数" value={m.broadcastsSent} unit="本" />
                <SummaryStat label="平均開封率" value={pct(m.broadcastOpenRate)} unit="" />
                <SummaryStat label="平均クリック率" value={pct(m.broadcastClickRate)} unit="" />
                <SummaryStat label="今月 CV" value={m.cvCount} unit="件" />
                <SummaryStat label="ホットリード" value={m.hotLeadsCount} unit="名" />
              </div>
            </div>
            {a.headline && <p className="text-sm text-slate-700 leading-relaxed mt-4 pt-4 border-t border-slate-100">{a.headline}</p>}
            <p className="text-[11px] text-slate-400 mt-3">
              生成日時:{' '}
              {new Date(report.generatedAt).toLocaleString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </section>

          {/* 強み と 課題 */}
          <div className="grid md:grid-cols-2 gap-4">
            <SectionCard title="今月の強み" badge={`${a.strengths.length} 件`} badgeTone="good">
              {a.strengths.length > 0 ? (
                <ul className="space-y-2">
                  {a.strengths.map((s, i) => (
                    <StrengthItem key={i} item={s} />
                  ))}
                </ul>
              ) : (
                <EmptyNote text="特筆すべき強みは抽出されませんでした" />
              )}
            </SectionCard>
            <SectionCard title="今月の課題" badge={`${a.issues.length} 件`} badgeTone="warn">
              {a.issues.length > 0 ? (
                <ul className="space-y-2">
                  {a.issues.map((s, i) => (
                    <IssueItem key={i} item={s} />
                  ))}
                </ul>
              ) : (
                <EmptyNote text="大きな課題は検出されませんでした" />
              )}
            </SectionCard>
          </div>

          {/* 来月の戦略 */}
          {a.strategies.length > 0 && (
            <SectionCard title="来月の戦略 / 優先施策" badge="Priority" badgeTone="idea">
              <ol className="space-y-3">
                {a.strategies
                  .slice()
                  .sort((x, y) => x.priority - y.priority)
                  .map((s, i) => (
                    <StrategyItem key={i} item={s} />
                  ))}
              </ol>
            </SectionCard>
          )}

          {/* 来月の配信プラン */}
          {a.plan.length > 0 && (
            <SectionCard title="来月の配信プラン(草案)" badge={`${a.plan.length} 本`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                      <th className="py-2 font-medium whitespace-nowrap">週</th>
                      <th className="py-2 font-medium">テーマ</th>
                      <th className="py-2 font-medium whitespace-nowrap">タイプ</th>
                      <th className="py-2 font-medium whitespace-nowrap">対象セグメント</th>
                      <th className="py-2 font-medium whitespace-nowrap">目標</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {a.plan.map((p, i) => (
                      <tr key={i}>
                        <td className="py-2.5 text-slate-500 text-xs whitespace-nowrap">{p.week}</td>
                        <td className="py-2.5 text-slate-900 font-medium">{p.theme}</td>
                        <td className="py-2.5">
                          <TypeBadge type={p.type} />
                        </td>
                        <td className="py-2.5 text-slate-700 text-xs whitespace-nowrap">{p.segment}</td>
                        <td className="py-2.5 text-emerald-700 text-xs whitespace-nowrap font-medium">{p.goal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {/* アクションリスト */}
          {a.actions.length > 0 && (
            <SectionCard title="アクションリスト(担当・期日)" badge={`${a.actions.length} タスク`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                      <th className="py-2 font-medium whitespace-nowrap">カテゴリ</th>
                      <th className="py-2 font-medium">タスク</th>
                      <th className="py-2 font-medium whitespace-nowrap">担当</th>
                      <th className="py-2 font-medium whitespace-nowrap">期日</th>
                      <th className="py-2 font-medium whitespace-nowrap">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {a.actions.map((act, i) => (
                      <tr key={i}>
                        <td className="py-2.5 text-slate-500 text-xs whitespace-nowrap">{act.category}</td>
                        <td className="py-2.5 text-slate-900">{act.task}</td>
                        <td className="py-2.5 text-slate-700 text-xs whitespace-nowrap">{act.owner}</td>
                        <td className="py-2.5 text-slate-700 text-xs whitespace-nowrap tabular-nums">{act.due}</td>
                        <td className="py-2.5">
                          <StatusBadge status={act.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          <p className="text-[11px] text-slate-400 text-center pt-4 print:pt-2">
            L-port レポート分析 © {new Date().getFullYear()}
          </p>
        </>
      )}
    </div>
  )
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 py-6 text-center">{text}</p>
}

function SummaryStat({
  label,
  value,
  unit,
  delta,
  good,
  bad,
}: {
  label: string
  value: string | number
  unit: string
  delta?: string
  good?: boolean
  bad?: boolean
}) {
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-lg px-3 py-2.5">
      <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="font-bold text-slate-900 tabular-nums text-lg">{value}</span>
        {unit && <span className="text-[10px] text-slate-500">{unit}</span>}
      </div>
      {delta && (
        <div className={`text-[10px] mt-0.5 ${good ? 'text-emerald-600' : bad ? 'text-rose-600' : 'text-slate-500'}`}>
          {good ? '▲' : bad ? '▼' : '・'} {delta}
        </div>
      )}
    </div>
  )
}

function SectionCard({
  title,
  badge,
  badgeTone,
  children,
}: {
  title: string
  badge?: string
  badgeTone?: 'good' | 'warn' | 'idea'
  children: React.ReactNode
}) {
  const toneClass: Record<NonNullable<typeof badgeTone>, string> = {
    good: 'bg-emerald-100 text-emerald-700',
    warn: 'bg-amber-100 text-amber-700',
    idea: 'bg-blue-100 text-blue-700',
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 print:break-inside-avoid">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</h3>
        {badge && (
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              badgeTone ? toneClass[badgeTone] : 'bg-slate-100 text-slate-600'
            }`}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function StrengthItem({ item }: { item: Strength }) {
  return (
    <li className="flex gap-3 items-start bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
      <span className="text-sm font-bold leading-5 text-emerald-700">◎</span>
      <div className="flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] text-slate-900 font-semibold">{item.title}</p>
          {item.metric && (
            <span className="text-[10px] text-emerald-700 font-semibold tabular-nums whitespace-nowrap">
              {item.metric}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{item.detail}</p>
      </div>
    </li>
  )
}

function IssueItem({ item }: { item: Issue }) {
  const sev: Record<Severity, { bg: string; border: string; label: string; tag: string }> = {
    high: { bg: 'bg-rose-50', border: 'border-rose-200', label: 'text-rose-700', tag: '高' },
    medium: { bg: 'bg-amber-50', border: 'border-amber-200', label: 'text-amber-700', tag: '中' },
    low: { bg: 'bg-slate-50', border: 'border-slate-200', label: 'text-slate-600', tag: '低' },
  }
  const s = sev[item.severity] ?? sev.medium
  return (
    <li className={`flex gap-3 items-start ${s.bg} ${s.border} border rounded-lg px-3 py-2.5`}>
      <span className={`text-[10px] font-bold leading-5 ${s.label} bg-white rounded px-1.5 py-0.5`}>{s.tag}</span>
      <div className="flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] text-slate-900 font-semibold">{item.title}</p>
          {item.metric && (
            <span className={`text-[10px] font-semibold tabular-nums whitespace-nowrap ${s.label}`}>{item.metric}</span>
          )}
        </div>
        <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{item.detail}</p>
      </div>
    </li>
  )
}

function StrategyItem({ item }: { item: Strategy }) {
  return (
    <li className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
      <div className="flex items-baseline gap-3">
        <span className="text-lg font-bold text-blue-700 tabular-nums">#{item.priority}</span>
        <p className="text-sm font-semibold text-slate-900 leading-snug">{item.title}</p>
      </div>
      <div className="mt-2 grid md:grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1">なぜ</p>
          <p className="text-xs text-slate-700 leading-relaxed">{item.why}</p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1">どうやる</p>
          <ul className="text-xs text-slate-700 leading-relaxed list-disc list-inside space-y-0.5">
            {item.how.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-blue-100">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">期待効果</p>
        <p className="text-xs text-blue-700 font-semibold">{item.expected}</p>
      </div>
    </li>
  )
}

function TypeBadge({ type }: { type: string }) {
  const color: Record<string, string> = {
    クーポン: 'bg-rose-100 text-rose-700',
    キャンペーン: 'bg-amber-100 text-amber-700',
    予約案内: 'bg-blue-100 text-blue-700',
    通常投稿: 'bg-slate-100 text-slate-600',
    お役立ち: 'bg-emerald-100 text-emerald-700',
    アンケート: 'bg-violet-100 text-violet-700',
  }
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full ${color[type] ?? 'bg-slate-100 text-slate-600'}`}>
      {type}
    </span>
  )
}

function StatusBadge({ status }: { status: 'todo' | 'doing' }) {
  if (status === 'doing') {
    return <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">対応中</span>
  }
  return <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">未着手</span>
}

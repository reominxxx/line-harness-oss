'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AgentJob } from '@/lib/ai-api'

export default function ClientReportsPage() {
  const { selectedAccountId } = useAccount()
  const [reports, setReports] = useState<AgentJob[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await aiApi.agentJobs.list(accountId, { status: 'completed', limit: 50 })
      setReports(
        res.jobs.filter((j) => j.job_type === 'generate_monthly_report' || j.job_type === 'generate_weekly_report'),
      )
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const parseReport = (job: AgentJob): { title: string; markdown: string; url?: string } | null => {
    if (!job.output_json) return null
    try {
      const parsed = JSON.parse(job.output_json) as {
        title?: string
        reportMarkdown?: string
        content?: string
        reportUrl?: string
      }
      return {
        title: parsed.title ?? '月次レポート',
        markdown: parsed.reportMarkdown ?? parsed.content ?? '',
        url: parsed.reportUrl,
      }
    } catch {
      return null
    }
  }

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">レポート</h1>
        <p className="text-sm text-slate-500 mt-1">
          AI が自動生成した月次・週次のレポートを確認できます
        </p>
      </section>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center">
          <div className="text-5xl mb-3">📊</div>
          <p className="text-base font-medium text-slate-700 mb-1">まだレポートがありません</p>
          <p className="text-sm text-slate-500">月初に最初のレポートをお届けします</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((job) => {
            const report = parseReport(job)
            const isExpanded = expanded === job.id
            const isMonthly = job.job_type === 'generate_monthly_report'
            return (
              <div key={job.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center shrink-0">
                      {isMonthly ? '📊' : '📈'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-medium">
                          {isMonthly ? '月次' : '週次'}
                        </span>
                        <span className="font-semibold text-sm text-slate-900 truncate">
                          {report?.title ?? 'レポート'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {new Date(job.completed_at ?? job.created_at).toLocaleString('ja-JP', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}/reports/render/${accountId}/${job.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs border border-slate-300 text-slate-700 px-3 py-1.5 rounded-md hover:bg-slate-50"
                      title="新しいタブで開きます。印刷から「PDF として保存」が可能です。"
                    >
                      📄 PDF 用に表示
                    </a>
                    <button
                      onClick={() => setExpanded(isExpanded ? null : job.id)}
                      className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700"
                    >
                      {isExpanded ? '閉じる' : '読む'}
                    </button>
                  </div>
                </div>
                {isExpanded && report && (
                  <div className="px-6 py-5 border-t border-slate-100 bg-slate-50">
                    <article className="prose prose-sm max-w-none text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {report.markdown}
                    </article>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <p className="text-xs text-emerald-900 leading-relaxed">
          <strong>💡 レポートの読み方：</strong> 数値の良し悪しだけでなく、「次月どうすべきか」の提案も含まれています。
          気になる点があれば、いつでも担当者まで LINE でお気軽にご相談ください。
        </p>
      </div>
    </div>
  )
}

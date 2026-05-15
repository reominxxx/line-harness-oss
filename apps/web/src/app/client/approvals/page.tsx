'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AgentJob } from '@/lib/ai-api'

const JOB_LABEL: Record<string, string> = {
  generate_broadcast: '配信案',
  generate_monthly_report: '月次レポート',
  generate_weekly_report: '週次レポート',
  wake_dormant: '休眠顧客への配信',
  wake_warm_leads: '見込み客への一押し',
  create_scenario: '新シナリオ提案',
  request_reviews: 'レビュー依頼配信',
  generate_acquisition_campaign: '集客キャンペーン',
  optimize_booking_promotion: '予約促進案',
  birthday_greeting: 'お誕生日メッセージ',
}

export default function ClientApprovalsPage() {
  const { selectedAccountId } = useAccount()
  const [jobs, setJobs] = useState<AgentJob[]>([])
  const [loading, setLoading] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await aiApi.agentJobs.list(accountId, { status: 'review', limit: 50 })
      setJobs(res.jobs)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const handleApprove = async (id: string) => {
    if (!accountId) return
    setActioning(id)
    try {
      await aiApi.agentJobs.approve(accountId, id)
      setToast({ kind: 'success', text: '承認しました。配信を予約します。' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '承認失敗' })
    } finally {
      setActioning(null)
    }
  }

  const handleReject = async (id: string) => {
    if (!accountId) return
    if (!confirm('却下します。よろしいですか？')) return
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

  const renderContent = (job: AgentJob) => {
    if (!job.output_json) return <p className="text-xs text-slate-400">内容なし</p>
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(job.output_json)
    } catch {
      return <pre className="text-xs whitespace-pre-wrap text-slate-700">{job.output_json}</pre>
    }
    if ('messages' in parsed && Array.isArray(parsed.messages)) {
      const messages = parsed.messages as Array<{ display_name?: string; message?: string }>
      return (
        <div className="space-y-2.5">
          <p className="text-xs text-slate-500 mb-2">送信対象 {messages.length} 名へ、それぞれ個別に文面を生成</p>
          {messages.slice(0, 4).map((m, i) => (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
                {m.display_name ?? `お客様 #${i + 1}`}
              </div>
              <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{m.message}</div>
            </div>
          ))}
          {messages.length > 4 && (
            <p className="text-xs text-slate-400 text-center pt-2">他 {messages.length - 4} 件…</p>
          )}
        </div>
      )
    }
    if ('content' in parsed) {
      return (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          {'title' in parsed && (
            <div className="font-semibold text-sm text-slate-900 mb-2">{parsed.title as string}</div>
          )}
          <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
            {parsed.content as string}
          </div>
        </div>
      )
    }
    return (
      <pre className="text-xs whitespace-pre-wrap bg-slate-50 border border-slate-200 p-3 rounded-lg max-h-60 overflow-auto text-slate-700">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    )
  }

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-2.5 rounded-lg shadow-lg text-white text-sm ${
          toast.kind === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
        }`}>{toast.text}</div>
      )}

      <section>
        <h1 className="text-2xl font-bold tracking-tight">承認待ち</h1>
        <p className="text-sm text-slate-500 mt-1">
          AI が作成したコンテンツの最終確認をお願いします
        </p>
      </section>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center">
          <div className="text-5xl mb-3">🎉</div>
          <p className="text-base font-medium text-slate-700 mb-1">すべて確認済みです</p>
          <p className="text-sm text-slate-500">新しい承認待ちはありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isExpanded = expanded === job.id
            return (
              <div key={job.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                        確認待ち
                      </span>
                      <span className="text-sm font-semibold text-slate-900">
                        {JOB_LABEL[job.job_type] ?? job.job_type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {new Date(job.completed_at ?? job.created_at).toLocaleString('ja-JP')}
                    </p>
                  </div>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : job.id)}
                    className="text-xs text-slate-600 hover:text-slate-900 shrink-0"
                  >
                    {isExpanded ? '閉じる' : '内容を見る'}
                  </button>
                </div>
                {isExpanded && (
                  <>
                    <div className="px-5 py-4 border-t border-slate-100">{renderContent(job)}</div>
                    <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                      <button
                        onClick={() => handleReject(job.id)}
                        disabled={actioning === job.id}
                        className="text-sm border border-slate-300 text-slate-700 px-4 py-2 rounded-md hover:bg-white disabled:opacity-50"
                      >
                        却下
                      </button>
                      <button
                        onClick={() => handleApprove(job.id)}
                        disabled={actioning === job.id}
                        className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-md font-medium disabled:opacity-50"
                      >
                        {actioning === job.id ? '処理中…' : '✓ 承認して配信'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-xs text-blue-900 leading-relaxed">
          <strong>💡 承認の判断基準：</strong> AI は業界に合わせた言い回しで原案を作成していますが、
          最終的にお客様に届く文章のため、必ず内容をご確認ください。修正が必要な場合は、
          一度却下していただき、担当者まで「こう変更してほしい」とご連絡ください。
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AgentJob } from '@/lib/ai-api'

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
  const [broadcastTarget, setBroadcastTarget] = useState<number>(0)
  const [broadcastDoneThisMonth, setBroadcastDoneThisMonth] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [editingJob, setEditingJob] = useState<{
    id: string
    title: string
    content: string
    recommendedSendTime: string
    imageUrl: string
    flexContent: string
  } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const accountId = selectedAccountId
  const yearMonth = new Date().toISOString().slice(0, 7)
  const [notifyTarget, setNotifyTarget] = useState('')
  const [savingNotify, setSavingNotify] = useState(false)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [reviewRes, completedRes, pendingRes, policyRes] = await Promise.all([
        aiApi.agentJobs.list(accountId, { status: 'review', limit: 50 }),
        aiApi.agentJobs.list(accountId, { status: 'completed', limit: 50 }),
        aiApi.agentJobs.list(accountId, { status: 'pending', limit: 30 }),
        aiApi.automationPolicy.get(accountId).catch(() => ({ policy: null })),
      ])
      setReviewJobs(reviewRes.jobs)
      setCompletedToday(
        completedRes.jobs.filter((j) =>
          j.completed_at?.startsWith(new Date().toISOString().slice(0, 10)),
        ),
      )
      setPendingJobs(pendingRes.jobs)
      const policy = policyRes.policy as Record<string, unknown> | null
      setBroadcastTarget(typeof policy?.monthly_broadcast_count === 'number' ? policy.monthly_broadcast_count : 0)
      setNotifyTarget(typeof policy?.notification_target === 'string' ? policy.notification_target : '')
      // 今月の配信完了数 = completed の generate_broadcast 件数（今月のみ）
      const ym = yearMonth
      const doneCount = completedRes.jobs.filter((j) =>
        j.job_type === 'generate_broadcast' && (j.completed_at ?? '').startsWith(ym),
      ).length
      setBroadcastDoneThisMonth(doneCount)
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

  const handleCancel = async (id: string) => {
    if (!accountId) return
    if (!confirm('この待機中ジョブをキャンセルします。よろしいですか？')) return
    setActioning(id)
    try {
      await aiApi.agentJobs.cancel(accountId, id)
      setToast({ kind: 'success', text: 'キャンセルしました' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : 'キャンセル失敗' })
    } finally {
      setActioning(null)
    }
  }

  const handleStartEdit = (job: AgentJob) => {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(job.output_json ?? '{}')
    } catch {
      parsed = {}
    }
    if ('messages' in parsed && Array.isArray(parsed.messages)) {
      setToast({ kind: 'error', text: '個別メッセージ一括の編集は未対応です（却下→再生成をご利用ください）' })
      return
    }
    setEditingJob({
      id: job.id,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      content: typeof parsed.content === 'string' ? parsed.content : (typeof parsed.reportMarkdown === 'string' ? parsed.reportMarkdown : ''),
      recommendedSendTime: typeof parsed.recommendedSendTime === 'string' ? parsed.recommendedSendTime : '',
      imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : '',
      flexContent: typeof parsed.flexContent === 'string' ? parsed.flexContent : '',
    })
  }

  const buildSimpleFlexFromCurrent = () => {
    if (!editingJob) return
    const flex = {
      type: 'bubble',
      ...(editingJob.imageUrl
        ? {
            hero: {
              type: 'image',
              url: editingJob.imageUrl,
              size: 'full',
              aspectRatio: '1:1',
              aspectMode: 'cover',
            },
          }
        : {}),
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: editingJob.content || ' ',
            wrap: true,
            size: 'sm',
          },
        ],
      },
    }
    setEditingJob({ ...editingJob, flexContent: JSON.stringify(flex, null, 2) })
  }

  const handleApproveEdited = async () => {
    if (!accountId || !editingJob) return
    setSavingEdit(true)
    try {
      const overrides: Record<string, unknown> = {
        title: editingJob.title,
        content: editingJob.content,
      }
      if (editingJob.recommendedSendTime) overrides.recommendedSendTime = editingJob.recommendedSendTime
      if (editingJob.imageUrl) overrides.imageUrl = editingJob.imageUrl
      if (editingJob.flexContent && editingJob.flexContent.trim().length > 0) {
        // JSON 妥当性チェック
        try {
          JSON.parse(editingJob.flexContent)
          overrides.flexContent = editingJob.flexContent
        } catch {
          setToast({ kind: 'error', text: 'Flex JSON が不正です' })
          return
        }
      }
      const res = await aiApi.agentJobs.approve(accountId, editingJob.id, undefined, overrides)
      const postNote = res.postAction?.notes || res.postAction?.error
      setToast({
        kind: res.postAction?.ok === false ? 'error' : 'success',
        text: postNote ? `承認しました: ${postNote}` : '承認しました',
      })
      setEditingJob(null)
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '承認失敗' })
    } finally {
      setSavingEdit(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!accountId || !editingJob) return
    setSavingEdit(true)
    try {
      // 元の output_json を保持しつつ title/content を上書き
      const job = reviewJobs.find((j) => j.id === editingJob.id)
      let original: Record<string, unknown> = {}
      try {
        original = JSON.parse(job?.output_json ?? '{}')
      } catch {
        original = {}
      }
      const merged = {
        ...original,
        title: editingJob.title,
        content: editingJob.content,
      }
      await aiApi.agentJobs.updateOutput(accountId, editingJob.id, merged)
      setToast({ kind: 'success', text: '編集を保存しました' })
      setEditingJob(null)
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSavingEdit(false)
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
        text: `処理結果: 取得 ${result.picked} 件 / 完了 ${result.succeeded} / 承認待ち ${result.reviewQueued} / 失敗 ${result.failed} / スキップ ${result.skipped}`,
      })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '実行に失敗しました' })
    } finally {
      setRunning(false)
    }
  }

  const prettyJson = (json: string | null | undefined): string => {
    if (!json) return ''
    try {
      return JSON.stringify(JSON.parse(json), null, 2)
    } catch {
      return json
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
      const imageUrl = typeof parsed.imageUrl === 'string' ? parsed.imageUrl : null
      const flexContent = typeof parsed.flexContent === 'string' ? parsed.flexContent : null
      const recommendedSendTime = typeof parsed.recommendedSendTime === 'string' ? parsed.recommendedSendTime : null
      const recommendedSendReason = typeof parsed.recommendedSendReason === 'string' ? parsed.recommendedSendReason : null
      const referenced = Array.isArray(parsed.referencedProducts) ? (parsed.referencedProducts as string[]) : []
      return (
        <div className="space-y-2">
          <div className="bg-gray-50 border border-gray-100 p-3 rounded">
            {'title' in parsed && (
              <div className="font-medium text-sm mb-2 text-gray-900">{parsed.title as string}</div>
            )}
            <div className="text-sm whitespace-pre-wrap text-gray-700">{parsed.content as string}</div>
          </div>
          {imageUrl && (
            <div>
              <div className="text-[11px] text-gray-500 mb-1">生成画像</div>
              <img src={imageUrl} alt="" className="max-h-48 border border-gray-200 rounded" />
            </div>
          )}
          {flexContent && (
            <div>
              <div className="text-[11px] text-gray-500 mb-1">Flex JSON</div>
              <pre className="text-[10px] whitespace-pre-wrap bg-gray-900 text-gray-100 p-2 rounded max-h-40 overflow-auto">
                {flexContent.slice(0, 1500)}
                {flexContent.length > 1500 && '\n... (省略)'}
              </pre>
            </div>
          )}
          {(recommendedSendTime || referenced.length > 0) && (
            <div className="text-[11px] text-gray-500 space-y-0.5">
              {recommendedSendTime && (
                <div>
                  📅 推奨送信: {new Date(recommendedSendTime).toLocaleString('ja-JP')}
                  {recommendedSendReason && <span className="ml-1 text-gray-400">({recommendedSendReason})</span>}
                </div>
              )}
              {referenced.length > 0 && <div>🛍 参照商品: {referenced.join(' / ')}</div>}
            </div>
          )}
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
    // リッチメニュー系: { menuName, audience, tiles: [{position, label, action, payload, rationale}, ...] }
    if ('menuName' in parsed && 'tiles' in parsed && Array.isArray(parsed.tiles)) {
      const tiles = parsed.tiles as Array<{
        position?: string
        label?: string
        action?: string
        payload?: string
        rationale?: string
      }>
      return (
        <div className="space-y-2">
          <div className="bg-gray-50 border border-gray-100 p-3 rounded">
            <div className="font-medium text-sm text-gray-900">{String(parsed.menuName)}</div>
            {typeof parsed.audience === 'string' && (
              <div className="text-[11px] text-gray-500 mt-0.5">対象: {parsed.audience}</div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {tiles.map((t, i) => (
              <div key={i} className="bg-white border border-gray-200 p-2.5 rounded text-xs">
                <div className="flex items-center gap-2 mb-1">
                  {t.position && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{t.position}</span>}
                  {t.action && <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{t.action}</span>}
                </div>
                {t.label && <div className="text-sm font-medium text-gray-900">{t.label}</div>}
                {t.payload && <div className="text-[11px] text-gray-500 mt-0.5">送信: {t.payload}</div>}
                {t.rationale && <div className="text-[11px] text-gray-600 mt-1 leading-relaxed">{t.rationale}</div>}
              </div>
            ))}
          </div>
        </div>
      )
    }
    // シナリオ系: { name, description, steps: [{stepIndex, name, delayMinutes, messageContent}, ...] }
    if ('steps' in parsed && Array.isArray(parsed.steps)) {
      const steps = parsed.steps as Array<{
        stepIndex?: number
        name?: string
        delayMinutes?: number
        messageContent?: string
      }>
      return (
        <div className="space-y-2">
          <div className="bg-gray-50 border border-gray-100 p-3 rounded">
            {typeof parsed.name === 'string' && (
              <div className="font-medium text-sm text-gray-900">{parsed.name}</div>
            )}
            {typeof parsed.description === 'string' && (
              <div className="text-[11px] text-gray-500 mt-0.5">{parsed.description}</div>
            )}
          </div>
          <ol className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="bg-white border border-gray-200 p-2.5 rounded text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                    Step {s.stepIndex ?? i + 1}
                  </span>
                  {typeof s.delayMinutes === 'number' && (
                    <span className="text-[10px] text-gray-400">{s.delayMinutes} 分後</span>
                  )}
                </div>
                {s.name && <div className="text-sm font-medium text-gray-900">{s.name}</div>}
                {s.messageContent && (
                  <div className="text-[11px] text-gray-600 mt-1 whitespace-pre-wrap leading-relaxed">
                    {s.messageContent.slice(0, 300)}
                    {s.messageContent.length > 300 && '...'}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )
    }
    // 不明な構造: トップレベルの主要フィールドだけ抜き出して表示
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
                className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm hover:bg-emerald-700 disabled:bg-gray-300 font-medium"
                title="待機中・承認済みのジョブを今すぐ処理します"
              >{running ? '実行中…' : '▶ 実行する'}</button>
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

          {/* 今月の配信進捗 */}
          <section className="bg-white border border-gray-200 rounded-md p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">今月の配信進捗</h2>
            </div>
            {broadcastTarget > 0 ? (
              <>
                <div className="flex justify-between items-baseline text-sm mb-2">
                  <span className="font-medium text-gray-700 text-xs">配信本数</span>
                  <span className="text-gray-500 text-xs tabular-nums">
                    <span className="text-gray-900 font-medium text-base">{broadcastDoneThisMonth}</span> / {broadcastTarget} 本
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gray-900 transition-all"
                    style={{ width: `${Math.min((broadcastDoneThisMonth / broadcastTarget) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  営業時に決めた月の配信本数です。変更は <a href="/kpi" className="underline">自動化設定</a> から。
                  ※ 現在 AI による配信案の自動生成は停止中です。<a href="/broadcasts" className="underline">一斉配信</a> から手動で作成してください。
                </p>
              </>
            ) : (
              <div className="text-center py-3">
                <p className="text-sm text-gray-700 mb-2">配信本数がまだ設定されていません</p>
                <p className="text-xs text-gray-400 mb-3">自動化設定から月の配信本数を設定できます。配信は <a href="/broadcasts" className="underline">一斉配信</a> から手動で作成してください</p>
                <a
                  href="/kpi"
                  className="inline-block text-xs bg-gray-900 hover:bg-gray-700 text-white px-4 py-2 rounded"
                >
                  自動化設定を開く →
                </a>
              </div>
            )}
          </section>

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
                  const isEditing = editingJob?.id === job.id
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
                            onClick={() => {
                              // 編集中なら編集状態もリセット
                              if (isEditing) setEditingJob(null)
                              setExpandedJobId(isExpanded ? null : job.id)
                            }}
                            className="text-xs text-gray-700 hover:text-gray-900"
                          >{isExpanded ? '閉じる' : '中身を見る'}</button>
                          {!isEditing && (
                            <button
                              onClick={() => {
                                handleStartEdit(job)
                                setExpandedJobId(job.id)
                              }}
                              disabled={actioning === job.id}
                              className="text-xs border border-gray-300 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
                            >編集</button>
                          )}
                          <button
                            onClick={() => handleReject(job.id)}
                            disabled={actioning === job.id || isEditing}
                            className="text-xs border border-gray-300 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
                          >却下</button>
                          <button
                            onClick={() => handleApprove(job.id)}
                            disabled={actioning === job.id || isEditing}
                            className="text-xs bg-gray-900 text-white px-3 py-1 rounded hover:bg-gray-700 disabled:opacity-50"
                          >{actioning === job.id ? '…' : '承認'}</button>
                        </div>
                      </div>
                      {isEditing && editingJob && (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                          <div>
                            <label className="text-[11px] text-gray-500 block mb-1">タイトル</label>
                            <input
                              type="text"
                              value={editingJob.title}
                              onChange={(e) => setEditingJob({ ...editingJob, title: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                              placeholder="配信タイトル（任意）"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-gray-500 block mb-1">本文</label>
                            <textarea
                              value={editingJob.content}
                              onChange={(e) => setEditingJob({ ...editingJob, content: e.target.value })}
                              rows={8}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-y leading-relaxed"
                              placeholder="配信本文"
                            />
                            <p className="text-[10px] text-gray-400 mt-1 text-right">{editingJob.content.length} 文字</p>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div>
                              <label className="text-[11px] text-gray-500 block mb-1">推奨送信時刻 (ISO 8601)</label>
                              <input
                                type="text"
                                value={editingJob.recommendedSendTime}
                                onChange={(e) => setEditingJob({ ...editingJob, recommendedSendTime: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                                placeholder="2026-05-20T12:00:00+09:00"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] text-gray-500 block mb-1">画像 URL (任意)</label>
                              <input
                                type="url"
                                value={editingJob.imageUrl}
                                onChange={(e) => setEditingJob({ ...editingJob, imageUrl: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                                placeholder="https://... または /api/broadcast-images/..."
                              />
                            </div>
                          </div>
                          {editingJob.imageUrl && (
                            <div>
                              <img
                                src={editingJob.imageUrl}
                                alt=""
                                className="max-h-40 border border-gray-200 rounded"
                              />
                            </div>
                          )}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] text-gray-500">Flex メッセージ JSON (任意、指定があれば優先)</label>
                              <button
                                type="button"
                                onClick={buildSimpleFlexFromCurrent}
                                className="text-[11px] font-medium px-2 py-0.5 rounded bg-violet-50 text-violet-700 hover:bg-violet-100"
                                title="本文 + 画像から簡易 Flex バブルを生成"
                              >
                                🎨 本文+画像から Flex 化
                              </button>
                            </div>
                            <textarea
                              value={editingJob.flexContent}
                              onChange={(e) => setEditingJob({ ...editingJob, flexContent: e.target.value })}
                              rows={editingJob.flexContent ? 8 : 3}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-mono resize-y"
                              placeholder='{"type":"bubble", "body": ...} (空欄なら本文/画像が使われる)'
                            />
                          </div>
                          <div className="text-[11px] text-gray-500 bg-amber-50 border border-amber-200 rounded p-2">
                            💡 優先順位: <b>Flex JSON</b> &gt; <b>画像 URL</b> &gt; <b>本文テキスト</b><br />
                            「保存して承認」を押すと、編集内容で agent_job の output が更新され、broadcasts テーブルに予約として挿入されます。
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditingJob(null)}
                              disabled={savingEdit}
                              className="text-xs border border-gray-300 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50"
                            >キャンセル</button>
                            <button
                              onClick={handleSaveEdit}
                              disabled={savingEdit}
                              className="text-xs border border-gray-300 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50"
                            >{savingEdit ? '保存中…' : '✓ 編集のみ保存'}</button>
                            <button
                              onClick={handleApproveEdited}
                              disabled={savingEdit}
                              className="text-xs bg-gray-900 hover:bg-gray-700 text-white px-4 py-1.5 rounded font-medium disabled:bg-gray-300"
                            >{savingEdit ? '処理中…' : '✓ 保存して承認 → 配信予約'}</button>
                          </div>
                        </div>
                      )}
                      {isExpanded && !isEditing && (
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
              <div className="bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
                {pendingJobs.map((job) => {
                  const isExpanded = expandedJobId === job.id
                  return (
                    <div key={job.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-900 font-medium">{getJobLabel(job.job_type)}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[job.status]}`}>{job.status}</span>
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            予定 {new Date(job.scheduled_at).toLocaleString('ja-JP')}
                            <span className="mx-1.5">·</span>起源 {job.origin}
                          </div>
                        </div>
                        <button
                          onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                          className="text-xs text-gray-700 hover:text-gray-900 px-2"
                        >{isExpanded ? '閉じる' : '中身'}</button>
                        <button
                          onClick={() => handleRun(job.id)}
                          disabled={actioning === job.id}
                          className="text-xs border border-gray-300 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
                        >{actioning === job.id ? '…' : '今すぐ実行'}</button>
                        <button
                          onClick={() => handleCancel(job.id)}
                          disabled={actioning === job.id}
                          className="text-xs border border-gray-300 text-gray-600 px-2.5 py-1 rounded hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                        >キャンセル</button>
                      </div>
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <div className="text-[11px] text-gray-500 mb-1 uppercase tracking-wide">生成指示 (input_json)</div>
                          <pre className="text-xs whitespace-pre-wrap bg-gray-50 border border-gray-100 p-3 rounded max-h-64 overflow-auto text-gray-700">
                            {prettyJson(job.input_json) || 'なし'}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                })}
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
                {completedToday.map((job) => {
                  const isExpanded = expandedJobId === job.id
                  return (
                    <div key={job.id} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-900 font-medium">{getJobLabel(job.job_type)}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[job.status]}`}>{job.status}</span>
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            {new Date(job.completed_at ?? job.created_at).toLocaleString('ja-JP')}
                            <span className="mx-1.5">·</span>
                            ¥{(job.cost_yen_x100 / 100).toFixed(2)}
                            {job.error && (
                              <span className="ml-2 text-rose-600">⚠️ {job.error.slice(0, 40)}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                          className="text-xs text-gray-700 hover:text-gray-900 px-2"
                        >{isExpanded ? '閉じる' : '詳細'}</button>
                      </div>
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                          <div>
                            <div className="text-[11px] text-gray-500 mb-1 uppercase tracking-wide">出力 (整形)</div>
                            {renderOutput(job)}
                          </div>
                          {job.input_json && (
                            <div>
                              <div className="text-[11px] text-gray-500 mb-1 uppercase tracking-wide">生成指示</div>
                              <pre className="text-xs whitespace-pre-wrap bg-gray-50 border border-gray-100 p-2 rounded max-h-32 overflow-auto text-gray-700">
                                {prettyJson(job.input_json)}
                              </pre>
                            </div>
                          )}
                          {job.error && (
                            <div>
                              <div className="text-[11px] text-rose-600 mb-1 uppercase tracking-wide">エラー</div>
                              <pre className="text-xs whitespace-pre-wrap bg-rose-50 border border-rose-100 p-2 rounded text-rose-800">
                                {job.error}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}


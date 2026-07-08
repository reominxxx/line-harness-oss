'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AgentJob } from '@/lib/ai-api'
import { StartMonthlyPlanModal } from '@/components/agent/start-monthly-plan-modal'

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
  const { selectedAccountId, accounts, loading: accountsLoading, error: accountsError, refreshAccounts } = useAccount()
  const [reviewJobs, setReviewJobs] = useState<AgentJob[]>([])
  const [completedToday, setCompletedToday] = useState<AgentJob[]>([])
  const [pendingJobs, setPendingJobs] = useState<AgentJob[]>([])
  const [broadcastTarget, setBroadcastTarget] = useState<number>(0)
  const [broadcastDoneThisMonth, setBroadcastDoneThisMonth] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [startingMonthlyPlan, setStartingMonthlyPlan] = useState(false)
  const [monthlyPlanModalOpen, setMonthlyPlanModalOpen] = useState(false)
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

  const handleOpenMonthlyPlanModal = () => {
    if (!accountId) return
    setMonthlyPlanModalOpen(true)
  }

  const handleSubmitMonthlyPlan = async (args: {
    totalCount: number
    hint: string
    referenceImageDataUrl: string | null
    imageGenCount: number
    homepageUrl?: string
  }) => {
    if (!accountId) return
    setStartingMonthlyPlan(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''

      // homepageUrl があれば worker の extract-site-text で本文を取得 → hint に統合
      let finalHint = args.hint
      if (args.homepageUrl) {
        try {
          const exRes = await fetch(`${apiUrl}/api/prompts/extract-site-text`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'X-Line-Account-Id': accountId,
            },
            body: JSON.stringify({ url: args.homepageUrl }),
          })
          const exJson = (await exRes.json()) as { success: boolean; text?: string; error?: string }
          if (!exJson.success || !exJson.text) {
            throw new Error(exJson.error ?? 'サイト読み込み失敗')
          }
          finalHint = (
            `【公式サイトから取得した事業情報】\n${exJson.text}\n\n`
            + (finalHint ? `【追加ヒント / 顧客依頼】\n${finalHint}` : '')
          ).trim()
        } catch (e) {
          throw new Error(`URL 読み込み失敗: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      const res = await fetch(`${apiUrl}/api/agent/start-monthly-plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Line-Account-Id': accountId,
        },
        body: JSON.stringify({
          totalCount: args.totalCount,
          hint: finalHint || undefined,
          referenceImageDataUrl: args.referenceImageDataUrl ?? undefined,
          imageGenCount: args.imageGenCount,
        }),
      })
      const json = (await res.json()) as { success: boolean; error?: string; note?: string }
      if (!res.ok || !json.success) throw new Error(json.error ?? '月の戦略立案に失敗しました')
      setToast({ kind: 'success', text: json.note ?? '月の戦略立案を開始しました' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '月の戦略立案に失敗しました' })
      throw e
    } finally {
      setStartingMonthlyPlan(false)
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

  // LINE トーク風のプレビュー (吹き出し + 画像 + flex バブル概観)
  const renderLinePreview = (job: AgentJob) => {
    if (!job.output_json) {
      return <div className="text-[11px] text-gray-400 italic">プレビュー対象なし</div>
    }
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(job.output_json) } catch { return null }
    const title = typeof parsed.title === 'string' ? parsed.title : null
    const content = typeof parsed.content === 'string' ? parsed.content : null
    const imageUrl = typeof parsed.imageUrl === 'string' ? parsed.imageUrl : null
    const flexContent = typeof parsed.flexContent === 'string' ? parsed.flexContent : null

    // Flex があれば bubble / carousel を簡易再現
    if (flexContent) {
      let flex: Record<string, unknown> = {}
      try { flex = JSON.parse(flexContent) } catch {/* */}
      const isCarousel = flex.type === 'carousel'
      const bubbles = isCarousel
        ? ((flex.contents as Array<Record<string, unknown>>) ?? []).slice(0, 5)
        : [flex]

      const renderBubble = (b: Record<string, unknown>, key: string | number) => {
        const body = b.body as { contents?: Array<Record<string, unknown>> } | undefined
        const hero = b.hero as { url?: string } | undefined
        const heroUrl = hero?.url || imageUrl
        const flexBodyTexts: string[] = []
        if (body?.contents) {
          for (const c of body.contents) {
            if (c.type === 'text' && typeof c.text === 'string') flexBodyTexts.push(c.text)
          }
        }
        const footer = b.footer as { contents?: Array<Record<string, unknown>> } | undefined
        const ctaLabel = footer?.contents?.find((x) => x.type === 'button')?.action as { label?: string } | undefined
        return (
          <div key={key} className="bg-white rounded-2xl overflow-hidden shadow-md shrink-0 w-[220px]">
            {heroUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroUrl} alt="" className="w-full h-28 object-cover" />
            )}
            <div className="p-3 space-y-1">
              {flexBodyTexts.map((t, i) => (
                <div key={i} className={i === 0 ? 'font-bold text-sm text-gray-900' : 'text-xs text-gray-700'}>{t}</div>
              ))}
              {flexBodyTexts.length === 0 && (
                <div className="text-[11px] text-gray-400">本文 JSON</div>
              )}
              {ctaLabel?.label && (
                <div className="mt-2 bg-[#06c755] text-white text-xs text-center rounded-md py-1.5 font-medium">
                  {ctaLabel.label}
                </div>
              )}
            </div>
          </div>
        )
      }

      return (
        <div className="bg-[#7DA6CE] rounded-lg p-3 space-y-2 max-w-[260px]">
          <div className="text-[10px] text-white/80">
            LINE プレビュー ({isCarousel ? `Flex Carousel ×${bubbles.length}` : 'Flex'})
          </div>
          {isCarousel ? (
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
              {bubbles.map((b, i) => renderBubble(b, i))}
            </div>
          ) : (
            renderBubble(flex, 'single')
          )}
        </div>
      )
    }

    // テキスト + 画像なら吹き出し風
    return (
      <div className="bg-[#7DA6CE] rounded-lg p-3 space-y-2 max-w-[260px]">
        <div className="text-[10px] text-white/80">LINE プレビュー</div>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="w-full rounded-2xl shadow-md max-h-48 object-cover" />
        )}
        {(title || content) && (
          <div className="bg-white rounded-2xl p-3 shadow-md text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
            {title && <div className="font-bold mb-1">{title}</div>}
            {content}
          </div>
        )}
      </div>
    )
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
    let body: ReactNode
    if (accountsLoading) {
      body = (
        <div className="text-center text-sm text-gray-500 flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
          アカウント情報を読み込み中…
        </div>
      )
    } else if (accountsError) {
      body = (
        <div className="text-center space-y-3">
          <div className="text-sm text-rose-700">アカウント取得に失敗しました</div>
          <div className="text-[11px] text-gray-400">{accountsError}</div>
          <button
            type="button"
            onClick={() => { void refreshAccounts() }}
            className="px-4 py-1.5 text-sm bg-slate-900 text-white rounded hover:bg-slate-700"
          >🔄 再試行</button>
        </div>
      )
    } else if (accounts.length === 0) {
      body = (
        <div className="text-center space-y-2">
          <div className="text-sm text-gray-600">LINE アカウントが登録されていません</div>
          <div className="text-[11px] text-gray-400">先にアカウント設定でアカウントを追加してください</div>
        </div>
      )
    } else {
      body = <div className="text-center text-sm text-gray-500">サイドバーでアカウントを選択してください</div>
    }
    return (
      <div className="flex-1 flex flex-col">
        <Header title="自動化ダッシュボード" />
        <main className="flex-1 flex items-center justify-center bg-gray-50 p-4">
          {body}
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
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleOpenMonthlyPlanModal}
                disabled={startingMonthlyPlan || running}
                className="bg-violet-600 text-white px-4 py-1.5 rounded text-sm hover:bg-violet-700 disabled:bg-gray-300 font-medium"
                title="月の AI 配信案 8 本を一括で立て、承認待ちキューに並べます (文章のみ / 文章+画像 は AI が判断)"
              >{startingMonthlyPlan ? '立案中…' : '✨ 月の AI 配信案を立てる'}</button>
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
                  上の <strong className="text-violet-700">「✨ 月の AI 配信案を立てる」</strong> ボタンで AI が一括生成 → 「承認待ち」に並びます。
                </p>
              </>
            ) : (
              <div className="text-center py-3">
                <p className="text-sm text-gray-700 mb-2">配信本数がまだ設定されていません</p>
                <p className="text-xs text-gray-400 mb-3">先に <a href="/kpi" className="underline">自動化設定</a> で月の配信本数を決めてから、上の <strong className="text-violet-700">「✨ 月の AI 配信案を立てる」</strong> ボタンを押してください。</p>
              </div>
            )}
          </section>

          {/* 承認待ち (AI 生成済み配信案、ユーザー承認待ち) */}
          <section className="mb-6">
            <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              ✅ 承認待ち ({reviewJobs.length}) — AI が生成した配信案。承認すると配信予約に入ります
            </h2>
            {reviewJobs.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-md p-6 text-center text-sm text-gray-400">
                承認待ちはありません
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
                {reviewJobs.map((job) => {
                  // 「中身を見る」を押さなくても最初からプレビューが見える
                  const isExpanded = expandedJobId === null ? true : expandedJobId === job.id
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
                        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>{renderOutput(job)}</div>
                          <div>{renderLinePreview(job)}</div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 配信プレビュー (待機中) */}
          {pendingJobs.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                📋 配信プレビュー ({pendingJobs.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pendingJobs.map((job) => {
                  let input: Record<string, unknown> = {}
                  try { if (job.input_json) input = JSON.parse(job.input_json) } catch {/* */}
                  const slot = typeof input.slot === 'number' ? input.slot : undefined
                  const ofTotal = typeof input.ofTotal === 'number' ? input.ofTotal : undefined
                  const topic = typeof input.topic === 'string' ? input.topic : null
                  const broadcastType = typeof input.broadcastType === 'string' ? input.broadcastType : null
                  const targetSegment = typeof input.targetSegment === 'string' ? input.targetSegment : null
                  const monthTheme = typeof input.monthTheme === 'string' ? input.monthTheme : null
                  const plannerRationale = typeof input.plannerRationale === 'string' ? input.plannerRationale : null
                  const plannedSendAt = typeof input.plannedSendAt === 'string' ? input.plannedSendAt : null
                  const forceImageGen = input.forceImageGen === true
                  const sendAtLabel = plannedSendAt
                    ? new Date(plannedSendAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : new Date(job.scheduled_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

                  return (
                    <div key={job.id} className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-2 relative">
                      {/* slot バッジ + キャンセル */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {slot !== undefined && (
                            <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                              {slot}/{ofTotal ?? '?'} 本目
                            </span>
                          )}
                          {broadcastType && (
                            <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-100 px-1.5 py-0.5 rounded">{broadcastType}</span>
                          )}
                          {forceImageGen && (
                            <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded">📷 画像あり</span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[job.status]}`}>{job.status}</span>
                        </div>
                        <button
                          onClick={() => handleCancel(job.id)}
                          disabled={actioning === job.id}
                          className="text-[10px] text-gray-400 hover:text-rose-600 disabled:opacity-50 shrink-0"
                          title="この配信案を取り消す"
                        >✕ 削除</button>
                      </div>

                      {/* topic */}
                      <div className="text-sm font-semibold text-gray-900 leading-snug">
                        {topic ?? getJobLabel(job.job_type)}
                      </div>

                      {/* 送信予定 + segment */}
                      <div className="text-[11px] text-gray-500 space-y-0.5">
                        <div>📅 {sendAtLabel}</div>
                        {targetSegment && <div>🎯 {targetSegment}</div>}
                        {monthTheme && <div className="text-gray-400 italic">月テーマ: {monthTheme}</div>}
                      </div>

                      {/* AI の意図 */}
                      {plannerRationale && (
                        <div className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded p-2 leading-relaxed mt-1">
                          {plannerRationale}
                        </div>
                      )}

                      {/* generate がまだの場合のフォールバック */}
                      {!topic && !plannerRationale && (
                        <pre className="text-[10px] whitespace-pre-wrap bg-gray-50 border border-gray-100 p-2 rounded max-h-32 overflow-auto text-gray-500">
                          {prettyJson(job.input_json) || 'なし'}
                        </pre>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* 本日の自動実行 (非表示。内部ロジックは温存) */}
          {false && (
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
          )}
        </div>
      </main>
      <StartMonthlyPlanModal
        open={monthlyPlanModalOpen}
        onClose={() => setMonthlyPlanModalOpen(false)}
        totalCount={broadcastTarget > 0 ? broadcastTarget : 4}
        onSubmit={handleSubmitMonthlyPlan}
      />
    </div>
  )
}


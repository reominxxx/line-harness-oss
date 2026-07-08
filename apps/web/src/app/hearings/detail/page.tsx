'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import BroadcastDesignPreview from '@/components/hearings/broadcast-design-preview'

type Hearing = {
  id: string
  title: string
  status: 'draft' | 'pending' | 'generating' | 'ready' | 'error'
  ai_cost_yen_x100: number
  error_message: string | null
  created_at: string
  updated_at: string
}

type Blueprint = {
  generated_at: string
  version: number
  summary: string
  monthly_broadcast_count: number
  business_profile: {
    industry: string
    business_type: string
    staff_count: string | null
    hours: string | null
    location: string | null
    customer_segment: string | null
    avg_unit_price: string | null
    monthly_visits: string | null
    repeat_rate: string | null
    current_friends: string | null
    source_tool: string | null
  }
  pain_points: Array<{ priority: number; description: string; evidence: string | null; impact: string }>
  goals: Array<{ kpi: string; current_value: string | null; target_value: string; deadline: string }>
  feature_decisions: Array<{ feature_key: string; feature_label: string; decision: 'adopt' | 'hold' | 'reject'; reason: string; phase: string | null }>
  central_strategy: string
  coupon_plan: Array<{ name: string; type: string; description: string; trigger: string }>
  scenario_steps: Array<{ trigger: string; action: string; message_outline: string | null }>
  segments: Array<{ category: string; tags: string[]; assignment_method: string }>
  broadcast_calendar: Array<{ week: number; content: string; target: string; purpose: string }>
  broadcast_designs: Array<{
    index: number
    send_week: number
    send_day_hint: string
    message_type: string
    title: string
    goal: string
    target_segment: string
    hook: string
    body_outline: string
    cta: string
    uses_feature: string[]
    expected_kpi: string
    notes: string | null
  }>
  rich_menu_layout: string | null
  action_items: Array<{ when: string; task: string; feature_dependency: string | null }>
  risks: Array<{ category: string; description: string; mitigation: string | null }>
  budget_estimate: {
    monthly_yen: number
    breakdown: Array<{ item: string; yen_per_month: number }>
    fits_user_budget: boolean | null
  } | null
  roadmap: Array<{ phase: string; label: string; tasks: string[] }>
}

function HearingDetailContent() {
  const params = useSearchParams()
  const id = params?.get('id') ?? null
  const { selectedAccountId } = useAccount()
  const [hearing, setHearing] = useState<Hearing | null>(null)
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id || !selectedAccountId) return
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; hearing: Hearing; blueprint: Blueprint | null }>(
        `/api/hearings/${id}`,
        { headers: { 'X-Line-Account-Id': selectedAccountId } },
      )
      if (res.success) {
        setHearing(res.hearing)
        setBlueprint(res.blueprint)
      }
    } catch {/* silent */}
    setLoading(false)
  }, [id, selectedAccountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (hearing?.status !== 'generating' && hearing?.status !== 'pending') return
    const t = setInterval(() => { void load() }, 4_000)
    return () => clearInterval(t)
  }, [hearing?.status, load])

  // タイムアウト検知: 5 分以上 (pending/generating) のままなら警告
  const stuck = (hearing?.status === 'generating' || hearing?.status === 'pending')
    && Date.now() - new Date(hearing.updated_at).getTime() > 300_000

  const [regenN, setRegenN] = useState(4)
  const [regenning, setRegenning] = useState(false)
  const regenerate = async () => {
    if (!id || !selectedAccountId || regenning) return
    setRegenning(true)
    try {
      await fetchApi<{ success: boolean }>(`/api/hearings/${id}/generate`, {
        method: 'POST',
        headers: { 'X-Line-Account-Id': selectedAccountId },
        body: JSON.stringify({ monthly_broadcast_count: regenN }),
      })
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setRegenning(false)
    }
  }

  if (!id) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header title="設計書" />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <p className="text-sm text-slate-500">ID が指定されていません</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header title="設計書" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <Link href="/hearings" className="text-xs text-slate-500 hover:text-slate-900">← 一覧に戻る</Link>
          {hearing && (
            <span className="text-xs text-slate-400 tabular-nums">
              AI コスト ¥{(hearing.ai_cost_yen_x100 / 100).toFixed(2)}
            </span>
          )}
        </div>

        {loading && !hearing ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : !hearing ? (
          <p className="text-sm text-slate-500">設計書が見つかりません</p>
        ) : (hearing.status === 'generating' || hearing.status === 'pending') && !stuck ? (
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
            <div className="inline-block w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mb-3" />
            <p className="text-sm font-medium text-slate-900">
              {hearing.status === 'pending' ? 'cron 待機中 (最大 1 分)' : 'AI が設計中...'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {hearing.status === 'pending'
                ? '次回 cron tick で処理が開始されます (約 1 分後)。完了まで合計 1〜3 分。'
                : '通常 30〜90 秒。完了したら自動で表示されます。'}
            </p>
            {hearing.error_message?.startsWith('[進捗]') && (
              <p className="text-[11px] text-slate-400 mt-3 font-mono">
                {hearing.error_message.replace('[進捗] ', '')}
              </p>
            )}
          </div>
        ) : (hearing.status === 'error' || hearing.status === 'draft' || stuck) ? (
          <div className="space-y-3">
            {stuck && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-amber-800">
                  3 分以上「設計中」のままです。AI が応答していない可能性が高いので、もう一度生成してみてください。
                </p>
              </div>
            )}
            {hearing.status === 'error' && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-4">
                <p className="text-sm font-medium text-rose-700">生成に失敗しました</p>
                <p className="text-xs text-rose-600 mt-1 font-mono whitespace-pre-wrap">{hearing.error_message}</p>
              </div>
            )}
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-sm font-medium text-slate-900 mb-2">再生成</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">月の配信本数</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={regenN}
                  onChange={(e) => setRegenN(Math.max(1, Math.min(30, parseInt(e.target.value || '4', 10))))}
                  className="w-20 px-2 py-1 border border-slate-300 rounded-md text-sm text-center focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <span className="text-xs text-slate-500">本 / 月</span>
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={regenning}
                  className="ml-3 px-3 py-1.5 text-xs font-medium rounded-md text-white bg-slate-900 hover:bg-slate-700 disabled:opacity-50"
                >
                  {regenning ? '実行中…' : 'AI で再生成'}
                </button>
              </div>
            </div>
          </div>
        ) : !blueprint ? (
          <p className="text-sm text-slate-500">設計書がまだ生成されていません</p>
        ) : (
          <BlueprintView hearing={hearing} blueprint={blueprint} />
        )}
      </main>
    </div>
  )
}

function BlueprintView({ hearing, blueprint }: { hearing: Hearing; blueprint: Blueprint }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{hearing.title}</h1>
        <p className="text-xs text-slate-400 mt-1">
          生成: {new Date(blueprint.generated_at).toLocaleString('ja-JP')}
        </p>
      </div>

      <Section title="サマリ">
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{blueprint.summary}</p>
      </Section>

      <Section title="事業プロフィール">
        <Grid kv={[
          ['業種', blueprint.business_profile.industry],
          ['業態', blueprint.business_profile.business_type],
          ['スタッフ数', blueprint.business_profile.staff_count],
          ['営業時間', blueprint.business_profile.hours],
          ['所在地', blueprint.business_profile.location],
          ['主要客層', blueprint.business_profile.customer_segment],
          ['客単価', blueprint.business_profile.avg_unit_price],
          ['月間来店/購入', blueprint.business_profile.monthly_visits],
          ['リピート率', blueprint.business_profile.repeat_rate],
          ['LINE 友だち数', blueprint.business_profile.current_friends],
          ['既存ツール', blueprint.business_profile.source_tool],
        ]} />
      </Section>

      <Section title={`課題 (優先度順 / ${blueprint.pain_points.length} 件)`}>
        <ol className="space-y-2">
          {blueprint.pain_points.map((p) => (
            <li key={p.priority} className="flex gap-3 items-start">
              <span className="shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{p.priority}</span>
              <div className="text-sm">
                <p className="text-slate-900">{p.description}</p>
                {p.evidence && <p className="text-[11px] text-slate-400 mt-0.5">引用: {p.evidence}</p>}
                <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${p.impact === 'high' ? 'bg-rose-100 text-rose-700' : p.impact === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>影響: {p.impact}</span>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="ゴール">
        <ul className="space-y-2">
          {blueprint.goals.map((g, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium text-slate-900">{g.kpi}</span>
              <span className="ml-2 text-slate-500">{g.current_value ?? '?'} → {g.target_value}</span>
              <span className="ml-2 text-[11px] text-slate-400">({g.deadline})</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="中心施策">
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{blueprint.central_strategy}</p>
      </Section>

      <Section title="L-port 機能 採否マトリクス">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {blueprint.feature_decisions.map((f, i) => (
            <div key={i} className={`p-3 rounded border text-sm ${f.decision === 'adopt' ? 'border-emerald-200 bg-emerald-50' : f.decision === 'hold' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{f.feature_label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${f.decision === 'adopt' ? 'bg-emerald-600 text-white' : f.decision === 'hold' ? 'bg-amber-600 text-white' : 'bg-slate-400 text-white'}`}>
                  {f.decision === 'adopt' ? '採用' : f.decision === 'hold' ? '保留' : '不採用'}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{f.reason}</p>
              {f.phase && <p className="text-[10px] text-slate-400 mt-1">{f.phase}</p>}
            </div>
          ))}
        </div>
      </Section>

      {blueprint.coupon_plan.length > 0 && (
        <Section title="クーポン計画">
          <ul className="space-y-2">
            {blueprint.coupon_plan.map((c, i) => (
              <li key={i} className="text-sm bg-white border border-slate-200 rounded p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{c.name}</span>
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{c.type}</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">{c.description}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">配布: {c.trigger}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {blueprint.segments.length > 0 && (
        <Section title="セグメント設計">
          <ul className="space-y-1.5">
            {blueprint.segments.map((s, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-slate-900">{s.category}</span>
                <span className="ml-2 text-[10px] text-slate-400">付与: {s.assignment_method}</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {s.tags.map((t, j) => (
                    <span key={j} className="text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{t}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {blueprint.scenario_steps.length > 0 && (
        <Section title="シナリオ (友だち追加後)">
          <ol className="space-y-2">
            {blueprint.scenario_steps.map((s, i) => (
              <li key={i} className="text-sm border-l-2 border-slate-300 pl-3">
                <p className="text-[10px] text-slate-400">{s.trigger}</p>
                <p className="font-medium text-slate-900">{s.action}</p>
                {s.message_outline && <p className="text-xs text-slate-600 mt-0.5">{s.message_outline}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title={`配信設計 — ${blueprint.monthly_broadcast_count} 本 / 月 (1 本ごと)`}>
        <div className="space-y-3">
          {blueprint.broadcast_designs.map((b) => (
            <div key={b.index} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{b.index}</span>
                  <h3 className="font-semibold text-slate-900">{b.title}</h3>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="bg-slate-100 px-1.5 py-0.5 rounded">Week {b.send_week}</span>
                  <span className="bg-slate-100 px-1.5 py-0.5 rounded">{b.send_day_hint}</span>
                  <span className="bg-slate-900 text-white px-1.5 py-0.5 rounded">{b.message_type}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-2">
                <div><span className="text-slate-400">目的: </span>{b.goal}</div>
                <div><span className="text-slate-400">配信対象: </span>{b.target_segment}</div>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">フック</p>
                  <p className="text-slate-900">{b.hook}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">本文骨子</p>
                  <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{b.body_outline}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">CTA</p>
                  <p className="text-slate-700">{b.cta}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap gap-1">
                  {b.uses_feature.map((f, i) => (
                    <span key={i} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">{f}</span>
                  ))}
                </div>
                <span className="text-[11px] text-emerald-700">{b.expected_kpi}</span>
              </div>
              {b.notes && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">⚠ {b.notes}</p>
              )}
              {/* LINE 風プレビュー (実際に配信されたらこう見える、をその場で表示) */}
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">プレビュー ({b.message_type})</p>
                <BroadcastDesignPreview design={b} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {blueprint.rich_menu_layout && (
        <Section title="リッチメニュー (6 ボタン)">
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{blueprint.rich_menu_layout}</p>
        </Section>
      )}

      {blueprint.action_items.length > 0 && (
        <Section title="ToDo">
          <ul className="space-y-1.5">
            {blueprint.action_items.map((a, i) => (
              <li key={i} className="text-sm flex items-center gap-2">
                <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded shrink-0">
                  {a.when === 'this_week' ? '今週' : a.when === 'this_month' ? '今月' : a.when === 'next_month' ? '来月' : '将来'}
                </span>
                <span className="text-slate-900">{a.task}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {blueprint.risks.length > 0 && (
        <Section title="リスク・注意点">
          <ul className="space-y-2">
            {blueprint.risks.map((r, i) => (
              <li key={i} className="text-sm">
                <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">{r.category}</span>
                <span className="ml-2 text-slate-900">{r.description}</span>
                {r.mitigation && <p className="text-xs text-slate-500 ml-12 mt-0.5">→ {r.mitigation}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {blueprint.budget_estimate && (
        <Section title={`予算試算 ¥${blueprint.budget_estimate.monthly_yen.toLocaleString('ja-JP')}/月`}>
          <ul className="space-y-1 text-sm">
            {blueprint.budget_estimate.breakdown.map((b, i) => (
              <li key={i} className="flex justify-between border-b border-slate-100 py-1">
                <span className="text-slate-700">{b.item}</span>
                <span className="tabular-nums text-slate-600">¥{b.yen_per_month.toLocaleString('ja-JP')}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {blueprint.roadmap.length > 0 && (
        <Section title="ロードマップ">
          <ol className="space-y-3">
            {blueprint.roadmap.map((r, i) => (
              <li key={i} className="border-l-2 border-slate-300 pl-3">
                <p className="text-[10px] text-slate-400 uppercase">{r.phase}</p>
                <p className="font-medium text-slate-900 text-sm">{r.label}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {r.tasks.map((t, j) => <li key={j}>• {t}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-slate-900 mb-3 border-b border-slate-100 pb-2">{title}</h2>
      {children}
    </section>
  )
}

function Grid({ kv }: { kv: Array<[string, string | null]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
      {kv.map(([k, v]) => (
        <div key={k}>
          <dt className="text-slate-400">{k}</dt>
          <dd className="text-slate-900">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function HearingDetailPage() {
  return <HearingDetailContent />
}

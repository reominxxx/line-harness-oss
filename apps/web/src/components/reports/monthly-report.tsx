'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAccount } from '@/contexts/account-context'
import { api, type ApiBroadcast } from '@/lib/api'

interface MonthlyPoint {
  ym: string
  label: string
  broadcasts: number
}

interface BroadcastRow {
  id: string
  title: string
  type: string
  sentAt: string
  openRate: number | null
  clickRate: number | null
  sent: number
  total: number
}

interface TypeStat {
  type: string
  count: number
  avgOpen: number | null
  avgClick: number | null
}

interface ReportData {
  period: string
  ym: string
  friends: number
  monthBroadcasts: number
  avgOpenRate: number | null
  avgClickRate: number | null
  hasInsights: boolean
  monthly: MonthlyPoint[]
  topBroadcasts: BroadcastRow[]
  typeStats: TypeStat[]
}

// 過去 6 ヶ月の選択肢を生成
function monthOptions(now = new Date()): { ym: string; label: string }[] {
  const out: { ym: string; label: string }[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ ym, label: `${d.getFullYear()}年${d.getMonth() + 1}月` })
  }
  return out
}

function classifyType(title: string | null | undefined): string {
  const t = (title ?? '').toLowerCase()
  if (/(クーポン|coupon|割引|off)/i.test(t)) return 'クーポン'
  if (/(キャンペーン|campaign|cp|抽選|プレゼント)/i.test(t)) return 'キャンペーン'
  if (/(予約|空き|来店|reserve)/i.test(t)) return '予約案内'
  if (/(お役立|ヒント|tips|豆知識|コラム)/i.test(t)) return 'お役立ち'
  if (/(アンケート|survey|質問)/i.test(t)) return 'アンケート'
  return '通常投稿'
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function MonthlyReport() {
  const { selectedAccountId } = useAccount()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasAnySent, setHasAnySent] = useState(true)
  const options = useMemo(() => monthOptions(), [])
  const [selectedYm, setSelectedYm] = useState<string>(options[0].ym)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [broadcastsRes, friendsRes] = await Promise.all([
        api.broadcasts.list({ accountId }),
        api.friends.count({ accountId }),
      ])
      const friends = friendsRes.success && friendsRes.data ? friendsRes.data.count : 0
      const sent = (broadcastsRes.success && broadcastsRes.data ? broadcastsRes.data : []).filter(
        (b): b is ApiBroadcast & { sentAt: string } => b.status === 'sent' && !!b.sentAt,
      )

      if (sent.length === 0) {
        setHasAnySent(false)
        setData(null)
        return
      }
      setHasAnySent(true)

      // 月別配信数 (過去 6 ヶ月)
      const now = new Date()
      const monthly: MonthlyPoint[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const mYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        monthly.push({
          ym: mYm,
          label: `${d.getMonth() + 1}月`,
          broadcasts: sent.filter((b) => b.sentAt.startsWith(mYm)).length,
        })
      }

      const monthSent = sent.filter((b) => b.sentAt.startsWith(selectedYm))
      const recent = [...sent]
        .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
        .slice(0, 5)

      // insight が必要な配信 = 当月分 ∪ 直近 5 件
      const insightTargets = new Map<string, ApiBroadcast & { sentAt: string }>()
      for (const b of [...monthSent, ...recent]) insightTargets.set(b.id, b)
      const insightMap = new Map<string, { open: number | null; click: number | null }>()
      await Promise.all(
        Array.from(insightTargets.keys()).map(async (id) => {
          try {
            const res = await api.broadcasts.getInsight(id)
            if (res.success && res.data) {
              insightMap.set(id, { open: res.data.openRate, click: res.data.clickRate })
            }
          } catch {
            /* insight 取得失敗は無視 */
          }
        }),
      )

      const pct = (v: number | null | undefined): number | null =>
        v == null ? null : Math.round(v * 1000) / 10

      // 当月の平均開封率 / CTR (insight がある配信のみ対象)
      const monthInsights = monthSent
        .map((b) => insightMap.get(b.id))
        .filter((x): x is { open: number | null; click: number | null } => !!x)
      const openVals = monthInsights.map((x) => x.open).filter((v): v is number => v != null)
      const clickVals = monthInsights.map((x) => x.click).filter((v): v is number => v != null)
      const avgOpenRate = openVals.length > 0 ? pct(openVals.reduce((s, v) => s + v, 0) / openVals.length) : null
      const avgClickRate = clickVals.length > 0 ? pct(clickVals.reduce((s, v) => s + v, 0) / clickVals.length) : null

      // 配信タイプ別
      const typeMap = new Map<string, { count: number; opens: number[]; clicks: number[] }>()
      for (const b of monthSent) {
        const k = classifyType(b.title)
        const cur = typeMap.get(k) ?? { count: 0, opens: [], clicks: [] }
        cur.count++
        const ins = insightMap.get(b.id)
        if (ins?.open != null) cur.opens.push(ins.open)
        if (ins?.click != null) cur.clicks.push(ins.click)
        typeMap.set(k, cur)
      }
      const avg = (arr: number[]): number | null =>
        arr.length > 0 ? pct(arr.reduce((s, v) => s + v, 0) / arr.length) : null
      const typeStats: TypeStat[] = Array.from(typeMap.entries())
        .map(([type, v]) => ({ type, count: v.count, avgOpen: avg(v.opens), avgClick: avg(v.clicks) }))
        .sort((a, b) => b.count - a.count)

      const topBroadcasts: BroadcastRow[] = recent.map((b) => {
        const ins = insightMap.get(b.id)
        return {
          id: b.id,
          title: b.title || '(無題)',
          type: classifyType(b.title),
          sentAt: fmtDateTime(b.sentAt),
          openRate: pct(ins?.open),
          clickRate: pct(ins?.click),
          sent: b.successCount ?? 0,
          total: b.totalCount ?? 0,
        }
      })

      setData({
        period: options.find((o) => o.ym === selectedYm)?.label ?? selectedYm,
        ym: selectedYm,
        friends,
        monthBroadcasts: monthSent.length,
        avgOpenRate,
        avgClickRate,
        hasInsights: insightMap.size > 0,
        monthly,
        topBroadcasts,
        typeStats,
      })
    } catch {
      setHasAnySent(false)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [accountId, selectedYm, options])

  useEffect(() => {
    void load()
  }, [load])

  const handlePrint = useCallback(() => {
    if (typeof window !== 'undefined') window.print()
  }, [])

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 print:flex-row">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">月次レポート</h1>
          {data ? (
            <p className="text-xs text-slate-500 mt-1">{data.period} の運用結果</p>
          ) : (
            <p className="text-xs text-slate-500 mt-1">配信実績をもとに自動でレポートを作成します</p>
          )}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <select
            value={selectedYm}
            onChange={(e) => setSelectedYm(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-white"
          >
            {options.map((o) => (
              <option key={o.ym} value={o.ym}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={handlePrint}
            disabled={!data}
            className="text-sm bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            PDF 保存
          </button>
        </div>
      </section>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : !hasAnySent ? (
        <EmptyState />
      ) : !data ? (
        <EmptyState />
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="友だち数" value={data.friends.toLocaleString()} unit="人" />
            <KpiCard label="今月の配信" value={data.monthBroadcasts} unit="本" />
            <KpiCard
              label="平均開封率"
              value={data.avgOpenRate != null ? data.avgOpenRate : '—'}
              unit={data.avgOpenRate != null ? '%' : ''}
            />
            <KpiCard
              label="平均クリック率"
              value={data.avgClickRate != null ? data.avgClickRate : '—'}
              unit={data.avgClickRate != null ? '%' : ''}
            />
          </div>

          {data.monthBroadcasts === 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 print:hidden">
              <p className="text-xs text-slate-500">
                {data.period} の配信はありません。下部に直近の配信実績を表示しています。
              </p>
            </div>
          )}

          {/* 月別 配信数 */}
          <ChartCard title="月別の配信数">
            <BarChart data={data.monthly.map((m) => ({ x: m.label, y: m.broadcasts }))} color="#3b82f6" unit="本" />
          </ChartCard>

          {/* 配信タイプ別 開封率 / CTR */}
          {data.typeStats.length > 0 && (
            <ChartCard title="配信タイプ別の本数・開封率 / CTR">
              <TypeChart stats={data.typeStats} hasInsights={data.hasInsights} />
            </ChartCard>
          )}

          {/* 配信一覧 */}
          <ChartCard title="配信パフォーマンス(直近 5 件)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="py-2 font-medium">配信タイトル</th>
                    <th className="py-2 font-medium whitespace-nowrap">タイプ</th>
                    <th className="py-2 font-medium whitespace-nowrap">配信日</th>
                    <th className="py-2 font-medium text-right whitespace-nowrap">送信数</th>
                    <th className="py-2 font-medium text-right whitespace-nowrap">開封率</th>
                    <th className="py-2 font-medium text-right whitespace-nowrap">クリック率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.topBroadcasts.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2.5 text-slate-900 font-medium truncate max-w-[240px]">{b.title}</td>
                      <td className="py-2.5">
                        <TypeBadge type={b.type} />
                      </td>
                      <td className="py-2.5 text-slate-500 text-xs whitespace-nowrap">{b.sentAt}</td>
                      <td className="py-2.5 text-right tabular-nums text-slate-700 text-xs whitespace-nowrap">
                        {b.total > 0 ? `${b.sent.toLocaleString()} / ${b.total.toLocaleString()}` : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        {b.openRate != null ? <RateBar value={b.openRate} color="#10b981" /> : <Dash />}
                      </td>
                      <td className="py-2.5 text-right">
                        {b.clickRate != null ? <RateBar value={b.clickRate} color="#3b82f6" /> : <Dash />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.hasInsights && (
              <p className="text-[11px] text-slate-400 mt-3">
                ※ 開封率・クリック率は LINE 側で集計が完了すると自動で表示されます(配信直後は「—」になります)。
              </p>
            )}
          </ChartCard>

          <p className="text-[11px] text-slate-400 text-center pt-4 print:pt-2">
            L-port 月次レポート © {new Date().getFullYear()}
          </p>
        </>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
      <div className="text-3xl mb-3">📭</div>
      <p className="text-sm text-slate-600 font-medium">まだレポートを作成できる配信実績がありません</p>
      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
        配信を行うと、友だち数・配信数・開封率などが
        <br />
        ここに自動でまとまります。
      </p>
    </div>
  )
}

function Dash() {
  return <span className="text-xs text-slate-300">—</span>
}

function KpiCard({ label, value, unit }: { label: string; value: string | number; unit: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-4">
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 print:break-inside-avoid">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  )
}

function BarChart({ data, color, unit }: { data: Array<{ x: string; y: number }>; color: string; unit: string }) {
  const max = useMemo(() => Math.max(...data.map((d) => d.y), 1), [data])
  const W = 600
  const H = 180
  const padL = 40
  const padR = 12
  const padT = 12
  const padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const slot = innerW / data.length
  const barW = Math.min(slot * 0.6, 38)
  const yTicks = [0, max / 2, max]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {yTicks.map((t, i) => {
        const y = padT + innerH - (t / max) * innerH
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#94a3b8">
              {Math.round(t)}
            </text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const cx = padL + slot * i + slot / 2
        const h = (d.y / max) * innerH
        const y = padT + innerH - h
        return (
          <g key={i}>
            <rect x={cx - barW / 2} y={y} width={barW} height={h} fill={color} opacity="0.85" rx="3" />
            <text x={cx} y={y - 4} textAnchor="middle" fontSize="10" fill="#475569" className="tabular-nums">
              {d.y.toLocaleString()}
            </text>
            <text x={cx} y={H - 10} textAnchor="middle" fontSize="10" fill="#64748b">
              {d.x}
            </text>
          </g>
        )
      })}
      <text x={padL - 6} y={padT - 2} textAnchor="end" fontSize="10" fill="#94a3b8">
        ({unit})
      </text>
    </svg>
  )
}

function TypeChart({ stats, hasInsights }: { stats: TypeStat[]; hasInsights: boolean }) {
  const max = Math.max(
    ...stats.map((s) => Math.max(s.avgOpen ?? 0, s.avgClick ?? 0)),
    1,
  )
  return (
    <div className="space-y-3 py-1">
      {stats.map((s, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium text-slate-700">{s.type}</span>
            <span className="text-slate-400 tabular-nums">{s.count} 本</span>
          </div>
          {hasInsights && (s.avgOpen != null || s.avgClick != null) && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-10">開封</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${((s.avgOpen ?? 0) / max) * 100}%` }}
                  />
                </div>
                <span className="text-[11px] text-slate-700 tabular-nums w-10 text-right">
                  {s.avgOpen != null ? `${s.avgOpen}%` : '—'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-10">CTR</span>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${((s.avgClick ?? 0) / max) * 100}%` }}
                  />
                </div>
                <span className="text-[11px] text-slate-700 tabular-nums w-10 text-right">
                  {s.avgClick != null ? `${s.avgClick}%` : '—'}
                </span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
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

function RateBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="inline-flex items-center gap-2 justify-end">
      <span className="text-xs text-slate-700 tabular-nums w-10 text-right">{value}%</span>
      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

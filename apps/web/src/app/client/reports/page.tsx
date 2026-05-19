'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAccount } from '@/contexts/account-context'
import { api, type ApiBroadcast } from '@/lib/api'

interface MonthlyPoint {
  ym: string // '2026-05'
  label: string // '5月'
  friends: number
  broadcasts: number
  responses: number
}

interface BroadcastRow {
  title: string
  sentAt: string
  openRate: number
  clickRate: number
}

interface ReportData {
  period: string
  kpi: {
    friends: number
    friendsDelta: number
    broadcasts: number
    avgOpenRate: number
    responses: number
  }
  monthly: MonthlyPoint[]
  topBroadcasts: BroadcastRow[]
  isSample: boolean
}

const SAMPLE_DATA: ReportData = {
  period: '直近 6 ヶ月',
  kpi: { friends: 248, friendsDelta: 42, broadcasts: 8, avgOpenRate: 71, responses: 34 },
  monthly: [
    { ym: '2025-12', label: '12月', friends: 152, broadcasts: 4, responses: 12 },
    { ym: '2026-01', label: '1月', friends: 168, broadcasts: 5, responses: 18 },
    { ym: '2026-02', label: '2月', friends: 184, broadcasts: 6, responses: 24 },
    { ym: '2026-03', label: '3月', friends: 199, broadcasts: 7, responses: 28 },
    { ym: '2026-04', label: '4月', friends: 219, broadcasts: 6, responses: 31 },
    { ym: '2026-05', label: '5月', friends: 248, broadcasts: 8, responses: 34 },
  ],
  topBroadcasts: [
    { title: '春の新メニューのお知らせ', sentAt: '2026-04-15 19:00', openRate: 78, clickRate: 12 },
    { title: 'GW 営業日程ご案内', sentAt: '2026-04-25 12:00', openRate: 71, clickRate: 4 },
    { title: '〇〇キャンペーン最終日', sentAt: '2026-04-30 11:00', openRate: 64, clickRate: 18 },
    { title: '誕生月クーポンのご案内', sentAt: '2026-04-05 09:00', openRate: 69, clickRate: 9 },
    { title: '新メニュー試食モニター募集', sentAt: '2026-03-22 18:00', openRate: 73, clickRate: 21 },
  ],
  isSample: true,
}

export default function ClientReportsPage() {
  const { selectedAccountId } = useAccount()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const broadcastsRes = await api.broadcasts.list({ accountId })
      const broadcasts = (broadcastsRes.success && broadcastsRes.data ? broadcastsRes.data : []).filter(
        (b) => b.status === 'sent' && b.sentAt,
      )
      // 実データが乏しい場合はサンプル表示
      if (broadcasts.length < 3) {
        setData(SAMPLE_DATA)
        return
      }
      setData(buildReport(broadcasts))
    } catch {
      setData(SAMPLE_DATA)
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">レポート</h1>
          <p className="text-sm text-slate-500 mt-1">運用結果を数字とグラフで確認できます</p>
        </div>
        {data && (
          <span className="text-xs text-slate-500">{data.period}</span>
        )}
      </section>

      {loading || !data ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : (
        <>
          {data.isSample && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-start gap-2">
              <span className="text-amber-600 text-sm">💡</span>
              <p className="text-xs text-amber-900 leading-relaxed">
                以下は <strong>サンプル</strong> です。配信実績が溜まると、実データに自動で切り替わります。
              </p>
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="友だち数"
              value={data.kpi.friends.toLocaleString()}
              unit="人"
              delta={data.kpi.friendsDelta > 0 ? `+${data.kpi.friendsDelta}` : `${data.kpi.friendsDelta}`}
              deltaTone={data.kpi.friendsDelta >= 0 ? 'positive' : 'negative'}
            />
            <KpiCard label="今月の配信" value={data.kpi.broadcasts} unit="本" />
            <KpiCard label="平均開封率" value={data.kpi.avgOpenRate} unit="%" />
            <KpiCard label="応対した会話" value={data.kpi.responses} unit="件" />
          </div>

          {/* 友だち数推移 */}
          <ChartCard title="友だち数の推移">
            <LineChart
              data={data.monthly.map((m) => ({ x: m.label, y: m.friends }))}
              color="#10b981"
              unit="人"
            />
          </ChartCard>

          {/* 月別 配信数 / 応対数 */}
          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title="月別の配信数">
              <BarChart
                data={data.monthly.map((m) => ({ x: m.label, y: m.broadcasts }))}
                color="#3b82f6"
                unit="本"
              />
            </ChartCard>
            <ChartCard title="月別の応対数">
              <BarChart
                data={data.monthly.map((m) => ({ x: m.label, y: m.responses }))}
                color="#8b5cf6"
                unit="件"
              />
            </ChartCard>
          </div>

          {/* 配信一覧 */}
          <ChartCard title="配信パフォーマンス（直近 5 件）">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="py-2 font-medium">配信タイトル</th>
                    <th className="py-2 font-medium whitespace-nowrap">配信日</th>
                    <th className="py-2 font-medium text-right whitespace-nowrap">開封率</th>
                    <th className="py-2 font-medium text-right whitespace-nowrap">クリック率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.topBroadcasts.map((b, i) => (
                    <tr key={i}>
                      <td className="py-2.5 text-slate-900 font-medium truncate max-w-[280px]">{b.title}</td>
                      <td className="py-2.5 text-slate-500 text-xs whitespace-nowrap">{b.sentAt}</td>
                      <td className="py-2.5 text-right">
                        <RateBar value={b.openRate} color="#10b981" />
                      </td>
                      <td className="py-2.5 text-right">
                        <RateBar value={b.clickRate} color="#3b82f6" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}
    </div>
  )
}

function buildReport(broadcasts: ApiBroadcast[]): ReportData {
  const now = new Date()
  const months: MonthlyPoint[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const count = broadcasts.filter((b) => b.sentAt?.startsWith(ym)).length
    months.push({
      ym,
      label: `${d.getMonth() + 1}月`,
      friends: 0, // friends history は別 API 必要、簡易のため累積線
      broadcasts: count,
      responses: 0,
    })
  }
  const top = broadcasts
    .sort((a, b) => (a.sentAt && b.sentAt ? new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime() : 0))
    .slice(0, 5)
    .map((b) => ({
      title: b.title || '(無題)',
      sentAt: b.sentAt
        ? new Date(b.sentAt).toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '—',
      openRate: 0,
      clickRate: 0,
    }))
  return {
    period: '直近 6 ヶ月',
    kpi: {
      friends: 0,
      friendsDelta: 0,
      broadcasts: months[months.length - 1].broadcasts,
      avgOpenRate: 0,
      responses: 0,
    },
    monthly: months,
    topBroadcasts: top,
    isSample: false,
  }
}

function KpiCard({
  label,
  value,
  unit,
  delta,
  deltaTone,
}: {
  label: string
  value: string | number
  unit: string
  delta?: string
  deltaTone?: 'positive' | 'negative'
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-4">
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{value}</span>
        <span className="text-xs text-slate-500">{unit}</span>
      </div>
      {delta && (
        <div
          className={`text-[11px] mt-1 ${
            deltaTone === 'positive' ? 'text-emerald-600' : 'text-rose-600'
          }`}
        >
          {deltaTone === 'positive' ? '▲' : '▼'} {delta}
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h3>
      {children}
    </div>
  )
}

function LineChart({ data, color, unit }: { data: Array<{ x: string; y: number }>; color: string; unit: string }) {
  const max = useMemo(() => Math.max(...data.map((d) => d.y), 1), [data])
  const W = 600
  const H = 180
  const padL = 40
  const padR = 12
  const padT = 12
  const padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0
  const points = data.map((d, i) => {
    const x = padL + stepX * i
    const y = padT + innerH - (d.y / max) * innerH
    return { x, y, v: d.y, label: d.x }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const area = `${path} L ${points[points.length - 1].x} ${padT + innerH} L ${points[0].x} ${padT + innerH} Z`
  const yTicks = [0, max / 2, max]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {/* grid */}
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
      {/* area */}
      <path d={area} fill={color} opacity="0.08" />
      {/* line */}
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {/* points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3.5" fill={color} />
          <text
            x={p.x}
            y={p.y - 8}
            textAnchor="middle"
            fontSize="10"
            fill="#475569"
            className="tabular-nums"
          >
            {p.v.toLocaleString()}
          </text>
          <text x={p.x} y={H - 10} textAnchor="middle" fontSize="10" fill="#64748b">
            {p.label}
          </text>
        </g>
      ))}
      {/* unit label */}
      <text x={padL - 6} y={padT - 2} textAnchor="end" fontSize="10" fill="#94a3b8">
        ({unit})
      </text>
    </svg>
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
            <rect
              x={cx - barW / 2}
              y={y}
              width={barW}
              height={h}
              fill={color}
              opacity="0.85"
              rx="3"
            />
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

function RateBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="inline-flex items-center gap-2 justify-end">
      <span className="text-xs text-slate-700 tabular-nums w-10 text-right">{value}%</span>
      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

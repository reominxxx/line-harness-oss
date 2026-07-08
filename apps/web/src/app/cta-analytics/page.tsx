'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

const FORMS = [
  { id: '11111111-1111-4111-8111-111111111111', label: '無料診断', cta: 'LINE運用無料診断', color: '#06C755' },
  { id: '33333333-3333-4333-8333-333333333333', label: '無料相談', cta: '無料相談・資料請求', color: '#0ea5e9' },
] as const

interface Counts {
  total: number
  today: number
  last7: number
}

interface Stats {
  formId: string
  formName: string
  opens: Counts
  submissions: Counts
}

function rate(opens: number, subs: number): string {
  if (!opens) return '—'
  return ((subs / opens) * 100).toFixed(1) + '%'
}

export default function CtaAnalyticsPage() {
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.all(
        FORMS.map((f) =>
          fetchApi<{ success: boolean; data: Stats }>(`/api/forms/${f.id}/stats`).catch(() => null),
        ),
      )
      const map: Record<string, Stats> = {}
      results.forEach((res, i) => {
        if (res && res.success) map[FORMS[i].id] = res.data
      })
      setStats(map)
    } catch {
      /* silent */
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <Header
        title="CTA計測"
        description="LP の「無料診断」「無料相談」ボタンのクリック数（ページ到達数）と、フォーム送信数・送信率"
      />

      <div className="flex justify-end mb-4">
        <button
          onClick={load}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          更新
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {FORMS.map((f) => {
            const s = stats[f.id]
            const opens = s?.opens ?? { total: 0, today: 0, last7: 0 }
            const subs = s?.submissions ?? { total: 0, today: 0, last7: 0 }
            return (
              <div key={f.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: f.color }}
                  />
                  <span className="font-bold text-gray-900">{f.label}</span>
                  <span className="text-xs text-gray-400">{f.cta}</span>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-400 mb-1">クリック数（到達）</div>
                      <div className="text-3xl font-black tabular-nums" style={{ color: f.color }}>
                        {opens.total.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        今日 {opens.today} / 7日間 {opens.last7}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-1">送信数</div>
                      <div className="text-3xl font-black tabular-nums text-gray-900">
                        {subs.total.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        今日 {subs.today} / 7日間 {subs.last7}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-xs text-gray-400">送信率（送信 ÷ クリック）</span>
                    <span className="text-lg font-bold text-gray-900 tabular-nums">
                      {rate(opens.total, subs.total)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4 leading-relaxed">
        ※ クリック数は各ボタンの遷移先ページ（/diagnosis・/consultation）の到達数で計測しています。
        ボタンクリック＝ページ到達のため、ほぼクリック数と一致します。
      </p>
    </div>
  )
}

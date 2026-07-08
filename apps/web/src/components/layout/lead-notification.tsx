'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { api, fetchApi } from '@/lib/api'

// 通知ソース。新規フォーム回答 (form) / 未返信の受信チャット (inbox) が来たら
// 右上にバッジを出し、クリックで該当一覧へ遷移して既読化する。
type LeadSource =
  | { key: string; type: 'form'; formId: string; seenKey: string; label: string; href: string }
  | { key: string; type: 'inbox'; seenKey: string; label: string; href: string }

const SOURCES: LeadSource[] = [
  {
    key: 'unanswered',
    type: 'inbox',
    seenKey: 'lh_unanswered_seen_at',
    label: '未対応チャット',
    href: '/notifications',
  },
  {
    key: 'diagnosis',
    type: 'form',
    // 無料診断フォーム (081_seed_free_diagnosis.sql の固定 UUID)
    formId: '11111111-1111-4111-8111-111111111111',
    seenKey: 'lh_diag_leads_seen_at',
    label: '新着診断リード',
    href: '/diagnosis-leads',
  },
  {
    key: 'consultation',
    type: 'form',
    // 無料相談フォーム (085_seed_consultation_form.sql の固定 UUID)
    formId: '33333333-3333-4333-8333-333333333333',
    seenKey: 'lh_consult_leads_seen_at',
    label: '新着相談リード',
    href: '/consultation-leads',
  },
]

// 未対応チャットは「最後に確認した時刻以降に届いた未返信受信」の最新時刻を集める。
async function fetchTimes(src: LeadSource): Promise<string[]> {
  if (src.type === 'inbox') {
    const res = await api.inbox.unanswered.list({ pageSize: 200 })
    if (!res.success || !Array.isArray(res.data.rows)) return []
    return res.data.rows.map((r) => r.lastIncomingAt).filter(Boolean)
  }
  const res = await fetchApi<{ success: boolean; data: Submission[] }>(
    `/api/forms/${src.formId}/submissions`,
  )
  if (!res.success || !Array.isArray(res.data)) return []
  return res.data.map((s) => s.createdAt).filter(Boolean)
}

const POLL_MS = 60_000

interface Submission {
  id: string
  createdAt: string
}

interface SourceState {
  newCount: number
  latest: string | null
}

export default function LeadNotification() {
  const router = useRouter()
  const pathname = usePathname()
  const [states, setStates] = useState<Record<string, SourceState>>(() =>
    Object.fromEntries(SOURCES.map((s) => [s.key, { newCount: 0, latest: null }])),
  )
  const initialized = useRef(false)
  // 最新受信時刻と現在パスは ref で保持し、既読化エフェクトが states に依存しない
  // ようにする（states 依存だと setStates → 再実行 → setStates の無限ループでタブが固まる）
  const latestRef = useRef<Record<string, string | null>>(
    Object.fromEntries(SOURCES.map((s) => [s.key, null])),
  )
  const pathnameRef = useRef(pathname)

  const markSeen = useCallback((src: LeadSource, ts: string | null) => {
    if (ts) localStorage.setItem(src.seenKey, ts)
    setStates((prev) => {
      // 既に 0 なら参照を変えない（auto-mark-seen エフェクトの states 依存による無限ループ防止）
      if (prev[src.key].newCount === 0) return prev
      return { ...prev, [src.key]: { ...prev[src.key], newCount: 0 } }
    })
  }, [])

  const pollOne = useCallback(async (src: LeadSource) => {
    try {
      const times = await fetchTimes(src)
      const newest = times.length
        ? times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
        : null
      latestRef.current[src.key] = newest

      const seen = localStorage.getItem(src.seenKey)
      // 初回起動時、または該当一覧ページを開いている間は「既読」扱い (バッジを出さない)
      if (seen === null || pathnameRef.current === src.href) {
        if (newest) localStorage.setItem(src.seenKey, newest)
        setStates((prev) => ({ ...prev, [src.key]: { newCount: 0, latest: newest } }))
        return
      }
      const seenDate = new Date(seen).getTime()
      const count = times.filter((t) => new Date(t).getTime() > seenDate).length
      setStates((prev) => ({ ...prev, [src.key]: { newCount: count, latest: newest } }))
    } catch {
      /* silent */
    }
  }, [])

  const pollAll = useCallback(() => {
    for (const src of SOURCES) void pollOne(src)
  }, [pollOne])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    pollAll()
    const id = setInterval(pollAll, POLL_MS)
    const onFocus = () => pollAll()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [pollAll])

  // リード一覧ページに遷移したら自動的に既読化。
  // 依存は pathname のみ（states を入れると setStates で自己再実行して無限ループになる）。
  // 最新時刻は latestRef から読むため states 依存が不要。
  useEffect(() => {
    pathnameRef.current = pathname
    for (const src of SOURCES) {
      if (pathname === src.href) markSeen(src, latestRef.current[src.key])
    }
  }, [pathname, markSeen])

  const visible = SOURCES.filter((s) => (states[s.key]?.newCount ?? 0) > 0)
  if (visible.length === 0) return null

  return (
    <div className="fixed top-2.5 right-3 lg:top-4 lg:right-5 z-[60] flex flex-col items-end gap-2">
      {visible.map((src) => {
        const count = states[src.key].newCount
        return (
          <button
            key={src.key}
            onClick={() => {
              markSeen(src, states[src.key].latest)
              router.push(src.href)
            }}
            aria-label={`${src.label}が${count}件あります`}
            className="flex items-center gap-2 rounded-full bg-white shadow-lg border border-gray-200 pl-3 pr-4 py-2 hover:bg-gray-50 transition-colors"
          >
            <span className="relative">
              <svg className="w-5 h-5 text-[#06C755]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {count > 99 ? '99+' : count}
              </span>
            </span>
            <span className="text-xs font-bold text-gray-700 whitespace-nowrap">
              {src.label} {count}件
            </span>
          </button>
        )
      })}
    </div>
  )
}

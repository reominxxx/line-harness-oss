'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

// 無料診断フォーム (081_seed_free_diagnosis.sql の固定 UUID)
const DIAGNOSIS_FORM_ID = '11111111-1111-4111-8111-111111111111'

interface Submission {
  id: string
  formId: string
  friendId: string | null
  friendName?: string | null
  data: Record<string, unknown>
  createdAt: string
}

interface Lead {
  id: string
  company: string
  name: string
  phone: string
  email: string
  website: string
  note: string
  industry: string
  score: string
  level: string
  bottleneck: string
  source: string
  friendId: string | null
  createdAt: string
}

const LEVEL_BADGE: Record<string, string> = {
  A: 'bg-green-100 text-green-700',
  B: 'bg-sky-100 text-sky-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-red-100 text-red-700',
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function toLead(s: Submission): Lead {
  const d = s.data || {}
  return {
    id: s.id,
    company: str(d.lead_company),
    name: str(d.lead_name),
    phone: str(d.lead_phone),
    email: str(d.lead_email),
    website: str(d.lead_website),
    note: str(d.lead_note),
    industry: str(d.diagnosis_industry),
    score: str(d.diagnosis_score),
    level: str(d.diagnosis_level),
    bottleneck: str(d.diagnosis_bottleneck),
    source: str(d.lead_source) || (s.friendId ? 'line' : 'web'),
    friendId: s.friendId,
    createdAt: s.createdAt,
  }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"'
  return v
}

export default function DiagnosisLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [onlyWeb, setOnlyWeb] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Submission[] }>(
        `/api/forms/${DIAGNOSIS_FORM_ID}/submissions`,
      )
      if (res.success) {
        const mapped = res.data
          .map((s) => ({
            ...s,
            data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
          }))
          .map(toLead)
        // 新しい順
        mapped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setLeads(mapped)
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (onlyWeb && l.source !== 'web_diagnosis' && l.source !== 'web') return false
      if (!query) return true
      const q = query.toLowerCase()
      return (
        l.company.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.industry.toLowerCase().includes(q) ||
        l.bottleneck.toLowerCase().includes(q)
      )
    })
  }, [leads, query, onlyWeb])

  const exportCsv = useCallback(() => {
    const header = ['日時', '店舗/会社名', 'お名前', '電話番号', 'メール', 'Web/SNS', 'ご相談内容', '業種', 'スコア', 'レベル', 'ボトルネック', '流入']
    const rows = filtered.map((l) => [
      formatDateTime(l.createdAt), l.company, l.name, l.phone, l.email, l.website, l.note, l.industry, l.score, l.level, l.bottleneck, l.source,
    ])
    const csv = [header, ...rows].map((r) => r.map((c) => csvCell(c)).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `diagnosis-leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  return (
    <div>
      <Header
        title="診断リード"
        description="Web無料診断で取得したテレアポ用リード（電話番号・店舗名・業種・診断結果）"
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="店舗名・名前・電話・業種で検索"
          className="flex-1 min-w-[220px] px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-[#06C755]"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 select-none">
          <input type="checkbox" checked={onlyWeb} onChange={(e) => setOnlyWeb(e.target.checked)} />
          Web診断のみ
        </label>
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="px-4 py-2 text-sm rounded-lg bg-[#06C755] text-white font-semibold disabled:opacity-30 hover:bg-[#05b14c]"
        >
          CSVダウンロード
        </button>
        <button
          onClick={load}
          className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          更新
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">読み込み中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
          診断リードはまだありません
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-400 mb-2">{filtered.length}件</div>
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full min-w-[1180px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">店舗/会社名</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">お名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">電話番号</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">メール</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Web/SNS</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">ご相談内容</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">業種</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">スコア</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">レベル</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">ボトルネック</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">流入</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{l.company || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{l.name || '—'}</td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {l.phone ? (
                        <a href={`tel:${l.phone}`} className="text-[#06C755] hover:underline">{l.phone}</a>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {l.email ? (
                        <a href={`mailto:${l.email}`} className="text-[#06C755] hover:underline">{l.email}</a>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap max-w-[160px] truncate">
                      {l.website ? (
                        /^https?:\/\//.test(l.website)
                          ? <a href={l.website} target="_blank" rel="noopener noreferrer" className="text-[#06C755] hover:underline">{l.website}</a>
                          : <span className="text-gray-700">{l.website}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate" title={l.note}>{l.note || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{l.industry || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 tabular-nums whitespace-nowrap">{l.score || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {l.level ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${LEVEL_BADGE[l.level] || 'bg-gray-100 text-gray-600'}`}>
                          {l.level}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">{l.bottleneck || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full ${
                        l.source === 'web_diagnosis' || l.source === 'web' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {l.source === 'web_diagnosis' || l.source === 'web' ? 'Web' : 'LINE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

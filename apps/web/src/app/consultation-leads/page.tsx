'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'

// 無料相談フォーム (085_seed_consultation_form.sql の固定 UUID)
const CONSULTATION_FORM_ID = '33333333-3333-4333-8333-333333333333'

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
  storeName: string
  contactName: string
  email: string
  phone: string
  industry: string
  website: string
  hasLineOa: string
  challenge: string
  preferredDatetime: string
  source: 'web' | 'line'
  friendId: string | null
  createdAt: string
}

const INDUSTRY_LABEL: Record<string, string> = {
  salon: '美容室・ネイル',
  seitai: '整体・治療院・パーソナルジム',
  ec: 'EC・D2C',
  school: 'スクール・教室',
  shigyo: '士業',
  restaurant: '飲食店',
  other: 'その他',
}

const LINE_OA_LABEL: Record<string, string> = {
  yes: 'あり',
  no: 'なし',
  unknown: 'わからない',
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function toLead(s: Submission): Lead {
  const d = s.data || {}
  return {
    id: s.id,
    company: str(d.company),
    storeName: str(d.store_name),
    contactName: str(d.contact_name),
    email: str(d.email),
    phone: str(d.phone),
    industry: INDUSTRY_LABEL[str(d.industry)] ?? str(d.industry),
    website: str(d.website),
    hasLineOa: LINE_OA_LABEL[str(d.has_line_oa)] ?? str(d.has_line_oa),
    challenge: str(d.challenge),
    preferredDatetime: str(d.preferred_datetime),
    source: s.friendId ? 'line' : 'web',
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

export default function ConsultationLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Submission[] }>(
        `/api/forms/${CONSULTATION_FORM_ID}/submissions`,
      )
      if (res.success) {
        const mapped = res.data
          .map((s) => ({
            ...s,
            data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
          }))
          .map(toLead)
        mapped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setLeads(mapped)
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!query) return leads
    const q = query.toLowerCase()
    return leads.filter((l) =>
      l.company.toLowerCase().includes(q) ||
      l.storeName.toLowerCase().includes(q) ||
      l.contactName.toLowerCase().includes(q) ||
      l.phone.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      l.industry.toLowerCase().includes(q) ||
      l.challenge.toLowerCase().includes(q),
    )
  }, [leads, query])

  const exportCsv = useCallback(() => {
    const header = ['日時', '会社名', '店舗名', 'ご担当者名', '電話番号', 'メール', '業種', 'WebサイトURL', 'LINE公式有無', 'ご相談内容', '希望相談日時', '流入']
    const rows = filtered.map((l) => [
      formatDateTime(l.createdAt), l.company, l.storeName, l.contactName, l.phone, l.email, l.industry, l.website, l.hasLineOa, l.challenge, l.preferredDatetime, l.source === 'web' ? 'Web' : 'LINE',
    ])
    const csv = [header, ...rows].map((r) => r.map((c) => csvCell(c)).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `consultation-leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  return (
    <div>
      <Header
        title="無料相談リード"
        description="LP「無料相談」フォームから取得した商談アポ用リード（会社名・担当者・連絡先・課題・希望日時）"
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="会社名・店舗名・担当者・電話・業種で検索"
          className="flex-1 min-w-[220px] px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-[#06C755]"
        />
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
          相談リードはまだありません
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-400 mb-2">{filtered.length}件</div>
          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full min-w-[1240px]">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">会社名</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">店舗名</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">ご担当者名</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">電話番号</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">メール</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">業種</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">LINE公式</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">ご相談内容</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">希望日時</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">流入</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{l.company || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{l.storeName || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{l.contactName || '—'}</td>
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
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{l.industry || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{l.hasLineOa || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-[220px] truncate" title={l.challenge}>{l.challenge || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-[160px] truncate" title={l.preferredDatetime}>{l.preferredDatetime || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full ${
                        l.source === 'web' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {l.source === 'web' ? 'Web' : 'LINE'}
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

'use client'

import { useEffect, useState, useCallback } from 'react'
import { aiApi, type AgencyExample } from '@/lib/ai-api'

const INDUSTRIES = [
  { value: 'beauty', label: '💄 美容' },
  { value: 'chiropractic', label: '🏥 整体' },
  { value: 'ecommerce', label: '🛍 EC・物販' },
  { value: 'school', label: '🎓 スクール' },
  { value: 'legal', label: '⚖️ 士業' },
]
const BROADCAST_TYPES = [
  { value: 'campaign', label: 'キャンペーン' },
  { value: 'reminder', label: 'リマインダー' },
  { value: 'newsletter', label: 'ニュースレター' },
  { value: 'event', label: 'イベント' },
  { value: 'limited_offer', label: '限定オファー' },
  { value: 'aftercare', label: 'アフターケア' },
  { value: 'welcome', label: 'ウェルカム' },
  { value: 'reactivation', label: '休眠掘り起こし' },
]

export default function PlaybookPickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (content: string, exampleTitle: string | null) => void
  onClose: () => void
}) {
  const [examples, setExamples] = useState<AgencyExample[]>([])
  const [loading, setLoading] = useState(false)
  const [industry, setIndustry] = useState('')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await aiApi.agencyExamples.list({
        industry: industry || undefined,
        broadcast_type: type || undefined,
        q: q || undefined,
        limit: 30,
      })
      setExamples(res.examples)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [industry, type, q])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">📚 実例ライブラリから選ぶ</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        <div className="p-5">
          <p className="text-xs text-gray-500 mb-3">
            参考にしたい実例を選ぶと、本文欄に挿入されます。
          </p>

          {/* フィルター */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="border border-gray-200 rounded px-2.5 py-1.5 text-sm"
            >
              <option value="">業界すべて</option>
              {INDUSTRIES.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="border border-gray-200 rounded px-2.5 py-1.5 text-sm"
            >
              <option value="">配信種別すべて</option>
              {BROADCAST_TYPES.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="キーワード検索"
              className="border border-gray-200 rounded px-2.5 py-1.5 text-sm"
            />
          </div>

          {loading && <div className="text-sm text-gray-400 py-4 text-center">読み込み中…</div>}
          {!loading && examples.length === 0 && (
            <div className="text-center py-8 text-sm text-gray-500">
              該当する実例がありません。<br />
              <a href="/playbook-library" target="_blank" className="underline text-violet-700">実例ライブラリ</a> から追加できます。
            </div>
          )}

          <div className="space-y-2">
            {examples.map((ex) => {
              const industryLabel = INDUSTRIES.find((i) => i.value === ex.industry)?.label
              const typeLabel = BROADCAST_TYPES.find((b) => b.value === ex.broadcast_type)?.label
              return (
                <div
                  key={ex.id}
                  className="border border-gray-200 rounded-md p-3 hover:border-gray-900 transition-colors cursor-pointer"
                  onClick={() => onSelect(ex.content, ex.title)}
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <div className="flex-1 min-w-0">
                      {ex.title && (
                        <div className="text-sm font-semibold text-gray-900 truncate">{ex.title}</div>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {industryLabel && (
                          <span className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">
                            {industryLabel}
                          </span>
                        )}
                        {typeLabel && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                            {typeLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(ex.content, ex.title)
                      }}
                      className="text-xs bg-gray-900 text-white px-2 py-1 rounded whitespace-nowrap"
                    >
                      この内容で挿入
                    </button>
                  </div>
                  <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-4">
                    {ex.content}
                  </div>
                  {ex.notes && (
                    <div className="mt-1 text-[11px] text-gray-500">📝 {ex.notes}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

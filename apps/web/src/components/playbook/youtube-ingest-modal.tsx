'use client'

import { useState } from 'react'
import { useAccount } from '@/contexts/account-context'

interface Props {
  onClose: () => void
  onSaved: () => void
}

interface ParsedExample {
  title?: string
  content?: string
  industry?: string
  broadcastType?: string | null
  notes?: string
  tags?: string[]
}

interface PreviewResult {
  videoId: string
  title: string
  author: string
  transcriptLang: string | null
  transcriptLength: number
  transcriptSample: string
  parsed: ParsedExample
  costYenX100: number
}

export default function YoutubeIngestModal({ onClose, onSaved }: Props) {
  const { selectedAccount } = useAccount()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [saving, setSaving] = useState(false)

  // 編集用 state (プレビュー取得後にユーザーが微調整)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editIndustry, setEditIndustry] = useState('')
  const [editBroadcastType, setEditBroadcastType] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editTags, setEditTags] = useState('')

  async function handlePreview() {
    if (!url.trim()) {
      setError('YouTube URL を入力してください')
      return
    }
    if (!selectedAccount) {
      setError('アカウントが選択されていません')
      return
    }
    setError(null)
    setLoading(true)
    setPreview(null)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
      const res = await fetch(`${apiUrl}/api/youtube-ingest/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Line-Account-Id': selectedAccount.id,
        },
        body: JSON.stringify({ url: url.trim() }),
      })
      const json = (await res.json()) as PreviewResult & { success: boolean; error?: string }
      if (!res.ok || !json.success) throw new Error(json.error ?? '取り込みに失敗しました')
      setPreview(json)
      // 編集 state を初期化
      setEditTitle(json.parsed.title ?? '')
      setEditContent(json.parsed.content ?? '')
      setEditIndustry(json.parsed.industry ?? '')
      setEditBroadcastType(json.parsed.broadcastType ?? '')
      setEditNotes(json.parsed.notes ?? '')
      setEditTags((json.parsed.tags ?? []).join(', '))
    } catch (e) {
      setError(e instanceof Error ? e.message : '取り込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!preview || !editContent.trim()) {
      setError('本文が空です')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
      const res = await fetch(`${apiUrl}/api/youtube-ingest/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url,
          parsed: {
            title: editTitle.trim() || null,
            content: editContent.trim(),
            industry: editIndustry || null,
            broadcastType: editBroadcastType || null,
            notes: editNotes.trim() || null,
            tags: editTags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          },
        }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!res.ok || !json.success) throw new Error(json.error ?? '保存に失敗しました')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto" onClick={onClose}>
      <div className="min-h-screen p-4 md:p-8 flex items-start justify-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-start justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-xl font-bold text-slate-800">📺 YouTube 動画から取り込む</h2>
              <p className="text-xs text-slate-500 mt-1">
                運用代行・LINE マーケ系の動画 URL を貼ると、AI が字幕を読んでノウハウを要約 → 実例ライブラリに保存
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg"
            >
              ✕
            </button>
          </div>

          {/* URL 入力 */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">YouTube URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={loading}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <button
                type="button"
                onClick={handlePreview}
                disabled={loading || !url.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium rounded-lg"
              >
                {loading ? '取り込み中…' : '✨ AI で要約'}
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              字幕がある動画はそれをベースに、字幕が無ければタイトルから推測します。1 件あたり数十秒。
            </p>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
              {error}
            </div>
          )}

          {/* プレビュー結果 */}
          {preview && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                <p>
                  <strong className="text-slate-800">{preview.title}</strong> — {preview.author}
                </p>
                <p className="text-[10px] text-slate-400">
                  字幕 {preview.transcriptLang ?? '取得失敗'} · 取得文字数 {preview.transcriptLength} ·
                  AI コスト ¥{(preview.costYenX100 / 100).toFixed(2)}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">タイトル</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    本文 <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={10}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">業界</label>
                    <select
                      value={editIndustry}
                      onChange={(e) => setEditIndustry(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    >
                      <option value="">(指定なし)</option>
                      <option value="beauty">美容</option>
                      <option value="chiropractic">整体・治療院</option>
                      <option value="ecommerce">EC・物販</option>
                      <option value="school">スクール</option>
                      <option value="legal">士業</option>
                      <option value="other">その他</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">配信種別</label>
                    <select
                      value={editBroadcastType}
                      onChange={(e) => setEditBroadcastType(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    >
                      <option value="">(指定なし)</option>
                      <option value="campaign">キャンペーン</option>
                      <option value="reminder">リマインダー</option>
                      <option value="newsletter">ニュースレター</option>
                      <option value="event">イベント</option>
                      <option value="limited_offer">期間限定</option>
                      <option value="aftercare">アフターケア</option>
                      <option value="welcome">ウェルカム</option>
                      <option value="reactivation">休眠掘り起こし</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">タグ (カンマ区切り)</label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="例: 集客, 開封率, 美容室"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">メモ (任意)</label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={2}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !editContent.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white text-sm font-medium rounded-lg"
                >
                  {saving ? '保存中…' : 'ライブラリに保存'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

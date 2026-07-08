'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { aiApi, type AgencyExample } from '@/lib/ai-api'
import YoutubeIngestModal from '@/components/playbook/youtube-ingest-modal'

const INDUSTRIES: Array<{ value: string; label: string }> = [
  { value: 'beauty', label: '💄 美容' },
  { value: 'chiropractic', label: '🏥 整体・治療院' },
  { value: 'ecommerce', label: '🛍 EC・物販' },
  { value: 'school', label: '🎓 スクール・教室' },
  { value: 'legal', label: '⚖️ 士業' },
  { value: 'other', label: 'その他' },
]
const BROADCAST_TYPES: Array<{ value: string; label: string }> = [
  { value: 'campaign', label: 'キャンペーン' },
  { value: 'reminder', label: 'リマインダー' },
  { value: 'newsletter', label: 'ニュースレター' },
  { value: 'event', label: 'イベント告知' },
  { value: 'limited_offer', label: '期間限定オファー' },
  { value: 'aftercare', label: 'アフターケア' },
  { value: 'welcome', label: 'ウェルカム' },
  { value: 'reactivation', label: '休眠掘り起こし' },
]
const TIME_OF_DAYS: Array<{ value: string; label: string }> = [
  { value: 'morning', label: '朝 (6-10)' },
  { value: 'noon', label: '昼 (11-13)' },
  { value: 'afternoon', label: '午後 (14-17)' },
  { value: 'evening', label: '夕方 (18-21)' },
  { value: 'night', label: '夜 (22-)' },
]

type InputTab = 'text' | 'image' | 'url'

export default function PlaybookLibraryPage() {
  const [examples, setExamples] = useState<AgencyExample[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [filterTime, setFilterTime] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showYoutubeModal, setShowYoutubeModal] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await aiApi.agencyExamples.list({
        broadcast_type: filterType || undefined,
        time_of_day: filterTime || undefined,
        q: searchQ || undefined,
        limit: 100,
      })
      setExamples(res.examples)
      setTotal(res.total)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [filterType, filterTime, searchQ])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleDelete = async (id: string) => {
    if (!confirm('この実例を削除します。よろしいですか？')) return
    try {
      await aiApi.agencyExamples.delete(id)
      setToast({ kind: 'success', text: '削除しました' })
      void load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '削除失敗' })
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="運用代行ノウハウ実例ライブラリ" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div
            className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${
              toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'
            }`}
          >
            {toast.text}
          </div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          <div className="flex items-start justify-between mb-4 gap-4">
            <div>
              <p className="text-sm text-gray-700">
                他社の優良配信や運用代行ノウハウを溜める全テナント共有のライブラリです。AI 配信生成時に業界・テーマで自動参照されます。
              </p>
              <p className="text-xs text-gray-400 mt-1">
                スクショ画像から AI が自動でタグ付け / テキストだけ貼っても OK / URL から記事取り込み
              </p>
            </div>
            <div className="flex items-center gap-2 whitespace-nowrap">
              <button
                onClick={() => setShowYoutubeModal(true)}
                className="bg-rose-600 hover:bg-rose-700 text-white text-sm px-4 py-2 rounded inline-flex items-center gap-1"
                title="YouTube 動画から運用代行ノウハウを取り込む"
              >
                📺 YouTube から取り込む
              </button>
              <button
                onClick={() => setShowModal(true)}
                className="bg-gray-900 text-white text-sm px-4 py-2 rounded"
              >
                + 実例を追加
              </button>
            </div>
          </div>

          {/* フィルター */}
          <div className="bg-white border border-gray-200 rounded-md p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="border border-gray-200 rounded px-2.5 py-1.5 text-sm"
              >
                <option value="">すべての配信種別</option>
                {BROADCAST_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
              <select
                value={filterTime}
                onChange={(e) => setFilterTime(e.target.value)}
                className="border border-gray-200 rounded px-2.5 py-1.5 text-sm"
              >
                <option value="">すべての時間帯</option>
                {TIME_OF_DAYS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="キーワード検索"
                className="border border-gray-200 rounded px-2.5 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="text-xs text-gray-500 mb-2 tabular-nums">{total} 件</div>

          {/* 一覧 */}
          {loading && <div className="text-sm text-gray-400 py-8 text-center">読み込み中…</div>}
          {!loading && examples.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-md p-12 text-center">
              <p className="text-sm text-gray-700 mb-2">まだ実例が登録されていません</p>
              <p className="text-xs text-gray-500 mb-4">
                「+ 実例を追加」から最初の 1 件を入れてみてください
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {examples.map((ex) => (
              <ExampleCard key={ex.id} example={ex} onDelete={() => void handleDelete(ex.id)} />
            ))}
          </div>
        </div>

        {showModal && (
          <AddExampleModal
            onClose={() => setShowModal(false)}
            onSaved={() => {
              setShowModal(false)
              setToast({ kind: 'success', text: '実例を追加しました' })
              void load()
            }}
          />
        )}

        {showYoutubeModal && (
          <YoutubeIngestModal
            onClose={() => setShowYoutubeModal(false)}
            onSaved={() => {
              setShowYoutubeModal(false)
              setToast({ kind: 'success', text: 'YouTube ノウハウをライブラリに保存しました' })
              void load()
            }}
          />
        )}
      </main>
    </div>
  )
}

function ExampleCard({ example, onDelete }: { example: AgencyExample; onDelete: () => void }) {
  const industryLabel = INDUSTRIES.find((i) => i.value === example.industry)?.label
  const typeLabel = BROADCAST_TYPES.find((b) => b.value === example.broadcast_type)?.label
  const timeLabel = TIME_OF_DAYS.find((t) => t.value === example.time_of_day)?.label
  const tags = example.tags_json ? (JSON.parse(example.tags_json) as string[]) : []
  return (
    <div className="bg-white border border-gray-200 rounded-md p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          {example.title && (
            <div className="text-sm font-semibold text-gray-900 truncate">{example.title}</div>
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
            {timeLabel && (
              <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                {timeLabel}
              </span>
            )}
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={onDelete}
          className="text-xs text-gray-400 hover:text-rose-600"
          title="削除"
        >
          ✕
        </button>
      </div>

      {example.image_url && (
        <img
          src={example.image_url}
          alt=""
          className="w-full max-h-40 object-contain bg-gray-50 rounded mb-2"
        />
      )}

      <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-6">
        {example.content}
      </div>

      {example.notes && (
        <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-500">
          📝 {example.notes}
        </div>
      )}

      <div className="text-[10px] text-gray-400 mt-2 tabular-nums">
        {example.created_at.slice(0, 10)}
        {example.source_url && (
          <>
            {' · '}
            <a
              href={example.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              元 URL
            </a>
          </>
        )}
      </div>
    </div>
  )
}

function AddExampleModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [tab, setTab] = useState<InputTab>('text')
  const [textInput, setTextInput] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    industry: string
    broadcast_type: string
    time_of_day: string
    weekday: string
    season: string
    title: string
    content: string
    notes: string
    tags: string
    source_url: string
  }>({
    industry: '',
    broadcast_type: '',
    time_of_day: '',
    weekday: '',
    season: '',
    title: '',
    content: '',
    notes: '',
    tags: '',
    source_url: '',
  })
  const [error, setError] = useState<string | null>(null)

  const handleParse = async () => {
    setError(null)
    setParsing(true)
    try {
      let imgUrl: string | undefined = imageUrl ?? undefined
      // 画像タブで未アップロードの場合、先にアップロード
      if (tab === 'image' && imageFile && !imgUrl) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.onerror = reject
          r.readAsDataURL(imageFile)
        })
        const upRes = await aiApi.agencyExamples.uploadImage({ data: base64 })
        imgUrl = upRes.image_url
        setImageUrl(upRes.image_url)
      }
      const res = await aiApi.agencyExamples.parse({
        source: tab,
        text: tab === 'text' ? textInput : undefined,
        url: tab === 'url' ? urlInput : undefined,
        image_url: tab === 'image' ? imgUrl : undefined,
      })
      if (!res.success) {
        setError(res.error || 'AI 解析失敗')
        return
      }
      setDraft({
        industry: res.parsed.industry ?? '',
        broadcast_type: res.parsed.broadcast_type ?? '',
        time_of_day: res.parsed.time_of_day ?? '',
        weekday: res.parsed.weekday ?? '',
        season: res.parsed.season ?? '',
        title: res.parsed.title ?? '',
        content: res.parsed.content,
        notes: res.parsed.notes ?? '',
        tags: res.parsed.tags.join(', '),
        source_url: tab === 'url' ? urlInput : '',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失敗')
    } finally {
      setParsing(false)
    }
  }

  const handleSave = async () => {
    if (!draft.content.trim()) {
      setError('本文を入力してください')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await aiApi.agencyExamples.create({
        industry: draft.industry || null,
        broadcast_type: draft.broadcast_type || null,
        time_of_day: draft.time_of_day || null,
        weekday: draft.weekday || null,
        season: draft.season || null,
        title: draft.title || null,
        content: draft.content,
        image_url: imageUrl,
        source_url: draft.source_url || null,
        notes: draft.notes || null,
        tags: draft.tags
          .split(/[,、]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">実例を追加</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        <div className="p-5">
          {/* タブ */}
          <div className="flex gap-1 border-b border-gray-200 mb-4">
            {(['text', 'image', 'url'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-xs font-medium border-b-2 ${
                  tab === t ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'text' && '📝 テキスト'}
                {t === 'image' && '📸 スクショ画像'}
                {t === 'url' && '🔗 URL'}
              </button>
            ))}
          </div>

          {/* 入力エリア */}
          {tab === 'text' && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">配信文を貼り付け</label>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="LINE で送られてきた配信文をそのままコピペしてください..."
                rows={8}
                className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
              />
            </div>
          )}

          {tab === 'image' && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                スクショ画像をアップロード (LINE トーク画面など)
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setImageFile(f)
                  setImageUrl(null)
                }}
                className="text-sm"
              />
              {imageFile && (
                <p className="text-[11px] text-gray-500 mt-1">{imageFile.name}</p>
              )}
              {imageUrl && (
                <img src={imageUrl} alt="" className="mt-2 max-h-48 border border-gray-200 rounded" />
              )}
              <p className="text-[11px] text-gray-400 mt-2">
                ※ アップロード後、AI Vision で文面と業界・時間帯を自動推測します
              </p>
            </div>
          )}

          {tab === 'url' && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">URL を貼り付け</label>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://..."
                className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-2">
                Web 記事や note からノウハウを取り込みます
              </p>
            </div>
          )}

          <button
            onClick={handleParse}
            disabled={
              parsing ||
              (tab === 'text' && !textInput.trim()) ||
              (tab === 'image' && !imageFile) ||
              (tab === 'url' && !urlInput.trim())
            }
            className="w-full bg-violet-600 text-white text-sm py-2 rounded disabled:opacity-50 mb-4"
          >
            {parsing ? '🔮 AI 解析中…' : '🔮 AI で自動解析'}
          </button>

          {/* 解析後の編集フォーム */}
          {(draft.content || draft.title) && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div className="text-xs font-medium text-gray-700 mb-2">
                AI が抽出した内容を確認・編集してから保存
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label="配信種別"
                  value={draft.broadcast_type}
                  onChange={(v) => setDraft({ ...draft, broadcast_type: v })}
                  options={BROADCAST_TYPES}
                />
                <SelectField
                  label="時間帯"
                  value={draft.time_of_day}
                  onChange={(v) => setDraft({ ...draft, time_of_day: v })}
                  options={TIME_OF_DAYS}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">タイトル (任意)</label>
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">本文</label>
                <textarea
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  rows={6}
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">タグ (カンマ区切り、任意)</label>
                <input
                  type="text"
                  value={draft.tags}
                  onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                  placeholder="例: 母の日, 割引, リピーター向け"
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">メモ (効果・気づき、任意)</label>
                <input
                  type="text"
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="例: 開封 35%。冒頭の絵文字が効いた"
                  className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
                />
              </div>

              {error && (
                <div className="text-xs text-rose-600 bg-rose-50 px-2 py-1.5 rounded">{error}</div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={onClose}
                  className="text-sm px-3 py-1.5 text-gray-600 hover:text-gray-900"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !draft.content.trim()}
                  className="bg-gray-900 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {error && !draft.content && (
            <div className="text-xs text-rose-600 bg-rose-50 px-2 py-1.5 rounded">{error}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
      >
        <option value="">未指定</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

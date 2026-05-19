'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type KbDocument, type KbSourceType } from '@/lib/ai-api'

const SOURCE_TYPES: Array<{ value: KbSourceType; label: string; emoji: string; desc: string }> = [
  { value: 'faq', label: 'FAQ', emoji: '❓', desc: 'よくある質問と回答' },
  { value: 'product', label: '商品情報', emoji: '🛍', desc: 'メニュー・商品の詳細' },
  { value: 'manual', label: '社内マニュアル', emoji: '📘', desc: '応対手順・運用ルール' },
  { value: 'policy', label: 'ポリシー', emoji: '📜', desc: '利用規約・プライバシー' },
  { value: 'brand_guide', label: 'ブランドガイド', emoji: '🎨', desc: 'トーン・口調・色味・お約束（AI 配信の世界観を統一）' },
  { value: 'external_url', label: '外部 URL', emoji: '🔗', desc: 'Web ページ参照' },
]

export default function KbPage() {
  const { selectedAccountId } = useAccount()
  const [filter, setFilter] = useState<KbSourceType | 'all'>('all')
  const [docs, setDocs] = useState<KbDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<{ id?: string; source_type: KbSourceType; title: string; content: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await aiApi.kb.list(accountId, filter === 'all' ? undefined : { sourceType: filter })
      setDocs(res.documents)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId, filter])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleSave = async () => {
    if (!accountId || !editing) return
    if (!editing.title.trim() || !editing.content.trim()) {
      setToast({ kind: 'error', text: 'タイトルと内容は必須です' })
      return
    }
    setSaving(true)
    try {
      if (editing.id) {
        await aiApi.kb.update(accountId, editing.id, {
          title: editing.title,
          content: editing.content,
          source_type: editing.source_type,
        })
      } else {
        await aiApi.kb.create(accountId, {
          source_type: editing.source_type,
          title: editing.title,
          content: editing.content,
        })
      }
      setToast({ kind: 'success', text: '保存しました' })
      setEditing(null)
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!accountId) return
    if (!confirm('このドキュメントを削除します。よろしいですか？')) return
    try {
      await aiApi.kb.delete(accountId, id)
      setToast({ kind: 'success', text: '削除しました' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '削除失敗' })
    }
  }

  const counts: Record<string, number> = {}
  for (const d of docs) counts[d.source_type] = (counts[d.source_type] ?? 0) + 1

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="ナレッジベース" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="ナレッジベース" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">AI 接客チャットが回答時に参照する知識を蓄積</p>

          {/* タイプ別カウンター */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
            {SOURCE_TYPES.map((t) => {
              const active = filter === t.value
              return (
                <button
                  key={t.value}
                  onClick={() => setFilter(active ? 'all' : t.value)}
                  className={`bg-white rounded-lg shadow p-3 text-left transition-all hover:shadow-md ${active ? 'ring-2 ring-gray-900' : ''}`}
                >
                  <div className="text-2xl mb-1">{t.emoji}</div>
                  <div className="text-xs font-medium text-gray-900">{t.label}</div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-semibold text-gray-900 tabular-nums">{counts[t.value] ?? 0}</span>
                    <span className="text-[11px] text-gray-400">件</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{t.desc}</div>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setFilter('all')} className={`text-sm px-3 py-1.5 rounded ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>すべて ({docs.length})</button>
            <button
              onClick={() => setEditing({
                source_type: filter !== 'all' ? filter : 'faq',
                title: '',
                content: '',
              })}
              className="bg-gray-900 text-white text-sm px-3 py-1.5 rounded hover:bg-gray-700"
            >+ 新規ドキュメント</button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-sm text-gray-400">読み込み中…</div>
          ) : docs.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-md text-center py-16 text-sm text-gray-400">
              まだナレッジが登録されていません
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
              {docs.map((d) => {
                const def = SOURCE_TYPES.find((s) => s.value === d.source_type)
                return (
                  <div key={d.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] text-gray-500 px-1.5 py-0.5 bg-gray-100 rounded">{def?.label}</span>
                          {d.vector_indexed === 1 && <span className="text-[11px] text-emerald-700 px-1.5 py-0.5 bg-emerald-50 rounded">indexed</span>}
                        </div>
                        <h3 className="font-medium text-gray-900">{d.title}</h3>
                        <p className="text-xs text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">{d.content.slice(0, 200)}{d.content.length > 200 && '…'}</p>
                        <p className="text-[11px] text-gray-400 mt-2">更新: {new Date(d.updated_at).toLocaleString('ja-JP')}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => setEditing({ id: d.id, source_type: d.source_type, title: d.title, content: d.content })}
                          className="text-xs bg-white border border-gray-300 text-gray-700 px-2 py-1 rounded hover:bg-gray-50"
                        >編集</button>
                        <button onClick={() => handleDelete(d.id)} className="text-xs text-rose-600 hover:underline">削除</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {editing && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-auto">
              <h3 className="font-medium text-base mb-4">{editing.id ? 'ドキュメント編集' : '新規ドキュメント'}</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">種別</label>
                  <select
                    value={editing.source_type}
                    onChange={(e) => setEditing({ ...editing, source_type: e.target.value as KbSourceType })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  >
                    {SOURCE_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label} - {s.desc}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">タイトル</label>
                  <input
                    type="text"
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    placeholder="例：駐車場について"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">内容</label>
                  <textarea
                    value={editing.content}
                    onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                    placeholder="AI が回答時に参照する内容を入力"
                    className="w-full h-64 px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setEditing(null)} className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50">キャンセル</button>
                <button onClick={handleSave} disabled={saving} className="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700 disabled:bg-gray-300">{saving ? '保存中…' : '保存'}</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

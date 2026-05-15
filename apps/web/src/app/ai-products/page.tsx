'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AiProduct } from '@/lib/ai-api'

interface ProductDraft {
  id?: string
  name: string
  description: string
  price_yen: number | ''
  category: string
  sku: string
  image_url: string
}

const empty: ProductDraft = { name: '', description: '', price_yen: '', category: '', sku: '', image_url: '' }

export default function AiProductsPage() {
  const { selectedAccountId } = useAccount()
  const [products, setProducts] = useState<AiProduct[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ProductDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await aiApi.products.list(accountId, search ? { q: search, limit: 100 } : { limit: 100 })
      setProducts(res.products)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId, search])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleSave = async () => {
    if (!accountId || !editing) return
    if (!editing.name.trim()) {
      setToast({ kind: 'error', text: '商品名は必須です' })
      return
    }
    setSaving(true)
    try {
      await aiApi.products.create(accountId, {
        name: editing.name,
        description: editing.description || undefined,
        price_yen: typeof editing.price_yen === 'number' ? editing.price_yen : undefined,
        category: editing.category || undefined,
        sku: editing.sku || undefined,
        image_url: editing.image_url || undefined,
      })
      setToast({ kind: 'success', text: '商品を追加しました' })
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
    if (!confirm('この商品を削除します。よろしいですか？')) return
    try {
      await aiApi.products.delete(accountId, id)
      setToast({ kind: 'success', text: '削除しました' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '削除失敗' })
    }
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="商品マスタ" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="商品マスタ" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">AI 接客で商品紹介・画像レコメンドに使うマスタ</p>

          <div className="flex items-center justify-between mb-3">
            <input
              type="text"
              placeholder="商品名・カテゴリで検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 max-w-md px-3 py-1.5 border border-gray-300 rounded text-sm"
            />
            <button onClick={() => setEditing(empty)} className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-700">+ 新規商品</button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-sm text-gray-400">読み込み中…</div>
          ) : products.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-md text-center py-16 text-sm text-gray-400">
              まだ商品が登録されていません
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {products.map((p) => (
                <div key={p.id} className="bg-white border border-gray-200 rounded-md p-4">
                  {p.image_url && (
                    <img src={p.image_url} alt={p.name} className="w-full h-32 object-cover rounded mb-3" />
                  )}
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-medium text-gray-900 text-sm">{p.name}</h3>
                    {p.price_yen && <span className="text-sm font-medium text-gray-900 tabular-nums shrink-0">¥{p.price_yen.toLocaleString()}</span>}
                  </div>
                  {p.category && <span className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{p.category}</span>}
                  {p.description && <p className="text-xs text-gray-500 mt-2 line-clamp-2">{p.description}</p>}
                  {p.stock !== null && <p className="text-[11px] text-gray-400 mt-1">在庫: {p.stock}</p>}
                  <div className="flex justify-end mt-3">
                    <button onClick={() => handleDelete(p.id)} className="text-[11px] text-rose-600 hover:underline">削除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {editing && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-auto">
              <h3 className="font-medium text-base mb-4">新規商品</h3>
              <div className="space-y-2">
                <input type="text" placeholder="商品名（必須）" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                <input type="text" placeholder="カテゴリ" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                <input type="number" placeholder="価格（円）" value={editing.price_yen} onChange={(e) => setEditing({ ...editing, price_yen: e.target.value ? Number(e.target.value) : '' })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                <input type="text" placeholder="SKU" value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                <input type="url" placeholder="画像 URL" value={editing.image_url} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                <textarea placeholder="商品説明" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="w-full h-32 px-3 py-2 border border-gray-300 rounded text-sm" />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setEditing(null)} className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50">キャンセル</button>
                <button onClick={handleSave} disabled={saving} className="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700 disabled:bg-gray-300">{saving ? '保存中…' : '追加'}</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

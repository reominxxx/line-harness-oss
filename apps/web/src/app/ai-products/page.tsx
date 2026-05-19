'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AiProduct } from '@/lib/ai-api'
import BulkImportModal from './_components/bulk-import-modal'

interface ProductDraft {
  id?: string
  name: string
  description: string
  price_yen: number | ''
  category: string
  sku: string
  image_url: string
  product_url: string
}

const empty: ProductDraft = { name: '', description: '', price_yen: '', category: '', sku: '', image_url: '', product_url: '' }

export default function AiProductsPage() {
  const { selectedAccountId } = useAccount()
  const [products, setProducts] = useState<AiProduct[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ProductDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const accountId = selectedAccountId

  const handleImageUpload = async (file: File) => {
    if (!editing) return
    if (file.size > 5 * 1024 * 1024) {
      setToast({ kind: 'error', text: '画像サイズは 5MB 以内にしてください' })
      return
    }
    setUploadingImage(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const apiKey = (typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') : null) ?? ''
      // ファイル → base64 変換
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('読み込みエラー'))
        reader.readAsDataURL(file)
      })
      const res = await fetch(`${apiUrl}/api/images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ data: dataUrl, filename: file.name }),
      })
      const json = (await res.json()) as { success: boolean; data?: { url: string }; error?: string }
      if (!res.ok || !json.success || !json.data?.url) {
        throw new Error(json.error ?? 'アップロード失敗')
      }
      setEditing({ ...editing, image_url: json.data.url })
      setToast({ kind: 'success', text: '画像をアップロードしました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : 'アップロード失敗' })
    } finally {
      setUploadingImage(false)
    }
  }

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
      const payload = {
        name: editing.name,
        description: editing.description || undefined,
        price_yen: typeof editing.price_yen === 'number' ? editing.price_yen : undefined,
        category: editing.category || undefined,
        sku: editing.sku || undefined,
        image_url: editing.image_url || undefined,
        product_url: editing.product_url || undefined,
      }
      if (editing.id) {
        await aiApi.products.update(accountId, editing.id, payload)
        setToast({ kind: 'success', text: '商品を更新しました' })
      } else {
        await aiApi.products.create(accountId, payload)
        setToast({ kind: 'success', text: '商品を追加しました' })
      }
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
        <Header title="商品データベース" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="商品データベース" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">AI 接客が商品紹介・画像レコメンドで参照する商品データベース。登録した商品はチャット応答内で自動的に推薦候補になります。</p>

          <div className="flex items-center justify-between gap-3 mb-3">
            <input
              type="text"
              placeholder="商品名・カテゴリで検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 max-w-md px-3 py-1.5 border border-gray-300 rounded text-sm"
            />
            <div className="flex items-center gap-2">
              <button onClick={() => setBulkOpen(true)} className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm hover:bg-emerald-700 font-medium">📥 まとめて取り込む</button>
              <button onClick={() => setEditing(empty)} className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-700">+ 新規商品</button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-sm text-gray-400">読み込み中…</div>
          ) : products.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-md text-center py-16 text-sm text-gray-400">
              まだ商品が登録されていません
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {products.map((p) => (
                <div key={p.id} className="bg-white border border-gray-200 rounded-md overflow-hidden flex flex-col">
                  {/* 正方形画像エリア */}
                  <div className="relative w-full bg-gray-50" style={{ aspectRatio: '1 / 1' }}>
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image_url}
                        alt={p.name}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-3xl">
                        🖼
                      </div>
                    )}
                  </div>
                  <div className="p-3 flex flex-col flex-1">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-medium text-gray-900 text-sm line-clamp-1">{p.name}</h3>
                      {p.price_yen && <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">¥{p.price_yen.toLocaleString()}</span>}
                    </div>
                    {p.category && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded inline-block w-fit">{p.category}</span>}
                    {p.description && <p className="text-[11px] text-gray-500 mt-2 line-clamp-2">{p.description}</p>}
                    {p.stock !== null && <p className="text-[10px] text-gray-400 mt-1">在庫: {p.stock}</p>}
                    <div className="flex justify-end gap-3 mt-auto pt-3 border-t border-gray-100">
                      <button
                        onClick={() => setEditing({
                          id: p.id,
                          name: p.name,
                          description: p.description ?? '',
                          price_yen: p.price_yen ?? '',
                          category: p.category ?? '',
                          sku: p.sku ?? '',
                          image_url: p.image_url ?? '',
                          product_url: p.product_url ?? '',
                        })}
                        className="text-[11px] text-gray-700 hover:text-gray-900 hover:underline"
                      >編集</button>
                      <button onClick={() => handleDelete(p.id)} className="text-[11px] text-rose-600 hover:underline">削除</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {editing && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-auto">
              <h3 className="font-medium text-base mb-4">{editing.id ? '商品を編集' : '新規商品'}</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">商品名 <span className="text-rose-500">*</span></label>
                  <input type="text" placeholder="例：カット、Tシャツ（黒・M）" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">カテゴリ</label>
                  <input type="text" placeholder="例：ヘアメニュー、アパレル" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">価格（円）</label>
                  <input type="number" placeholder="例：6000" value={editing.price_yen} onChange={(e) => setEditing({ ...editing, price_yen: e.target.value ? Number(e.target.value) : '' })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    商品コード <span className="text-gray-400 text-[10px]">（任意・EC や在庫管理が必要な場合）</span>
                  </label>
                  <input type="text" placeholder="例：TSHIRT-BLK-M" value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">商品画像</label>
                  <div className="space-y-2">
                    {editing.image_url && (
                      <div className="flex items-start gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={editing.image_url} alt="プレビュー" className="w-20 h-20 object-cover rounded border border-gray-200" />
                        <button
                          onClick={() => setEditing({ ...editing, image_url: '' })}
                          className="text-xs text-rose-600 hover:underline"
                        >画像を削除</button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <label className="bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 text-xs px-3 py-1.5 rounded cursor-pointer">
                        {uploadingImage ? 'アップロード中…' : '📷 画像をアップロード'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp"
                          disabled={uploadingImage}
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) void handleImageUpload(f)
                            e.target.value = ''
                          }}
                          className="hidden"
                        />
                      </label>
                      <span className="text-[10px] text-gray-400">または ↓ URL を直接入力</span>
                    </div>
                    <input type="url" placeholder="https://..." value={editing.image_url} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-xs" />
                    <p className="text-[10px] text-gray-400">PNG / JPG / GIF / WebP（最大 5MB）</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">商品ページ URL（任意）</label>
                  <input type="url" placeholder="https://example.com/products/..." value={editing.product_url} onChange={(e) => setEditing({ ...editing, product_url: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                  <p className="text-[10px] text-gray-400 mt-1">設定すると AI チャットで商品を紹介する時、お客様がクリックで商品ページに飛べます</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">商品説明</label>
                  <textarea placeholder="特徴・素材・サイズ展開など" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="w-full h-24 px-3 py-2 border border-gray-300 rounded text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setEditing(null)} className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50">キャンセル</button>
                <button onClick={handleSave} disabled={saving} className="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700 disabled:bg-gray-300">{saving ? '保存中…' : (editing.id ? '更新' : '追加')}</button>
              </div>
            </div>
          </div>
        )}
        {bulkOpen && accountId && (
          <BulkImportModal
            accountId={accountId}
            onClose={() => setBulkOpen(false)}
            onImported={(created) => {
              setBulkOpen(false)
              setToast({ kind: 'success', text: `${created} 件を登録しました` })
              void load()
            }}
          />
        )}
      </main>
    </div>
  )
}

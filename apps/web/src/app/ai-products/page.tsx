'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type AiProduct } from '@/lib/ai-api'
import { PRODUCT_KINDS, PRICING_TYPES, CTA_TYPES, INDUSTRY_TEMPLATES, getIndustryTemplate, type AttributeField } from '@line-crm/shared'
import BulkImportModal from './_components/bulk-import-modal'

const KIND_LABELS: Record<string, string> = {
  physical: '物販', service_plan: 'プラン/施術', subscription: 'サブスク', booking: '予約枠', digital: 'デジタル', menu_item: 'メニュー',
}
const PRICING_LABELS: Record<string, string> = {
  fixed: '固定', from: '〜から', range: '幅(X〜Y)', quote: '要相談', subscription: '月額', free: '無料',
}
const CTA_LABELS: Record<string, string> = {
  buy: '購入', book: '予約', consult: '相談/カウンセリング', inquire: '問い合わせ', none: 'なし',
}

interface ProductDraft {
  id?: string
  name: string
  description: string
  price_yen: number | ''
  category: string
  sku: string
  image_url: string
  product_url: string
  product_kind: string
  pricing_type: string
  price_min: number | ''
  price_max: number | ''
  price_note: string
  cta_type: string
  cta_label: string
  cta_url: string
  status: string
  attributes: Record<string, unknown>
}

const empty: ProductDraft = {
  name: '', description: '', price_yen: '', category: '', sku: '', image_url: '', product_url: '',
  product_kind: 'physical', pricing_type: 'fixed', price_min: '', price_max: '', price_note: '',
  cta_type: 'buy', cta_label: '', cta_url: '', status: 'published', attributes: {},
}

/** attributes_json (文字列) を安全に Record へ。壊れていたら空。 */
function parseAttributes(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {}
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** product_kind から既定の業種テンプレを推定 (明示選択が無いとき用)。 */
function inferIndustryId(kind: string): string {
  const t = INDUSTRY_TEMPLATES.find((t) => t.defaultKind === kind)
  return t?.id ?? 'retail'
}

export default function AiProductsPage() {
  const { selectedAccountId } = useAccount()
  const [products, setProducts] = useState<AiProduct[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [editing, setEditing] = useState<ProductDraft | null>(null)
  const [attrIndustry, setAttrIndustry] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
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
      const res = await aiApi.products.list(accountId, {
        limit: 100,
        ...(search ? { q: search } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      })
      setProducts(res.products)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId, search, statusFilter])

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
        product_kind: editing.product_kind,
        pricing_type: editing.pricing_type,
        price_min: typeof editing.price_min === 'number' ? editing.price_min : null,
        price_max: typeof editing.price_max === 'number' ? editing.price_max : null,
        price_note: editing.price_note || null,
        cta_type: editing.cta_type,
        cta_label: editing.cta_label || null,
        cta_url: editing.cta_url || null,
        status: editing.status,
        attributes: Object.keys(editing.attributes).length > 0 ? editing.attributes : null,
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

  const handleDeleteAll = async () => {
    if (!accountId) return
    if (products.length === 0) return
    if (!confirm(`このアカウントの商品をすべて削除します。本当によろしいですか？\nこの操作は取り消せません。`)) return
    setDeletingAll(true)
    try {
      const res = await aiApi.products.deleteAll(accountId)
      setToast({ kind: 'success', text: `${res.deleted} 件を削除しました` })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '一括削除失敗' })
    } finally {
      setDeletingAll(false)
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
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                placeholder="商品名・カテゴリで検索"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 max-w-md px-3 py-1.5 border border-gray-300 rounded text-sm"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="">すべて</option>
                <option value="published">公開のみ</option>
                <option value="draft">下書きのみ</option>
                <option value="archived">非公開のみ</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              {products.length > 0 && (
                <button onClick={handleDeleteAll} disabled={deletingAll} className="border border-rose-300 text-rose-600 px-3 py-1.5 rounded text-sm hover:bg-rose-50 disabled:opacity-50">{deletingAll ? '削除中…' : '🗑 まとめて削除'}</button>
              )}
              <button onClick={() => setBulkOpen(true)} className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm hover:bg-emerald-700 font-medium">📥 まとめて取り込む</button>
              <button onClick={() => { setAttrIndustry('retail'); setEditing(empty) }} className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-700">+ 新規商品</button>
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
                    {p.status === 'draft' && (
                      <span className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow">下書き</span>
                    )}
                    {p.status === 'archived' && (
                      <span className="absolute top-1.5 left-1.5 bg-gray-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded shadow">非公開</span>
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
                        onClick={() => {
                          setAttrIndustry(inferIndustryId(p.product_kind ?? 'physical'))
                          setEditing({
                            id: p.id,
                            name: p.name,
                            description: p.description ?? '',
                            price_yen: p.price_yen ?? '',
                            category: p.category ?? '',
                            sku: p.sku ?? '',
                            image_url: p.image_url ?? '',
                            product_url: p.product_url ?? '',
                            product_kind: p.product_kind ?? 'physical',
                            pricing_type: p.pricing_type ?? 'fixed',
                            price_min: p.price_min ?? '',
                            price_max: p.price_max ?? '',
                            price_note: p.price_note ?? '',
                            cta_type: p.cta_type ?? 'buy',
                            cta_label: p.cta_label ?? '',
                            cta_url: p.cta_url ?? '',
                            status: p.status ?? 'published',
                            attributes: parseAttributes(p.attributes_json),
                          })
                        }}
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
                  <label className="block text-xs text-gray-600 mb-1">価格（円）<span className="text-gray-400 text-[10px]">（代表価格・スライダーに表示）</span></label>
                  <input type="number" placeholder="例：6000" value={editing.price_yen} onChange={(e) => setEditing({ ...editing, price_yen: e.target.value ? Number(e.target.value) : '' })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                </div>

                {/* オファー設定: 種別・価格タイプ・CTA */}
                <div className="border border-gray-200 rounded p-3 bg-gray-50 space-y-3">
                  <p className="text-[11px] font-medium text-gray-500">オファー設定（AI 接客の見せ方）</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">種別</label>
                      <select value={editing.product_kind} onChange={(e) => setEditing({ ...editing, product_kind: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                        {PRODUCT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">価格タイプ</label>
                      <select value={editing.pricing_type} onChange={(e) => setEditing({ ...editing, pricing_type: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                        {PRICING_TYPES.map((p) => <option key={p} value={p}>{PRICING_LABELS[p] ?? p}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">最低価格（幅/〜から用）</label>
                      <input type="number" placeholder="例：8000" value={editing.price_min} onChange={(e) => setEditing({ ...editing, price_min: e.target.value ? Number(e.target.value) : '' })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">最高価格（幅用）</label>
                      <input type="number" placeholder="例：15000" value={editing.price_max} onChange={(e) => setEditing({ ...editing, price_max: e.target.value ? Number(e.target.value) : '' })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">価格の注記</label>
                    <input type="text" placeholder="例：カウンセリング後にお見積り" value={editing.price_note} onChange={(e) => setEditing({ ...editing, price_note: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">ボタン種別</label>
                      <select value={editing.cta_type} onChange={(e) => setEditing({ ...editing, cta_type: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                        {CTA_TYPES.map((c) => <option key={c} value={c}>{CTA_LABELS[c] ?? c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">ボタン文言（任意）</label>
                      <input type="text" placeholder="既定ラベルを使用" value={editing.cta_label} onChange={(e) => setEditing({ ...editing, cta_label: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">ボタンのリンク先（任意・未指定なら商品ページ URL）</label>
                    <input type="url" placeholder="https://..." value={editing.cta_url} onChange={(e) => setEditing({ ...editing, cta_url: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">公開状態</label>
                    <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                      <option value="published">公開（AI 接客が紹介）</option>
                      <option value="draft">下書き（紹介しない）</option>
                      <option value="archived">非公開（アーカイブ）</option>
                    </select>
                  </div>
                </div>

                {/* 業種別の詳細属性 (attributes_json)。業種テンプレでフィールドが変わる。 */}
                <div className="border border-gray-200 rounded p-3 bg-gray-50 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-gray-500">業種別の詳細（AI が会話で使う付加情報）</p>
                    <select value={attrIndustry} onChange={(e) => setAttrIndustry(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-[11px] bg-white">
                      {INDUSTRY_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  {(() => {
                    const tmpl = getIndustryTemplate(attrIndustry)
                    if (!tmpl) return null
                    const setAttr = (key: string, val: unknown) => {
                      const next = { ...editing.attributes }
                      if (val === '' || val === null || val === undefined || (Array.isArray(val) && val.length === 0)) delete next[key]
                      else next[key] = val
                      setEditing({ ...editing, attributes: next })
                    }
                    return (
                      <div className="space-y-2">
                        {tmpl.fields.map((f: AttributeField) => {
                          const cur = editing.attributes[f.key]
                          return (
                            <div key={f.key}>
                              <label className="block text-[11px] text-gray-600 mb-1">
                                {f.label}{f.unit ? <span className="text-gray-400">（{f.unit}）</span> : null}
                                {f.showInFlex ? <span className="ml-1 text-[9px] text-emerald-600">接客表示</span> : null}
                              </label>
                              {f.type === 'boolean' ? (
                                <label className="flex items-center gap-2 text-xs text-gray-700">
                                  <input type="checkbox" checked={cur === true} onChange={(e) => setAttr(f.key, e.target.checked)} />
                                  {f.hint ?? 'あり'}
                                </label>
                              ) : f.type === 'list' ? (
                                <input type="text" placeholder={f.hint ?? 'カンマ区切りで入力'} value={Array.isArray(cur) ? cur.join(', ') : ''} onChange={(e) => setAttr(f.key, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" />
                              ) : f.type === 'number' || f.type === 'duration' ? (
                                <input type="number" placeholder={f.hint ?? ''} value={typeof cur === 'number' ? cur : ''} onChange={(e) => setAttr(f.key, e.target.value ? Number(e.target.value) : '')} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" />
                              ) : (
                                <input type="text" placeholder={f.hint ?? ''} value={typeof cur === 'string' ? cur : ''} onChange={(e) => setAttr(f.key, e.target.value)} className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
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

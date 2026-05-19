'use client'

import { useState } from 'react'
import { aiApi } from '@/lib/ai-api'

type SourceTab = 'text' | 'image' | 'csv' | 'url' | 'shopify'

interface DraftProduct {
  name: string
  price_yen: number | null
  description: string
  category: string
  sku: string
  image_url?: string | null
  stock?: number
  tags?: string[]
}

interface Props {
  accountId: string
  onClose: () => void
  onImported: (created: number) => void
}

const CSV_TEMPLATE = `name,price_yen,description,category,sku
カット,6000,スタイリング込み,ヘアメニュー,
カラー,8000,根本リタッチ,ヘアメニュー,
パーマ,12000,デジタルパーマ,ヘアメニュー,
`

export default function BulkImportModal({ accountId, onClose, onImported }: Props) {
  const [tab, setTab] = useState<SourceTab>('text')
  const [textInput, setTextInput] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [csvInput, setCsvInput] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [shopDomain, setShopDomain] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [drafts, setDrafts] = useState<DraftProduct[] | null>(null)
  const [meta, setMeta] = useState<{ costYen?: number; model?: string; count?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)

  const handleParse = async () => {
    setError(null)
    setDrafts(null)
    setMeta(null)
    setParsing(true)
    try {
      if (tab === 'shopify') {
        const res = await aiApi.products.shopifyFetch(accountId, {
          shop_domain: shopDomain.trim(),
          access_token: accessToken.trim(),
        })
        if (!res.success) {
          setError(res.error ?? 'Shopify 取得失敗')
          return
        }
        setDrafts(res.products)
        setMeta({ count: res.meta?.count })
      } else {
        const input: Record<string, string> = { source: tab }
        if (tab === 'text') input.text = textInput
        if (tab === 'image') input.image_url = imageUrl
        if (tab === 'csv') input.csv = csvInput
        if (tab === 'url') input.url = siteUrl
        const res = await aiApi.products.parse(accountId, input as Parameters<typeof aiApi.products.parse>[1])
        if (!res.success) {
          setError(res.error ?? 'AI 解析失敗')
          return
        }
        setDrafts(res.products)
        setMeta({ costYen: res.meta?.costYen, model: res.meta?.model })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失敗')
    } finally {
      setParsing(false)
    }
  }

  const handleImport = async () => {
    if (!drafts || drafts.length === 0) return
    setImporting(true)
    try {
      const res = await aiApi.products.bulkImport(
        accountId,
        drafts.map((d) => ({
          name: d.name,
          price_yen: d.price_yen,
          description: d.description,
          category: d.category,
          sku: d.sku,
          image_url: d.image_url ?? undefined,
          stock: d.stock,
          tags: d.tags,
        })),
        skipDuplicates,
      )
      if (res.success) {
        onImported(res.summary.created)
      } else {
        setError('登録失敗')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録失敗')
    } finally {
      setImporting(false)
    }
  }

  const downloadCsvTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'product-template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const updateDraft = (i: number, patch: Partial<DraftProduct>) => {
    if (!drafts) return
    setDrafts(drafts.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }
  const removeDraft = (i: number) => {
    if (!drafts) return
    setDrafts(drafts.filter((_, idx) => idx !== i))
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-base">📥 商品をまとめて取り込む</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900">✕</button>
        </div>

        {!drafts && (
          <>
            <div className="border-b border-gray-200 px-6">
              <div className="flex gap-1 overflow-x-auto">
                {(
                  [
                    { key: 'text', label: '✏️ テキスト' },
                    { key: 'image', label: '📷 画像/PDF' },
                    { key: 'csv', label: '📄 CSV' },
                    { key: 'url', label: '🌐 サイト URL' },
                    { key: 'shopify', label: '🛍 Shopify 連携' },
                  ] as Array<{ key: SourceTab; label: string }>
                ).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => { setTab(t.key); setError(null) }}
                    className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                      tab === t.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {tab === 'text' && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">
                    メモ書きでも箇条書きでも OK。AI が商品名・価格・説明を自動で抽出します。
                  </p>
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    rows={12}
                    placeholder={`例:\nカット 6000円、カラー 8000円〜10000円（長さで）、\nパーマ 12000円、トリートメント 3000円追加で\n\n新メニュー: 髪質改善トリートメント 15000円`}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                  />
                </div>
              )}

              {tab === 'image' && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">
                    メニュー表の画像 URL を入力してください。AI が画像内のメニューを読み取ります。
                  </p>
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://example.com/menu.jpg"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  />
                  <p className="text-[11px] text-gray-400 mt-2">
                    画像は公開 URL である必要があります（社内アップロード機能は今後追加予定）
                  </p>
                </div>
              )}

              {tab === 'csv' && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs text-gray-500">CSV を貼り付け、または下のボタンでテンプレートをダウンロード</p>
                    <button onClick={downloadCsvTemplate} className="text-xs text-blue-600 hover:underline">
                      📥 テンプレートをダウンロード
                    </button>
                  </div>
                  <textarea
                    value={csvInput}
                    onChange={(e) => setCsvInput(e.target.value)}
                    rows={12}
                    placeholder={CSV_TEMPLATE}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-mono"
                  />
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const reader = new FileReader()
                      reader.onload = () => setCsvInput(reader.result as string)
                      reader.readAsText(f)
                    }}
                    className="text-xs mt-2"
                  />
                </div>
              )}

              {tab === 'url' && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">
                    EC サイトや商品ページの URL を入力。HTML を取得して AI が商品を抽出します。
                  </p>
                  <input
                    type="url"
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                    placeholder="https://shop.example.com/products"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  />
                  <p className="text-[11px] text-gray-400 mt-2">
                    ※ サイト構造によっては精度が下がります。利用規約 / robots.txt を遵守してご利用ください。
                  </p>
                </div>
              )}

              {tab === 'shopify' && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Shopify 管理画面 → アプリ → カスタムアプリ で Admin API トークンを発行してください。
                    products の read 権限が必要です。
                  </p>
                  <input
                    type="text"
                    value={shopDomain}
                    onChange={(e) => setShopDomain(e.target.value)}
                    placeholder="yourstore.myshopify.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                  />
                  <input
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="shpat_xxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                  />
                  <p className="text-[11px] text-gray-400">
                    アクセストークンは安全に扱われ、サーバー側に保存されません（このセッションのみ）
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3 rounded">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
              <button onClick={onClose} className="text-sm text-gray-600 px-3 py-1.5">キャンセル</button>
              <button
                onClick={handleParse}
                disabled={parsing}
                className="bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white text-sm px-4 py-2 rounded font-medium"
              >
                {parsing ? '解析中…' : '🔍 解析する'}
              </button>
            </div>
          </>
        )}

        {drafts && (
          <>
            <div className="px-6 py-3 border-b border-gray-200 bg-emerald-50 flex items-center justify-between">
              <div>
                <span className="font-semibold text-emerald-900">{drafts.length} 件 抽出されました</span>
                {meta?.costYen !== undefined && (
                  <span className="ml-3 text-xs text-emerald-700">AI コスト ¥{meta.costYen.toFixed(2)}</span>
                )}
              </div>
              <button onClick={() => { setDrafts(null); setError(null) }} className="text-xs text-gray-600 hover:text-gray-900">
                ← 別の方法で解析
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {drafts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">商品が抽出されませんでした</p>
              ) : (
                <div className="space-y-2">
                  {drafts.map((d, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={d.name}
                            onChange={(e) => updateDraft(i, { name: e.target.value })}
                            className="col-span-2 px-2 py-1 border border-gray-300 rounded text-sm font-medium"
                            placeholder="商品名"
                          />
                          <input
                            type="number"
                            value={d.price_yen ?? ''}
                            onChange={(e) => updateDraft(i, { price_yen: e.target.value ? Number(e.target.value) : null })}
                            className="px-2 py-1 border border-gray-300 rounded text-xs"
                            placeholder="価格（円）"
                          />
                          <input
                            type="text"
                            value={d.category}
                            onChange={(e) => updateDraft(i, { category: e.target.value })}
                            className="px-2 py-1 border border-gray-300 rounded text-xs"
                            placeholder="カテゴリ"
                          />
                          <textarea
                            value={d.description}
                            onChange={(e) => updateDraft(i, { description: e.target.value })}
                            className="col-span-2 px-2 py-1 border border-gray-300 rounded text-xs resize-none"
                            placeholder="商品説明"
                            rows={2}
                          />
                        </div>
                        <button
                          onClick={() => removeDraft(i)}
                          className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded shrink-0"
                        >削除</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              <label className="text-xs text-gray-700 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  className="accent-gray-900"
                />
                同名の既存商品はスキップ
              </label>
              <div className="flex gap-2">
                <button onClick={onClose} className="text-sm text-gray-600 px-3 py-1.5">キャンセル</button>
                <button
                  onClick={handleImport}
                  disabled={importing || drafts.length === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-sm px-5 py-2 rounded font-medium"
                >
                  {importing ? '登録中…' : `✓ ${drafts.length} 件を登録`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

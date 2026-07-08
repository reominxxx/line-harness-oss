'use client'

import { useState } from 'react'
import { aiApi } from '@/lib/ai-api'
import { INDUSTRY_TEMPLATES, PRODUCT_KINDS, PRICING_TYPES, CTA_TYPES } from '@line-crm/shared'

type SourceTab = 'text' | 'image' | 'csv' | 'url' | 'shopify_url' | 'shopify' | 'hearing'

type HearingMessage = { role: 'user' | 'assistant'; content: string }

// offer 系フィールドの日本語ラベル (プレビュー編集用)
const KIND_LABELS: Record<string, string> = {
  physical: '物販', service_plan: 'プラン/施術', subscription: 'サブスク', booking: '予約枠', digital: 'デジタル', menu_item: 'メニュー',
}
const PRICING_LABELS: Record<string, string> = {
  fixed: '固定', from: '〜から', range: '幅(X〜Y)', quote: '要相談', subscription: '月額', free: '無料',
}
const CTA_LABELS: Record<string, string> = {
  buy: '購入', book: '予約', consult: '相談/カウンセリング', inquire: '問い合わせ', none: 'なし',
}

interface DraftProduct {
  name: string
  price_yen: number | null
  price_min?: number | null
  price_max?: number | null
  price_note?: string | null
  description: string
  category: string
  sku: string
  image_url?: string | null
  product_url?: string | null
  stock?: number
  tags?: string[]
  product_kind?: string | null
  pricing_type?: string | null
  cta_type?: string | null
  external_id?: string | null
  source?: string | null
  attributes?: Record<string, unknown> | null
}

interface Props {
  accountId: string
  onClose: () => void
  onImported: (created: number) => void
}

// 顧客記入用テンプレート。Google スプレッドシート / Excel どちらでも開ける UTF-8 CSV。
// 画像は image_url 列に「公開された画像 URL」または「Google ドライブの共有リンク」を貼り付け。
// 取込時にサーバー側で取得し、高画質のまま保存します。
const CSV_HEADER = 'name,category,price_yen,sku,image_url,product_url,description'
const CSV_TEMPLATE = `${CSV_HEADER}
カット,ヘアメニュー,6000,,https://example.com/images/cut.jpg,,スタイリング込み
カラー,ヘアメニュー,8000,,,,根本リタッチ
Tシャツ（黒・M）,アパレル,3500,TSHIRT-BLK-M,https://example.com/images/tshirt.jpg,https://example.com/products/tshirt,綿100% / S/M/L 展開
`

// CSV ヘッダー → 内部フィールドの対応（日本語・英語の表記ゆれを吸収）
const HEADER_ALIASES: Record<keyof Pick<DraftProduct, 'name' | 'category' | 'price_yen' | 'sku' | 'image_url' | 'product_url' | 'description'> | 'stock' | 'tags', string[]> = {
  name: ['name', '商品名', '名前', 'title', 'メニュー', 'メニュー名', '品名'],
  category: ['category', 'カテゴリ', 'カテゴリー', '分類', 'ジャンル'],
  price_yen: ['price_yen', 'price', '価格', '価格(円)', '価格（円）', '値段', '料金', '金額'],
  sku: ['sku', '商品コード', '型番', 'コード', 'jan', 'janコード'],
  image_url: ['image_url', 'image', '画像', '画像url', '画像URL', '商品画像', '画像リンク', 'img'],
  product_url: ['product_url', 'url', '商品ページurl', '商品ページURL', 'ページurl', 'リンク', '商品url'],
  description: ['description', '説明', '商品説明', '詳細', '備考', 'メモ'],
  stock: ['stock', '在庫', '在庫数', 'qty', 'quantity'],
  tags: ['tags', 'タグ', 'tag'],
}

// RFC4180 準拠の最小 CSV パーサ（"" エスケープ・改行・カンマ含みフィールド対応）
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  // 先頭 BOM を除去
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      // 空行はスキップ
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((c) => c.trim() !== '')) rows.push(row)
  }
  return rows
}

// CSV テキスト → DraftProduct[]。ヘッダーが認識できなければ null（AI 解析にフォールバック）。
function csvToDrafts(text: string): DraftProduct[] | null {
  const rows = parseCsv(text)
  if (rows.length < 2) return null
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const colIndex: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[keyof typeof HEADER_ALIASES, string[]]>) {
    const idx = header.findIndex((h) => aliases.some((a) => a.toLowerCase() === h))
    if (idx >= 0) colIndex[field] = idx
  }
  // 最低限 name 列が無ければ認識失敗
  if (colIndex.name === undefined) return null

  const get = (cols: string[], field: keyof typeof HEADER_ALIASES): string => {
    const i = colIndex[field]
    return i === undefined ? '' : (cols[i] ?? '').trim()
  }
  const toPrice = (v: string): number | null => {
    const n = parseInt(v.replace(/[^\d.]/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const httpsOrNull = (v: string): string | null => (/^https?:\/\//i.test(v) ? v : null)

  const drafts: DraftProduct[] = []
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]
    const name = get(cols, 'name')
    if (!name) continue
    const stockStr = get(cols, 'stock')
    const tagsStr = get(cols, 'tags')
    drafts.push({
      name: name.slice(0, 200),
      category: get(cols, 'category').slice(0, 100),
      price_yen: toPrice(get(cols, 'price_yen')),
      sku: get(cols, 'sku').slice(0, 100),
      image_url: httpsOrNull(get(cols, 'image_url')),
      product_url: httpsOrNull(get(cols, 'product_url')),
      description: get(cols, 'description').slice(0, 1000),
      stock: stockStr ? Number(stockStr.replace(/[^\d]/g, '')) || undefined : undefined,
      tags: tagsStr ? tagsStr.split(/[、,|]/).map((t) => t.trim()).filter(Boolean) : undefined,
    })
  }
  return drafts.length > 0 ? drafts : null
}

// parse API の結果 1 件 → DraftProduct。offer 系フィールド(price_min 等)があれば引き継ぐ。
type ParsedProduct = Awaited<ReturnType<typeof aiApi.products.parse>>['products'][number]
function fromParsed(p: ParsedProduct): DraftProduct {
  return {
    name: p.name,
    price_yen: p.price_yen ?? null,
    price_min: p.price_min ?? null,
    price_max: p.price_max ?? null,
    description: p.description ?? '',
    category: p.category ?? '',
    sku: p.sku ?? '',
    image_url: p.image_url ?? null,
    product_url: p.product_url ?? null,
    product_kind: p.product_kind ?? null,
    attributes: p.attributes ?? null,
  }
}

export default function BulkImportModal({ accountId, onClose, onImported }: Props) {
  const [tab, setTab] = useState<SourceTab>('text')
  const [textInput, setTextInput] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  // 画像/PDF のローカルアップロード (base64・data: プレフィックス除去済み)
  const [fileData, setFileData] = useState('')
  const [fileMediaType, setFileMediaType] = useState('')
  const [fileName, setFileName] = useState('')
  const [csvInput, setCsvInput] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [shopifyPublicUrl, setShopifyPublicUrl] = useState('')
  const [shopDomain, setShopDomain] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [drafts, setDrafts] = useState<DraftProduct[] | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: number; imagesRehosted: number; errorDetails: Array<{ index: number; reason: string }> } | null>(null)
  const [meta, setMeta] = useState<{ costYen?: number; model?: string; count?: number; truncated?: boolean; structured?: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  // 業種テンプレート: offer フィールド未指定分の既定値の供給源。空 = 汎用。
  const [industry, setIndustry] = useState<string>('')
  // 取込後すぐ公開するか。構造化ソース(Shopify等)は既定 true、AI抽出は下書き推奨で false。
  const [publishNow, setPublishNow] = useState(true)
  // 対話ヒアリング用の会話状態
  const [hearingMessages, setHearingMessages] = useState<HearingMessage[]>([])
  const [hearingInput, setHearingInput] = useState('')
  const [hearingLoading, setHearingLoading] = useState(false)
  const [hearingDone, setHearingDone] = useState(false)

  const sendHearing = async (content: string) => {
    const text = content.trim()
    if (!text || hearingLoading) return
    const nextMessages: HearingMessage[] = [...hearingMessages, { role: 'user', content: text }]
    setHearingMessages(nextMessages)
    setHearingInput('')
    setHearingLoading(true)
    setError(null)
    try {
      const res = await aiApi.products.hearing(accountId, {
        industry: industry || undefined,
        messages: nextMessages,
      })
      if (!res.success) {
        setError(res.error ?? 'ヒアリングに失敗しました')
        return
      }
      setHearingMessages([...nextMessages, { role: 'assistant', content: res.reply }])
      if (res.done && res.products.length > 0) {
        setHearingDone(true)
        setDrafts(res.products.map((p) => ({
          name: p.name, price_yen: p.price_yen, price_min: p.price_min, price_max: p.price_max,
          description: p.description, category: p.category, sku: '',
          product_kind: p.product_kind, pricing_type: p.pricing_type, cta_type: p.cta_type,
          attributes: p.attributes, source: p.source,
        })))
        setMeta({ costYen: res.meta?.costYen, model: res.meta?.model, count: res.products.length })
        // AI 抽出なので下書き既定（運用者が確認して公開）
        setPublishNow(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ヒアリングに失敗しました')
    } finally {
      setHearingLoading(false)
    }
  }

  const handleFileSelect = (file: File | undefined) => {
    if (!file) return
    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']
    if (!allowed.includes(file.type)) {
      setError('対応形式は 画像(PNG/JPEG/GIF/WebP) または PDF です')
      return
    }
    if (file.size > 4_500_000) {
      setError('ファイルが大きすぎます（約 4.5MB まで）')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const base64 = result.includes(',') ? result.split(',')[1] : result
      setFileData(base64)
      setFileMediaType(file.type)
      setFileName(file.name)
      setImageUrl('')
      setError(null)
    }
    reader.onerror = () => setError('ファイルの読み込みに失敗しました')
    reader.readAsDataURL(file)
  }

  const clearFile = () => { setFileData(''); setFileMediaType(''); setFileName('') }

  const handleParse = async () => {
    setError(null)
    setDrafts(null)
    setMeta(null)
    setParsing(true)
    try {
      if (tab === 'shopify_url') {
        const res = await aiApi.products.shopifyPublicFetch(accountId, { url: shopifyPublicUrl.trim() })
        if (!res.success) {
          setError(res.error ?? 'Shopify 公開データの取得に失敗しました')
          return
        }
        setDrafts(res.products.map((p) => ({
          name: p.name, price_yen: p.price_yen, price_min: p.price_min, price_max: p.price_max,
          description: p.description, category: p.category, sku: p.sku,
          image_url: p.image_url, product_url: p.product_url, stock: p.stock ?? undefined, tags: p.tags,
          product_kind: p.product_kind, pricing_type: p.pricing_type, cta_type: p.cta_type,
          external_id: p.external_id, source: p.source,
        })))
        setMeta({ count: res.meta?.count, structured: true })
        setPublishNow(true)
      } else if (tab === 'shopify') {
        const res = await aiApi.products.shopifyFetch(accountId, {
          shop_domain: shopDomain.trim(),
          access_token: accessToken.trim(),
        })
        if (!res.success) {
          setError(res.error ?? 'Shopify 取得失敗')
          return
        }
        setDrafts(res.products.map((p) => ({
          name: p.name, price_yen: p.price_yen, description: p.description, category: p.category, sku: p.sku,
          image_url: p.image_url, stock: p.stock, tags: p.tags,
          product_kind: p.product_kind, external_id: p.external_id, source: p.source,
        })))
        setMeta({ count: res.meta?.count })
        setPublishNow(true)
      } else if (tab === 'csv') {
        // まず決定的にパース（列が認識できれば AI を使わず正確・無料・高速）
        const local = csvToDrafts(csvInput)
        if (local) {
          setDrafts(local)
          setMeta({ count: local.length, structured: true })
          setPublishNow(true)
          return
        }
        // 列が認識できない自由形式 CSV のみ AI にフォールバック
        const res = await aiApi.products.parse(accountId, { source: 'csv', csv: csvInput })
        if (!res.success) {
          setError(res.error ?? 'CSV の解析に失敗しました。テンプレートの列名をご確認ください。')
          return
        }
        setDrafts(res.products.map(fromParsed))
        setMeta({ costYen: res.meta?.costYen, model: res.meta?.model })
        setPublishNow(false)
      } else if (tab !== 'hearing') {
        const input: Parameters<typeof aiApi.products.parse>[1] = { source: tab }
        if (industry) input.industry = industry
        if (tab === 'text') input.text = textInput
        if (tab === 'url') input.url = siteUrl
        if (tab === 'image') {
          if (fileData) {
            // ローカルアップロード: PDF は source='pdf'、画像は source='image' で base64 送信
            input.source = fileMediaType === 'application/pdf' ? 'pdf' : 'image'
            input.file_data = fileData
            input.media_type = fileMediaType
          } else if (imageUrl.trim()) {
            input.image_url = imageUrl.trim()
          } else {
            setError('画像/PDF ファイルを選ぶか、公開画像 URL を入力してください')
            return
          }
        }
        const res = await aiApi.products.parse(accountId, input)
        if (!res.success) {
          setError(res.error ?? 'AI 解析失敗')
          return
        }
        const structured = res.meta?.structured === true
        setDrafts(res.products.map(fromParsed))
        setMeta({ costYen: res.meta?.costYen, model: res.meta?.model, truncated: res.meta?.truncated, structured })
        // JSON-LD 等の構造化抽出は信頼度が高いので即公開、LLM 抽出は下書き推奨
        setPublishNow(structured)
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
          price_min: d.price_min ?? null,
          price_max: d.price_max ?? null,
          price_note: d.price_note ?? null,
          description: d.description,
          category: d.category,
          sku: d.sku,
          image_url: d.image_url ?? undefined,
          product_url: d.product_url ?? undefined,
          stock: d.stock,
          tags: d.tags,
          product_kind: d.product_kind ?? null,
          pricing_type: d.pricing_type ?? null,
          cta_type: d.cta_type ?? null,
          external_id: d.external_id ?? null,
          source: d.source ?? null,
          attributes: d.attributes ?? null,
        })),
        { skipDuplicates, industry: industry || null, status: publishNow ? 'published' : 'draft' },
      )
      if (res.success) {
        // 結果サマリを表示（スキップ・失敗を握りつぶさず全件の帰結を見せる）
        setResult({
          created: res.summary.created,
          updated: res.summary.updated,
          skipped: res.summary.skipped,
          errors: res.summary.errors,
          imagesRehosted: res.summary.imagesRehosted,
          errorDetails: res.errors ?? [],
        })
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
    // BOM 付き UTF-8。Excel / Google スプレッドシートで日本語が文字化けしない。
    const blob = new Blob(['﻿' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '商品テンプレート.csv'
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
                    { key: 'hearing', label: '💬 対話ヒアリング' },
                    { key: 'image', label: '📷 画像/PDF' },
                    { key: 'csv', label: '📄 CSV' },
                    { key: 'shopify_url', label: '🛍 Shopify(URL貼るだけ)' },
                    { key: 'url', label: '🌐 サイト URL' },
                    { key: 'shopify', label: '🔑 Shopify(API連携)' },
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

              {tab === 'hearing' && (
                <div className="flex flex-col h-full min-h-0">
                  <p className="text-xs text-gray-500 mb-2">
                    AI とチャットしながら商品・サービスを聞き取ります。ITが苦手な店舗オーナーでも、質問に答えるだけでカタログが作れます。
                    {industry ? '' : '（上の業種を選ぶと、業種に合わせた質問になります）'}
                  </p>
                  <div className="flex-1 min-h-[240px] max-h-[46vh] overflow-auto border border-gray-200 rounded p-3 space-y-2 bg-gray-50">
                    {hearingMessages.length === 0 ? (
                      <div className="text-center text-xs text-gray-400 py-8">
                        「ヘアサロンをやっています」など、まずはお店や扱っている商品を一言で教えてください。
                      </div>
                    ) : (
                      hearingMessages.map((m, i) => (
                        <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                          <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                            m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-800'
                          }`}>
                            {m.content}
                          </div>
                        </div>
                      ))
                    )}
                    {hearingLoading && (
                      <div className="flex justify-start">
                        <div className="px-3 py-2 rounded-lg text-sm bg-white border border-gray-200 text-gray-400">…</div>
                      </div>
                    )}
                  </div>
                  {hearingDone ? (
                    <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                      カタログ案ができました。下の「確認画面へ」で内容を確認して登録してください。続けて話しかければ追記もできます。
                    </div>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={hearingInput}
                      onChange={(e) => setHearingInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void sendHearing(hearingInput) } }}
                      placeholder="メッセージを入力…"
                      disabled={hearingLoading}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm disabled:bg-gray-100"
                    />
                    <button
                      onClick={() => void sendHearing(hearingInput)}
                      disabled={hearingLoading || !hearingInput.trim()}
                      className="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700 disabled:opacity-40 shrink-0"
                    >送信</button>
                    {hearingMessages.length > 0 && !hearingDone && (
                      <button
                        onClick={() => void sendHearing('以上です。ここまでの内容でカタログを作ってください。')}
                        disabled={hearingLoading}
                        className="border border-gray-300 text-gray-700 px-3 py-2 rounded text-sm hover:bg-gray-50 disabled:opacity-40 shrink-0"
                      >聞き取り終了</button>
                    )}
                  </div>
                </div>
              )}

              {tab === 'image' && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">
                    メニュー表・料金表の <span className="font-medium">画像や PDF</span> をアップロードすると、AI が中の商品/メニューを読み取ります。
                  </p>
                  {fileData ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded bg-gray-50">
                      <span className="text-xs text-gray-700 truncate">
                        {fileMediaType === 'application/pdf' ? '📄' : '🖼'} {fileName}
                      </span>
                      <button onClick={clearFile} className="text-[11px] text-rose-600 hover:underline shrink-0">選び直す</button>
                    </div>
                  ) : (
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
                      onChange={(e) => handleFileSelect(e.target.files?.[0])}
                      className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-gray-900 file:text-white hover:file:bg-gray-700"
                    />
                  )}
                  <div className="mt-3">
                    <p className="text-[11px] text-gray-400 mb-1">または公開画像 URL を貼り付け</p>
                    <input
                      type="url"
                      value={imageUrl}
                      onChange={(e) => { setImageUrl(e.target.value); if (e.target.value) clearFile() }}
                      placeholder="https://example.com/menu.jpg"
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      disabled={!!fileData}
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    下の「業種」を選ぶと、種別や業種別の項目もできる範囲で自動で読み取ります。
                  </p>
                </div>
              )}

              {tab === 'csv' && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs font-medium text-gray-700">顧客に記入してもらった CSV を取り込みます</p>
                    <button onClick={downloadCsvTemplate} className="text-xs text-blue-600 hover:underline shrink-0">
                      📥 記入用テンプレートをダウンロード
                    </button>
                  </div>

                  {/* 顧客向けの記入フロー案内 */}
                  <div className="mb-3 bg-blue-50 border border-blue-100 rounded p-3 text-[11px] text-blue-900 leading-relaxed">
                    <p className="font-semibold mb-1">📋 顧客への依頼の流れ（Google スプレッドシート推奨）</p>
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>「記入用テンプレート」をダウンロードして顧客に共有</li>
                      <li>Google ドライブにアップロード →「Google スプレッドシートで開く」で編集してもらう</li>
                      <li>記入後、<span className="font-medium">ファイル → ダウンロード →「カンマ区切り形式 (.csv)」</span>で書き出してもらう</li>
                      <li>その CSV を下のファイル選択で読み込み → 「解析する」</li>
                    </ol>
                    <p className="mt-1.5 text-blue-800">
                      画像は <span className="font-medium">image_url 列</span> に「公開された画像 URL」を貼り付けてもらってください。取込時に高画質のまま当サービス側へ保存します。
                    </p>
                  </div>

                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      const reader = new FileReader()
                      reader.onload = () => setCsvInput(reader.result as string)
                      reader.readAsText(f, 'utf-8')
                    }}
                    className="text-xs mb-2 block"
                  />
                  <p className="text-[11px] text-gray-400 mb-1">または CSV を直接貼り付け:</p>
                  <textarea
                    value={csvInput}
                    onChange={(e) => setCsvInput(e.target.value)}
                    rows={8}
                    placeholder={CSV_TEMPLATE}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-mono"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    対応列: 商品名 / カテゴリ / 価格 / 商品コード / 画像URL / 商品ページURL / 商品説明（日本語・英語の列名どちらも自動認識）
                  </p>
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

              {tab === 'shopify_url' && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">
                    Shopify ストアの URL を貼るだけ。トークン不要で全商品を取り込みます（公開商品データを利用）。
                  </p>
                  <input
                    type="url"
                    value={shopifyPublicUrl}
                    onChange={(e) => setShopifyPublicUrl(e.target.value)}
                    placeholder="https://yourstore.myshopify.com （独自ドメインでも可）"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                  />
                  <p className="text-[11px] text-gray-400 mt-2">
                    ※ ストアが商品データの公開を無効にしている場合は取得できません。その場合は「🔑 Shopify(API連携)」をご利用ください。
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

            <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between gap-2 bg-gray-50">
              <label className="text-xs text-gray-600 flex items-center gap-1.5">
                <span className="whitespace-nowrap">業種</span>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
                >
                  <option value="">汎用（指定なし）</option>
                  {INDUSTRY_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button onClick={onClose} className="text-sm text-gray-600 px-3 py-1.5">キャンセル</button>
                <button
                  onClick={handleParse}
                  disabled={parsing}
                  className="bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white text-sm px-4 py-2 rounded font-medium"
                >
                  {parsing ? '解析中…' : '🔍 解析する'}
                </button>
              </div>
            </div>
          </>
        )}

        {drafts && !result && (
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

            {meta?.truncated && (
              <div className="px-6 py-2 border-b border-amber-200 bg-amber-50 text-xs text-amber-800">
                ⚠️ 商品数が多く、AI の出力上限に達したため末尾の一部を取りこぼした可能性があります。ページを絞る（カテゴリ/ページ送り単位の URL）か、数回に分けて取り込んでください。
              </div>
            )}

            <div className="flex-1 overflow-auto p-6">
              {drafts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">商品が抽出されませんでした</p>
              ) : (
                <div className="space-y-2">
                  {drafts.map((d, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded p-3">
                      <div className="flex items-start gap-3">
                        {/* 画像プレビュー (AI が image_url を割り当てた場合) */}
                        <div className="shrink-0 w-20">
                          {d.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={d.image_url}
                              alt=""
                              className="w-20 h-20 object-cover rounded border border-gray-200 bg-gray-50"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                          ) : (
                            <div className="w-20 h-20 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-300 text-2xl">📦</div>
                          )}
                          <input
                            type="url"
                            value={d.image_url ?? ''}
                            onChange={(e) => updateDraft(i, { image_url: e.target.value || null })}
                            placeholder="画像 URL"
                            className="w-full mt-1 px-1.5 py-0.5 border border-gray-200 rounded text-[10px]"
                          />
                        </div>
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
                          <input
                            type="url"
                            value={d.product_url ?? ''}
                            onChange={(e) => updateDraft(i, { product_url: e.target.value || null })}
                            className="col-span-2 px-2 py-1 border border-gray-300 rounded text-xs"
                            placeholder="商品ページ URL（任意）"
                          />
                          <textarea
                            value={d.description}
                            onChange={(e) => updateDraft(i, { description: e.target.value })}
                            className="col-span-2 px-2 py-1 border border-gray-300 rounded text-xs resize-none"
                            placeholder="商品説明"
                            rows={2}
                          />
                          <div className="col-span-2 grid grid-cols-3 gap-2">
                            <select
                              value={d.product_kind ?? 'physical'}
                              onChange={(e) => updateDraft(i, { product_kind: e.target.value })}
                              className="px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white"
                              title="種別"
                            >
                              {PRODUCT_KINDS.map((k) => (
                                <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>
                              ))}
                            </select>
                            <select
                              value={d.pricing_type ?? 'fixed'}
                              onChange={(e) => updateDraft(i, { pricing_type: e.target.value })}
                              className="px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white"
                              title="価格タイプ"
                            >
                              {PRICING_TYPES.map((p) => (
                                <option key={p} value={p}>{PRICING_LABELS[p] ?? p}</option>
                              ))}
                            </select>
                            <select
                              value={d.cta_type ?? 'buy'}
                              onChange={(e) => updateDraft(i, { cta_type: e.target.value })}
                              className="px-1.5 py-1 border border-gray-200 rounded text-[11px] bg-white"
                              title="ボタン"
                            >
                              {CTA_TYPES.map((c) => (
                                <option key={c} value={c}>{CTA_LABELS[c] ?? c}</option>
                              ))}
                            </select>
                          </div>
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
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-700 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="accent-gray-900"
                  />
                  同名の既存商品はスキップ
                </label>
                <label className="text-xs text-gray-700 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={publishNow}
                    onChange={(e) => setPublishNow(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  取り込み後すぐ公開する（オフ = 下書き保存）
                </label>
              </div>
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

        {result && (
          <>
            <div className="flex-1 overflow-auto p-6">
              <div className="text-center mb-5">
                <div className="text-3xl mb-2">✅</div>
                <p className="font-semibold text-gray-900">取り込みが完了しました</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="bg-emerald-50 border border-emerald-100 rounded p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-700 tabular-nums">{result.created}</div>
                  <div className="text-[11px] text-emerald-800">新規登録</div>
                </div>
                <div className="bg-blue-50 border border-blue-100 rounded p-3 text-center">
                  <div className="text-2xl font-bold text-blue-700 tabular-nums">{result.updated}</div>
                  <div className="text-[11px] text-blue-800">更新（再同期）</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
                  <div className="text-2xl font-bold text-gray-600 tabular-nums">{result.skipped}</div>
                  <div className="text-[11px] text-gray-700">スキップ（重複等）</div>
                </div>
                <div className={`border rounded p-3 text-center ${result.errors > 0 ? 'bg-rose-50 border-rose-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className={`text-2xl font-bold tabular-nums ${result.errors > 0 ? 'text-rose-700' : 'text-gray-400'}`}>{result.errors}</div>
                  <div className={`text-[11px] ${result.errors > 0 ? 'text-rose-800' : 'text-gray-500'}`}>失敗</div>
                </div>
              </div>

              {result.imagesRehosted > 0 && (
                <p className="text-[11px] text-gray-500 mb-3">🖼 画像 {result.imagesRehosted} 件を当サービスへ保存（高画質化・リンク切れ対策）しました。</p>
              )}

              {result.skipped > 0 && result.errors === 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs p-3 rounded mb-3">
                  {result.skipped} 件は既存商品と重複（商品名の一致、または再同期対象）のためスキップしました。上書きしたい場合は「同名の既存商品はスキップ」をオフにするか、個別に編集してください。
                </div>
              )}

              {result.errors > 0 && (
                <div className="bg-rose-50 border border-rose-200 rounded p-3 mb-3">
                  <p className="text-xs font-semibold text-rose-800 mb-1">{result.errors} 件が登録できませんでした</p>
                  <ul className="text-[11px] text-rose-700 space-y-0.5 max-h-40 overflow-auto">
                    {result.errorDetails.map((e, idx) => (
                      <li key={idx}>#{e.index + 1}: {e.reason}</li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-rose-600 mt-1.5">上記は登録されていません。原因を直して再度お試しください。</p>
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-gray-200 flex justify-end bg-gray-50">
              <button
                onClick={() => onImported(result.created + result.updated)}
                className="bg-gray-900 hover:bg-gray-700 text-white text-sm px-5 py-2 rounded font-medium"
              >
                完了して一覧へ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

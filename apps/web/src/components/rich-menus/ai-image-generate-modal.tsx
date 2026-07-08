'use client'

import { useEffect, useState } from 'react'
import { compressForRichMenu, formatBytes } from '@/lib/image-compress'
import { ImagePromptBuilderModal } from '@/components/ai/image-prompt-builder-modal'
import { useAccount } from '@/contexts/account-context'

// リッチメニュー用 (large/compact) と、配信用 (square/landscape/portrait/banner) の両方をサポート。
// 親が `availableSizes` で表示する選択肢を絞れる。
type RichMenuSize = 'large' | 'compact' | 'square' | 'landscape' | 'portrait' | 'banner_wide'

// 画像生成の「用途」。用途ごとに最適なプロンプト座組み・推奨サイズに切り替わる。
export type ImagePurpose =
  | 'rich_menu'
  | 'coupon'
  | 'card_message'
  | 'broadcast'
  | 'event'
  | 'scenario'
  | 'template'

interface Props {
  open: boolean
  onClose: () => void
  /** 親から渡される初期サイズ。モーダル内で切替可能 */
  size: RichMenuSize
  menuName?: string
  /** モーダルで表示するサイズ選択肢を絞る。省略時は purpose ごとの推奨セット */
  availableSizes?: RichMenuSize[]
  /** 画像の用途。タイトル・推奨サイズ・裏側プロンプトを切り替える。省略時は rich_menu */
  purpose?: ImagePurpose
  /** 画像取得後 (圧縮 & File 化済み) のコールバック。最終的に適用したサイズも返す */
  onSelect: (
    file: File,
    info: { prompt: string; originalBytes: number; compressedBytes: number; size: RichMenuSize },
  ) => Promise<void>
}

// 用途ごとの表示名・推奨サイズ。availableSizes 未指定時の選択肢を決める。
const PURPOSE_META: Record<ImagePurpose, { title: string; sizes: RichMenuSize[] }> = {
  rich_menu: { title: 'リッチメニュー画像', sizes: ['large', 'compact'] },
  coupon: { title: 'クーポン画像', sizes: ['landscape', 'square', 'banner_wide'] },
  card_message: { title: 'カード式メッセージ画像', sizes: ['square', 'landscape', 'portrait'] },
  broadcast: { title: '配信クリエイティブ', sizes: ['square', 'landscape', 'banner_wide', 'portrait'] },
  event: { title: 'イベント告知画像', sizes: ['landscape', 'banner_wide', 'square', 'portrait'] },
  scenario: { title: 'ステップ配信画像', sizes: ['square', 'landscape', 'portrait'] },
  template: { title: 'テンプレート画像', sizes: ['square', 'landscape', 'banner_wide', 'portrait'] },
}

const SIZE_OPTIONS: Array<{ value: RichMenuSize; label: string; subLabel: string; layoutHint: string }> = [
  {
    value: 'large',
    label: 'Large (3:2)',
    subLabel: '2500×1686',
    layoutHint: 'リッチメニュー大 / 6 ボタン (3×2)',
  },
  {
    value: 'compact',
    label: 'Compact (3:1)',
    subLabel: '2500×843',
    layoutHint: 'リッチメニュー小 / 3 ボタン (1×3)',
  },
  {
    value: 'square',
    label: 'スクエア (1:1)',
    subLabel: '1024×1024',
    layoutHint: '配信画像・SNS 投稿風・LINE 配信に最適',
  },
  {
    value: 'landscape',
    label: '横長 (3:2)',
    subLabel: '1536×1024',
    layoutHint: '配信ヘッダー・キャンペーン告知バナー',
  },
  {
    value: 'banner_wide',
    label: 'ワイドバナー (16:9)',
    subLabel: '1536×864 相当',
    layoutHint: 'YouTube サムネ風・ヘッダー型告知',
  },
  {
    value: 'portrait',
    label: '縦長 (2:3)',
    subLabel: '1024×1536',
    layoutHint: 'ポスター・縦型告知・ストーリー風',
  },
]

type Variation = {
  status: 'pending' | 'done' | 'error'
  dataUrl?: string
  errorMessage?: string
}

const DEFAULTS_STORAGE = 'rich-menu-ai-defaults'

type CvMenuItem = { name: string; subcopy: string }

// CV 特化テンプレートの初期文言 (worker 側 DEFAULT_CV_MENU_ITEMS と一致させる)
const DEFAULT_CV_MENU_ITEMS: CvMenuItem[] = [
  { name: '無料診断', subcopy: 'LINE改善ポイントがわかる' },
  { name: '料金プラン', subcopy: '月額・内容を見る' },
  { name: '実績を見る', subcopy: '改善事例を確認' },
  { name: '無料相談', subcopy: 'まずは相談する' },
  { name: 'サービス資料', subcopy: '詳しい内容をDL' },
  { name: 'よくある質問', subcopy: '不安を解消' },
]

function shortHost(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 30)
  }
}

function Spinner({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const s = { sm: 'w-4 h-4 border-2', lg: 'w-12 h-12 border-4' }[size]
  return <div className={`${s} border-emerald-100 border-t-emerald-600 rounded-full animate-spin flex-shrink-0`} />
}

export function AiImageGenerateModal({ open, onClose, size: initialSize, menuName, availableSizes, purpose = 'rich_menu', onSelect }: Props) {
  const { selectedAccount } = useAccount()
  const purposeMeta = PURPOSE_META[purpose] ?? PURPOSE_META.rich_menu
  // availableSizes 明示指定があればそれを優先。なければ用途の推奨セット。
  const effectiveSizes = availableSizes ?? purposeMeta.sizes
  const [defaults, setDefaults] = useState('')
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  // AI プロンプト構築モーダル: スタイルガイド用 / クリエイティブ用
  const [promptBuilderKind, setPromptBuilderKind] = useState<'style_guide' | 'creative' | null>(null)

  const [size, setSize] = useState<RichMenuSize>(initialSize)
  const [prompt, setPrompt] = useState('')
  const [imageCount, setImageCount] = useState(2)

  // CV 特化テンプレート (文字入りリッチメニュー)。large/compact のみ対応。
  const [cvMode, setCvMode] = useState(false)
  const [cvMenuItems, setCvMenuItems] = useState<CvMenuItem[]>(() =>
    DEFAULT_CV_MENU_ITEMS.map((it) => ({ ...it })),
  )

  // 参考リンク (HP / Instagram 等を複数)。情報を取り込んでブランド文脈を作る。全用途共通。
  const [referenceLinks, setReferenceLinks] = useState<string[]>([''])
  const [linksLoading, setLinksLoading] = useState(false)
  const [brandContext, setBrandContext] = useState('')
  const [linksNote, setLinksNote] = useState<string | null>(null)

  /** 参考画像 (base64、data URL 含まず raw のみ) */
  const [referenceImageBase64, setReferenceImageBase64] = useState<string | null>(null)
  const [referenceImageName, setReferenceImageName] = useState<string | null>(null)

  const [generating, setGenerating] = useState(false)
  const [variations, setVariations] = useState<Variation[]>([])
  const [genError, setGenError] = useState<string | null>(null)

  const [revisionRequests, setRevisionRequests] = useState<string[]>([])
  const [revisingIndex, setRevisingIndex] = useState<number | null>(null)

  const [applyingIndex, setApplyingIndex] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setDefaults(window.localStorage.getItem(DEFAULTS_STORAGE) ?? '')
  }, [])

  // 親から initialSize が変わったら反映 (モーダルを開き直したとき等)。
  // 用途の推奨サイズに initialSize が含まれないケースは推奨先頭にフォールバック。
  useEffect(() => {
    setSize(effectiveSizes.includes(initialSize) ? initialSize : effectiveSizes[0] ?? initialSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSize, purpose])

  const currentSizeOpt = SIZE_OPTIONS.find((s) => s.value === size) ?? SIZE_OPTIONS[0]
  const sizeLabel = `${currentSizeOpt.subLabel} (${currentSizeOpt.label})`
  const layoutHint = currentSizeOpt.layoutHint

  async function handleReferenceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setGenError('参考画像は 8MB 以下にしてください')
      return
    }
    setGenError(null)
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] ?? ''
      setReferenceImageBase64(base64)
      setReferenceImageName(file.name)
    }
    reader.readAsDataURL(file)
  }

  function clearReferenceImage() {
    setReferenceImageBase64(null)
    setReferenceImageName(null)
  }

  // CV テンプレートはリッチメニューサイズ (large/compact) のみ
  const cvAvailable = size === 'large' || size === 'compact'
  const cvTileCount = size === 'compact' ? 3 : 6

  function updateCvItem(index: number, patch: Partial<CvMenuItem>) {
    setCvMenuItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  function setLink(index: number, value: string) {
    setReferenceLinks((prev) => {
      const next = prev.map((u, i) => (i === index ? value : u))
      // 末尾が埋まったら空欄を1つ足す（最大5）
      if (index === next.length - 1 && value.trim() && next.length < 5) next.push('')
      return next
    })
  }

  function removeLink(index: number) {
    setReferenceLinks((prev) => {
      const next = prev.filter((_, i) => i !== index)
      return next.length ? next : ['']
    })
  }

  // 複数の参考リンク (HP / Instagram 等) から情報を取り込み、ブランド文脈を組み立てる。
  async function loadBrandFromLinks() {
    const urls = referenceLinks.map((u) => u.trim()).filter(Boolean)
    if (urls.length === 0) return
    if (!selectedAccount) {
      setLinksNote('アカウントが選択されていません')
      return
    }
    setLinksLoading(true)
    setLinksNote(null)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
    const blocks: string[] = []
    let okCount = 0
    for (const url of urls) {
      try {
        const res = await fetch(`${apiUrl}/api/ai-generate/brand-from-url`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-Line-Account-Id': selectedAccount.id,
          },
          body: JSON.stringify({ url }),
        })
        const json = (await res.json()) as {
          success: boolean
          brandOneLine?: string
          colors?: string
          industry?: string
          tone?: string
          error?: string
        }
        if (!res.ok || !json.success) continue
        const parts = [
          json.brandOneLine && `ブランド: ${json.brandOneLine}`,
          json.industry && `業種: ${json.industry}`,
          json.colors && `配色: ${json.colors}`,
          json.tone && `トーン: ${json.tone}`,
        ].filter(Boolean)
        if (parts.length) {
          blocks.push(`【${shortHost(url)}】\n${parts.join('\n')}`)
          okCount++
        }
      } catch {
        /* 1件失敗しても他を続行 */
      }
    }
    const context = blocks.join('\n\n')
    setBrandContext(context)
    setLinksNote(
      okCount > 0
        ? `✓ ${okCount}/${urls.length} 件のリンクから情報を取り込みました`
        : '情報を取り込めませんでした（Instagram 等は読めない場合があります）',
    )
    setLinksLoading(false)
  }

  if (!open) return null

  function saveDefaults() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DEFAULTS_STORAGE, defaults)
      setDefaultsSaved(true)
      setTimeout(() => setDefaultsSaved(false), 2000)
    }
  }

  async function callGenerate(opts: {
    prompt: string
    variationIndex?: number
    totalCount?: number
    revisionRequest?: string
    previousImageBase64?: string
    referenceImageBase64?: string | null
    template?: 'cv_rich_menu'
    menuItems?: CvMenuItem[]
    brandContext?: string
  }): Promise<string> {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
    const res = await fetch(`${apiUrl}/api/rich-menu-images/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ size, defaultsText: defaults, purpose, brandContext, ...opts }),
    })
    const json = (await res.json()) as { success: boolean; imageBase64?: string; mimeType?: string; error?: string }
    if (!res.ok || !json.success || !json.imageBase64) {
      throw new Error(json.error ?? '画像生成に失敗しました')
    }
    return `data:${json.mimeType ?? 'image/png'};base64,${json.imageBase64}`
  }

  async function handleGenerate() {
    const useCv = cvMode && cvAvailable
    const finalPrompt = prompt.trim()
    if (!useCv && !finalPrompt) {
      setGenError('プロンプトを入力してください')
      return
    }
    const cvItems = useCv ? cvMenuItems.slice(0, cvTileCount).filter((it) => it.name.trim()) : []
    if (useCv && cvItems.length === 0) {
      setGenError('ボタンの見出しを 1 つ以上入力してください')
      return
    }
    setGenError(null)
    setGenerating(true)
    setRevisionRequests(Array(imageCount).fill(''))
    const initial: Variation[] = Array.from({ length: imageCount }, () => ({ status: 'pending' as const }))
    setVariations(initial)

    for (let i = 0; i < imageCount; i++) {
      try {
        const dataUrl = await callGenerate({
          prompt: finalPrompt,
          variationIndex: i,
          totalCount: imageCount,
          referenceImageBase64,
          ...(useCv ? { template: 'cv_rich_menu' as const, menuItems: cvItems } : {}),
        })
        setVariations((prev) => prev.map((v, idx) => (idx === i ? { status: 'done', dataUrl } : v)))
      } catch (e) {
        setVariations((prev) =>
          prev.map((v, idx) =>
            idx === i ? { status: 'error', errorMessage: e instanceof Error ? e.message : '生成失敗' } : v,
          ),
        )
      }
    }
    setGenerating(false)
  }

  async function handleRevise(index: number) {
    const req = revisionRequests[index]?.trim()
    if (!req) return
    const target = variations[index]
    if (!target?.dataUrl) return
    setRevisingIndex(index)
    setGenError(null)
    try {
      const prevB64 = target.dataUrl.split(',')[1] ?? ''
      const useCv = cvMode && cvAvailable
      const dataUrl = await callGenerate({
        prompt,
        revisionRequest: req,
        previousImageBase64: prevB64,
        ...(useCv
          ? {
              template: 'cv_rich_menu' as const,
              menuItems: cvMenuItems.slice(0, cvTileCount).filter((it) => it.name.trim()),
            }
          : {}),
      })
      setVariations((prev) => prev.map((v, idx) => (idx === index ? { status: 'done', dataUrl } : v)))
      setRevisionRequests((prev) => prev.map((r, idx) => (idx === index ? '' : r)))
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '修正に失敗しました')
    } finally {
      setRevisingIndex(null)
    }
  }

  async function handleApply(index: number) {
    const v = variations[index]
    if (!v?.dataUrl) return
    setApplyingIndex(index)
    setGenError(null)
    try {
      const blob = await (await fetch(v.dataUrl)).blob()
      const rawFile = new File([blob], `ai-generated-${Date.now()}.png`, {
        type: blob.type || 'image/png',
      })
      const compressed = await compressForRichMenu(rawFile, size)
      await onSelect(compressed.file, {
        prompt,
        originalBytes: rawFile.size,
        compressedBytes: compressed.compressedBytes,
        size,
      })
      handleClose()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : '反映に失敗しました')
    } finally {
      setApplyingIndex(null)
    }
  }

  function handleClose() {
    setVariations([])
    setRevisionRequests([])
    setGenError(null)
    setGenerating(false)
    setRevisingIndex(null)
    setApplyingIndex(null)
    setReferenceImageBase64(null)
    setReferenceImageName(null)
    setReferenceLinks([''])
    setBrandContext('')
    setLinksNote(null)
    onClose()
  }

  const doneCount = variations.filter((v) => v.status === 'done').length
  const pendingCount = variations.filter((v) => v.status === 'pending').length

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto">
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-emerald-50 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          {/* ヘッダー */}
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">✨ AI で{purposeMeta.title}を生成</h1>
              <p className="text-slate-500 mt-1 text-sm">
                {menuName && <span className="font-medium text-slate-700">{menuName}</span>}
                {menuName && ' · '}
                {sizeLabel} · {layoutHint}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg bg-white"
            >
              ✕ 閉じる
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* ===== 左: 入力 ===== */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
              <h2 className="text-base font-semibold text-slate-700 border-b border-slate-100 pb-3">
                入力設定
              </h2>

              {/* デフォルト訴求 */}
              <div className="border border-amber-200 rounded-xl bg-amber-50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDefaultsOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-amber-500">★</span>
                    <span className="text-sm font-medium text-amber-800">
                      ブランドスタイルガイド（毎回反映）
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-amber-400 transition-transform ${defaultsOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {defaultsOpen && (
                  <div className="px-4 pb-4 space-y-2 border-t border-amber-200">
                    <div className="flex items-center justify-between gap-2 pt-3">
                      <p className="text-xs text-amber-700 flex-1">
                        ここに書いた内容は毎回の生成に組み込まれます（ブランドカラー・トーン等）
                      </p>
                      <button
                        type="button"
                        onClick={() => setPromptBuilderKind('style_guide')}
                        className="shrink-0 text-[11px] bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1 rounded transition-colors whitespace-nowrap"
                        title="数項目を埋めるだけで AI が良いスタイルガイドを作ります"
                      >
                        ✨ AI で作る
                      </button>
                    </div>
                    <textarea
                      value={defaults}
                      onChange={(e) => setDefaults(e.target.value)}
                      rows={5}
                      placeholder={'例: ブランドカラーは #06C755 (LINE グリーン) と白。\nトーン: 親しみやすい、清潔感、過度な装飾を避ける。\nNG: 蛍光色、ピンク系'}
                      className="w-full border border-amber-200 rounded-lg px-3 py-2 text-slate-700 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={saveDefaults}
                      className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      {defaultsSaved ? '✓ 保存しました' : 'この端末に保存'}
                    </button>
                  </div>
                )}
              </div>

              {/* サイズ選択 */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-600">サイズパターン</label>
                <div className="grid grid-cols-2 gap-2">
                  {SIZE_OPTIONS.filter((opt) => effectiveSizes.includes(opt.value)).map((opt) => {
                    const selected = opt.value === size
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSize(opt.value)}
                        className={`text-left text-xs px-3 py-2 border rounded-lg transition-colors ${
                          selected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50'
                        }`}
                      >
                        <div className="font-medium text-sm mb-0.5">{opt.label}</div>
                        <div className="text-[10px] text-slate-500">{opt.subLabel} · {opt.layoutHint}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 参考リンク (HP / Instagram 等を複数)。全用途共通でブランド情報を取り込む */}
              <div className="border border-sky-200 rounded-xl bg-sky-50/60 p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span>🔗</span>
                  <span className="text-sm font-medium text-sky-800">参考リンクから情報を取り込む</span>
                  <span className="text-[10px] text-slate-400 font-normal">(任意)</span>
                </div>
                <p className="text-[11px] text-sky-700">
                  ホームページや Instagram などの URL を複数貼ると、ブランドの世界観・配色・トーンを読み取って生成に反映します。
                </p>
                <div className="space-y-1.5">
                  {referenceLinks.map((url, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="url"
                        value={url}
                        onChange={(e) => setLink(i, e.target.value)}
                        placeholder={i === 0 ? 'https://example.com（HP）' : 'https://instagram.com/...'}
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
                      />
                      {referenceLinks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLink(i)}
                          className="shrink-0 px-2 text-slate-400 hover:text-rose-600 text-sm"
                          title="この行を削除"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={loadBrandFromLinks}
                  disabled={linksLoading || referenceLinks.every((u) => !u.trim())}
                  className="w-full py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {linksLoading ? '読込中…' : 'リンクから情報を取り込む'}
                </button>
                {linksNote && <p className="text-[11px] text-sky-700">{linksNote}</p>}
                {brandContext && (
                  <pre className="text-[10px] text-slate-600 bg-white border border-slate-200 rounded-lg p-2 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                    {brandContext}
                  </pre>
                )}
              </div>

              {/* CV 最適化テンプレート (large/compact のみ) */}
              {cvAvailable && (
                <div className="border border-emerald-200 rounded-xl bg-emerald-50/60 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setCvMode((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span>🎯</span>
                      <span className="text-sm font-medium text-emerald-800">
                        CV最適化テンプレート（文字入り）
                      </span>
                    </div>
                    <span
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        cvMode ? 'bg-emerald-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          cvMode ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </button>
                  {cvMode && (
                    <div className="px-4 pb-4 space-y-4 border-t border-emerald-200 pt-3">
                      <p className="text-[11px] text-emerald-700">
                        各ボタンの見出し・サブコピーを画像に直接描画し、予約・問い合わせ・購入につながる構成で生成します（{cvTileCount} 区画）。世界観は上の「参考リンク」から取り込めます。
                      </p>

                      {/* メニュー文言 */}
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-slate-600">
                          ボタンの文言（上段→下段の順）
                        </label>
                        {cvMenuItems.slice(0, cvTileCount).map((item, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="shrink-0 w-5 text-center text-[11px] text-slate-400 font-medium">
                              {i + 1}
                            </span>
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => updateCvItem(i, { name: e.target.value })}
                              placeholder="見出し"
                              className="w-28 shrink-0 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                            <input
                              type="text"
                              value={item.subcopy}
                              onChange={(e) => updateCvItem(i, { subcopy: e.target.value })}
                              placeholder="サブコピー (任意)"
                              className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400"
                            />
                          </div>
                        ))}
                        <p className="text-[11px] text-slate-400">
                          AI は日本語文字が崩れる場合があります。崩れたら「修正する」で整えられます。
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 参考画像 */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-600">
                  参考画像 <span className="ml-1 text-[10px] text-slate-400 font-normal">(任意)</span>
                </label>
                {referenceImageBase64 ? (
                  <div className="flex items-center gap-3 border border-slate-200 rounded-lg p-3 bg-slate-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/*;base64,${referenceImageBase64}`}
                      alt="参考画像プレビュー"
                      className="w-16 h-16 object-cover rounded border border-slate-200"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-700 truncate">{referenceImageName}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">この画像の雰囲気・色合いを参考にします</p>
                    </div>
                    <button
                      type="button"
                      onClick={clearReferenceImage}
                      className="text-xs text-rose-600 hover:text-rose-700 px-2 py-1 rounded hover:bg-rose-50"
                    >
                      × 外す
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center w-full px-3 py-4 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleReferenceFileChange}
                      className="hidden"
                    />
                    <div className="text-center">
                      <p className="text-xs text-slate-600">📎 参考画像をアップロード (任意)</p>
                      <p className="text-[10px] text-slate-400 mt-1">この画像の雰囲気を踏まえて生成します</p>
                    </div>
                  </label>
                )}
              </div>

              {/* プロンプト */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium text-slate-600">
                    どんな画像にする?
                    {cvMode && cvAvailable && (
                      <span className="ml-1 text-[10px] text-slate-400 font-normal">(任意・追加の指定があれば)</span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => setPromptBuilderKind('creative')}
                    className="shrink-0 text-[11px] bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1 rounded transition-colors whitespace-nowrap"
                    title="目的・主役・雰囲気を選ぶだけで AI が良いプロンプトを作ります"
                  >
                    ✨ AI で作る
                  </button>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  placeholder="例: 美容室のリッチメニュー画像。淡いピンクと白を基調に、桜のモチーフ..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none text-sm"
                />
                <p className="text-[11px] text-slate-400">
                  {cvMode && cvAvailable
                    ? 'CV最適化テンプレート使用中。ここは色味や雰囲気など追加の希望があれば入力してください'
                    : '文字なしでアイコン中心の構成にすると、後からタップ領域を配置しやすいです'}
                </p>
              </div>

              {/* 生成枚数 */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-600">
                  生成枚数 <span className="ml-2 text-emerald-700 font-bold">{imageCount} 枚</span>
                </label>
                <div className="flex gap-1.5 flex-wrap">
                  {[1, 2, 3, 4, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setImageCount(n)}
                      className={`w-10 h-10 rounded-lg text-sm font-medium transition-all ${
                        imageCount === n
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">
                  1 枚あたり 30〜60 秒。複数枚は順番に生成（合計 {imageCount * 45}秒前後）
                </p>
              </div>

              {/* 生成ボタン */}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || (!(cvMode && cvAvailable) && !prompt.trim())}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm"
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    生成中… ({doneCount}/{imageCount})
                  </span>
                ) : (
                  `クリエイティブを生成（${imageCount} 枚）`
                )}
              </button>

              {genError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
                  <strong>エラー: </strong>
                  {genError}
                </div>
              )}
            </div>

            {/* ===== 右: 結果 ===== */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-base font-semibold text-slate-700">生成結果</h2>
                {variations.length > 0 && !generating && (
                  <span className="text-xs text-slate-400">{doneCount} 枚完成</span>
                )}
              </div>

              {/* 初期状態 */}
              {variations.length === 0 && !generating && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-300 gap-4">
                  <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <p className="text-sm text-center">
                    左の入力欄でプロンプトを書いて
                    <br />
                    「クリエイティブを生成」を押してください
                  </p>
                </div>
              )}

              {/* プログレス */}
              {generating && pendingCount > 0 && (
                <div className="flex items-center gap-3 bg-emerald-50 rounded-lg px-4 py-3">
                  <Spinner size="sm" />
                  <div className="flex-1">
                    <div className="text-xs text-emerald-800 font-medium mb-1.5">
                      {doneCount} / {imageCount} 枚生成完了
                    </div>
                    <div className="w-full bg-emerald-100 rounded-full h-1.5">
                      <div
                        className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${(doneCount / imageCount) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* グリッド */}
              {variations.length > 0 && (
                <div className={`grid gap-4 ${variations.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {variations.map((v, index) => (
                    <div
                      key={index}
                      className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white"
                    >
                      <div
                        className={`relative w-full bg-slate-100 overflow-hidden ${
                          size === 'large' ? 'aspect-[2500/1686]'
                          : size === 'compact' ? 'aspect-[2500/843]'
                          : size === 'square' ? 'aspect-square'
                          : size === 'landscape' ? 'aspect-[3/2]'
                          : size === 'banner_wide' ? 'aspect-[16/9]'
                          : 'aspect-[2/3]'
                        }`}
                      >
                        {v.status === 'pending' && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Spinner size="sm" />
                          </div>
                        )}
                        {v.status === 'done' && v.dataUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.dataUrl} alt={`バリエーション ${index + 1}`} className="w-full h-full object-cover" />
                        )}
                        {v.status === 'error' && (
                          <div className="absolute inset-0 flex items-center justify-center p-2 text-center">
                            <p className="text-[11px] text-rose-600">{v.errorMessage ?? '生成失敗'}</p>
                          </div>
                        )}
                        <span className="absolute top-2 left-2 bg-black/55 text-white text-[10px] px-2 py-0.5 rounded-full">
                          {index + 1}/{variations.length}
                        </span>
                      </div>

                      {v.status === 'done' && v.dataUrl && (
                        <div className="p-3 space-y-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleApply(index)}
                              disabled={applyingIndex !== null}
                              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-medium rounded-lg transition-colors"
                            >
                              {applyingIndex === index ? '反映中…' : '✓ この画像を使う'}
                            </button>
                            <a
                              href={v.dataUrl}
                              download={`rich-menu-${index + 1}.png`}
                              className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs rounded-lg transition-colors"
                              title="ダウンロード"
                            >
                              ⬇
                            </a>
                          </div>

                          <div className="space-y-1.5">
                            <textarea
                              value={revisionRequests[index] ?? ''}
                              onChange={(e) =>
                                setRevisionRequests((prev) =>
                                  prev.map((r, i) => (i === index ? e.target.value : r)),
                                )
                              }
                              placeholder="修正依頼（例: もっとシンプルに / 色を青系に）"
                              rows={2}
                              className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-slate-700 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                            />
                            <button
                              onClick={() => handleRevise(index)}
                              disabled={!(revisionRequests[index] ?? '').trim() || revisingIndex !== null}
                              className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-100 disabled:text-slate-400 text-white text-xs font-medium rounded-lg transition-colors"
                            >
                              {revisingIndex === index ? '修正中…' : '修正する'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* コスト目安 */}
              {variations.length > 0 && (
                <p className="text-[11px] text-slate-400 text-center pt-2 border-t border-slate-100">
                  OpenAI gpt-image-2 使用 / 1 枚 ¥20〜50 程度
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI プロンプト構築モーダル */}
      <ImagePromptBuilderModal
        open={promptBuilderKind !== null}
        kind={promptBuilderKind ?? 'creative'}
        context="rich_menu"
        onClose={() => setPromptBuilderKind(null)}
        size={
          size === 'large' ? '1536x1024'
          : size === 'compact' ? '1536x1024'
          : size === 'square' ? '1024x1024'
          : size === 'landscape' ? '1536x1024'
          : size === 'portrait' ? '1024x1536'
          : size === 'banner_wide' ? '1536x864'
          : '1024x1024'
        }
        styleGuideText={defaults}
        onApply={(text) => {
          if (promptBuilderKind === 'style_guide') {
            setDefaults(text)
            setDefaultsOpen(true)
          } else {
            setPrompt(text)
          }
        }}
      />
    </div>
  )
}

export { formatBytes }

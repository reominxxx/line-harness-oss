'use client'

/**
 * 汎用 AI 画像生成モーダル (gpt-image-2)
 *
 * 配信用バナー・告知画像・キャンペーン画像など、LINE 配信に乗せるクリエイティブを
 * AI 生成する。リッチメニュー専用の AiImageGenerateModal (rich-menus 配下) と
 * 違って、配信用の正方形 / 横長 / 縦長サイズに対応。
 *
 * 生成された画像は R2 に保存され、imageUrl (公開URL) として onSelect で返される。
 * 呼び出し側は LINE messaging API の image タイプにそのまま使える。
 */

import { useState } from 'react'
import { useAccount } from '@/contexts/account-context'

export type AiImageGenSize = '1024x1024' | '1024x1536' | '1536x1024'

interface Props {
  open: boolean
  onClose: () => void
  /** 生成された画像 URL を返す */
  onSelect: (imageUrl: string, info: { prompt: string; size: AiImageGenSize; costYenX100: number }) => void
  /** 初期プロンプト */
  initialPrompt?: string
  /** デフォルトサイズ (省略時 1024x1024) */
  defaultSize?: AiImageGenSize
  /** モーダルタイトル */
  title?: string
}

const SIZE_OPTIONS: Array<{ value: AiImageGenSize; label: string; ratio: string; use: string }> = [
  { value: '1024x1024', label: 'スクエア', ratio: '1:1', use: '汎用バナー・SNS 投稿風' },
  { value: '1536x1024', label: '横長', ratio: '3:2', use: '配信ヘッダー・キャンペーン告知' },
  { value: '1024x1536', label: '縦長', ratio: '2:3', use: 'ポスター・縦型告知' },
]

interface Variant {
  imageUrl: string
  prompt: string
  size: AiImageGenSize
  costYenX100: number
}

export function AiImageGenerateModalGeneric({
  open,
  onClose,
  onSelect,
  initialPrompt = '',
  defaultSize = '1024x1024',
  title = '✨ AI で画像を作る',
}: Props) {
  const { selectedAccount } = useAccount()
  const [prompt, setPrompt] = useState(initialPrompt)
  const [size, setSize] = useState<AiImageGenSize>(defaultSize)
  const [generating, setGenerating] = useState(false)
  const [variants, setVariants] = useState<Variant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [totalCost, setTotalCost] = useState(0)

  if (!open) return null

  async function generate() {
    if (!selectedAccount) { setError('アカウントが選択されていません'); return }
    if (!prompt.trim()) { setError('プロンプトを入力してください'); return }
    setError(null)
    setGenerating(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
      const res = await fetch(`${apiUrl}/api/ai-generate/image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Line-Account-Id': selectedAccount.id,
        },
        body: JSON.stringify({ prompt: prompt.trim(), size }),
      })
      const json = (await res.json()) as {
        success: boolean
        imageUrl?: string
        costYenX100?: number
        error?: string
      }
      if (!res.ok || !json.success || !json.imageUrl) {
        throw new Error(json.error ?? '画像生成に失敗しました')
      }
      const cost = json.costYenX100 ?? 0
      setVariants((prev) => [...prev, { imageUrl: json.imageUrl!, prompt: prompt.trim(), size, costYenX100: cost }])
      setTotalCost((prev) => prev + cost)
    } catch (e) {
      setError(e instanceof Error ? e.message : '画像生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }

  function handleApply(v: Variant) {
    onSelect(v.imageUrl, { prompt: v.prompt, size: v.size, costYenX100: v.costYenX100 })
    handleClose()
  }

  function handleClose() {
    setVariants([])
    setPrompt(initialPrompt)
    setError(null)
    setTotalCost(0)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto" onClick={handleClose}>
      <div className="min-h-screen p-4 md:p-8 flex items-start justify-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
          {/* ヘッダー */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">{title}</h2>
              <p className="text-xs text-slate-500 mt-1">
                gpt-image-2 で生成。R2 に保存され LINE 配信に直接使えます。
              </p>
            </div>
            <button
              onClick={handleClose}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg"
            >
              ✕ 閉じる
            </button>
          </div>

          {/* サイズ選択 */}
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-2">サイズ</label>
            <div className="grid grid-cols-3 gap-2">
              {SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSize(opt.value)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    size === opt.value
                      ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-800">{opt.label}</div>
                  <div className="text-[11px] text-slate-500">{opt.ratio} / {opt.value}</div>
                  <div className="text-[11px] text-slate-400 mt-1">{opt.use}</div>
                </button>
              ))}
            </div>
          </div>

          {/* プロンプト */}
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <label className="block text-sm font-medium text-slate-600">
                画像の指示 <span className="text-red-500">*</span>
              </label>
              <span className="text-[11px] text-slate-400">{prompt.length} 字</span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`例:\n春の新作トリートメント発売告知用バナー。\n背景は淡いピンク〜白のグラデーション。中央に商品ボトル風のオブジェクト。\nやわらかい光、上品で清潔感のある雰囲気。文字は入れない。\n\n※ 文字は AI が苦手なので、テキストは別途追加するほうが綺麗です`}
              rows={7}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-y"
              maxLength={4000}
            />
            <p className="text-[11px] text-slate-400">
              業種・雰囲気・配色・構図を具体的に書くと意図に近い画像が出ます。文字 / ロゴは現状苦手なので、生成後に手動で重ねるのがおすすめです。
            </p>
          </div>

          {/* 生成ボタン */}
          <button
            type="button"
            onClick={generate}
            disabled={generating || !prompt.trim()}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl text-sm shadow-sm transition-colors"
          >
            {generating ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                生成中… (約 15-30 秒)
              </span>
            ) : variants.length === 0 ? (
              '✨ 画像を生成する'
            ) : (
              '別案を追加生成'
            )}
          </button>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs whitespace-pre-wrap">{error}</div>
          )}

          {/* 結果 */}
          {variants.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-sm font-semibold text-slate-700">生成された画像 ({variants.length})</h3>
                <span className="text-[11px] text-slate-400">累計 約 ¥{(totalCost / 100).toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {variants.map((v, i) => (
                  <div key={i} className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">案 {i + 1} ({v.size})</span>
                      <span className="text-[10px] text-slate-400">¥{(v.costYenX100 / 100).toFixed(2)}</span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={v.imageUrl}
                      alt={`案 ${i + 1}`}
                      className="w-full rounded-lg border border-slate-200 bg-white object-contain"
                    />
                    <button
                      onClick={() => handleApply(v)}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      ✓ この画像を使う
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

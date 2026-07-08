'use client'

import { useState } from 'react'
import { useAccount } from '@/contexts/account-context'

export type AiTextGenerateKind =
  | 'broadcast.text'
  | 'scenario.step_text'
  | 'auto_reply.text'
  | 'broadcast.flex'
  | 'scenario.step_flex'
  | 'auto_reply.flex'

interface Props {
  open: boolean
  onClose: () => void
  /** どの種類の生成か。バックエンドの kind に対応 */
  kind: AiTextGenerateKind
  /** kind 固有の context (現在入力中のフィールド値など) */
  context: Record<string, unknown>
  /** 選択した文言を返す */
  onSelect: (text: string) => void
  /** モーダル上部に出すタイトル */
  title?: string
}

interface Variant {
  text: string
  costYenX100: number
}

export function AiTextGenerateModal({ open, onClose, kind, context, onSelect, title }: Props) {
  const { selectedAccount } = useAccount()
  const [hint, setHint] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState<string | null>(null)
  const [variants, setVariants] = useState<Variant[]>([])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalCost, setTotalCost] = useState(0)

  if (!open) return null

  async function handleImagePick(file: File | null) {
    if (!file) {
      setImageDataUrl(null)
      setImageName(null)
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選んでください')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('画像は 10MB までです')
      return
    }
    try {
      // 送信前に長辺 1568px へ縮小して JPEG 化する。
      // Claude vision のトークン量は画像の解像度に比例するため、縦長フル解像度の
      // スクショ等をそのまま送ると処理が 60 秒を超えて timeout する。1568px は
      // Anthropic 推奨の上限で、これ以上大きくても内部で縮小されるだけ。
      const dataUrl = await resizeImageToJpegDataUrl(file, 1568, 0.85)
      setImageDataUrl(dataUrl)
      setImageName(file.name)
      setError(null)
    } catch {
      // canvas 縮小に失敗したら生画像でフォールバック (4MB 超は弾く)
      if (file.size > 4 * 1024 * 1024) {
        setError('画像の処理に失敗しました。4MB 以下の画像でお試しください')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        setImageDataUrl(reader.result as string)
        setImageName(file.name)
        setError(null)
      }
      reader.onerror = () => setError('画像の読み込みに失敗しました')
      reader.readAsDataURL(file)
    }
  }

  async function generate() {
    if (!selectedAccount) {
      setError('アカウントが選択されていません')
      return
    }
    setError(null)
    setGenerating(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
      const res = await fetch(`${apiUrl}/api/ai-generate/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Line-Account-Id': selectedAccount.id,
        },
        body: JSON.stringify({
          kind,
          context,
          hint: hint.trim() || undefined,
          imageDataUrl: imageDataUrl ?? undefined,
          previousVariants: variants.map((v) => v.text),
        }),
      })
      const json = (await res.json()) as {
        success: boolean
        text?: string
        costYenX100?: number
        error?: string
      }
      if (!res.ok || !json.success || !json.text) {
        throw new Error(json.error ?? '生成に失敗しました')
      }
      setVariants((prev) => [...prev, { text: json.text!, costYenX100: json.costYenX100 ?? 0 }])
      setTotalCost((prev) => prev + (json.costYenX100 ?? 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }

  function handleApply(text: string) {
    onSelect(text)
    handleClose()
  }

  function handleClose() {
    setVariants([])
    setHint('')
    setImageDataUrl(null)
    setImageName(null)
    setError(null)
    setTotalCost(0)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto" onClick={handleClose}>
      <div
        className="min-h-screen p-4 md:p-8 flex items-start justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
          {/* ヘッダー */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                ✨ {title ?? 'AI に文言を考えさせる'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                ブランド設定と業界ノウハウを踏まえて自動生成します
              </p>
            </div>
            <button
              onClick={handleClose}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg"
            >
              ✕ 閉じる
            </button>
          </div>

          {/* ヒント入力 */}
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <label className="block text-sm font-medium text-slate-600">
                追加のヒント (任意)
              </label>
              <span className="text-[11px] text-slate-400">{hint.length} 字</span>
            </div>
            <textarea
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder={`例: もっとフレンドリーに / 短めに / 絵文字なし\n\n顧客から依頼が来た場合は、依頼内容をそのまま貼り付けてください\n例:\n「添付した写真を使って、新商品の告知配信をしたい。\n  ・タイトル: 春の新作トリートメント発売\n  ・ターゲット: 30-40代女性会員\n  ・キャンペーン: 初回 ¥3,000 オフ\n  ・トーンは少し改まった感じで」`}
              rows={6}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-y"
            />

            {/* 画像添付 */}
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-700 hover:bg-slate-100 cursor-pointer">
                <span>📷</span>
                <span>{imageDataUrl ? '画像を差し替え' : '画像を添付 (任意)'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleImagePick(e.target.files?.[0] ?? null)}
                />
              </label>
              {imageName && (
                <>
                  <span className="text-[11px] text-slate-500 truncate flex-1">{imageName}</span>
                  <button
                    type="button"
                    onClick={() => void handleImagePick(null)}
                    className="text-[11px] text-rose-600 hover:underline"
                  >
                    削除
                  </button>
                </>
              )}
            </div>
            {imageDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageDataUrl}
                alt="添付プレビュー"
                className="max-h-48 rounded-lg border border-slate-200 object-contain bg-slate-50"
              />
            )}
            <p className="text-[11px] text-slate-400">
              ヒント欄に「こんな内容で」と要望を書き、必要なら参考写真を添付すると AI が画像も読み取って文章を作ります (Claude の vision 機能)。大きい画像は送信前に自動で縮小します。
            </p>
          </div>

          {/* 生成ボタン */}
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl text-sm shadow-sm transition-colors"
          >
            {generating ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                生成中…
              </span>
            ) : variants.length === 0 ? (
              '✨ AI に文言を考えさせる'
            ) : (
              '別案を追加で生成する'
            )}
          </button>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
              {error}
            </div>
          )}

          {/* 結果 */}
          {variants.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="text-sm font-semibold text-slate-700">生成された案 ({variants.length})</h3>
                <span className="text-[11px] text-slate-400">
                  累計コスト 約 ¥{(totalCost / 100).toFixed(2)}
                </span>
              </div>
              {variants.map((v, i) => (
                <div
                  key={i}
                  className="border border-slate-200 rounded-xl bg-slate-50 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">案 {i + 1}</span>
                    <span className="text-[10px] text-slate-400">¥{(v.costYenX100 / 100).toFixed(2)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed bg-white border border-slate-100 rounded-lg p-3">
                    {v.text}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApply(v.text)}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      ✓ この文言を使う
                    </button>
                    <button
                      onClick={() => {
                        if (typeof navigator !== 'undefined' && navigator.clipboard) {
                          navigator.clipboard.writeText(v.text)
                        }
                      }}
                      className="px-3 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs rounded-lg"
                      title="コピー"
                    >
                      📋
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 既存の textarea / input の横に置く小さな ✨ ボタン。
 * 押すと AiTextGenerateModal が開く想定。
 */
interface ButtonProps {
  onClick: () => void
  label?: string
  size?: 'sm' | 'md'
}

export function AiTextGenerateButton({ onClick, label = 'AI に文言を考えさせる', size = 'md' }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 ${sizeClass} bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg shadow-sm transition-colors`}
    >
      <span>✨</span>
      <span>{label}</span>
    </button>
  )
}

/**
 * 画像を縦横比を保ったまま長辺 maxEdge px 以内に縮小し、JPEG の dataURL を返す。
 * Claude vision のトークン量・送信ペイロード・エンコード時間をまとめて削るための前処理。
 */
async function resizeImageToJpegDataUrl(file: File, maxEdge: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, maxEdge / longest)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context not available')
    // JPEG は透過を持てないので、PNG の透過部分が黒くならないよう白背景で塗る
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}

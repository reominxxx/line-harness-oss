'use client'

import { useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  /** KPI で設定済みの月の配信本数 (デフォルト本数として表示) */
  totalCount: number
  /** 実際に start-monthly-plan を呼び出す */
  onSubmit: (args: {
    totalCount: number
    hint: string
    referenceImageDataUrl: string | null
    imageGenCount: number
    /** 任意。公式 HP / 商品ページ URL。worker でテキスト抽出して hint に統合される */
    homepageUrl?: string
  }) => Promise<void>
}

export function StartMonthlyPlanModal({ open, onClose, totalCount, onSubmit }: Props) {
  const [hint, setHint] = useState('')
  const [homepageUrl, setHomepageUrl] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState<string | null>(null)
  const [withImageGen, setWithImageGen] = useState(false)
  const [imageGenCount, setImageGenCount] = useState(Math.min(2, totalCount))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  function handleImagePick(file: File | null) {
    if (!file) {
      setImageDataUrl(null)
      setImageName(null)
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選んでください')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('画像は 4MB までです (Claude vision の制限)')
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

  function handleClose() {
    setHint('')
    setHomepageUrl('')
    setImageDataUrl(null)
    setImageName(null)
    setWithImageGen(false)
    setImageGenCount(Math.min(2, totalCount))
    setError(null)
    onClose()
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      // URL バリデーション (空欄は OK、入ってる場合は http(s) 必須)
      const url = homepageUrl.trim()
      if (url && !/^https?:\/\//.test(url)) {
        setError('URL は http(s):// で始めてください')
        setSubmitting(false)
        return
      }
      await onSubmit({
        totalCount,
        hint: hint.trim(),
        homepageUrl: url || undefined,
        referenceImageDataUrl: imageDataUrl,
        imageGenCount: withImageGen ? Math.min(Math.max(imageGenCount, 0), totalCount) : 0,
      })
      handleClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const effectiveImageCount = withImageGen ? Math.min(Math.max(imageGenCount, 0), totalCount) : 0

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto" onClick={handleClose}>
      <div
        className="min-h-screen p-4 md:p-8 flex items-start justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">
                ✨ 月の AI 配信案を立てる
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                月 <strong className="text-slate-900">{totalCount} 本</strong> の配信案を AI が一括生成します (
                <a href="/kpi" className="underline hover:text-slate-700">本数を変更</a>
                )
              </p>
            </div>
            <button
              onClick={handleClose}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg"
            >
              ✕ 閉じる
            </button>
          </div>

          {/* 公式 HP / 商品ページ URL */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-600">
              🔗 公式 HP / 商品ページ URL (任意)
            </label>
            <input
              type="url"
              value={homepageUrl}
              onChange={(e) => setHomepageUrl(e.target.value)}
              placeholder="https://example.com/"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
            <p className="text-[11px] text-slate-400">
              入力するとサイト本文 (タイトル / メタ情報 / 本文) を自動取得し、下の「ヒント」と組み合わせて AI が解析します。
            </p>
          </div>

          {/* ヒント */}
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <label className="block text-sm font-medium text-slate-600">
                追加のヒント / 顧客依頼 (任意)
              </label>
              <span className="text-[11px] text-slate-400">{hint.length} 字</span>
            </div>
            <textarea
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder={`例: 顧客から「今月は新商品の発売があるので、それを軸に組み立てて欲しい」と依頼が来た場合、依頼内容をそのまま貼り付けてください\n\n例:\n・5/15 に春の新作トリートメント発売\n・ターゲットは 30-40 代の既存顧客\n・初週は予約特典で集客、後半はビフォーアフター訴求\n・写真は添付した素材を活用`}
              rows={7}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y"
            />

            {/* 参考画像 */}
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-700 hover:bg-slate-100 cursor-pointer">
                <span>📷</span>
                <span>{imageDataUrl ? '画像を差し替え' : '参考画像を添付 (任意)'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImagePick(e.target.files?.[0] ?? null)}
                />
              </label>
              {imageName && (
                <>
                  <span className="text-[11px] text-slate-500 truncate flex-1">{imageName}</span>
                  <button
                    type="button"
                    onClick={() => handleImagePick(null)}
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
                alt="参考画像プレビュー"
                className="max-h-48 rounded-lg border border-slate-200 object-contain bg-slate-50"
              />
            )}
          </div>

          {/* 画像生成設定 */}
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={withImageGen}
                onChange={(e) => setWithImageGen(e.target.checked)}
                className="w-4 h-4 accent-violet-600"
              />
              <span className="text-sm font-medium text-slate-700">
                配信内容に合わせた画像も AI で生成する (OpenAI gpt-image-2)
              </span>
            </label>

            {withImageGen && (
              <div className="pl-6 space-y-2">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-slate-600">画像を付ける本数:</label>
                  <input
                    type="number"
                    min={1}
                    max={totalCount}
                    value={imageGenCount}
                    onChange={(e) => setImageGenCount(parseInt(e.target.value, 10) || 0)}
                    className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-center"
                  />
                  <span className="text-xs text-slate-500">本 / 全 {totalCount} 本中</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  AI がキャンペーン・限定オファー・イベント等、視覚効果の高い種別を {effectiveImageCount} 本選んで画像を生成します。
                  画像 1 本あたり約 ¥6 のコスト。
                </p>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
              {error}
            </div>
          )}

          {/* 実行ボタン */}
          <div className="border-t border-slate-100 pt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              生成後は「承認待ち」に並ぶので、確認・編集してから配信できます。
            </p>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="shrink-0 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg whitespace-nowrap"
            >
              {submitting ? '立案中…' : `✨ ${totalCount} 本の配信案を立てる${effectiveImageCount > 0 ? ` (画像 ${effectiveImageCount} 本)` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { compressForRichMenu, formatBytes } from '@/lib/image-compress'

interface Props {
  open: boolean
  onClose: () => void
  size: 'large' | 'compact'
  menuName?: string
  /** 画像取得後 (圧縮 & File 化済み) のコールバック */
  onSelect: (file: File, info: { prompt: string; originalBytes: number; compressedBytes: number }) => Promise<void>
}

const PRESETS: Array<{ key: string; label: string; prompt: string }> = [
  {
    key: 'salon-spring',
    label: '美容室・春',
    prompt:
      '美容室のリッチメニュー画像。淡いピンクと白を基調に、桜のモチーフを上品にあしらった春らしいデザイン。清潔感重視で派手すぎない、上品な雰囲気。',
  },
  {
    key: 'salon-summer',
    label: '美容室・夏',
    prompt:
      '美容室のリッチメニュー画像。ターコイズと白を基調に、海と植物のモチーフをあしらった夏らしい爽やかなデザイン。清涼感重視。',
  },
  {
    key: 'cafe-warm',
    label: 'カフェ・温かみ',
    prompt:
      'カフェのリッチメニュー画像。ブラウンとアイボリーの落ち着いた配色。コーヒー豆や葉っぱのモチーフ。温かみのあるアイコン的なシンボル。',
  },
  {
    key: 'minimal',
    label: 'ミニマル・モノトーン',
    prompt:
      'モノトーンで構成されたミニマルなリッチメニュー画像。グレーと白の境界線が明確。シャープで洗練された印象。',
  },
]

type Variation = {
  status: 'pending' | 'done' | 'error'
  dataUrl?: string
  errorMessage?: string
}

const DEFAULTS_STORAGE = 'rich-menu-ai-defaults'

function Spinner({ size = 'lg' }: { size?: 'sm' | 'lg' }) {
  const s = { sm: 'w-4 h-4 border-2', lg: 'w-12 h-12 border-4' }[size]
  return <div className={`${s} border-emerald-100 border-t-emerald-600 rounded-full animate-spin flex-shrink-0`} />
}

export function AiImageGenerateModal({ open, onClose, size, menuName, onSelect }: Props) {
  const [defaults, setDefaults] = useState('')
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)

  const [prompt, setPrompt] = useState('')
  const [imageCount, setImageCount] = useState(2)

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

  const sizeLabel = size === 'large' ? '2500×1686 (Large・3:2)' : '2500×843 (Compact・3:1)'
  const layoutHint =
    size === 'large' ? '6 ボタン (3×2 グリッド) を想定' : '3 ボタン (1×3 グリッド) を想定'

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
  }): Promise<string> {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
    const res = await fetch(`${apiUrl}/api/rich-menu-images/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ size, defaultsText: defaults, ...opts }),
    })
    const json = (await res.json()) as { success: boolean; imageBase64?: string; mimeType?: string; error?: string }
    if (!res.ok || !json.success || !json.imageBase64) {
      throw new Error(json.error ?? '画像生成に失敗しました')
    }
    return `data:${json.mimeType ?? 'image/png'};base64,${json.imageBase64}`
  }

  async function handleGenerate() {
    const finalPrompt = prompt.trim()
    if (!finalPrompt) {
      setGenError('プロンプトを入力してください')
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
      const dataUrl = await callGenerate({
        prompt,
        revisionRequest: req,
        previousImageBase64: prevB64,
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
              <h1 className="text-2xl font-bold text-slate-800">✨ AI でリッチメニュー画像を生成</h1>
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
                    <p className="text-xs text-amber-700 pt-3">
                      ここに書いた内容は毎回の生成に組み込まれます（ブランドカラー・トーン等）
                    </p>
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

              {/* プリセット */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-600">プリセット</label>
                <div className="grid grid-cols-2 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setPrompt(p.prompt)}
                      className="text-left text-xs px-3 py-2 border border-slate-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50 transition-colors"
                    >
                      <div className="font-medium text-slate-900 mb-0.5">{p.label}</div>
                      <div className="text-[10px] text-slate-500 line-clamp-2">{p.prompt}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* プロンプト */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-600">どんな画像にする？</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={5}
                  placeholder="例: 美容室のリッチメニュー画像。淡いピンクと白を基調に、桜のモチーフ..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none text-sm"
                />
                <p className="text-[11px] text-slate-400">
                  文字なしでアイコン中心の構成にすると、後からタップ領域を配置しやすいです
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
                disabled={!prompt.trim() || generating}
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
                          size === 'large' ? 'aspect-[2500/1686]' : 'aspect-[2500/843]'
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
    </div>
  )
}

export { formatBytes }

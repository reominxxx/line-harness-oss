'use client'

import { useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'

const SEGMENTS = [
  {
    key: 'vip' as const,
    label: 'VIP (上得意客)',
    tagName: '★VIP',
    accent: 'bg-violet-50 text-violet-700 border-violet-200',
    guide: '上得意客への特別感・限定オファー・ロイヤリティ向上を意識した文章。先行案内・希少性を強調。',
  },
  {
    key: 'warm' as const,
    label: 'ウォーム (反応してくれそう)',
    tagName: '★ウォーム',
    accent: 'bg-amber-50 text-amber-700 border-amber-200',
    guide: '購入の後押し・比較材料の提示。具体的なベネフィットを示し、行動への一歩を促す。',
  },
  {
    key: 'cold' as const,
    label: 'コールド (低反応)',
    tagName: '★コールド',
    accent: 'bg-sky-50 text-sky-700 border-sky-200',
    guide: '関係再構築・軽い接点づくり。押し売り厳禁、お役立ち情報や雑談寄りで距離を縮める。',
  },
  {
    key: 'dormant' as const,
    label: '休眠 (長期未接触)',
    tagName: '★休眠',
    accent: 'bg-gray-100 text-gray-700 border-gray-200',
    guide: '久しぶりの挨拶ベース、ハードルを下げた呼びかけ。「お元気でしたか?」など共感ベース。',
  },
  {
    key: 'new' as const,
    label: 'NEW (新規)',
    tagName: '★NEW',
    accent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    guide: 'ウェルカム + 自己紹介 + お試し提案。期待感を醸成、不安を取り除く。',
  },
]

type SegmentKey = (typeof SEGMENTS)[number]['key']

interface Variant {
  key: SegmentKey
  label: string
  tagName: string
  accent: string
  content: string | null
  loading: boolean
  error: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  tags: Tag[]
  /** 「この案だけ form に反映」した時のコールバック */
  onApplySingle: (content: string, tagId: string) => void
  /** 「5 つすべて下書きとして作成」した後の成功通知 */
  onCreatedAll: (createdCount: number) => void
}

export function SegmentBulkAiModal({ open, onClose, tags, onApplySingle, onCreatedAll }: Props) {
  const { selectedAccountId } = useAccount()
  const [theme, setTheme] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState<string | null>(null)
  const [variants, setVariants] = useState<Variant[]>([])
  const [generating, setGenerating] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
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
      setError('画像は 4MB までです')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setImageDataUrl(reader.result as string)
      setImageName(file.name)
      setError(null)
    }
    reader.readAsDataURL(file)
  }

  function tagIdFor(segmentTagName: string): string | null {
    return tags.find((t) => t.name === segmentTagName)?.id ?? null
  }

  async function generateAll() {
    if (!selectedAccountId) {
      setError('アカウントが選択されていません')
      return
    }
    if (!theme.trim()) {
      setError('ベースのテーマを入力してください (どんな配信か 1〜2 行)')
      return
    }
    setError(null)
    setGenerating(true)

    const init: Variant[] = SEGMENTS.map((s) => ({
      key: s.key,
      label: s.label,
      tagName: s.tagName,
      accent: s.accent,
      content: null,
      loading: true,
      error: null,
    }))
    setVariants(init)

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''

    await Promise.all(
      SEGMENTS.map(async (seg) => {
        try {
          const res = await fetch(`${apiUrl}/api/ai-generate/text`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'X-Line-Account-Id': selectedAccountId,
            },
            body: JSON.stringify({
              kind: 'broadcast.text',
              context: {
                title: theme,
                hint: `セグメント: ${seg.label}\n${seg.guide}`,
                targetSegment: `tag:${seg.tagName}`,
              },
              hint: `セグメント「${seg.label}」向けの配信文。\n${seg.guide}`,
              imageDataUrl: imageDataUrl ?? undefined,
            }),
          })
          const json = (await res.json()) as { success: boolean; text?: string; error?: string }
          if (!res.ok || !json.success || !json.text) {
            throw new Error(json.error ?? '生成失敗')
          }
          setVariants((prev) =>
            prev.map((v) => (v.key === seg.key ? { ...v, content: json.text ?? '', loading: false } : v)),
          )
        } catch (e) {
          setVariants((prev) =>
            prev.map((v) =>
              v.key === seg.key
                ? { ...v, loading: false, error: e instanceof Error ? e.message : '生成失敗' }
                : v,
            ),
          )
        }
      }),
    )

    setGenerating(false)
  }

  async function saveAllAsDrafts() {
    if (!selectedAccountId) return
    const ok = variants.filter((v) => v.content && !v.error)
    if (ok.length === 0) {
      setError('保存できる案がありません')
      return
    }
    if (!confirm(`${ok.length} 本の配信案を下書きとして作成します。よろしいですか?`)) return
    setSavingAll(true)
    setError(null)
    let created = 0
    for (const v of ok) {
      const tagId = tagIdFor(v.tagName)
      if (!tagId) continue
      try {
        await api.broadcasts.create({
          title: `${theme.slice(0, 30)} - ${v.label}`,
          messageType: 'text',
          messageContent: v.content!,
          targetType: 'tag',
          targetTagId: tagId,
          status: 'draft',
          lineAccountId: selectedAccountId,
        })
        created++
      } catch (e) {
        console.error(`[segment-bulk] create failed for ${v.key}:`, e)
      }
    }
    setSavingAll(false)
    onCreatedAll(created)
    handleClose()
  }

  function handleClose() {
    setTheme('')
    setImageDataUrl(null)
    setImageName(null)
    setVariants([])
    setGenerating(false)
    setSavingAll(false)
    setError(null)
    onClose()
  }

  const hasResults = variants.length > 0
  const allDone = hasResults && variants.every((v) => !v.loading)
  const successCount = variants.filter((v) => v.content && !v.error).length

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto" onClick={handleClose}>
      <div className="min-h-screen p-4 md:p-8 flex items-start justify-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800">✨ 5 セグメント別に AI 一括生成</h2>
              <p className="text-xs text-slate-500 mt-1">
                ★VIP / ★ウォーム / ★コールド / ★休眠 / ★NEW の 5 種類のセグメントごとに、適切なトーンと内容で配信文を AI が並列生成します。
              </p>
            </div>
            <button
              onClick={handleClose}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg"
            >
              ✕ 閉じる
            </button>
          </div>

          {/* テーマ入力 */}
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <label className="block text-sm font-medium text-slate-600">
                ベースのテーマ / 顧客依頼 (必須)
              </label>
              <span className="text-[11px] text-slate-400">{theme.length} 字</span>
            </div>
            <textarea
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder={`例: 春の新作トリートメント発売、初週は予約特典で集客、後半はビフォーアフター訴求\n\nセグメントごとに、このテーマを別の切り口で AI が書き分けます。`}
              rows={5}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-400 resize-y"
            />

            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-700 hover:bg-slate-100 cursor-pointer">
                <span>📷</span>
                <span>{imageDataUrl ? '画像を差し替え' : '参考画像 (任意)'}</span>
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
                alt="参考画像"
                className="max-h-32 rounded-lg border border-slate-200 object-contain bg-slate-50"
              />
            )}
          </div>

          <button
            type="button"
            onClick={generateAll}
            disabled={generating || !theme.trim()}
            className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl text-sm"
          >
            {generating ? '✨ 5 セグメント分を生成中…' : hasResults ? '✨ 別案を生成し直す' : '✨ 5 セグメント分を一括生成'}
          </button>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
              {error}
            </div>
          )}

          {/* 結果カード */}
          {hasResults && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">生成結果 ({successCount}/5 成功)</h3>
              </div>
              {variants.map((v) => {
                const tagId = tagIdFor(v.tagName)
                const tagMissing = !tagId
                return (
                  <div key={v.key} className={`border rounded-xl p-4 ${v.accent}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">{v.label}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/70">
                        {v.tagName}
                      </span>
                    </div>
                    {v.loading && (
                      <div className="text-xs text-slate-500 py-3">生成中…</div>
                    )}
                    {v.error && (
                      <div className="text-xs text-rose-700 py-3">エラー: {v.error}</div>
                    )}
                    {v.content && (
                      <>
                        <p className="text-sm whitespace-pre-wrap text-slate-800 bg-white border border-white rounded-lg p-3 mb-2 leading-relaxed">
                          {v.content}
                        </p>
                        {tagMissing ? (
                          <p className="text-[11px] text-rose-700">
                            {v.tagName} タグが未作成です。先に友だち管理から「AI でタグ付与」を実行してください。
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onApplySingle(v.content!, tagId!)
                              handleClose()
                            }}
                            className="text-xs px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-md font-medium"
                          >
                            ▶ この案だけ反映する
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}

              {allDone && successCount > 0 && (
                <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                  <p className="text-[11px] text-slate-500">
                    各セグメント用に別々の配信案を一気に下書きへ保存します。
                  </p>
                  <button
                    type="button"
                    onClick={saveAllAsDrafts}
                    disabled={savingAll}
                    className="text-sm px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white font-medium rounded-lg"
                  >
                    {savingAll ? '保存中…' : `📥 ${successCount} 本すべて下書きで作成`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

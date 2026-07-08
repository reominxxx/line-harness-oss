'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { api, type SegmentTagDto } from '@/lib/api'
import { AiTextGenerateModal } from '@/components/ai/ai-text-generate-modal'
import { AiImageGenerateModal } from '@/components/rich-menus/ai-image-generate-modal'

interface Props {
  open: boolean
  accountId: string
  tags: SegmentTagDto[] // 利用可能なセグメント一覧
  onClose: () => void
  onSent?: () => void
}

// エンゲージメント仮想セグメント (engagement:hot/warm/dormant) は criteria に「計測の定義」が
// 入っているため、そのまま AI に渡すと文面が刺さらない。代わりにマーケ視点の「相手の温度感と
// 刺さる訴求の方向性」を渡す。リサーチ回答セグメントは従来どおり name(criteria)。
function describeSegmentForAi(t: SegmentTagDto): string {
  switch (t.id) {
    case 'engagement:hot':
      return '【かなりホット層】アクティブな友だちの中で反応回数が上位1/3。購買意欲の高い友だち。今すぐ行動してもらうのが狙い。限定オファー・在庫/期限の希少性・「あなただけ」感のある強いオファーが刺さる'
    case 'engagement:warm':
      return '【見込みあり層】アクティブな友だちの中で反応回数が中位1/3。関心はある友だち。背中を押すのが狙い。ベネフィットの再提示・お試ししやすい一歩・不安解消の情報で関心をホットへ引き上げる'
    case 'engagement:light':
      return '【ライト層】アクティブな友だちの中で反応回数が下位1/3。たまに反応する程度の友だち。関心を育てるのが狙い。役立つ情報・ゆるい接点づくり・ハードルの低い参加導線で接触頻度を上げる'
    case 'engagement:dormant':
      return '【休眠層】最近反応がない掘り起こし対象の友だち。まず思い出してもらうのが狙い。ご無沙汰の声かけ・近況/新着のお知らせ・復帰メリットの強いきっかけ作りで再来を促す'
    default:
      return `${t.name}(${t.criteria || ''})`
  }
}

export function MultiSegmentBroadcastModal({ open, accountId, tags, onClose, onSent }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [messageType, setMessageType] = useState<'text' | 'flex' | 'image'>('text')
  const [messageContent, setMessageContent] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showAiImage, setShowAiImage] = useState(false)
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [sending, setSending] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setSelectedIds([])
    setMessageType('text')
    setMessageContent('')
    setImageUrl('')
    setPreviewCount(null)
    setSending(false)
    setResult(null)
    setError(null)
  }, [])

  // 画像アップロード(File → /api/images → URL)
  const uploadImageFile = useCallback(async (file: File): Promise<string> => {
    const reader = new FileReader()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
    const res = await fetch(`${apiUrl}/api/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ data: dataUrl, mimeType: file.type, filename: file.name }),
    })
    const json = (await res.json()) as { success: boolean; data?: { url: string }; error?: string }
    if (!res.ok || !json.success || !json.data?.url) {
      throw new Error(json.error || '画像アップロードに失敗しました')
    }
    return json.data.url
  }, [])

  const handleFileSelect = useCallback(
    async (file: File) => {
      setError(null)
      setUploadingImage(true)
      try {
        const url = await uploadImageFile(file)
        setImageUrl(url)
        setMessageContent(JSON.stringify({ originalContentUrl: url, previewImageUrl: url }))
      } catch (err) {
        setError(err instanceof Error ? err.message : '画像アップロードに失敗しました')
      } finally {
        setUploadingImage(false)
      }
    },
    [uploadImageFile],
  )

  const handleClose = useCallback(() => {
    if (sending) return
    reset()
    onClose()
  }, [sending, reset, onClose])

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  // 選択が変わるたびに対象人数をプレビュー
  useEffect(() => {
    if (!open) return
    if (selectedIds.length === 0) {
      setPreviewCount(null)
      return
    }
    let cancelled = false
    setCounting(true)
    api.broadcasts
      .multiSegmentPreview({ accountId, segmentTagIds: selectedIds })
      .then((res) => {
        if (cancelled) return
        if (res.success) setPreviewCount(res.count)
      })
      .catch(() => {
        if (!cancelled) setPreviewCount(null)
      })
      .finally(() => {
        if (!cancelled) setCounting(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, accountId, selectedIds])

  const selectedTags = useMemo(
    () => tags.filter((t) => selectedIds.includes(t.id)),
    [tags, selectedIds],
  )

  const handleSend = async () => {
    setError(null)
    if (selectedIds.length === 0) {
      setError('セグメントを 1 つ以上選択してください')
      return
    }
    if (!messageContent.trim()) {
      setError('配信内容が空です')
      return
    }
    if (previewCount === 0) {
      setError('該当する友だちがいません')
      return
    }

    setSending(true)
    try {
      const res = await api.broadcasts.multiSegmentSend({
        accountId,
        segmentTagIds: selectedIds,
        messageType,
        messageContent,
        title: selectedTags.map((t) => t.name).join(' ∧ '),
      })
      if (!res.success) {
        throw new Error(res.error ?? '配信に失敗しました')
      }
      setResult({ sent: res.sent, failed: res.failed, total: res.total })
      onSent?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '配信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8">
          {/* ヘッダー */}
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">複数セグメントを組み合わせて配信</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                選択したセグメントを <strong>すべて満たす</strong>友だち(AND 条件)に配信します
              </p>
            </div>
            <button
              onClick={handleClose}
              disabled={sending}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              ✕
            </button>
          </div>

          {result ? (
            // ─── 配信結果 ───
            <div className="px-5 py-10 text-center space-y-4">
              <div className="text-4xl">✅</div>
              <h3 className="text-lg font-bold text-gray-900">配信を実行しました</h3>
              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
                <div className="bg-emerald-50 rounded-lg p-3">
                  <p className="text-[10px] text-emerald-700 font-semibold">送信成功</p>
                  <p className="text-2xl font-bold text-emerald-700">{result.sent}</p>
                </div>
                <div className="bg-rose-50 rounded-lg p-3">
                  <p className="text-[10px] text-rose-700 font-semibold">失敗</p>
                  <p className="text-2xl font-bold text-rose-700">{result.failed}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-600 font-semibold">対象数</p>
                  <p className="text-2xl font-bold text-slate-700">{result.total}</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="text-sm px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium"
              >
                閉じる
              </button>
            </div>
          ) : (
            <>
              <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
                {/* セグメント選択 */}
                <section>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">セグメントを選ぶ(複数可)</h3>
                  {tags.length === 0 ? (
                    <p className="text-xs text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded">
                      利用可能なセグメントがありません
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {tags.map((t) => {
                        const selected = selectedIds.includes(t.id)
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => toggle(t.id)}
                            className={`text-left px-3 py-2 rounded-lg border transition-colors text-xs ${
                              selected
                                ? 'border-emerald-500 bg-emerald-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: t.color || '#94a3b8' }}
                              />
                              <span className={`font-medium ${selected ? 'text-emerald-700' : 'text-gray-700'}`}>
                                {t.name}
                              </span>
                              {selected && <span className="ml-auto text-emerald-600">✓</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>

                {/* 対象人数表示 */}
                {selectedIds.length > 0 && (
                  <section className="bg-slate-50 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500">対象人数(AND 条件)</p>
                        <p className="text-2xl font-bold text-slate-900 tabular-nums">
                          {counting
                            ? '...'
                            : previewCount !== null
                              ? `${previewCount.toLocaleString()} 人`
                              : '—'}
                        </p>
                      </div>
                      <div className="text-right text-xs text-slate-600 max-w-xs">
                        {selectedTags.map((t) => t.name).join(' ∧ ')}
                      </div>
                    </div>
                  </section>
                )}

                {/* メッセージ入力 */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-semibold text-gray-900">配信内容</h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={messageType}
                        onChange={(e) => {
                          const next = e.target.value as 'text' | 'flex' | 'image'
                          setMessageType(next)
                          // モード切替時に messageContent をクリア
                          setMessageContent('')
                          if (next !== 'image') setImageUrl('')
                        }}
                        className="text-xs border border-gray-300 rounded px-2 py-1"
                      >
                        <option value="text">テキスト</option>
                        <option value="image">画像</option>
                        <option value="flex">Flex(JSON)</option>
                      </select>
                      {messageType !== 'image' && (
                        <button
                          type="button"
                          onClick={() => setShowAi(true)}
                          disabled={selectedIds.length === 0}
                          className="text-xs px-2.5 py-1 bg-violet-50 text-violet-700 border border-violet-200 rounded hover:bg-violet-100 disabled:opacity-50"
                        >
                          {messageType === 'flex' ? '🤖 AI で Flex 生成' : '🤖 AI で文章生成'}
                        </button>
                      )}
                      {messageType === 'image' && (
                        <button
                          type="button"
                          onClick={() => setShowAiImage(true)}
                          disabled={selectedIds.length === 0}
                          className="text-xs px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50"
                        >
                          🖼️ AI で画像生成
                        </button>
                      )}
                    </div>
                  </div>
                  {messageType === 'image' ? (
                    <div className="space-y-2">
                      {imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl}
                          alt=""
                          className="w-full max-h-64 object-contain rounded border border-gray-200"
                        />
                      )}
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-2 cursor-pointer text-xs px-3 py-1.5 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">
                          📷 {uploadingImage ? 'アップロード中...' : '画像をアップロード'}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const f = e.target.files?.[0]
                              if (f) void handleFileSelect(f)
                              e.target.value = ''
                            }}
                            className="hidden"
                            disabled={uploadingImage}
                          />
                        </label>
                        <input
                          type="url"
                          value={imageUrl}
                          onChange={(e) => {
                            setImageUrl(e.target.value)
                            setMessageContent(
                              e.target.value
                                ? JSON.stringify({
                                    originalContentUrl: e.target.value,
                                    previewImageUrl: e.target.value,
                                  })
                                : '',
                            )
                          }}
                          placeholder="または画像 URL を直接入力"
                          className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                        />
                      </div>
                      <p className="text-[10px] text-gray-400">
                        JPEG/PNG、最大 10MB。LINE 側で自動的にプレビュー画像も同じ URL になります。
                      </p>
                    </div>
                  ) : (
                    <textarea
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      placeholder={
                        messageType === 'text'
                          ? '配信するメッセージを入力'
                          : 'Flex Message の JSON を入力'
                      }
                      rows={messageType === 'flex' ? 10 : 6}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 font-mono"
                    />
                  )}
                </section>
              </div>

              {/* フッター */}
              <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  {error ? (
                    <span className="text-red-600">{error}</span>
                  ) : selectedIds.length > 0 && previewCount !== null ? (
                    <>
                      <strong className="text-emerald-700">{previewCount.toLocaleString()} 人</strong> に配信します
                    </>
                  ) : (
                    'セグメントを選択してください'
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={sending}
                    className="text-sm px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || selectedIds.length === 0 || !messageContent.trim() || previewCount === 0}
                    className="text-sm px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium disabled:opacity-50"
                  >
                    {sending ? '配信中...' : '🚀 配信する'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showAiImage && (
        <AiImageGenerateModal
          open={showAiImage}
          onClose={() => setShowAiImage(false)}
          size="banner_wide"
          purpose="broadcast"
          menuName={`${selectedTags.map((t) => t.name).join(' × ') || '配信'} 向け画像`}
          onSelect={async (file) => {
            try {
              setUploadingImage(true)
              const url = await uploadImageFile(file)
              setImageUrl(url)
              setMessageContent(JSON.stringify({ originalContentUrl: url, previewImageUrl: url }))
              setShowAiImage(false)
            } catch (err) {
              setError(err instanceof Error ? err.message : '画像保存に失敗しました')
            } finally {
              setUploadingImage(false)
            }
          }}
        />
      )}

      {showAi && selectedTags.length > 0 && (
        <AiTextGenerateModal
          open={showAi}
          onClose={() => setShowAi(false)}
          kind={messageType === 'flex' ? 'broadcast.flex' : 'broadcast.text'}
          context={{
            messageType,
            title: `${selectedTags.map((t) => t.name).join(' × ')} 向け配信`,
            targetSegment: selectedTags.map((t) => describeSegmentForAi(t)).join(' / かつ '),
          }}
          onSelect={(text: string) => {
            setMessageContent(text)
            setShowAi(false)
          }}
          title={`${selectedTags.map((t) => t.name).join(' × ')} 向け配信案を AI に作らせる`}
        />
      )}
    </>
  )
}

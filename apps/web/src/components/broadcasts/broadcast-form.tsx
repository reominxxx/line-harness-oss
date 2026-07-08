'use client'

import { useEffect, useState } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, eventsApi, fetchApi, type ApiBroadcast, type EventListItem, type SegmentTagDto } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import FlexPreviewComponent from '@/components/flex-preview'
import MultiAccountDedupSection from './multi-account-dedup-section'
import SegmentBuilder from './segment-builder'
import { AiTextGenerateButton, AiTextGenerateModal } from '@/components/ai/ai-text-generate-modal'
import { AiImageGenerateModal } from '@/components/rich-menus/ai-image-generate-modal'

interface SegmentRule {
  type:
    | 'tag_exists'
    | 'tag_not_exists'
    | 'segment_tag_exists'
    | 'segment_tag_not_exists'
    | 'metadata_equals'
    | 'metadata_not_equals'
    | 'is_following'
    | 'link_clicked_within'
  value: string | boolean | { key: string; value: string } | { days: number; trackedLinkId?: string | null }
}
interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

interface BroadcastFormProps {
  tags: Tag[]
  onSuccess: () => void
  onCancel: () => void
}

const messageTypeLabels: Record<ApiBroadcast['messageType'], string> = {
  text: 'テキスト',
  image: '画像',
  video: '動画',
  flex: 'Flexメッセージ',
}

// UI 上だけで使う絞り込み種別。'link-clicked' は内部的に targetType='tag' +
// segmentConditions={ link_clicked_within } として保存する。
type UiTargetMode = 'all' | 'tag' | 'multi-account-dedup' | 'link-clicked'

interface FormState {
  title: string
  messageType: ApiBroadcast['messageType']
  messageContent: string
  targetType: ApiBroadcast['targetType']
  targetTagId: string
  scheduledAt: string
  sendNow: boolean
  accountIds: string[]
  dedupPriority: string[]
  segmentConditions: SegmentCondition | null
  /** UI 上の絞り込み種別。link-clicked モードの判定に使う */
  uiTargetMode: UiTargetMode
  /** リンクをタップした友だち: 過去 N 日以内 */
  linkClickedDays: number
  /** リンクをタップした友だち: 特定リンク (空文字 = どれか) */
  linkClickedLinkId: string
}

export default function BroadcastForm({ tags, onSuccess, onCancel }: BroadcastFormProps) {
  const { selectedAccountId } = useAccount()
  // 「リンクするイベント」セレクタ用: 公開中の events を取得して
  // 選択された event の LIFF URL (テンプレ) を message に挿入する。
  const [linkableEvents, setLinkableEvents] = useState<EventListItem[]>([])
  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    eventsApi.listEvents(selectedAccountId)
      .then((r) => { if (!cancelled) setLinkableEvents(r.items.filter((e) => e.is_published === 1)) })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [selectedAccountId])
  const [form, setForm] = useState<FormState>({
    title: '',
    messageType: 'text',
    messageContent: '',
    targetType: 'all',
    targetTagId: '',
    scheduledAt: '',
    sendNow: true,
    accountIds: [],
    dedupPriority: [],
    segmentConditions: null,
    uiTargetMode: 'all',
    linkClickedDays: 7,
    linkClickedLinkId: '',
  })

  // tracked_links 一覧 (リンクをタップした友だち モード用のセレクタ)
  const [trackedLinks, setTrackedLinks] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    fetchApi<{ success: boolean; data?: Array<{ id: string; name: string }> }>(`/api/tracked-links?lineAccountId=${selectedAccountId}`)
      .then((r) => { if (!cancelled && r.success && r.data) setTrackedLinks(r.data.map((l) => ({ id: l.id, name: l.name }))) })
      .catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [selectedAccountId])

  // セグメント条件ビルダー用の segment_tags 取得
  const [segmentTags, setSegmentTags] = useState<SegmentTagDto[]>([])
  useEffect(() => {
    if (!selectedAccountId) return
    let cancelled = false
    api.segmentTags.list(selectedAccountId)
      .then((r) => { if (!cancelled && r.success) setSegmentTags(r.items) })
      .catch(() => { /* silent — セグメント無くてもタグだけで動く */ })
    return () => { cancelled = true }
  }, [selectedAccountId])

  // sessionStorage 経由のプリフィル (card-messages 等の「この内容で配信」から遷移)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const flexJson = sessionStorage.getItem('broadcast_prefill_flex_json')
    const prefillTitle = sessionStorage.getItem('broadcast_prefill_title')
    const prefillType = sessionStorage.getItem('broadcast_prefill_messageType')
    if (flexJson) {
      // 保存済み flex_json は { type:'flex', altText, contents:{bubble|carousel} } の
      // wrapper 形式。messageContent には contents だけ入れる (broadcast 送信時の
      // buildMessage 二重ラップ防止)。
      let unwrapped = flexJson
      try {
        const parsed = JSON.parse(flexJson) as { type?: string; contents?: unknown }
        if (parsed && parsed.type === 'flex' && parsed.contents) {
          unwrapped = JSON.stringify(parsed.contents)
        }
      } catch { /* parse 失敗時は元のまま */ }
      setForm((prev) => ({
        ...prev,
        title: prefillTitle ?? prev.title,
        messageType: (prefillType as ApiBroadcast['messageType']) ?? 'flex',
        messageContent: unwrapped,
      }))
      sessionStorage.removeItem('broadcast_prefill_flex_json')
      sessionStorage.removeItem('broadcast_prefill_title')
      sessionStorage.removeItem('broadcast_prefill_messageType')
    }
  }, [])
  // メッセージ種別ごとに本文を独立保持。タブ切替時に内容が消えないようにする。
  // (form.messageContent は「現在表示している種別の内容」と常に同期)
  const [textContent, setTextContent] = useState('')
  const [imageContent, setImageContent] = useState('')
  const [flexContent, setFlexContent] = useState('')

  // メッセージ種別を切り替え。現在の messageContent を type 別ストアに退避してから、
  // 新しい type の保存内容を messageContent に復元する。
  const switchMessageType = (next: ApiBroadcast['messageType']) => {
    setForm((prev) => {
      // 現在の内容を type 別ストアに保存
      if (prev.messageType === 'text') setTextContent(prev.messageContent)
      else if (prev.messageType === 'image') setImageContent(prev.messageContent)
      else if (prev.messageType === 'flex') setFlexContent(prev.messageContent)
      // 次の type の保存内容を取り出す
      const restored = next === 'text' ? textContent : next === 'image' ? imageContent : flexContent
      return { ...prev, messageType: next, messageContent: restored }
    })
  }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showAiGen, setShowAiGen] = useState(false)
  const [showAiImageGen, setShowAiImageGen] = useState(false)
  const [showCouponPicker, setShowCouponPicker] = useState(false)
  const [showCardPicker, setShowCardPicker] = useState(false)
  // 画像配信時のクリックリンク URL。入力されていれば送信時に Flex Message に変換する。
  const [imageLinkUrl, setImageLinkUrl] = useState('')
  const [imageLinkLabel, setImageLinkLabel] = useState('詳しく見る')
  const [uploadingImage, setUploadingImage] = useState(false)

  // 顧客から受け取った画像ファイルを R2 にアップロードし、公開 URL を originalContentUrl にセット
  const handleImageUpload = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('画像ファイル (PNG / JPEG / WebP) を選んでください')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('画像サイズは 10MB までです')
      return
    }
    setError('')
    setUploadingImage(true)
    try {
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
        setError(json.error ?? '画像アップロードに失敗しました')
        return
      }
      const url = json.data.url
      setForm((prev) => ({
        ...prev,
        messageType: 'image',
        messageContent: JSON.stringify({ originalContentUrl: url, previewImageUrl: url }),
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アップロード失敗')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleSave = async () => {
    if (!form.title.trim()) { setError('配信タイトルを入力してください'); return }
    if (!form.messageContent.trim()) { setError('メッセージ内容を入力してください'); return }
    if (form.messageType === 'flex') {
      try { JSON.parse(form.messageContent) } catch { setError('FlexメッセージのJSONが無効です'); return }
    }
    if (!form.sendNow && !form.scheduledAt) {
      setError('予約配信の場合は配信日時を指定してください')
      return
    }
    if (form.targetType === 'multi-account-dedup' && form.accountIds.length === 0) {
      setError('複数アカ重複除外: 配信先アカウントを 1 つ以上選択してください')
      return
    }
    if (form.targetType === 'tag' && !form.targetTagId && !form.segmentConditions) {
      setError('タグで絞り込み: タグ または 条件を選択してください')
      return
    }
    if (form.targetType === 'tag' && form.segmentConditions) {
      // 条件が空 (rule が無い or value 未入力) なら拒否
      const valid = form.segmentConditions.rules.some(r => {
        if (r.type === 'is_following') return true
        if (r.type === 'link_clicked_within') {
          const v = r.value as { days?: number } | null
          return !!v && typeof v.days === 'number' && v.days > 0
        }
        if (typeof r.value === 'string') return r.value !== ''
        if (typeof r.value === 'object' && r.value !== null) return (r.value as { key: string }).key !== ''
        return false
      })
      if (!valid) {
        setError('セグメント条件: 1 つ以上の条件を指定してください')
        return
      }
    }

    // 画像配信 + リンク URL あり → Flex Message に自動変換して送信
    let outgoingType: ApiBroadcast['messageType'] = form.messageType
    let outgoingContent = form.messageContent
    if (form.messageType === 'image' && imageLinkUrl.trim()) {
      const url = imageLinkUrl.trim()
      if (!/^https?:\/\//i.test(url)) {
        setError('リンク URL は http:// または https:// で始めてください')
        return
      }
      let parsed: { originalContentUrl?: string; previewImageUrl?: string } = {}
      try { parsed = JSON.parse(form.messageContent) } catch {
        setError('画像 URL が正しく入力されていません')
        return
      }
      if (!parsed.originalContentUrl) {
        setError('元画像 URL を入力してください')
        return
      }
      const flexBubble = {
        type: 'bubble',
        hero: {
          type: 'image',
          url: parsed.originalContentUrl,
          size: 'full',
          aspectMode: 'cover',
          aspectRatio: '1:1',
          action: {
            type: 'uri',
            label: imageLinkLabel.trim() || '詳しく見る',
            uri: url,
          },
        },
      }
      outgoingType = 'flex'
      outgoingContent = JSON.stringify(flexBubble)
    }

    setSaving(true)
    setError('')
    try {
      const res = await api.broadcasts.create({
        title: form.title,
        messageType: outgoingType,
        messageContent: outgoingContent,
        targetType: form.targetType,
        // tag mode: required; multi-account-dedup mode: optional narrowing filter; else: null
        targetTagId:
          form.targetType === 'tag'
            ? form.targetTagId || null
            : form.targetType === 'multi-account-dedup'
            ? form.targetTagId || null
            : null,
        status: 'draft',
        lineAccountId: form.targetType === 'multi-account-dedup' ? null : (selectedAccountId || null),
        accountIds: form.targetType === 'multi-account-dedup' ? form.accountIds : undefined,
        dedupPriority: form.targetType === 'multi-account-dedup' ? form.dedupPriority : undefined,
        // タグで絞り込みかつビルダーで条件を組んだ場合、segment_conditions として保存。
        // 単一タグ選択 (targetTagId) の場合は送らない (互換挙動)。
        segmentConditions: form.targetType === 'tag' && form.segmentConditions
          ? JSON.stringify(form.segmentConditions)
          : undefined,
        // datetime-local returns YYYY-MM-DDTHH:mm in JST wall-clock time
        // Append +09:00 so new Date() parses correctly for epoch comparisons
        scheduledAt: form.sendNow || !form.scheduledAt
          ? null
          : form.scheduledAt + ':00.000+09:00',
      })
      if (res.success) {
        onSuccess()
      } else {
        setError(res.error)
      }
    } catch {
      setError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
      <h2 className="text-sm font-semibold text-gray-800 mb-5">新規配信を作成</h2>

      <div className="space-y-4 max-w-lg">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            配信タイトル <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="例: 3月のキャンペーン告知"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        {/* Message type */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">メッセージ種別</label>
          <div className="flex gap-2">
            {(Object.keys(messageTypeLabels) as ApiBroadcast['messageType'][]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => switchMessageType(type)}
                className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                  form.messageType === type
                    ? 'border-green-500 text-green-700 bg-green-50'
                    : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
                }`}
              >
                {messageTypeLabels[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Message content */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-600">
              メッセージ内容 <span className="text-red-500">*</span>
              {(form.messageType === 'flex' || form.messageType === 'image' || form.messageType === 'video') && (
                <span className="ml-1 text-gray-400">(JSON形式)</span>
              )}
            </label>
            {form.messageType === 'text' && (
              <AiTextGenerateButton onClick={() => setShowAiGen(true)} size="sm" />
            )}
            {form.messageType === 'flex' && (
              <div className="flex gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowCardPicker(true)}
                  className="text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded transition-colors"
                  title="保存済みカード型メッセージを Flex として引用"
                >
                  🃏 カードから引用
                </button>
                <button
                  type="button"
                  onClick={() => setShowCouponPicker(true)}
                  className="text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded transition-colors"
                  title="保存済みクーポンを Flex メッセージとして引用"
                >
                  🎟️ クーポンを送る
                </button>
                <AiTextGenerateButton onClick={() => setShowAiGen(true)} size="sm" label="AI に Flex を作らせる" />
              </div>
            )}
            {form.messageType === 'image' && (
              <button
                type="button"
                onClick={() => setShowAiImageGen(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg shadow-sm transition-colors"
              >
                <span>✨</span>
                <span>AI で画像を生成</span>
              </button>
            )}
          </div>

          {/* Image helper: URL inputs that auto-generate the required LINE image JSON */}
          {form.messageType === 'image' && (() => {
            let parsed: { originalContentUrl?: string; previewImageUrl?: string } = {}
            try { parsed = JSON.parse(form.messageContent) } catch { /* not yet valid */ }
            return (
              <div className="space-y-2 mb-2">
                {/* 画像ファイルアップロード — 顧客からもらった画像をそのまま使う場合 */}
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <label className="block text-xs font-medium text-emerald-900">
                      📤 画像ファイルをアップロード (顧客素材をそのまま使う場合)
                    </label>
                    <label className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors ${
                      uploadingImage
                        ? 'bg-emerald-300 text-white cursor-wait'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}>
                      <span>{uploadingImage ? '⏳ アップロード中…' : '📁 ファイルを選択'}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={uploadingImage}
                        onChange={(e) => {
                          handleImageUpload(e.target.files?.[0] ?? null)
                          // ファイル input は同じファイル再選択を許可するためリセット
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                  {parsed.originalContentUrl && (
                    <div className="flex items-center gap-2 bg-white border border-emerald-200 rounded p-2 mb-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={parsed.originalContentUrl} alt="プレビュー" className="w-12 h-12 object-cover rounded border border-emerald-200" />
                      <span className="text-[11px] text-emerald-800 truncate flex-1">{parsed.originalContentUrl}</span>
                    </div>
                  )}
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    PNG / JPEG / WebP・10MB まで。アップロード後、自動で URL が下の枠に入ります。
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-gray-500 mb-1">元画像URL (originalContentUrl)</label>
                  <input
                    type="url"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="https://example.com/image.png"
                    value={parsed.originalContentUrl ?? ''}
                    onChange={(e) => {
                      const orig = e.target.value
                      const prev = parsed.previewImageUrl ?? orig
                      setForm({ ...form, messageContent: JSON.stringify({ originalContentUrl: orig, previewImageUrl: prev }) })
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">プレビュー画像URL (previewImageUrl)</label>
                  <input
                    type="url"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="https://example.com/preview.png (空欄で元画像と同じ)"
                    value={parsed.previewImageUrl ?? ''}
                    onChange={(e) => {
                      const prev = e.target.value
                      setForm({ ...form, messageContent: JSON.stringify({ originalContentUrl: parsed.originalContentUrl ?? '', previewImageUrl: prev }) })
                    }}
                  />
                </div>
                {/* リンク URL (任意): 入力されると LINE 仕様に従い Flex Message に自動変換して送信 */}
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <label className="block text-xs font-medium text-blue-900 mb-1">
                    🔗 画像クリック時のリンク URL (任意)
                  </label>
                  <input
                    type="url"
                    className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                    placeholder="https://example.com/landing"
                    value={imageLinkUrl}
                    onChange={(e) => setImageLinkUrl(e.target.value)}
                  />
                  {imageLinkUrl && (
                    <div className="mt-2">
                      <label className="block text-[11px] text-blue-700 mb-1">
                        ボタンラベル (タップ時のアクセシビリティ用、画面には出ません)
                      </label>
                      <input
                        type="text"
                        className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                        placeholder="詳しく見る"
                        maxLength={20}
                        value={imageLinkLabel}
                        onChange={(e) => setImageLinkLabel(e.target.value)}
                      />
                    </div>
                  )}
                  <p className="text-[11px] text-blue-700 mt-1.5 leading-relaxed">
                    LINE 仕様上、画像メッセージにそのままリンクは付けられません。リンク URL を入れると、送信時に自動で <strong>Flex Message</strong> 形式 (画像クリックで URL に遷移) に変換します。
                  </p>
                </div>
              </div>
            )
          })()}

          {/* 動画タイプの UI */}
          {form.messageType === 'video' && (
            <VideoUploadSection
              value={form.messageContent}
              onChange={(json) => setForm({ ...form, messageContent: json })}
            />
          )}

          {/* リンクするイベント: 選択で {{liff_id}} 入りテンプレ URL を本文末尾に挿入 */}
          {linkableEvents.length > 0 && form.messageType === 'text' && (
            <div className="mb-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                リンクするイベント（任意）
              </label>
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value
                  if (!id) return
                  const url = `https://liff.line.me/{{liff_id}}/?page=event&id=${id}`
                  setForm((prev) => ({
                    ...prev,
                    messageContent: prev.messageContent
                      ? `${prev.messageContent}\n${url}`
                      : url,
                  }))
                  e.target.value = ''
                }}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-full"
              >
                <option value="">— 選択しない —</option>
                {linkableEvents.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} ({ev.target_type === 'multi-account-dedup' ? 'multi' : 'single'})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                選ぶと本文末尾にテンプレ URL を挿入。{'{{liff_id}}'} は配信時に各友だちのアカに対応した値に自動置換されます。
              </p>
            </div>
          )}
          <textarea
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
            rows={form.messageType === 'flex' ? 8 : form.messageType === 'image' ? 3 : 4}
            placeholder={
              form.messageType === 'text'
                ? '配信するメッセージを入力...'
                : form.messageType === 'image'
                ? '{"originalContentUrl":"...","previewImageUrl":"..."}'
                : '{"type":"bubble","body":{...}}'
            }
            value={form.messageContent}
            onChange={(e) => setForm({ ...form, messageContent: e.target.value })}
            style={{ fontFamily: form.messageType !== 'text' ? 'monospace' : 'inherit' }}
          />
          {form.messageType === 'image' && (
            <p className="text-xs text-gray-400 mt-1">上のURLフォームか、直接JSONを編集できます</p>
          )}
          {form.messageType === 'flex' && form.messageContent && (() => {
            try { JSON.parse(form.messageContent); return true } catch { return false }
          })() && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 mb-2">プレビュー</p>
              <FlexPreviewComponent content={form.messageContent} maxWidth={300} />
            </div>
          )}
        </div>

        {/* Target */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">配信対象</label>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, uiTargetMode: 'all', targetType: 'all', targetTagId: '', segmentConditions: null })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.uiTargetMode === 'all'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              全員
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, uiTargetMode: 'tag', targetType: 'tag', segmentConditions: null })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.uiTargetMode === 'tag'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              タグで絞り込み
            </button>
            <button
              type="button"
              onClick={() => setForm({
                ...form,
                uiTargetMode: 'link-clicked',
                targetType: 'tag',
                targetTagId: '',
                segmentConditions: {
                  operator: 'AND',
                  rules: [{ type: 'link_clicked_within', value: { days: form.linkClickedDays, trackedLinkId: form.linkClickedLinkId || null } }],
                },
              })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.uiTargetMode === 'link-clicked'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              🔗 リンクをタップした友だち
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, uiTargetMode: 'multi-account-dedup', targetType: 'multi-account-dedup', targetTagId: '', segmentConditions: null })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.uiTargetMode === 'multi-account-dedup'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              複数アカ重複除外
            </button>
          </div>
          {form.uiTargetMode === 'tag' && (
            <SegmentBuilder
              tags={tags}
              segmentTags={segmentTags}
              accountId={selectedAccountId ?? null}
              initialConditions={form.segmentConditions ?? { operator: 'AND', rules: [{ type: 'tag_exists', value: '' }] }}
              embedded
              onApply={(conditions) => {
                // ルールが 1 つだけ + tag_exists で、単一タグ運用と等価のときは
                // targetTagId に格納してレガシー path に乗せる (insight 取得などの互換性)。
                // それ以外は segment_conditions として保存する。
                const onlyTagRule =
                  conditions.rules.length === 1 &&
                  conditions.rules[0].type === 'tag_exists' &&
                  typeof conditions.rules[0].value === 'string'
                if (onlyTagRule) {
                  setForm((prev) => ({
                    ...prev,
                    targetTagId: conditions.rules[0].value as string,
                    segmentConditions: null,
                  }))
                } else {
                  setForm((prev) => ({
                    ...prev,
                    targetTagId: '',
                    segmentConditions: conditions,
                  }))
                }
              }}
            />
          )}
          {form.uiTargetMode === 'link-clicked' && (
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-600">過去</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.linkClickedDays}
                  onChange={(e) => {
                    const days = Math.max(1, Math.min(365, parseInt(e.target.value || '7', 10)))
                    setForm((prev) => ({
                      ...prev,
                      linkClickedDays: days,
                      segmentConditions: {
                        operator: 'AND',
                        rules: [{ type: 'link_clicked_within', value: { days, trackedLinkId: prev.linkClickedLinkId || null } }],
                      },
                    }))
                  }}
                  className="w-20 px-2 py-1 border border-slate-300 rounded text-sm text-center"
                />
                <span className="text-xs text-slate-600">日以内にタップした友だちに送信</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-600">対象リンク:</span>
                <select
                  value={form.linkClickedLinkId}
                  onChange={(e) => {
                    const id = e.target.value
                    setForm((prev) => ({
                      ...prev,
                      linkClickedLinkId: id,
                      segmentConditions: {
                        operator: 'AND',
                        rules: [{ type: 'link_clicked_within', value: { days: prev.linkClickedDays, trackedLinkId: id || null } }],
                      },
                    }))
                  }}
                  className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
                >
                  <option value="">どのリンクでも (OR)</option>
                  {trackedLinks.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-slate-500">
                tracked_links に登録した URL を 1 回でもタップした友だちに配信されます。リンクは「分析 → リファラルリンク」で管理できます。
              </p>
            </div>
          )}
          {form.uiTargetMode === 'multi-account-dedup' && (
            <MultiAccountDedupSection
              accountIds={form.accountIds}
              dedupPriority={form.dedupPriority}
              targetTagId={form.targetTagId || null}
              tags={tags}
              onAccountIdsChange={(ids) => setForm({ ...form, accountIds: ids })}
              onDedupPriorityChange={(ids) => setForm({ ...form, dedupPriority: ids })}
              onTargetTagIdChange={(id) => setForm({ ...form, targetTagId: id ?? '' })}
            />
          )}
        </div>

        {/* Schedule */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">配信タイミング</label>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setForm({ ...form, sendNow: true, scheduledAt: '' })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                form.sendNow
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              下書きとして保存
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, sendNow: false })}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md border transition-colors ${
                !form.sendNow
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-gray-300 text-gray-600 bg-white hover:border-gray-400'
              }`}
            >
              予約配信
            </button>
          </div>
          {!form.sendNow && (
            <input
              type="datetime-local"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
            />
          )}
        </div>

        {/* Error */}
        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '作成中...' : '作成'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>

      <AiTextGenerateModal
        open={showAiGen}
        onClose={() => setShowAiGen(false)}
        kind={form.messageType === 'flex' ? 'broadcast.flex' : 'broadcast.text'}
        title={form.messageType === 'flex' ? 'Flex メッセージを AI に作らせる' : '配信文を AI に書かせる'}
        context={{
          title: form.title,
          targetSegment: form.targetType === 'all' ? '全友だち' : form.targetType === 'tag' ? `タグ: ${form.targetTagId}` : form.targetType,
        }}
        onSelect={(text) => {
          setForm((prev) => ({ ...prev, messageContent: text }))
        }}
      />

      <AiImageGenerateModal
        open={showAiImageGen}
        onClose={() => setShowAiImageGen(false)}
        size="square"
        purpose="broadcast"
        menuName={form.title || '一斉配信画像'}
        onSelect={async (file) => {
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
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ data: dataUrl, mimeType: file.type, filename: file.name }),
          })
          const json = (await res.json()) as { success: boolean; data?: { url: string }; error?: string }
          if (!res.ok || !json.success || !json.data?.url) {
            throw new Error(json.error ?? '画像アップロードに失敗しました')
          }
          const url = json.data.url
          setForm((prev) => ({
            ...prev,
            messageType: 'image',
            messageContent: JSON.stringify({ originalContentUrl: url, previewImageUrl: url }),
          }))
        }}
      />

      <CouponPickerModal
        open={showCouponPicker}
        onClose={() => setShowCouponPicker(false)}
        onPick={(flex, altText) => {
          // buildCouponFlex は { type:'flex', altText, contents:{bubble} } の
          // フル wrapper を返す。broadcast の messageContent には bubble だけを
          // 入れる (送信時に buildMessage が再度 wrapper を組む) — wrapper を
          // そのまま入れると LINE API が `contents.type='flex'` を拒否して落ちる。
          const f = flex as { contents?: unknown }
          const bubble = f && typeof f === 'object' && f.contents ? f.contents : flex
          setForm((prev) => ({
            ...prev,
            messageType: 'flex',
            messageContent: JSON.stringify(bubble),
            title: prev.title || `🎟️ ${altText}`,
          }))
          setShowCouponPicker(false)
        }}
      />

      <CardMessagePickerModal
        open={showCardPicker}
        onClose={() => setShowCardPicker(false)}
        onPick={(flexJson, name) => {
          // クーポンと同じく、保存済み flex_json は { type:'flex', altText, contents:{bubble|carousel} }
          // の wrapper 形式。broadcast の messageContent には contents (bubble or carousel) だけ
          // 入れる — wrapper のまま入れると send 時に buildMessage が再度 wrapper を組み立てて
          // `contents.type='flex'` の二重構造になり LINE API が 400 を返す。
          let unwrapped = flexJson
          try {
            const parsed = JSON.parse(flexJson) as { type?: string; contents?: unknown }
            if (parsed && parsed.type === 'flex' && parsed.contents) {
              unwrapped = JSON.stringify(parsed.contents)
            }
          } catch { /* parse 失敗時は元の文字列を渡す */ }
          setForm((prev) => ({
            ...prev,
            messageType: 'flex',
            messageContent: unwrapped,
            title: prev.title || `🃏 ${name}`,
          }))
          setShowCardPicker(false)
        }}
      />
    </div>
  )
}

// ----- クーポン選択モーダル -----
function CouponPickerModal({ open, onClose, onPick }: {
  open: boolean
  onClose: () => void
  onPick: (flex: unknown, altText: string) => void
}) {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<Array<{
    id: string
    name: string
    status: string
    valid_to: string
    image_url: string | null
    discount_mode: string | null
    discount_yen: number | null
    discount_percent: number | null
    strikethrough_before: number | null
    strikethrough_after: number | null
  }>>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !selectedAccountId) return
    setLoading(true)
    setError(null)
    fetchApi<{ success: boolean; items: typeof items }>(`/api/coupons`, {
      headers: { 'X-Line-Account-Id': selectedAccountId },
    })
      .then((r) => { if (r.success) setItems(r.items) })
      .catch((e) => setError(e instanceof Error ? e.message : '取得失敗'))
      .finally(() => setLoading(false))
  }, [open, selectedAccountId])

  if (!open) return null

  const offerText = (c: typeof items[number]): string => {
    if (c.discount_mode === 'yen' && c.discount_yen) return `¥${c.discount_yen.toLocaleString('ja-JP')} OFF`
    if (c.discount_mode === 'percent' && c.discount_percent) return `${c.discount_percent}% OFF`
    if (c.discount_mode === 'strikethrough' && c.strikethrough_before && c.strikethrough_after) {
      return `¥${c.strikethrough_before.toLocaleString('ja-JP')} → ¥${c.strikethrough_after.toLocaleString('ja-JP')}`
    }
    return 'クーポン'
  }

  const handlePick = async (coupon: typeof items[number]) => {
    setGenerating(coupon.id)
    setError(null)
    try {
      const res = await fetchApi<{ success: boolean; flex: unknown; offerText: string; error?: string }>(`/api/coupons/${coupon.id}/flex`, {
        method: 'POST',
      })
      if (!res.success) { setError(res.error ?? 'Flex 生成失敗'); return }
      onPick(res.flex, coupon.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Flex 生成失敗')
    }
    setGenerating(null)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">🎟️ クーポンを選択</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        {error && <div className="mb-3 p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">{error}</div>}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-8">読み込み中…</p>
        ) : items.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 mb-2">クーポンがありません</p>
            <a href="/coupons/edit" className="text-xs text-emerald-600 underline">クーポンを作成する</a>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handlePick(c)}
                disabled={generating !== null || c.status !== 'published'}
                className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-emerald-300 hover:bg-emerald-50 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {c.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.image_url} alt="" className="w-14 h-10 rounded object-cover bg-gray-100 shrink-0" />
                ) : (
                  <div className="w-14 h-10 rounded bg-emerald-50 flex items-center justify-center text-emerald-300 shrink-0">🎟️</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900 truncate">{c.name}</p>
                  <p className="text-xs text-emerald-700 font-bold">{offerText(c)}</p>
                </div>
                <div className="text-[10px] text-gray-400 shrink-0">
                  {c.status === 'published' ? '公開中' : c.status === 'draft' ? '下書き' : 'アーカイブ'}
                </div>
                {generating === c.id && <span className="text-xs text-gray-400">処理中…</span>}
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-4 text-center">
          下書きクーポンは配信できません。先に「保存」して公開状態にしてください。
        </p>
      </div>
    </div>
  )
}

// ----- 動画アップロードセクション (動画ファイル選択 → 自動サムネ抽出 → R2 アップロード) -----
function VideoUploadSection({ value, onChange }: { value: string; onChange: (json: string) => void }) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  let parsed: { originalContentUrl?: string; previewImageUrl?: string } = {}
  try { parsed = JSON.parse(value) } catch { /* not yet valid */ }

  const setUrls = (orig: string, preview: string) => {
    onChange(JSON.stringify({ originalContentUrl: orig, previewImageUrl: preview }))
  }

  // 動画から HTML5 video → canvas でサムネ画像を抽出して File 化
  const extractThumbnail = async (videoFile: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      const url = URL.createObjectURL(videoFile)
      video.src = url
      video.onloadedmetadata = () => {
        // 動画の 1 秒地点 (短い動画なら 0 秒) を選ぶ
        video.currentTime = Math.min(1, Math.max(0, video.duration - 0.1))
      }
      video.onseeked = () => {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 1280
        canvas.height = video.videoHeight || 720
        const ctx = canvas.getContext('2d')
        if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas context unavailable')); return }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url)
          if (!blob) { reject(new Error('thumbnail blob creation failed')); return }
          resolve(new File([blob], 'thumb.jpg', { type: 'image/jpeg' }))
        }, 'image/jpeg', 0.85)
      }
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('動画の読み込みに失敗しました')) }
    })
  }

  const uploadThumbnail = async (file: File): Promise<string> => {
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
    if (!res.ok || !json.success || !json.data?.url) throw new Error(json.error ?? 'サムネアップロード失敗')
    return json.data.url
  }

  const uploadVideo = async (file: File): Promise<string> => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
    // 大きい動画は streaming で送る (XHR で progress 取得)
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${apiUrl}/api/videos?filename=${encodeURIComponent(file.name)}`)
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
      xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.floor((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        try {
          const json = JSON.parse(xhr.responseText) as { success: boolean; data?: { url: string }; error?: string }
          if (xhr.status >= 200 && xhr.status < 300 && json.success && json.data?.url) {
            resolve(json.data.url)
          } else {
            reject(new Error(json.error ?? `アップロード失敗 (${xhr.status})`))
          }
        } catch (e) {
          reject(e instanceof Error ? e : new Error('レスポンス解析失敗'))
        }
      }
      xhr.onerror = () => reject(new Error('ネットワークエラー'))
      xhr.send(file)
    })
  }

  const handleFile = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setError('動画ファイルを選択してください (MP4 / MOV / WebM)')
      return
    }
    if (file.size > 200 * 1024 * 1024) {
      setError(`ファイルが大きすぎます (上限 200MB、選択 ${Math.floor(file.size / 1024 / 1024)}MB)`)
      return
    }
    setError(null)
    setUploading(true)
    setProgress(0)
    try {
      // 1. サムネ抽出 + アップロード
      const thumbFile = await extractThumbnail(file)
      const thumbUrl = await uploadThumbnail(thumbFile)
      // 2. 動画本体アップロード (進捗バー表示)
      const videoUrl = await uploadVideo(file)
      setUrls(videoUrl, thumbUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アップロード失敗')
    }
    setUploading(false)
    setProgress(null)
  }

  return (
    <div className="space-y-3 mb-2">
      <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
        <p className="text-xs text-purple-900 font-medium mb-1">📹 動画配信</p>
        <p className="text-[11px] text-purple-800 leading-relaxed">
          MP4 / MOV / WebM・最大 200MB。アップロードすると自動でサムネイル画像を抽出します。
        </p>
      </div>

      {/* アップロードボタン */}
      <div className="flex flex-col gap-2">
        <label className={`inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-purple-300 rounded-lg cursor-pointer text-sm font-medium transition-colors ${
          uploading ? 'bg-purple-50 text-purple-400 cursor-wait' : 'text-purple-700 hover:bg-purple-50'
        }`}>
          <span>{uploading ? `⏳ アップロード中… ${progress ?? 0}%` : '📁 動画ファイルをアップロード'}</span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { handleFile(e.target.files?.[0] ?? null); e.target.value = '' }}
          />
        </label>
        {uploading && progress != null && (
          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div className="h-full bg-purple-500 transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
        )}
        {error && <div className="p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">{error}</div>}
      </div>

      {/* URL 直接入力 (手動の場合や URL 編集用) */}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">URL を直接入力する (外部 CDN 等)</summary>
        <div className="mt-2 space-y-2 p-3 bg-gray-50 border border-gray-200 rounded">
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">動画 URL (originalContentUrl)</label>
            <input
              type="url"
              placeholder="https://example.com/video.mp4"
              value={parsed.originalContentUrl ?? ''}
              onChange={(e) => setUrls(e.target.value, parsed.previewImageUrl ?? '')}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-500 mb-1">サムネイル URL (previewImageUrl)</label>
            <input
              type="url"
              placeholder="https://example.com/thumb.jpg"
              value={parsed.previewImageUrl ?? ''}
              onChange={(e) => setUrls(parsed.originalContentUrl ?? '', e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
            />
          </div>
        </div>
      </details>

      {/* プレビュー */}
      {parsed.originalContentUrl && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-2">プレビュー</p>
          <div className="flex gap-3">
            {parsed.previewImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={parsed.previewImageUrl} alt="" className="w-24 h-24 object-cover rounded border border-gray-200" />
            )}
            <div className="flex-1 min-w-0 text-[11px] text-gray-600 space-y-1">
              <p className="truncate">🎬 {parsed.originalContentUrl}</p>
              {parsed.previewImageUrl && <p className="truncate">🖼️ {parsed.previewImageUrl}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ----- カード型メッセージ選択モーダル -----
function CardMessagePickerModal({ open, onClose, onPick }: {
  open: boolean
  onClose: () => void
  onPick: (flexJson: string, name: string) => void
}) {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<Array<{
    id: string
    name: string
    card_type: 'product' | 'location' | 'person' | 'image'
    cards: unknown[]
    flex_json: string | null
  }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !selectedAccountId) return
    setLoading(true)
    setError(null)
    fetchApi<{ success: boolean; items: typeof items }>(`/api/card-messages`, {
      headers: { 'X-Line-Account-Id': selectedAccountId },
    })
      .then((r) => { if (r.success) setItems(r.items) })
      .catch((e) => setError(e instanceof Error ? e.message : '取得失敗'))
      .finally(() => setLoading(false))
  }, [open, selectedAccountId])

  if (!open) return null

  const typeEmoji = (t: string) => t === 'product' ? '🛍️' : t === 'location' ? '📍' : t === 'person' ? '👤' : '🖼️'
  const typeLabel = (t: string) => t === 'product' ? 'プロダクト' : t === 'location' ? 'ロケーション' : t === 'person' ? 'パーソン' : 'イメージ'

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">🃏 カード型メッセージから引用</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        {error && <div className="mb-3 p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">{error}</div>}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-8">読み込み中…</p>
        ) : items.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 mb-2">カード型メッセージがまだありません</p>
            <a href="/card-messages/edit" className="text-xs text-blue-600 underline">作成する</a>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  if (!m.flex_json) { setError('Flex JSON 未生成。再保存してください'); return }
                  onPick(m.flex_json, m.name)
                }}
                disabled={!m.flex_json}
                className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 text-left transition-colors disabled:opacity-50"
              >
                <span className="text-2xl shrink-0">{typeEmoji(m.card_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-gray-900 truncate">{m.name}</p>
                  <p className="text-[11px] text-gray-500">{typeLabel(m.card_type)} · {m.cards.length} 枚</p>
                </div>
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-4 text-center">
          選択するとカルーセル Flex として配信本文にセットされます。
        </p>
      </div>
    </div>
  )
}

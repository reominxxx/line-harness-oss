'use client'

import { useState, useMemo, useCallback } from 'react'
import { api, fetchApi, type SegmentTagDto } from '@/lib/api'

interface ApiOk {
  success: boolean
  error?: string
  data?: { id: string }
}

// ─── 型 ────────────────────────────────────────────────────────────

// worker 側の FormField.type に揃える(radio = 単一選択 / checkbox = 複数選択)
type QuestionType = 'radio' | 'checkbox'

interface Option {
  value: string
  label: string
  segmentName: string // セグメント(タグ)として作成する名前
  color: string
}

interface Question {
  id: string // クライアント側の一時 ID
  name: string // fields[].name (英数, snake_case)
  label: string // 表示用ラベル
  type: QuestionType
  options: Option[]
}

type DeliveryTarget = 'friend_add' | 'broadcast'

type BroadcastTargetType = 'all' | 'segment' | 'unanswered' | 'referral'

interface Props {
  open: boolean
  accountId: string
  /** カード型 Flex の「回答する」ボタンが開く LIFF の ID(未設定なら配信ボタンは無効) */
  liffId?: string | null
  onClose: () => void
  onCreated: () => void
}

// ─── Flex Message 構築(LINE 公式リサーチのカードに近い形)──────────
function buildResearchFlex(args: {
  title: string
  description: string
  imageUrl: string
  liffUrl: string
}): unknown {
  const { title, description, imageUrl, liffUrl } = args
  return {
    type: 'bubble',
    size: 'kilo',
    ...(imageUrl
      ? {
          hero: {
            type: 'image',
            url: imageUrl,
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
            action: { type: 'uri', uri: liffUrl },
          },
        }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true },
        ...(description
          ? [{ type: 'text', text: description, size: 'sm', color: '#666666', wrap: true }]
          : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#06C755',
          action: { type: 'uri', label: '回答する', uri: liffUrl },
        },
      ],
    },
  }
}

// ─── テンプレート(年代 / 性別 / 居住地) ─────────────────────────────

const PALETTE = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1',
]

const newId = () => Math.random().toString(36).slice(2, 10)

function makeOption(label: string, segmentName: string, idx: number): Option {
  return {
    value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `opt${idx + 1}`,
    label,
    segmentName,
    color: PALETTE[idx % PALETTE.length],
  }
}

const TEMPLATES: Record<'age' | 'gender' | 'area', () => Question> = {
  age: () => ({
    id: newId(),
    name: 'age',
    label: '年代を教えてください',
    type: 'radio',
    options: [
      makeOption('10代', '年代:10代', 0),
      makeOption('20代', '年代:20代', 1),
      makeOption('30代', '年代:30代', 2),
      makeOption('40代', '年代:40代', 3),
      makeOption('50代', '年代:50代', 4),
      makeOption('60代以上', '年代:60代以上', 5),
    ],
  }),
  gender: () => ({
    id: newId(),
    name: 'gender',
    label: '性別を教えてください',
    type: 'radio',
    options: [
      makeOption('女性', '性別:女性', 0),
      makeOption('男性', '性別:男性', 1),
      makeOption('回答しない', '性別:無回答', 2),
    ],
  }),
  area: () => ({
    id: newId(),
    name: 'area',
    label: 'お住まいの地域を教えてください',
    type: 'radio',
    options: [
      makeOption('北海道・東北', '地域:北海道東北', 0),
      makeOption('関東', '地域:関東', 1),
      makeOption('中部', '地域:中部', 2),
      makeOption('近畿', '地域:近畿', 3),
      makeOption('中国・四国', '地域:中四国', 4),
      makeOption('九州・沖縄', '地域:九州沖縄', 5),
      makeOption('海外', '地域:海外', 6),
    ],
  }),
}

// ─── 本体 ──────────────────────────────────────────────────────────

// 開始/終了日時のデフォルト(今日〜+7日)
function defaultStart(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  return d.toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm
}
function defaultEnd(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  d.setHours(23, 59, 0, 0)
  return d.toISOString().slice(0, 16)
}

export function ResearchCreatorModal({ open, accountId, liffId, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [startAt, setStartAt] = useState<string>(defaultStart())
  const [endAt, setEndAt] = useState<string>(defaultEnd())
  const [uploadingImage, setUploadingImage] = useState(false)
  const [questions, setQuestions] = useState<Question[]>([])
  const [deliveryTargets, setDeliveryTargets] = useState<DeliveryTarget[]>(['broadcast'])
  const [broadcastTargetType, setBroadcastTargetType] = useState<BroadcastTargetType>('all')
  const [referralDays, setReferralDays] = useState<number>(7)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null)

  const reset = useCallback(() => {
    setName('')
    setDescription('')
    setImageUrl('')
    setStartAt(defaultStart())
    setEndAt(defaultEnd())
    setQuestions([])
    setDeliveryTargets(['broadcast'])
    setBroadcastTargetType('all')
    setReferralDays(7)
    setError(null)
    setSaving(false)
    setSendResult(null)
  }, [])

  // 画像アップロード(/api/images に POST)
  const handleImageUpload = useCallback(async (file: File) => {
    setError(null)
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
        throw new Error(json.error || '画像アップロードに失敗しました')
      }
      setImageUrl(json.data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像アップロードに失敗しました')
    } finally {
      setUploadingImage(false)
    }
  }, [])

  const handleClose = useCallback(() => {
    if (saving) return
    reset()
    onClose()
  }, [saving, reset, onClose])

  const addTemplate = (key: keyof typeof TEMPLATES) => {
    setQuestions((prev) => [...prev, TEMPLATES[key]()])
  }

  const addCustom = () => {
    setQuestions((prev) => [
      ...prev,
      {
        id: newId(),
        name: `q${prev.length + 1}`,
        label: '新しい質問',
        type: 'radio',
        options: [makeOption('選択肢 1', '選択肢 1', 0)],
      },
    ])
  }

  const removeQuestion = (id: string) =>
    setQuestions((prev) => prev.filter((q) => q.id !== id))

  const updateQuestion = (id: string, patch: Partial<Question>) =>
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)))

  const addOption = (qid: string) =>
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === qid
          ? { ...q, options: [...q.options, makeOption(`選択肢 ${q.options.length + 1}`, '', q.options.length)] }
          : q,
      ),
    )

  const removeOption = (qid: string, idx: number) =>
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === qid ? { ...q, options: q.options.filter((_, i) => i !== idx) } : q,
      ),
    )

  const updateOption = (qid: string, idx: number, patch: Partial<Option>) =>
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === qid
          ? { ...q, options: q.options.map((o, i) => (i === idx ? { ...o, ...patch } : o)) }
          : q,
      ),
    )

  const totalSegments = useMemo(
    () => questions.reduce((acc, q) => acc + q.options.length, 0),
    [questions],
  )

  /**
   * @param mode 'draft' = 下書きとして保存(非アクティブ)
   *             'publish' = 公開保存(アクティブ・後から配信可能)
   *             'publish-and-send' = 公開保存 + 即時配信
   */
  const handleSave = async (mode: 'draft' | 'publish' | 'publish-and-send') => {
    setError(null)
    setSendResult(null)
    if (!name.trim()) {
      setError('リサーチ名は必須です')
      return
    }
    if (mode === 'publish-and-send' && !liffId) {
      setError('このアカウントには LIFF ID が設定されていません。配信は LIFF ID を登録してから可能になります。')
      return
    }
    const sendNow = mode === 'publish-and-send'
    const isActive = mode !== 'draft'
    if (questions.length === 0) {
      setError('質問を 1 つ以上追加してください')
      return
    }
    for (const q of questions) {
      if (!q.label.trim()) {
        setError(`質問ラベルが空です: ${q.name}`)
        return
      }
      if (q.options.length === 0) {
        setError(`「${q.label}」に選択肢が 1 つもありません`)
        return
      }
      for (const opt of q.options) {
        if (!opt.label.trim() || !opt.segmentName.trim()) {
          setError(`「${q.label}」の選択肢にラベル / セグメント名が空のものがあります`)
          return
        }
      }
    }

    setSaving(true)
    try {
      // Step 1: 各選択肢分のセグメント(タグ)を作成
      // 既存セグメント名と衝突したら既存を再利用するため、まず一覧を取得
      const tagsRes = await api.segmentTags.list(accountId)
      const existingByName = new Map<string, SegmentTagDto>()
      if (tagsRes.success) {
        for (const t of tagsRes.items) existingByName.set(t.name, t)
      }

      // questions の各 option に tagId を埋める
      const enriched = await Promise.all(
        questions.map(async (q) => {
          const opts = await Promise.all(
            q.options.map(async (opt) => {
              const existing = existingByName.get(opt.segmentName.trim())
              if (existing) return { ...opt, tagId: existing.id }
              // 新規作成
              const created = await api.segmentTags.create(accountId, {
                name: opt.segmentName.trim(),
                criteria: `リサーチ「${name}」の質問「${q.label}」で「${opt.label}」を選択した友だち`,
                color: opt.color,
              })
              if (!created.success || !created.tag) {
                throw new Error(`セグメント作成に失敗: ${opt.segmentName}`)
              }
              existingByName.set(created.tag.name, created.tag)
              return { ...opt, tagId: created.tag.id }
            }),
          )
          return { ...q, options: opts }
        }),
      )

      // Step 2: fields JSON を組み立てて forms に保存
      const fields = enriched.map((q) => ({
        name: q.name,
        label: q.label,
        type: q.type,
        required: true,
        options: q.options.map((o) => ({
          value: o.value,
          label: o.label,
          tagId: o.tagId,
        })),
      }))

      const broadcastConfig = deliveryTargets.includes('broadcast')
        ? { broadcastTargetType, referralDays: broadcastTargetType === 'referral' ? referralDays : null }
        : null

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        fields: JSON.stringify(fields),
        formKind: 'research',
        deliveryTargets: JSON.stringify(deliveryTargets),
        researchTemplate: 'custom',
        mainImageUrl: imageUrl.trim() || null,
        startAt: startAt ? new Date(startAt).toISOString() : null,
        endAt: endAt ? new Date(endAt).toISOString() : null,
        isActive,
        // 一部のクライアントは snake_case で送ってくる可能性があるので両対応
        form_kind: 'research',
        delivery_targets: JSON.stringify(deliveryTargets),
        broadcast_config: broadcastConfig ? JSON.stringify(broadcastConfig) : null,
      }

      const res = await fetchApi<ApiOk>('/api/forms', {
        method: 'POST',
        headers: { 'x-line-account-id': accountId },
        body: JSON.stringify(payload),
      })
      if (!res.success) {
        throw new Error('リサーチの保存に失敗しました')
      }
      const formId = res.data?.id

      // 「保存して配信」が押されていれば、Flex カードを構築して全員にブロードキャスト
      // LIFF URL は ?liffId=...&page=form&id=... 形式。
      //   - worker の detectLiffId() が ?liffId= から LIFF ID を読み取って liff.init する
      //   - getPage() が 'form' を返し initForm(formId) が起動して直接フォームを表示
      if (sendNow && liffId && formId) {
        const liffUrl = `https://liff.line.me/${liffId}?liffId=${liffId}&page=form&id=${formId}`
        const flex = buildResearchFlex({
          title: name.trim(),
          description: description.trim(),
          imageUrl: imageUrl.trim(),
          liffUrl,
        })
        const altText = `📋 ${name.trim()}`

        // broadcasts.create → send で全友だちへ送信
        const created = await api.broadcasts.create({
          title: altText,
          messageType: 'flex',
          messageContent: JSON.stringify(flex),
          targetType: 'all',
          lineAccountId: accountId,
        })
        if (!created.success || !created.data) {
          throw new Error('配信メッセージの作成に失敗しました')
        }
        const sendRes = await api.broadcasts.send(created.data.id)
        if (!sendRes.success) {
          throw new Error('配信の送信に失敗しました')
        }
        // broadcasts.send は status だけ返すので、人数は別途取得が必要なケースがある。
        // 詳細人数は broadcasts のステータス画面で確認できるため、ここでは "送信実行済み" のみ表示。
        setSendResult({ sent: 0, failed: 0, total: 0 })
        // フォームを閉じる前に結果を見せたいので、自動 close は省略
        onCreated()
        return
      }

      onCreated()
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-8">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">リサーチで作成</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              質問への回答で自動的にセグメント(タグ)が付与されます
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* 基本情報 */}
          <section className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                リサーチ名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 友だち追加アンケート"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">説明(任意)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="お客様向けの案内文"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  実施期間 開始
                </label>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">
                  実施期間 終了
                </label>
                <input
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">
                メイン画像
              </label>
              <div className="flex items-start gap-3">
                {imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt="メイン画像プレビュー"
                    className="w-24 h-24 object-cover rounded border border-gray-200"
                  />
                )}
                <div className="flex-1 space-y-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer text-xs px-3 py-1.5 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">
                    📷 {uploadingImage ? 'アップロード中...' : '画像をアップロード'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void handleImageUpload(f)
                        e.target.value = ''
                      }}
                      className="hidden"
                      disabled={uploadingImage}
                    />
                  </label>
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="または URL を直接入力"
                    className="w-full px-3 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
                  />
                  <p className="text-[10px] text-gray-400">
                    配信カードのヘッダーに使用(横長 1040×675px 推奨)
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* 質問 */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">質問</h3>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => addTemplate('age')}
                  className="text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded"
                >
                  + 年代
                </button>
                <button
                  type="button"
                  onClick={() => addTemplate('gender')}
                  className="text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded"
                >
                  + 性別
                </button>
                <button
                  type="button"
                  onClick={() => addTemplate('area')}
                  className="text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded"
                >
                  + 居住地
                </button>
                <button
                  type="button"
                  onClick={addCustom}
                  className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded font-medium"
                >
                  + カスタム質問
                </button>
              </div>
            </div>

            {questions.length === 0 && (
              <div className="text-center text-xs text-gray-400 py-8 border border-dashed border-gray-200 rounded-lg">
                上のボタンから質問を追加してください
              </div>
            )}

            {questions.map((q) => (
              <div key={q.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={q.label}
                    onChange={(e) => updateQuestion(q.id, { label: e.target.value })}
                    placeholder="質問文"
                    className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded font-medium"
                  />
                  <select
                    value={q.type}
                    onChange={(e) =>
                      updateQuestion(q.id, { type: e.target.value as QuestionType })
                    }
                    className="text-xs border border-gray-300 rounded px-2 py-1.5"
                  >
                    <option value="radio">単一選択</option>
                    <option value="checkbox">複数選択</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeQuestion(q.id)}
                    className="text-red-500 hover:text-red-700 text-xs px-2"
                  >
                    削除
                  </button>
                </div>

                <div className="ml-3 space-y-1.5">
                  <div className="grid grid-cols-[1fr_1fr_28px_24px] gap-2 text-[10px] text-gray-400 font-semibold">
                    <span>選択肢ラベル</span>
                    <span>セグメント(タグ)名</span>
                    <span className="text-center">色</span>
                    <span></span>
                  </div>
                  {q.options.map((opt, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_1fr_28px_24px] gap-2 items-center">
                      <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => updateOption(q.id, idx, { label: e.target.value })}
                        className="px-2 py-1 text-xs border border-gray-200 rounded"
                      />
                      <input
                        type="text"
                        value={opt.segmentName}
                        onChange={(e) => updateOption(q.id, idx, { segmentName: e.target.value })}
                        placeholder="このタグ名で作成"
                        className="px-2 py-1 text-xs border border-gray-200 rounded"
                      />
                      <input
                        type="color"
                        value={opt.color}
                        onChange={(e) => updateOption(q.id, idx, { color: e.target.value })}
                        className="w-7 h-7 rounded border border-gray-200 cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(q.id, idx)}
                        disabled={q.options.length === 1}
                        className="text-red-400 hover:text-red-600 disabled:opacity-30 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addOption(q.id)}
                    className="text-[11px] text-emerald-600 hover:text-emerald-700"
                  >
                    + 選択肢を追加
                  </button>
                </div>
              </div>
            ))}
          </section>

          {/* 配信タイミング */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">配信タイミング</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deliveryTargets.includes('friend_add')}
                onChange={(e) =>
                  setDeliveryTargets((prev) =>
                    e.target.checked
                      ? Array.from(new Set([...prev, 'friend_add']))
                      : prev.filter((t) => t !== 'friend_add'),
                  )
                }
                className="rounded"
              />
              友だち追加時のあいさつメッセージに同梱
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deliveryTargets.includes('broadcast')}
                onChange={(e) =>
                  setDeliveryTargets((prev) =>
                    e.target.checked
                      ? Array.from(new Set([...prev, 'broadcast']))
                      : prev.filter((t) => t !== 'broadcast'),
                  )
                }
                className="rounded"
              />
              既存友だちに配信する(後から手動で配信できます)
            </label>

            {deliveryTargets.includes('broadcast') && (
              <div className="ml-6 space-y-2 mt-2 p-3 bg-slate-50 rounded-lg">
                <p className="text-xs font-semibold text-slate-700">配信対象を絞り込む</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { v: 'all', label: '全員' },
                      { v: 'segment', label: '特定セグメント' },
                      { v: 'unanswered', label: '未回答者のみ' },
                      { v: 'referral', label: 'リファラルリンクをタップした友だち' },
                    ] as const
                  ).map((opt) => (
                    <label key={opt.v} className="flex items-center gap-2 text-xs">
                      <input
                        type="radio"
                        name="broadcastTarget"
                        checked={broadcastTargetType === opt.v}
                        onChange={() => setBroadcastTargetType(opt.v)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                {broadcastTargetType === 'referral' && (
                  <div className="flex items-center gap-2 text-xs">
                    <span>過去</span>
                    <input
                      type="number"
                      value={referralDays}
                      onChange={(e) => setReferralDays(Math.max(1, Number(e.target.value) || 7))}
                      className="w-16 px-2 py-1 border border-gray-200 rounded"
                      min={1}
                      max={365}
                    />
                    <span>日以内にタップした友だちに送信</span>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* フッター */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          {sendResult ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-emerald-700 font-semibold">
                ✅ リサーチを保存し、既存友だちに配信しました
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="text-sm px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium"
              >
                閉じる
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-gray-500">
                保存すると <strong>{totalSegments} 個のセグメント</strong>が作成されます
                {!liffId && (
                  <span className="ml-2 text-amber-600">
                    ※ LIFF 未設定のためカード配信は不可
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                {error && <p className="text-xs text-red-600 mr-2">{error}</p>}
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={saving}
                  className="text-sm px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => handleSave('draft')}
                  disabled={saving}
                  className="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded font-medium disabled:opacity-50"
                  title="非アクティブで保存(後で編集・公開できます)"
                >
                  📝 下書き保存
                </button>
                <button
                  type="button"
                  onClick={() => handleSave('publish')}
                  disabled={saving}
                  className="text-sm px-4 py-1.5 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded font-medium disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存(配信は後で)'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSave('publish-and-send')}
                  disabled={saving || !liffId}
                  className="text-sm px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium disabled:opacity-50"
                  title={!liffId ? 'LIFF ID をアカウント設定で登録してください' : '保存して全友だちにカードを配信'}
                >
                  {saving ? '配信中...' : '🚀 保存して今すぐ配信'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

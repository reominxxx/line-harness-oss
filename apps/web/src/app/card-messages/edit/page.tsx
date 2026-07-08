'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { AccountBadge } from '@/components/account-badge'
import { AiImageGenerateModal } from '@/components/rich-menus/ai-image-generate-modal'
import { uploadGeneratedImageToR2 } from '@/lib/upload-image'
import {
  CouponPickerModal,
  ResearchPickerModal,
} from '@/components/card-messages/action-picker-modals'

type CardType = 'product' | 'location' | 'person' | 'image'
type ActionType = 'uri' | 'message' | 'coupon' | 'research'
type TagColor = 'default' | 'white' | 'red' | 'brown' | 'green' | 'blue'

interface CardAction {
  label: string
  type: ActionType
  data: string
}

interface CardItem {
  tagLabel?: string
  tagColor?: TagColor
  imageUrl?: string
  title?: string
  description?: string
  price?: string
  address?: string
  extraInfoType?: string
  extraInfo?: string
  personName?: string
  tagLabel2?: string
  tagColor2?: TagColor
  tagLabel3?: string
  tagColor3?: TagColor
  actions: CardAction[]
}

const CARD_TYPES: Array<{ value: CardType; label: string; emoji: string; desc: string }> = [
  { value: 'product', label: 'プロダクト', emoji: '🛍️', desc: '商品 / メニュー' },
  { value: 'location', label: 'ロケーション', emoji: '📍', desc: '店舗 / 場所' },
  { value: 'person', label: 'パーソン', emoji: '👤', desc: 'スタッフ紹介' },
  { value: 'image', label: 'イメージ', emoji: '🖼️', desc: '画像のみ' },
]

const TAG_COLORS: Array<{ value: TagColor; bg: string; fg: string }> = [
  { value: 'default', bg: '#6B7280', fg: '#FFFFFF' },
  { value: 'white', bg: '#FFFFFF', fg: '#111827' },
  { value: 'red', bg: '#EF4444', fg: '#FFFFFF' },
  { value: 'brown', bg: '#A16207', fg: '#FFFFFF' },
  { value: 'green', bg: '#10B981', fg: '#FFFFFF' },
  { value: 'blue', bg: '#3B82F6', fg: '#FFFFFF' },
]

const ACTION_TYPES = [
  { value: 'uri', label: 'URL' },
  { value: 'coupon', label: 'クーポン' },
  { value: 'research', label: 'リサーチ' },
  { value: 'message', label: 'テキスト' },
]

const ACTION_PLACEHOLDER: Record<ActionType, string> = {
  uri: 'https://...',
  coupon: 'クーポンの LIFF URL または ID',
  research: 'リサーチの LIFF URL または ID',
  message: 'タップ時に送信されるテキスト',
}

function emptyCard(): CardItem {
  return { actions: [{ label: '詳しく見る', type: 'uri', data: '' }] }
}

function EditPageInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const id = sp.get('id')
  const { selectedAccountId, selectedAccount } = useAccount()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [cardType, setCardType] = useState<CardType>('product')
  const [cards, setCards] = useState<CardItem[]>([emptyCard()])
  /** -1 = もっと見るカード編集モード、それ以外 = カード index */
  const [activeIdx, setActiveIdx] = useState<number>(0)
  /** もっと見るカード設定。null なら無効。 */
  const [moreCard, setMoreCard] = useState<{
    label: string
    actionType: ActionType
    data: string
  } | null>(null)
  /** もっと見るカードのクーポン/リサーチピッカー表示 */
  const [showMoreCardPicker, setShowMoreCardPicker] = useState<'coupon' | 'research' | null>(null)
  const [showAiImageGen, setShowAiImageGen] = useState<number | null>(null)
  /** クーポンピッカー: { cardIdx, actionIdx } */
  const [showCouponPicker, setShowCouponPicker] = useState<{ cardIdx: number; actionIdx: number } | null>(null)
  /** リサーチピッカー: { cardIdx, actionIdx } */
  const [showResearchPicker, setShowResearchPicker] = useState<{ cardIdx: number; actionIdx: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetchApi<{
        success: boolean
        item?: {
          id: string
          name: string
          card_type: CardType
          cards: CardItem[]
          moreCard?: { label: string; actionType: ActionType; data: string } | null
        }
      }>(`/api/card-messages/${id}`)
      if (res.success && res.item) {
        setName(res.item.name)
        setCardType(res.item.card_type)
        setCards(res.item.cards.length > 0 ? res.item.cards : [emptyCard()])
        setMoreCard(res.item.moreCard ?? null)
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  const update = (idx: number, patch: Partial<CardItem>) => {
    setCards((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  }

  const updateAction = (idx: number, actionIdx: number, patch: Partial<CardAction>) => {
    setCards((prev) => prev.map((c, i) => {
      if (i !== idx) return c
      const actions = [...c.actions]
      actions[actionIdx] = { ...actions[actionIdx], ...patch }
      return { ...c, actions }
    }))
  }

  const addAction = (idx: number) => {
    setCards((prev) => prev.map((c, i) => (i === idx && c.actions.length < 2
      ? { ...c, actions: [...c.actions, { label: '', type: 'uri', data: '' }] }
      : c)))
  }

  const removeAction = (idx: number, actionIdx: number) => {
    setCards((prev) => prev.map((c, i) => (i === idx
      ? { ...c, actions: c.actions.filter((_, ai) => ai !== actionIdx) }
      : c)))
  }

  const addCard = () => {
    if (cards.length >= 12) { setError('カードは最大 12 枚まで'); return }
    setCards((prev) => [...prev, emptyCard()])
    setActiveIdx(cards.length)
  }

  const removeCard = (idx: number) => {
    if (cards.length <= 1) { setError('最低 1 枚は必要です'); return }
    setCards((prev) => prev.filter((_, i) => i !== idx))
    setActiveIdx(Math.max(0, idx - 1))
  }

  const handleSave = async () => {
    if (!selectedAccountId) return
    if (!name.trim()) { setError('アイテム名を入力してください'); return }
    setSaving(true)
    setError(null)
    try {
      const body = {
        name: name.trim(),
        cardType,
        cards,
        altText: name.trim(),
        moreCard: moreCard && moreCard.label.trim() ? moreCard : null,
      }
      if (id) {
        await fetchApi(`/api/card-messages/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setToast('保存しました')
      } else {
        await fetchApi(`/api/card-messages`, {
          method: 'POST',
          headers: { 'X-Line-Account-Id': selectedAccountId },
          body: JSON.stringify(body),
        })
        setToast('作成しました')
      }
      setTimeout(() => router.push('/card-messages'), 800)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失敗')
    }
    setSaving(false)
  }

  const active = activeIdx >= 0 ? cards[activeIdx] : cards[0]
  if (!active) return null

  return (
    <div>
      <Header
        title="カード型メッセージ"
        description="さまざまなコンテンツを 1 つにまとめて送信できるカードタイプのメッセージです。最大 12 枚、左右スワイプで表示します。"
      />

      <AccountBadge />

      {toast && <div className="fixed top-20 right-6 z-50 px-3 py-2 rounded bg-gray-900 text-white text-sm">{toast}</div>}

      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
        {/* アイテム名 */}
        <div className="flex items-start gap-4 mb-5">
          <label className="text-sm font-medium text-gray-700 pt-2 w-24 shrink-0">アイテム名</label>
          <div className="flex-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 春の新メニュー紹介"
              maxLength={100}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">プッシュ通知とチャットリストに表示されます。 {name.length}/100</p>
          </div>
        </div>

        {/* カードタイプ */}
        <div className="flex items-start gap-4 mb-2">
          <label className="text-sm font-medium text-gray-700 pt-2 w-24 shrink-0">カードタイプ</label>
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CARD_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setCardType(t.value)}
                className={`p-3 border rounded-lg text-left transition-colors ${
                  cardType === t.value
                    ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="text-xl mb-1">{t.emoji}</div>
                <div className="text-sm font-semibold text-slate-800">{t.label}</div>
                <div className="text-[10px] text-slate-500">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-sm">{error}</div>}

      {/* カード タブ */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-3 overflow-x-auto">
          {cards.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`px-3 py-1.5 text-xs font-medium rounded border whitespace-nowrap ${
                activeIdx === i
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (!moreCard) {
                setMoreCard({ label: 'もっと見る', actionType: 'uri', data: '' })
              }
              setActiveIdx(-1)
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded border whitespace-nowrap ${
              activeIdx === -1
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : moreCard
                  ? 'border-blue-300 text-blue-700 hover:bg-blue-50'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            もっと見る{moreCard ? ' ✓' : ''}
          </button>
          <button
            type="button"
            onClick={addCard}
            disabled={cards.length >= 12}
            className="px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-300 rounded hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
          >
            + カードを追加 ({cards.length}/12)
          </button>
          {activeIdx >= 0 && cards.length > 1 && (
            <button
              type="button"
              onClick={() => removeCard(activeIdx)}
              className="ml-auto px-3 py-1.5 text-xs text-rose-500 hover:text-rose-700"
            >
              このカードを削除
            </button>
          )}
          {activeIdx === -1 && moreCard && (
            <button
              type="button"
              onClick={() => {
                setMoreCard(null)
                setActiveIdx(0)
              }}
              className="ml-auto px-3 py-1.5 text-xs text-rose-500 hover:text-rose-700"
            >
              もっと見るを削除
            </button>
          )}
        </div>

        {/* もっと見るカード編集モード */}
        {activeIdx === -1 && moreCard ? (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
              💡 もっと見るカードは、カードタイプメッセージの最後に表示されます。
              コンテンツをもっと見たいユーザー向けにリンクを設定できます。
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">アクション ラベル</label>
                <input
                  type="text"
                  value={moreCard.label}
                  onChange={(e) => setMoreCard({ ...moreCard, label: e.target.value })}
                  placeholder="例: もっと見る"
                  maxLength={30}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <p className="text-[11px] text-gray-400 mt-1">{moreCard.label.length}/30</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">タイプ</label>
                <select
                  value={moreCard.actionType}
                  onChange={(e) => setMoreCard({ ...moreCard, actionType: e.target.value as ActionType, data: '' })}
                  className="border border-gray-300 rounded px-3 py-2 text-sm bg-white"
                >
                  {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {moreCard.actionType === 'coupon' || moreCard.actionType === 'research' ? (
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">
                    {moreCard.actionType === 'coupon' ? 'クーポン' : 'リサーチ'}
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowMoreCardPicker(moreCard.actionType as 'coupon' | 'research')}
                      className="text-xs px-3 py-1.5 border border-emerald-500 text-emerald-700 rounded hover:bg-emerald-50"
                    >
                      選択
                    </button>
                    <span className="text-xs text-gray-600 truncate flex-1">
                      {moreCard.data || '未選択'}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">
                    {moreCard.actionType === 'message' ? '送信テキスト' : 'URL'}
                  </label>
                  <input
                    type="text"
                    value={moreCard.data}
                    onChange={(e) => setMoreCard({ ...moreCard, data: e.target.value })}
                    placeholder={ACTION_PLACEHOLDER[moreCard.actionType]}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          {/* プレビュー */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">プレビュー</p>
            <CardPreview type={cardType} card={active} />
          </div>

          {/* 編集フォーム */}
          <div className="space-y-4">
            {/* 写真 */}
            <Field label="写真">
              <div className="flex gap-2 items-start">
                <button
                  type="button"
                  onClick={() => setShowAiImageGen(activeIdx)}
                  className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded"
                >
                  ✨ AI で画像生成
                </button>
                <ImageUploadButton
                  onUpload={async (file) => {
                    const url = await uploadGeneratedImageToR2(file)
                    update(activeIdx, { imageUrl: url })
                  }}
                />
              </div>
              {active.imageUrl && (
                <div className="mt-2 flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={active.imageUrl} alt="" className="w-16 h-16 rounded border border-gray-200 object-cover" />
                  <span className="text-[11px] text-gray-500 truncate flex-1">{active.imageUrl}</span>
                  <button type="button" onClick={() => update(activeIdx, { imageUrl: undefined })} className="text-[11px] text-rose-500">削除</button>
                </div>
              )}
            </Field>

            {/* タグ */}
            <Field label="タグ (任意)">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={active.tagLabel ?? ''}
                  onChange={(e) => update(activeIdx, { tagLabel: e.target.value })}
                  placeholder="タグを入力 (例: おすすめ, 新着)"
                  maxLength={12}
                  className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
                <span className="text-[11px] text-gray-400">{(active.tagLabel ?? '').length}/12</span>
              </div>
              {active.tagLabel && (
                <div className="flex gap-1.5 mt-2">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => update(activeIdx, { tagColor: c.value })}
                      className={`w-7 h-7 rounded-full border-2 transition-all flex items-center justify-center text-xs font-bold ${
                        (active.tagColor ?? 'default') === c.value ? 'border-emerald-500 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c.bg, color: c.fg }}
                      title={c.value}
                    >A</button>
                  ))}
                </div>
              )}
            </Field>

            {/* タイプ別フィールド */}
            {(cardType === 'product' || cardType === 'location' || cardType === 'person') && (
              <Field label={cardType === 'person' ? '名前' : 'タイトル'}>
                <input
                  type="text"
                  value={(cardType === 'person' ? active.personName : active.title) ?? ''}
                  onChange={(e) => update(activeIdx, cardType === 'person' ? { personName: e.target.value } : { title: e.target.value })}
                  placeholder="タイトルを入力"
                  maxLength={20}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </Field>
            )}

            {cardType === 'product' && (
              <>
                <Field label="説明文">
                  <textarea
                    value={active.description ?? ''}
                    onChange={(e) => update(activeIdx, { description: e.target.value })}
                    rows={2}
                    maxLength={60}
                    placeholder="説明文を入力"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-y"
                  />
                </Field>
                <Field label="価格">
                  <input
                    type="text"
                    value={active.price ?? ''}
                    onChange={(e) => update(activeIdx, { price: e.target.value })}
                    placeholder="¥1,200 など"
                    maxLength={15}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </Field>
              </>
            )}

            {cardType === 'location' && (
              <>
                <Field label="住所">
                  <textarea
                    value={active.address ?? ''}
                    onChange={(e) => update(activeIdx, { address: e.target.value })}
                    rows={2}
                    maxLength={60}
                    placeholder="例: 東京都渋谷区..."
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-y"
                  />
                </Field>
                <Field label="追加情報 (任意)">
                  <div className="flex gap-2">
                    <select
                      value={active.extraInfoType ?? 'time'}
                      onChange={(e) => update(activeIdx, { extraInfoType: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
                    >
                      <option value="time">時間</option>
                      <option value="phone">電話</option>
                      <option value="note">メモ</option>
                    </select>
                    <input
                      type="text"
                      value={active.extraInfo ?? ''}
                      onChange={(e) => update(activeIdx, { extraInfo: e.target.value })}
                      placeholder="営業時間など"
                      maxLength={30}
                      className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                </Field>
              </>
            )}

            {cardType === 'person' && (
              <>
                <Field label="説明文">
                  <textarea
                    value={active.description ?? ''}
                    onChange={(e) => update(activeIdx, { description: e.target.value })}
                    rows={2}
                    maxLength={60}
                    placeholder="一言紹介"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm resize-y"
                  />
                </Field>
                {/* 追加タグ 2-3 */}
                {[2, 3].map((n) => {
                  const labelKey = (n === 2 ? 'tagLabel2' : 'tagLabel3') as 'tagLabel2' | 'tagLabel3'
                  const colorKey = (n === 2 ? 'tagColor2' : 'tagColor3') as 'tagColor2' | 'tagColor3'
                  return (
                    <Field key={n} label={`タグ ${n} (任意)`}>
                      <input
                        type="text"
                        value={(active[labelKey] ?? '') as string}
                        onChange={(e) => update(activeIdx, { [labelKey]: e.target.value } as Partial<CardItem>)}
                        placeholder={`タグ${n}`}
                        maxLength={12}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                      />
                      {(active[labelKey] as string | undefined) && (
                        <div className="flex gap-1.5 mt-2">
                          {TAG_COLORS.map((c) => (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => update(activeIdx, { [colorKey]: c.value } as Partial<CardItem>)}
                              className={`w-7 h-7 rounded-full border-2 ${
                                (active[colorKey] ?? 'default') === c.value ? 'border-emerald-500 scale-110' : 'border-transparent'
                              }`}
                              style={{ backgroundColor: c.bg, color: c.fg }}
                            >A</button>
                          ))}
                        </div>
                      )}
                    </Field>
                  )
                })}
              </>
            )}

            {/* アクション */}
            <div>
              <p className="text-xs font-medium text-gray-700 mb-2">アクション (1〜2 個)</p>
              <div className="space-y-2">
                {active.actions.map((a, ai) => (
                  <div key={ai} className="border border-gray-200 rounded p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12 shrink-0">ラベル</span>
                      <input
                        type="text"
                        value={a.label}
                        onChange={(e) => updateAction(activeIdx, ai, { label: e.target.value })}
                        placeholder="アクションラベルを入力"
                        maxLength={15}
                        className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                      />
                      {active.actions.length > 1 && (
                        <button onClick={() => removeAction(activeIdx, ai)} className="text-xs text-rose-500 px-2">×</button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-12 shrink-0">タイプ</span>
                      <select
                        value={a.type}
                        onChange={(e) => {
                          // タイプを変えた時、data はクリア(URLとIDが混ざるのを防ぐ)
                          const newType = e.target.value as ActionType
                          updateAction(activeIdx, ai, { type: newType, data: '' })
                        }}
                        className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
                      >
                        {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      {a.type === 'coupon' || a.type === 'research' ? (
                        <div className="flex-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (a.type === 'coupon') {
                                setShowCouponPicker({ cardIdx: activeIdx, actionIdx: ai })
                              } else {
                                setShowResearchPicker({ cardIdx: activeIdx, actionIdx: ai })
                              }
                            }}
                            className="text-xs px-3 py-1.5 border border-emerald-500 text-emerald-700 rounded hover:bg-emerald-50"
                          >
                            選択
                          </button>
                          <span className="text-xs text-gray-600 truncate flex-1">
                            {a.data ? a.data : '未選択'}
                          </span>
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={a.data}
                          onChange={(e) => updateAction(activeIdx, ai, { data: e.target.value })}
                          placeholder={ACTION_PLACEHOLDER[a.type]}
                          className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {active.actions.length < 2 && (
                <button
                  type="button"
                  onClick={() => addAction(activeIdx)}
                  className="mt-2 text-xs text-emerald-600 hover:text-emerald-800"
                >
                  + アクションを追加
                </button>
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* 保存 */}
      <div className="flex gap-2 mt-5 justify-end">
        <button
          onClick={() => router.push('/card-messages')}
          className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          キャンセル
        </button>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="px-6 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#06C755' }}
        >
          {saving ? '保存中…' : id ? '更新' : '作成'}
        </button>
      </div>

      {/* AI 画像生成モーダル */}
      {showAiImageGen !== null && (
        <AiImageGenerateModal
          open={true}
          onClose={() => setShowAiImageGen(null)}
          size="square"
          purpose="card_message"
          menuName="カード画像"
          onSelect={async (file) => {
            const url = await uploadGeneratedImageToR2(file)
            if (showAiImageGen !== null) update(showAiImageGen, { imageUrl: url })
          }}
        />
      )}

      {/* クーポンピッカー */}
      {showCouponPicker && selectedAccountId && (
        <CouponPickerModal
          open={true}
          accountId={selectedAccountId}
          liffId={selectedAccount?.liffId ?? null}
          onClose={() => setShowCouponPicker(null)}
          onSelect={({ url, name }) => {
            const { cardIdx, actionIdx } = showCouponPicker
            // data に URL を入れる + label が空ならクーポン名を入れる
            setCards((prev) =>
              prev.map((c, ci) =>
                ci === cardIdx
                  ? {
                      ...c,
                      actions: c.actions.map((a, ai) =>
                        ai === actionIdx
                          ? { ...a, data: url, label: a.label || name.slice(0, 15) }
                          : a,
                      ),
                    }
                  : c,
              ),
            )
          }}
        />
      )}

      {/* リサーチピッカー */}
      {showResearchPicker && selectedAccountId && (
        <ResearchPickerModal
          open={true}
          accountId={selectedAccountId}
          liffId={selectedAccount?.liffId ?? null}
          onClose={() => setShowResearchPicker(null)}
          onSelect={({ url, name }) => {
            const { cardIdx, actionIdx } = showResearchPicker
            setCards((prev) =>
              prev.map((c, ci) =>
                ci === cardIdx
                  ? {
                      ...c,
                      actions: c.actions.map((a, ai) =>
                        ai === actionIdx
                          ? { ...a, data: url, label: a.label || name.slice(0, 15) }
                          : a,
                      ),
                    }
                  : c,
              ),
            )
          }}
        />
      )}

      {/* もっと見るカード用のピッカー */}
      {showMoreCardPicker === 'coupon' && selectedAccountId && moreCard && (
        <CouponPickerModal
          open={true}
          accountId={selectedAccountId}
          liffId={selectedAccount?.liffId ?? null}
          onClose={() => setShowMoreCardPicker(null)}
          onSelect={({ url, name }) => {
            setMoreCard({ ...moreCard, data: url, label: moreCard.label || name.slice(0, 30) })
          }}
        />
      )}
      {showMoreCardPicker === 'research' && selectedAccountId && moreCard && (
        <ResearchPickerModal
          open={true}
          accountId={selectedAccountId}
          liffId={selectedAccount?.liffId ?? null}
          onClose={() => setShowMoreCardPicker(null)}
          onSelect={({ url, name }) => {
            setMoreCard({ ...moreCard, data: url, label: moreCard.label || name.slice(0, 30) })
          }}
        />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <label className="text-xs font-medium text-gray-700 pt-1.5 w-20 shrink-0">{label}</label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function ImageUploadButton({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const [uploading, setUploading] = useState(false)
  return (
    <label className={`text-xs px-3 py-1.5 border border-gray-300 rounded cursor-pointer hover:bg-gray-50 ${uploading ? 'opacity-50' : ''}`}>
      {uploading ? '⏳ アップロード中…' : '📁 写真をアップロード'}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading}
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          setUploading(true)
          try { await onUpload(f) } catch { /* silent */ }
          setUploading(false)
          e.target.value = ''
        }}
      />
    </label>
  )
}

function CardPreview({ type, card }: { type: CardType; card: CardItem }) {
  const tagBg = TAG_COLORS.find((c) => c.value === (card.tagColor ?? 'default'))?.bg ?? '#6B7280'
  const tagFg = TAG_COLORS.find((c) => c.value === (card.tagColor ?? 'default'))?.fg ?? '#FFFFFF'

  return (
    <div className="w-[260px] bg-white border border-gray-300 rounded-xl overflow-hidden shadow-sm">
      <div className="aspect-square bg-slate-200 relative flex items-center justify-center text-slate-400 text-4xl">
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span>A</span>
        )}
        {card.tagLabel && (
          <span
            className="absolute top-3 left-3 px-2 py-0.5 text-[10px] font-bold rounded"
            style={{ backgroundColor: tagBg, color: tagFg }}
          >{card.tagLabel}</span>
        )}
      </div>
      <div className="p-3">
        {type === 'person' ? (
          <>
            <div className="font-bold text-sm text-center">{card.personName || '名前を入力'}</div>
            {card.description && <div className="text-[11px] text-gray-500 mt-1 text-center">{card.description}</div>}
          </>
        ) : (
          <>
            <div className="font-bold text-sm">{card.title || 'タイトルを入力'}</div>
            {type === 'product' && card.description && <div className="text-[11px] text-gray-500 mt-1">{card.description}</div>}
            {type === 'product' && card.price && <div className="text-base font-bold text-right mt-1">{card.price}</div>}
            {type === 'location' && card.address && <div className="text-[11px] text-gray-500 mt-1">📍 {card.address}</div>}
            {type === 'location' && card.extraInfo && <div className="text-[11px] text-gray-500 mt-0.5">🕐 {card.extraInfo}</div>}
          </>
        )}
        {card.actions.map((a, i) => (
          <div key={i} className="text-blue-600 text-xs mt-2 truncate text-center">
            {a.label || 'アクションラベルを入力'}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function CardMessageEditPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">読み込み中…</div>}>
      <EditPageInner />
    </Suspense>
  )
}

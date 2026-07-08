'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { AccountBadge } from '@/components/account-badge'
import { uploadGeneratedImageToR2 } from '@/lib/upload-image'
import { AiImageGenerateModal } from '@/components/rich-menus/ai-image-generate-modal'

type DiscountMode = 'yen' | 'percent' | 'strikethrough' | 'none'
type CouponStatus = 'draft' | 'published' | 'archived'
type AcquisitionCondition = 'none' | 'lottery' | 'friend_add' | 'tag_added' | 'event_book'
type CouponType = 'discount' | 'free' | 'present' | 'cashback' | 'other'

type TemplateId = 'simple' | 'bold' | 'elegant' | 'pop' | 'premium' | 'urgent'

interface CouponForm {
  name: string
  acquisitionCondition: AcquisitionCondition
  validFromDate: string
  validFromTime: string
  validToDate: string
  validToTime: string
  timezone: string
  imageUrl: string | null
  usageGuide: string
  maxUsesPerFriend: 1 | 0  // 1=1回のみ, 0=無制限
  showCode: boolean
  codeValue: string
  couponType: CouponType
  discountMode: DiscountMode
  discountYen: string
  discountPercent: string
  strikethroughBefore: string
  strikethroughAfter: string
  conditionText: string
  status: CouponStatus
  // 抽選条件
  lotteryProbability: number | null
  lotteryMaxWinners: number | null
  // デザイン拡張
  subtitle: string
  templateId: TemplateId
  brandColor: string
  accentColor: string
  buttonLabel: string
  storeHours: string
  storePhone: string
  storeAddress: string
  storeMapUrl: string
  showRemainingDays: boolean
  showLotteryRemaining: boolean
  backgroundPattern: 'none' | 'stripe' | 'dot' | 'gradient'
  imagePosition: 'hero' | 'inline'
}

const TEMPLATE_OPTIONS: Array<{ id: TemplateId; label: string; desc: string; emoji: string }> = [
  { id: 'simple', label: 'シンプル', desc: '白基調・万能', emoji: '⬜' },
  { id: 'bold', label: '大胆ディスカウント', desc: '割引額を巨大に', emoji: '💥' },
  { id: 'elegant', label: 'エレガント', desc: '上品・サロン向け', emoji: '🎩' },
  { id: 'pop', label: 'ポップ', desc: 'カラフル・カフェ向け', emoji: '🎨' },
  { id: 'premium', label: 'プレミアム', desc: '黒×金・高単価向け', emoji: '👑' },
  { id: 'urgent', label: '限定強調', desc: '赤強め・セール向け', emoji: '🔥' },
]

const COLOR_PRESETS: Array<{ name: string; hex: string }> = [
  { name: 'LINE グリーン', hex: '#06C755' },
  { name: 'ローズピンク', hex: '#ec4899' },
  { name: 'スカイブルー', hex: '#0ea5e9' },
  { name: 'パープル', hex: '#8b5cf6' },
  { name: 'オレンジ', hex: '#f97316' },
  { name: 'ブラック', hex: '#0f172a' },
  { name: 'ゴールド', hex: '#d97706' },
  { name: 'レッド', hex: '#dc2626' },
]

const DEFAULT_GUIDE = `- クーポンを使用するには、この画面をスタッフに提示してください。
- 使用済みのクーポンはご利用になれません。また、お客さまの操作で誤って「使用済み」にしてしまった場合も利用できなくなります。
- 本クーポンは有効期間に関わらず、予告なく変更されたり、終了したりする場合があります。`

function todayJst(): string {
  const d = new Date()
  const offset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - offset).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function emptyForm(): CouponForm {
  const today = todayJst()
  return {
    name: '',
    acquisitionCondition: 'none',
    validFromDate: today,
    validFromTime: '00:00',
    validToDate: addDays(today, 7),
    validToTime: '23:59',
    timezone: 'Asia/Tokyo',
    imageUrl: null,
    usageGuide: DEFAULT_GUIDE,
    maxUsesPerFriend: 1,
    showCode: false,
    codeValue: '',
    couponType: 'discount',
    discountMode: 'yen',
    discountYen: '',
    discountPercent: '',
    strikethroughBefore: '',
    strikethroughAfter: '',
    conditionText: '',
    status: 'draft',
    lotteryProbability: 10,
    lotteryMaxWinners: null,
    subtitle: '',
    templateId: 'simple',
    brandColor: '#06C755',
    accentColor: '',
    buttonLabel: 'クーポンを見る',
    storeHours: '',
    storePhone: '',
    storeAddress: '',
    storeMapUrl: '',
    showRemainingDays: true,
    showLotteryRemaining: false,
    backgroundPattern: 'none',
    imagePosition: 'hero',
  }
}

function CouponEditInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const id = sp.get('id')
  const { selectedAccountId } = useAccount()
  const [form, setForm] = useState<CouponForm>(emptyForm())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showAiImageGen, setShowAiImageGen] = useState(false)
  const [uploading, setUploading] = useState(false)

  const set = <K extends keyof CouponForm>(k: K, v: CouponForm[K]) => setForm((p) => ({ ...p, [k]: v }))

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; item?: Record<string, unknown> }>(`/api/coupons/${id}`)
      if (res.success && res.item) {
        const c = res.item as Record<string, unknown> & {
          name: string
          acquisition_condition: AcquisitionCondition
          valid_from: string
          valid_to: string
          timezone: string
          image_url: string | null
          usage_guide: string | null
          max_uses_per_friend: number
          show_code: number
          code_value: string | null
          coupon_type: string | null
          discount_mode: DiscountMode | null
          discount_yen: number | null
          discount_percent: number | null
          strikethrough_before: number | null
          strikethrough_after: number | null
          condition_text: string | null
          status: CouponStatus
          lottery_probability: number | null
          lottery_max_winners: number | null
        }
        const from = new Date(c.valid_from)
        const to = new Date(c.valid_to)
        const storeInfo = c.store_info_json
          ? (() => { try { return JSON.parse(c.store_info_json as string) as { hours?: string; phone?: string; address?: string; map_url?: string } } catch { return {} } })()
          : {} as { hours?: string; phone?: string; address?: string; map_url?: string }
        setForm({
          name: c.name,
          acquisitionCondition: c.acquisition_condition,
          validFromDate: from.toISOString().slice(0, 10),
          validFromTime: from.toISOString().slice(11, 16),
          validToDate: to.toISOString().slice(0, 10),
          validToTime: to.toISOString().slice(11, 16),
          timezone: c.timezone,
          imageUrl: c.image_url,
          usageGuide: c.usage_guide ?? DEFAULT_GUIDE,
          maxUsesPerFriend: c.max_uses_per_friend === 0 ? 0 : 1,
          showCode: c.show_code === 1,
          codeValue: c.code_value ?? '',
          couponType: ((c.coupon_type ?? 'discount') as CouponType),
          discountMode: (c.discount_mode ?? 'yen') as DiscountMode,
          discountYen: c.discount_yen != null ? String(c.discount_yen) : '',
          discountPercent: c.discount_percent != null ? String(c.discount_percent) : '',
          strikethroughBefore: c.strikethrough_before != null ? String(c.strikethrough_before) : '',
          strikethroughAfter: c.strikethrough_after != null ? String(c.strikethrough_after) : '',
          conditionText: c.condition_text ?? '',
          status: c.status,
          lotteryProbability: c.lottery_probability ?? 10,
          lotteryMaxWinners: c.lottery_max_winners ?? null,
          subtitle: (c.subtitle as string | null) ?? '',
          templateId: ((c.template_id as TemplateId | null) ?? 'simple'),
          brandColor: (c.brand_color as string | null) ?? '#06C755',
          accentColor: (c.accent_color as string | null) ?? '',
          buttonLabel: (c.button_label as string | null) ?? 'クーポンを見る',
          storeHours: storeInfo.hours ?? '',
          storePhone: storeInfo.phone ?? '',
          storeAddress: storeInfo.address ?? '',
          storeMapUrl: storeInfo.map_url ?? '',
          showRemainingDays: ((c.show_remaining_days as number | null) ?? 1) === 1,
          showLotteryRemaining: ((c.show_lottery_remaining as number | null) ?? 0) === 1,
          backgroundPattern: ((c.background_pattern as 'none' | 'stripe' | 'dot' | 'gradient' | null) ?? 'none'),
          imagePosition: ((c.image_position as 'hero' | 'inline' | null) ?? 'hero'),
        })
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  const handleImageFile = async (file: File | null) => {
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadGeneratedImageToR2(file)
      set('imageUrl', url)
    } catch (e) { setError(e instanceof Error ? e.message : 'アップロード失敗') }
    setUploading(false)
  }

  const handleSave = async (overrideStatus?: CouponStatus) => {
    if (!selectedAccountId) return
    if (!form.name.trim()) { setError('クーポン名は必須です'); return }
    if (!form.validFromDate || !form.validToDate) { setError('有効期間を入力してください'); return }
    setSaving(true)
    setError(null)
    try {
      const validFrom = `${form.validFromDate}T${form.validFromTime}:00+09:00`
      const validTo = `${form.validToDate}T${form.validToTime}:59+09:00`
      const body = {
        name: form.name.trim(),
        acquisitionCondition: form.acquisitionCondition,
        validFrom,
        validTo,
        timezone: form.timezone,
        imageUrl: form.imageUrl,
        usageGuide: form.usageGuide.trim() || null,
        maxUsesPerFriend: form.maxUsesPerFriend,
        showCode: form.showCode,
        codeValue: form.showCode ? form.codeValue : null,
        couponType: form.couponType,
        discountMode: form.discountMode,
        discountYen: form.discountMode === 'yen' && form.discountYen ? Number(form.discountYen) : null,
        discountPercent: form.discountMode === 'percent' && form.discountPercent ? Number(form.discountPercent) : null,
        strikethroughBefore: form.discountMode === 'strikethrough' && form.strikethroughBefore ? Number(form.strikethroughBefore) : null,
        strikethroughAfter: form.discountMode === 'strikethrough' && form.strikethroughAfter ? Number(form.strikethroughAfter) : null,
        conditionText: form.conditionText.trim() || null,
        status: overrideStatus ?? form.status,
        // 抽選条件(獲得条件が lottery の時のみ送る)
        lotteryProbability:
          form.acquisitionCondition === 'lottery' ? form.lotteryProbability ?? 10 : null,
        lotteryMaxWinners:
          form.acquisitionCondition === 'lottery' ? form.lotteryMaxWinners : null,
        // デザイン拡張
        subtitle: form.subtitle.trim() || null,
        templateId: form.templateId,
        brandColor: form.brandColor || null,
        accentColor: form.accentColor || null,
        buttonLabel: form.buttonLabel.trim() || null,
        storeInfoJson: (() => {
          const info = {
            ...(form.storeHours ? { hours: form.storeHours } : {}),
            ...(form.storePhone ? { phone: form.storePhone } : {}),
            ...(form.storeAddress ? { address: form.storeAddress } : {}),
            ...(form.storeMapUrl ? { map_url: form.storeMapUrl } : {}),
          }
          return Object.keys(info).length > 0 ? JSON.stringify(info) : null
        })(),
        showRemainingDays: form.showRemainingDays,
        showLotteryRemaining: form.showLotteryRemaining,
        backgroundPattern: form.backgroundPattern,
        imagePosition: form.imagePosition,
      }
      if (id) {
        await fetchApi(`/api/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
        setToast('保存しました')
      } else {
        await fetchApi(`/api/coupons`, {
          method: 'POST',
          headers: { 'X-Line-Account-Id': selectedAccountId },
          body: JSON.stringify(body),
        })
        setToast(overrideStatus === 'published' ? '公開しました' : '下書き保存しました')
      }
      setTimeout(() => router.push('/coupons'), 800)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失敗')
    }
    setSaving(false)
  }

  const offerPreview = (() => {
    if (form.discountMode === 'yen' && form.discountYen) return `¥${Number(form.discountYen).toLocaleString('ja-JP')} OFF`
    if (form.discountMode === 'percent' && form.discountPercent) return `${form.discountPercent}% OFF`
    if (form.discountMode === 'strikethrough' && form.strikethroughBefore && form.strikethroughAfter) {
      return `¥${Number(form.strikethroughBefore).toLocaleString('ja-JP')} → ¥${Number(form.strikethroughAfter).toLocaleString('ja-JP')}`
    }
    return 'お得なクーポン'
  })()

  return (
    <div>
      <Header
        title="クーポン"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => handleSave('draft')}
              disabled={saving || loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              下書き保存
            </button>
            <button
              onClick={() => handleSave('published')}
              disabled={saving || loading}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        }
      />

      <AccountBadge />

      {toast && <div className="fixed top-20 right-6 z-50 px-3 py-2 rounded bg-gray-900 text-white text-sm">{toast}</div>}
      {error && <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-sm">{error}</div>}

      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">基本設定</h2>
        <Field label="獲得条件" required>
          <select
            value={form.acquisitionCondition}
            onChange={(e) => set('acquisitionCondition', e.target.value as AcquisitionCondition)}
            className="border border-gray-300 rounded px-3 py-2 text-sm bg-white"
          >
            <option value="none">条件なし(すべてのユーザーが獲得)</option>
            <option value="lottery">抽選(当選したユーザーのみ)</option>
            <option value="friend_add">友だち追加時</option>
            <option value="tag_added">タグ付与時</option>
            <option value="event_book">イベント予約時</option>
          </select>
          {form.acquisitionCondition === 'lottery' && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-24">当選確率</span>
                <select
                  value={form.lotteryProbability ?? 10}
                  onChange={(e) => set('lotteryProbability', Number(e.target.value))}
                  className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
                >
                  {[1, 5, 10, 25, 50, 75, 100].map((p) => (
                    <option key={p} value={p}>
                      {p}%
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-24">当選者数の上限</span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    checked={form.lotteryMaxWinners == null}
                    onChange={() => set('lotteryMaxWinners', null)}
                  />
                  上限なし
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    checked={form.lotteryMaxWinners != null}
                    onChange={() => set('lotteryMaxWinners', 100)}
                  />
                  上限あり
                </label>
                {form.lotteryMaxWinners != null && (
                  <>
                    <input
                      type="number"
                      min={1}
                      value={form.lotteryMaxWinners}
                      onChange={(e) => set('lotteryMaxWinners', Number(e.target.value) || 1)}
                      className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-gray-500">人</span>
                  </>
                )}
              </div>
            </div>
          )}
        </Field>
        <Field label="クーポン名" required>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="例: LINE友だち限定クーポン"
            maxLength={60}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-gray-400 mt-1">{form.name.length}/60 · 氏名などの個人情報を入力しないでください。</p>
        </Field>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">クーポン設定</h2>

        {/* 有効期間 */}
        <Field label="有効期間">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500 w-16">開始日時</span>
              <input
                type="date"
                value={form.validFromDate}
                onChange={(e) => set('validFromDate', e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
              <input
                type="time"
                value={form.validFromTime}
                onChange={(e) => set('validFromTime', e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500 w-16">終了日時</span>
              <input
                type="date"
                value={form.validToDate}
                onChange={(e) => set('validToDate', e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
              <input
                type="time"
                value={form.validToTime}
                onChange={(e) => set('validToTime', e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-16">タイムゾーン</span>
              <select
                value={form.timezone}
                onChange={(e) => set('timezone', e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
              >
                <option value="Asia/Tokyo">(UTC+09:00) Asia/Tokyo, Seoul</option>
              </select>
            </div>
          </div>
        </Field>

        {/* 写真 */}
        <Field label="写真">
          <div className="flex items-start gap-3">
            <div className="w-40 aspect-[4/3] border-2 border-dashed border-gray-300 rounded flex items-center justify-center bg-gray-50 overflow-hidden">
              {form.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-gray-400">画像なし</span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <label className="inline-block">
                <span className="inline-block text-xs px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded cursor-pointer hover:bg-emerald-100">
                  {uploading ? '⏳ アップロード中…' : '📁 画像をアップロード'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/jpg"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => { handleImageFile(e.target.files?.[0] ?? null); e.target.value = '' }}
                />
              </label>
              <button
                type="button"
                onClick={() => setShowAiImageGen(true)}
                className="block text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded"
              >
                ✨ AI で画像生成
              </button>
              {form.imageUrl && (
                <button
                  type="button"
                  onClick={() => set('imageUrl', null)}
                  className="block text-xs text-rose-500 hover:text-rose-700"
                >
                  画像を削除
                </button>
              )}
              <p className="text-[11px] text-gray-400 leading-relaxed">
                10MB 以下の画像 (JPG / JPEG / PNG)。有効期限切れ・使用済みの画面では写真は表示されません。
              </p>
            </div>
          </div>
        </Field>

        {/* 利用ガイド */}
        <Field label="利用ガイド">
          <textarea
            value={form.usageGuide}
            onChange={(e) => set('usageGuide', e.target.value)}
            rows={6}
            maxLength={500}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono"
          />
          <p className="text-[11px] text-gray-400 mt-1">{form.usageGuide.length}/500</p>
        </Field>

        {/* ── デザイン設定 ── */}
        <div className="border-t border-gray-200 pt-6 mt-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">🎨 デザイン設定</h2>

          <Field label="サブタイトル / キャッチコピー (任意)">
            <input
              type="text"
              value={form.subtitle}
              onChange={(e) => set('subtitle', e.target.value)}
              maxLength={40}
              placeholder="例: 今月限定 / 新規様限定"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-gray-400 mt-1">{form.subtitle.length}/40</p>
          </Field>

          <Field label="デザインテンプレート">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TEMPLATE_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => set('templateId', t.id)}
                  className={`text-left p-3 rounded border transition-colors ${
                    form.templateId === t.id
                      ? 'border-emerald-500 bg-emerald-50'
                      : 'border-gray-200 hover:border-gray-400 bg-white'
                  }`}
                >
                  <div className="text-xl mb-1">{t.emoji}</div>
                  <div className="text-xs font-semibold text-gray-900">{t.label}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </Field>

          <Field label="テーマカラー">
            <div className="flex flex-wrap gap-2 mb-2">
              {COLOR_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  onClick={() => set('brandColor', p.hex)}
                  title={p.name}
                  className={`w-8 h-8 rounded-full border-2 transition-transform ${form.brandColor === p.hex ? 'border-gray-900 scale-110' : 'border-white shadow'}`}
                  style={{ backgroundColor: p.hex }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.brandColor}
                onChange={(e) => set('brandColor', e.target.value)}
                className="w-12 h-8 border border-gray-300 rounded"
              />
              <input
                type="text"
                value={form.brandColor}
                onChange={(e) => set('brandColor', e.target.value)}
                placeholder="#06C755"
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">ボタン・装飾の基調色になります</p>
          </Field>

          <Field label="アクセント色 (任意)">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.accentColor || form.brandColor}
                onChange={(e) => set('accentColor', e.target.value)}
                className="w-12 h-8 border border-gray-300 rounded"
              />
              <input
                type="text"
                value={form.accentColor}
                onChange={(e) => set('accentColor', e.target.value)}
                placeholder="未設定ならテーマカラーを使用"
                className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm font-mono"
              />
              {form.accentColor && (
                <button
                  type="button"
                  onClick={() => set('accentColor', '')}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  クリア
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">割引額の色に使われます</p>
          </Field>

          <Field label="主ボタンの文言">
            <input
              type="text"
              value={form.buttonLabel}
              onChange={(e) => set('buttonLabel', e.target.value)}
              maxLength={30}
              placeholder="例: クーポンを見る / 予約する / 詳細を見る"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-gray-400 mt-1">Flex メッセージとクーポン詳細画面の主ボタン</p>
          </Field>

          <Field label="画像の表示位置">
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={form.imagePosition === 'hero'}
                  onChange={() => set('imagePosition', 'hero')}
                  className="accent-emerald-600"
                />
                <span>上部 (ヘッダー)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={form.imagePosition === 'inline'}
                  onChange={() => set('imagePosition', 'inline')}
                  className="accent-emerald-600"
                />
                <span>中央 (本文中)</span>
              </label>
            </div>
          </Field>

          <Field label="動的表示">
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.showRemainingDays}
                  onChange={(e) => set('showRemainingDays', e.target.checked)}
                  className="accent-emerald-600"
                />
                <span>「あと N 日」を自動表示 (3 日以下は赤く強調)</span>
              </label>
              {form.acquisitionCondition === 'lottery' && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.showLotteryRemaining}
                    onChange={(e) => set('showLotteryRemaining', e.target.checked)}
                    className="accent-emerald-600"
                  />
                  <span>抽選残枠「残り N 名様」を表示</span>
                </label>
              )}
            </div>
          </Field>

          <Field label="店舗情報 (任意)">
            <details className="border border-gray-200 rounded p-3">
              <summary className="text-xs text-gray-700 cursor-pointer">展開して入力</summary>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <div>
                  <label className="text-[11px] text-gray-500">営業時間</label>
                  <input
                    type="text"
                    value={form.storeHours}
                    onChange={(e) => set('storeHours', e.target.value)}
                    placeholder="例: 10:00-19:00 (火曜定休)"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500">電話番号</label>
                  <input
                    type="text"
                    value={form.storePhone}
                    onChange={(e) => set('storePhone', e.target.value)}
                    placeholder="例: 03-1234-5678"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500">住所</label>
                  <input
                    type="text"
                    value={form.storeAddress}
                    onChange={(e) => set('storeAddress', e.target.value)}
                    placeholder="例: 東京都新宿区..."
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500">地図 URL</label>
                  <input
                    type="text"
                    value={form.storeMapUrl}
                    onChange={(e) => set('storeMapUrl', e.target.value)}
                    placeholder="https://maps.google.com/..."
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">クーポン詳細画面に「店舗情報」セクションが折りたたみ表示されます</p>
            </details>
          </Field>
        </div>

        {/* 使用可能回数 */}
        <Field label="使用可能回数">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.maxUsesPerFriend === 1}
                onChange={() => set('maxUsesPerFriend', 1)}
                className="accent-emerald-600"
              />
              <span>1 回のみ</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.maxUsesPerFriend === 0}
                onChange={() => set('maxUsesPerFriend', 0)}
                className="accent-emerald-600"
              />
              <span>上限なし</span>
            </label>
          </div>
        </Field>

        {/* クーポンコード */}
        <Field label="クーポンコード">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={!form.showCode}
                onChange={() => set('showCode', false)}
                className="accent-emerald-600"
              />
              <span>表示しない</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.showCode}
                onChange={() => set('showCode', true)}
                className="accent-emerald-600"
              />
              <span>表示する</span>
            </label>
            {form.showCode && (
              <input
                type="text"
                value={form.codeValue}
                onChange={(e) => set('codeValue', e.target.value)}
                placeholder="例: SPRING2026"
                maxLength={20}
                className="border border-gray-300 rounded px-3 py-2 text-sm w-64"
              />
            )}
          </div>
        </Field>

        {/* クーポンタイプ */}
        <Field label="クーポンタイプ">
          <select
            value={form.couponType}
            onChange={(e) => set('couponType', e.target.value as CouponType)}
            className="border border-gray-300 rounded px-3 py-2 text-sm bg-white mb-3"
          >
            <option value="discount">割引</option>
            <option value="free">無料</option>
            <option value="present">プレゼント</option>
            <option value="cashback">キャッシュバック</option>
            <option value="other">その他</option>
          </select>
          {form.couponType !== 'discount' && (
            <p className="text-[11px] text-gray-500 mb-2">
              「{
                form.couponType === 'free' ? '無料'
                : form.couponType === 'present' ? 'プレゼント'
                : form.couponType === 'cashback' ? 'キャッシュバック'
                : 'その他'
              }」タイプでは、下の割引設定は使用されません。
            </p>
          )}
          <div className={`space-y-2 ${form.couponType !== 'discount' ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={form.discountMode === 'yen'}
                  onChange={() => set('discountMode', 'yen')}
                  className="accent-emerald-600"
                />
                <span>円引き</span>
              </label>
              <input
                type="number"
                value={form.discountYen}
                onChange={(e) => set('discountYen', e.target.value)}
                placeholder="100"
                disabled={form.discountMode !== 'yen'}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24 disabled:bg-gray-100"
              />
              <span className="text-sm text-gray-500">円</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={form.discountMode === 'percent'}
                  onChange={() => set('discountMode', 'percent')}
                  className="accent-emerald-600"
                />
                <span>%引き</span>
              </label>
              <input
                type="number"
                value={form.discountPercent}
                onChange={(e) => set('discountPercent', e.target.value)}
                placeholder="10"
                disabled={form.discountMode !== 'percent'}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-20 disabled:bg-gray-100"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm mb-1">
                <input
                  type="radio"
                  checked={form.discountMode === 'strikethrough'}
                  onChange={() => set('discountMode', 'strikethrough')}
                  className="accent-emerald-600"
                />
                <span>打ち消し線</span>
              </label>
              {form.discountMode === 'strikethrough' && (
                <div className="ml-6 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-14">割引前</span>
                    <input
                      type="number"
                      value={form.strikethroughBefore}
                      onChange={(e) => set('strikethroughBefore', e.target.value)}
                      placeholder="1,200"
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-28"
                    />
                    <span className="text-sm text-gray-500">円</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-14">割引後</span>
                    <input
                      type="number"
                      value={form.strikethroughAfter}
                      onChange={(e) => set('strikethroughAfter', e.target.value)}
                      placeholder="1,000"
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm w-28"
                    />
                    <span className="text-sm text-gray-500">円</span>
                  </div>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={form.discountMode === 'none'}
                onChange={() => set('discountMode', 'none')}
                className="accent-emerald-600"
              />
              <span>設定なし</span>
            </label>
          </div>
        </Field>

        {/* 利用条件 */}
        <Field label="利用条件">
          <input
            type="text"
            value={form.conditionText}
            onChange={(e) => set('conditionText', e.target.value)}
            placeholder="例: 1,000円以上のお支払いで利用可能"
            maxLength={30}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-gray-400 mt-1">{form.conditionText.length}/30</p>
        </Field>
      </div>

      {/* プレビュー */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5 mb-4">
        <h3 className="text-sm font-semibold text-emerald-800 mb-3">プレビュー</h3>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-sm">
          {form.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.imageUrl} alt="" className="w-full aspect-[20/13] object-cover" />
          ) : (
            <div className="w-full aspect-[20/13] bg-emerald-100 flex items-center justify-center text-emerald-300 text-4xl">🎟️</div>
          )}
          <div className="p-4">
            <p className="text-[10px] text-emerald-600 font-bold mb-1">🎟️ クーポン</p>
            <p className="font-bold text-base text-gray-900 mb-1">{form.name || '(クーポン名)'}</p>
            <p className="text-xl font-bold text-emerald-700 mb-2">{offerPreview}</p>
            {form.conditionText && <p className="text-xs text-gray-500 mb-1">{form.conditionText}</p>}
            <p className="text-[11px] text-gray-400">有効期限 〜 {form.validToDate}</p>
            <button className="mt-3 w-full py-2 bg-emerald-600 text-white text-sm font-medium rounded">クーポンを使う</button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-center mb-8">
        <button
          onClick={() => handleSave('draft')}
          disabled={saving || loading}
          className="px-5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          下書き保存
        </button>
        <button
          onClick={() => handleSave('published')}
          disabled={saving || loading}
          className="px-6 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
          style={{ backgroundColor: '#06C755' }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {showAiImageGen && (
        <AiImageGenerateModal
          open={true}
          onClose={() => setShowAiImageGen(false)}
          size="landscape"
          purpose="coupon"
          availableSizes={['landscape', 'square', 'banner_wide']}
          menuName={form.name || 'クーポン画像'}
          onSelect={async (file) => {
            const url = await uploadGeneratedImageToR2(file)
            set('imageUrl', url)
          }}
        />
      )}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 mb-5">
      <label className="text-sm font-medium text-gray-700 pt-1.5 w-24 shrink-0">
        {label}
        {required && <span className="text-emerald-500 ml-1">●</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export default function CouponEditPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">読み込み中…</div>}>
      <CouponEditInner />
    </Suspense>
  )
}

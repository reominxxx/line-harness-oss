'use client'

import { useEffect, useState, Suspense } from 'react'

/**
 * 顧客向けクーポン表示ページ (公開、認証不要)
 *
 * URL: /c?id=xxx&friend_id=yyy
 *
 * - LIFF or LINE トーク内ブラウザで開かれる想定
 * - friend_id クエリで使用済み判定 (なければ閲覧のみ)
 * - 「クーポンを使う」ボタン → 使用済み画面に切替
 *
 * 注: Next.js static export では dynamic routes (/c/[id]) が使えないので、
 *     クエリパラメータ方式で実装。配信時の URL は /c?id=... の形式で発行する。
 */

type DiscountMode = 'yen' | 'percent' | 'strikethrough' | 'none'

// 注: API レスポンスは snake_case で返ってくる (apps/worker/src/routes/coupons.ts の
// /api/coupons/public/:id を参照) ため、ここも snake_case で受ける。
// LIFF 側 (client/coupon.ts) も同じ shape を使っているので合わせる。
interface Coupon {
  id: string
  name: string
  image_url: string | null
  usage_guide: string | null
  valid_from: string
  valid_to: string
  discount_mode: DiscountMode | null
  offerText: string
  condition_text: string | null
  show_code: boolean | number
  code_value: string | null
  max_uses_per_friend: number
}

interface CouponState {
  active: boolean
  expired: boolean
  notStarted: boolean
  usedUp: boolean
  redemptionsByFriend: number
}

function PublicCouponInner() {
  const [id, setId] = useState<string | null>(null)
  const [friendId, setFriendId] = useState<string | null>(null)
  const [coupon, setCoupon] = useState<Coupon | null>(null)
  const [state, setState] = useState<CouponState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [justUsed, setJustUsed] = useState(false)

  useEffect(() => {
    const url = new URL(window.location.href)
    const cid = url.searchParams.get('id')
    const fid = url.searchParams.get('friend_id')
    setId(cid)
    setFriendId(fid)
    if (!cid) { setError('URL が不正です (id パラメータが必要)'); setLoading(false); return }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
    fetch(`${apiUrl}/api/coupons/public/${cid}${fid ? `?friend_id=${encodeURIComponent(fid)}` : ''}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) { setError(j.error ?? '取得失敗'); return }
        setCoupon(j.coupon)
        setState(j.state)
      })
      .catch((e) => setError(e instanceof Error ? e.message : '取得失敗'))
      .finally(() => setLoading(false))
  }, [])

  const redeem = async () => {
    if (!id) return
    if (!friendId) { setError('利用するにはお店から発行された URL を LINE 経由で開いてください'); return }
    if (!confirm('このクーポンを使用済みにします。スタッフに画面を見せてから押してください。\n\nよろしいですか?')) return
    setRedeeming(true)
    setError(null)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const res = await fetch(`${apiUrl}/api/coupons/public/${id}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId }),
      })
      const j = await res.json()
      if (!j.success) { setError(j.error ?? '使用失敗'); return }
      setJustUsed(true)
      setState((prev) => prev ? { ...prev, usedUp: true, redemptionsByFriend: prev.redemptionsByFriend + 1 } : prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : '使用失敗')
    }
    setRedeeming(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-sm text-gray-400">読み込み中…</p>
      </div>
    )
  }

  if (!coupon) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-4xl mb-3">😢</p>
          <p className="text-sm text-gray-600">{error ?? 'クーポンが見つかりません'}</p>
        </div>
      </div>
    )
  }

  const usedUp = state?.usedUp || justUsed
  const inactive = state && !state.active

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-md overflow-hidden">
        <div className={`relative ${usedUp || inactive ? 'opacity-40' : ''}`}>
          {coupon.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coupon.image_url} alt="" className="w-full aspect-[20/13] object-cover bg-gray-100" />
          ) : (
            <div className="w-full aspect-[20/13] bg-emerald-50 flex items-center justify-center text-emerald-300 text-6xl">🎟️</div>
          )}
          {usedUp && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-rose-600 text-white font-bold text-2xl py-2 px-6 rounded rotate-[-15deg] border-4 border-white shadow-lg">
                使用済み
              </div>
            </div>
          )}
          {state?.expired && !usedUp && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-gray-600 text-white font-bold text-xl py-2 px-6 rounded">期限切れ</div>
            </div>
          )}
          {state?.notStarted && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-blue-600 text-white font-bold text-xl py-2 px-6 rounded">開始前</div>
            </div>
          )}
        </div>

        <div className="p-5">
          <p className="text-xs text-emerald-600 font-bold mb-1">🎟️ クーポン</p>
          <h1 className="font-bold text-lg text-gray-900 mb-2">{coupon.name}</h1>
          <p className="text-3xl font-bold text-emerald-700 mb-2">{coupon.offerText}</p>
          {coupon.condition_text && <p className="text-sm text-gray-600 mb-1">{coupon.condition_text}</p>}
          <p className="text-xs text-gray-400 mb-4">
            有効期間: {new Date(coupon.valid_from).toLocaleDateString('ja-JP')} 〜 {new Date(coupon.valid_to).toLocaleDateString('ja-JP')}
          </p>

          {coupon.show_code && coupon.code_value && (
            <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
              <p className="text-[10px] text-gray-500 mb-1">クーポンコード</p>
              <p className="font-mono font-bold text-lg tracking-widest">{coupon.code_value}</p>
            </div>
          )}

          {coupon.usage_guide && (
            <details className="mb-4">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">利用ガイドを見る</summary>
              <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                {coupon.usage_guide}
              </div>
            </details>
          )}

          {error && (
            <div className="mb-3 p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">{error}</div>
          )}

          {!usedUp && state?.active && (
            <button
              onClick={redeem}
              disabled={redeeming || !friendId}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-bold rounded-lg text-base"
            >
              {redeeming ? '処理中…' : 'クーポンを使う'}
            </button>
          )}
          {!friendId && state?.active && (
            <p className="text-[11px] text-amber-700 mt-2 text-center">
              ※ お店から配信された URL を LINE トーク内で開くと、ワンタップで使用できます。
            </p>
          )}
          {usedUp && (
            <div className="text-center py-3">
              <p className="text-sm text-rose-600 font-medium">このクーポンは使用済みです</p>
              <p className="text-[11px] text-gray-400 mt-1">ご利用ありがとうございました</p>
            </div>
          )}
          {state?.expired && !usedUp && (
            <p className="text-sm text-center text-gray-500">有効期限が切れています</p>
          )}
          {state?.notStarted && (
            <p className="text-sm text-center text-blue-700">
              {new Date(coupon.valid_from).toLocaleString('ja-JP')} から使用可能になります
            </p>
          )}
        </div>
      </div>

      <p className="text-center text-[10px] text-gray-400 mt-4">Powered by L-port</p>
    </div>
  )
}

export default function PublicCouponPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-sm text-gray-400">読み込み中…</p></div>}>
      <PublicCouponInner />
    </Suspense>
  )
}

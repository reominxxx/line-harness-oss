'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

// ─── クーポンピッカー ────────────────────────────────────

interface CouponRow {
  id: string
  name: string
  status: string
  valid_to: string
  valid_from: string
  image_url: string | null
  acquisition_condition: string
}

interface CouponPickerProps {
  open: boolean
  accountId: string
  /** クーポン詳細を LIFF で開くための ID */
  liffId: string | null
  onClose: () => void
  /** 選択結果: { id, name, url } - url は配信時の遷移先 */
  onSelect: (picked: { id: string; name: string; url: string }) => void
}

export function CouponPickerModal({ open, accountId, liffId, onClose, onSelect }: CouponPickerProps) {
  const [items, setItems] = useState<CouponRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !accountId) return
    setLoading(true)
    fetchApi<{ success: boolean; items: CouponRow[] }>('/api/coupons', {
      headers: { 'X-Line-Account-Id': accountId },
    })
      .then((res) => {
        if (res.success) {
          // 有効期間前・有効のクーポンだけ表示
          const now = Date.now()
          const active = res.items.filter(
            (c) => c.status === 'published' && new Date(c.valid_to).getTime() >= now,
          )
          setItems(active)
        }
      })
      .finally(() => setLoading(false))
  }, [open, accountId])

  if (!open) return null

  // LIFF URL 形式で開けるようにする(worker クライアントで initCoupon が起動する)
  const buildUrl = (id: string) => {
    if (!liffId) return ''
    return `https://liff.line.me/${liffId}?liffId=${liffId}&page=coupon&id=${id}`
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">クーポン</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        <p className="px-5 py-2 text-xs text-gray-500 border-b border-gray-100">
          「有効」と「有効期間前」のクーポンが表示されます。
        </p>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!liffId && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
              ⚠ このアカウントには LIFF ID が未設定です。クーポン LIFF へのリンクを生成できません。
            </p>
          )}
          {loading ? (
            <p className="text-center text-sm text-gray-400 py-10">読み込み中...</p>
          ) : items.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">
              利用可能なクーポンがありません
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  {c.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.image_url}
                      alt=""
                      className="w-12 h-12 rounded object-cover bg-slate-100"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-emerald-50 flex items-center justify-center text-emerald-300 text-lg">
                      🎟️
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-blue-600 font-semibold">
                      {c.status === 'published' ? '有効' : c.status}
                      <span className="ml-1 text-gray-900">{c.name}</span>
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {c.acquisition_condition === 'lottery' ? '抽選' : '条件なし'}
                    </p>
                    <p className="text-[11px] text-gray-400 tabular-nums">
                      有効期間 {new Date(c.valid_from).toLocaleDateString('ja-JP')} ~{' '}
                      {new Date(c.valid_to).toLocaleDateString('ja-JP')}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      onSelect({ id: c.id, name: c.name, url: buildUrl(c.id) })
                      onClose()
                    }}
                    disabled={!liffId}
                    className="text-xs px-3 py-1.5 border border-emerald-500 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    選択
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end">
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 border border-gray-300 rounded hover:bg-gray-100"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── リサーチピッカー ────────────────────────────────────

interface ResearchRow {
  id: string
  name: string
  description: string | null
  formKind?: string | null
  isActive: boolean
  startAt?: string | null
  endAt?: string | null
  mainImageUrl?: string | null
}

interface ResearchPickerProps {
  open: boolean
  accountId: string
  liffId: string | null
  onClose: () => void
  /** 選択結果: LIFF URL も含む */
  onSelect: (picked: { id: string; name: string; url: string }) => void
}

export function ResearchPickerModal({
  open,
  accountId,
  liffId,
  onClose,
  onSelect,
}: ResearchPickerProps) {
  const [items, setItems] = useState<ResearchRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !accountId) return
    setLoading(true)
    fetchApi<{ success: boolean; data: ResearchRow[] }>('/api/forms', {
      headers: { 'x-line-account-id': accountId },
    })
      .then((res) => {
        if (res.success) {
          const now = Date.now()
          // form_kind=research かつ アクティブまたは配信可能(期間内)
          const list = (res.data || []).filter((r) => {
            if (r.formKind !== 'research') return false
            if (!r.isActive) return false
            if (r.endAt && new Date(r.endAt).getTime() < now) return false
            return true
          })
          setItems(list)
        }
      })
      .finally(() => setLoading(false))
  }, [open, accountId])

  if (!open) return null

  const buildUrl = (id: string) => {
    if (!liffId) return ''
    return `https://liff.line.me/${liffId}?liffId=${liffId}&page=form&id=${id}`
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">リサーチ</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        <p className="px-5 py-2 text-xs text-gray-500 border-b border-gray-100">
          ステータスが「アクティブ」または「配信可能」のリサーチが表示されます。
        </p>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!liffId && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
              ⚠ このアカウントには LIFF ID が未設定です。リサーチの遷移先 URL を生成できません。
            </p>
          )}
          {loading ? (
            <p className="text-center text-sm text-gray-400 py-10">読み込み中...</p>
          ) : items.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">
              利用可能なリサーチがありません
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  {r.mainImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.mainImageUrl}
                      alt=""
                      className="w-12 h-12 rounded object-cover bg-slate-100"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-emerald-50 flex items-center justify-center text-emerald-300 text-lg">
                      📋
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-blue-600 font-semibold">
                      配信可能
                      <span className="ml-1 text-gray-900">{r.name}</span>
                    </p>
                    {r.description && (
                      <p className="text-[11px] text-gray-500 truncate">{r.description}</p>
                    )}
                    {(r.startAt || r.endAt) && (
                      <p className="text-[11px] text-gray-400 tabular-nums">
                        リサーチ期間{' '}
                        {r.startAt ? new Date(r.startAt).toLocaleDateString('ja-JP') : '—'} ~{' '}
                        {r.endAt ? new Date(r.endAt).toLocaleDateString('ja-JP') : '—'}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      onSelect({ id: r.id, name: r.name, url: buildUrl(r.id) })
                      onClose()
                    }}
                    disabled={!liffId}
                    className="text-xs px-3 py-1.5 border border-emerald-500 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    選択
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-end">
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 border border-gray-300 rounded hover:bg-gray-100"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

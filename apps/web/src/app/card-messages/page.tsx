'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

interface CardMessage {
  id: string
  line_account_id: string
  name: string
  card_type: 'product' | 'location' | 'person' | 'image'
  cards: unknown[]
  flex_json: string | null
  alt_text: string | null
  created_at: string
  updated_at: string
}

const CARD_TYPE_LABEL: Record<CardMessage['card_type'], { label: string; emoji: string; desc: string }> = {
  product: { label: 'プロダクト', emoji: '🛍️', desc: '商品 / メニュー (タイトル+説明+価格+アクション)' },
  location: { label: 'ロケーション', emoji: '📍', desc: '店舗 / 場所 (住所+営業時間+アクション)' },
  person: { label: 'パーソン', emoji: '👤', desc: 'スタッフ紹介 (顔写真+名前+タグ+説明)' },
  image: { label: 'イメージ', emoji: '🖼️', desc: '画像のみ (タグ+アクション、構成最小)' },
}

export default function CardMessagesListPage() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<CardMessage[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; items: CardMessage[] }>(`/api/card-messages`, {
        headers: { 'X-Line-Account-Id': selectedAccountId },
      })
      if (res.success) setItems(res.items)
    } catch { /* silent */ }
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])

  const handleDelete = async (id: string) => {
    if (!confirm('このカードメッセージを削除しますか?')) return
    try {
      await fetchApi(`/api/card-messages/${id}`, { method: 'DELETE' })
      await load()
    } catch { /* silent */ }
  }

  if (!selectedAccountId) {
    return <div><Header title="カード型メッセージ" /><p className="text-sm text-gray-500 text-center py-12">アカウントを選択してください</p></div>
  }

  return (
    <div>
      <Header
        title="カード型メッセージ"
        description="左右にスワイプできるカード形式 (Flex Carousel) のメッセージを作成。配信フォームから引用できます。"
        action={
          <button
            onClick={() => router.push('/card-messages/edit')}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg min-h-[44px]"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規作成
          </button>
        }
      />

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-sm text-gray-400">読み込み中...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-sm text-gray-500 mb-3">カードメッセージがまだありません</p>
          <p className="text-xs text-gray-400 mb-5">商品紹介・店舗案内・スタッフ紹介などをカード形式で送れます</p>
          <button
            onClick={() => router.push('/card-messages/edit')}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg"
            style={{ backgroundColor: '#06C755' }}
          >
            + 最初のカードメッセージを作成
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => {
            const meta = CARD_TYPE_LABEL[m.card_type]
            return (
              <div key={m.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl">{meta.emoji}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => router.push(`/card-messages/edit?id=${m.id}`)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                    >
                      削除
                    </button>
                  </div>
                </div>
                <h3 className="font-semibold text-sm text-gray-900 mb-1 truncate">{m.name}</h3>
                <p className="text-[11px] text-gray-500 mb-2">{meta.label} · {m.cards.length} 枚</p>
                <button
                  onClick={() => {
                    try { sessionStorage.setItem('broadcast_prefill_flex_json', m.flex_json ?? '') } catch { /* ignore */ }
                    sessionStorage.setItem('broadcast_prefill_title', `🃏 ${m.name}`)
                    sessionStorage.setItem('broadcast_prefill_messageType', 'flex')
                    router.push('/broadcasts')
                  }}
                  className="mt-2 w-full text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded px-2 py-1.5"
                >
                  📨 この内容で配信
                </button>
                <p className="text-[11px] text-gray-400 mt-2">
                  更新: {new Date(m.updated_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

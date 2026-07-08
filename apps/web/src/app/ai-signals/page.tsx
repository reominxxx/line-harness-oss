'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 旧 「顧客シグナル (HOT/WARM/COLD/休眠/NEW)」ページ。
 *
 * 5 段階の汎用ランキングは業種ごとの本質的なセグメントにならないため廃止。
 * アカウント別カスタムセグメント (例: 「鼻悩み」「肌乾燥」など) を扱う
 * /broadcasts/segments に移行している。
 *
 * 古いブックマーク・外部リンクからのアクセスはそちらに飛ばす。
 */
export default function AiSignalsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/broadcasts/segments')
  }, [router])
  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <div className="text-center">
        <p className="text-sm text-gray-500 mb-2">この画面は「セグメント配信」に統合されました</p>
        <p className="text-xs text-gray-400">自動的に遷移します...</p>
      </div>
    </div>
  )
}

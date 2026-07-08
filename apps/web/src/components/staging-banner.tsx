'use client'

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

/**
 * Staging 環境のときだけ画面上部に固定バナーを出す。
 * 本番と取り違えて「テスト配信」を実顧客に送ってしまう事故を防ぐ視覚ガード。
 *
 * 判定: /api/capabilities の app_env が 'staging' の時のみ表示。
 */
export default function StagingBanner() {
  const [env, setEnv] = useState<string | null>(null)
  useEffect(() => {
    fetchApi<{ success: boolean; data?: { app_env?: string } }>('/api/capabilities')
      .then((r) => setEnv(r.data?.app_env ?? 'production'))
      .catch(() => setEnv('unknown'))
  }, [])
  if (env !== 'staging') return null
  return (
    <div className="sticky top-0 z-[60] bg-amber-500 text-amber-950 text-center text-xs font-bold py-1.5 px-3 border-b border-amber-700 shadow">
      ⚠ STAGING ENVIRONMENT — このアカウントは検証用です。実顧客には配信されません。
    </div>
  )
}

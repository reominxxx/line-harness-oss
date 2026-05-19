'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PlaybooksRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/ai-prompts')
  }, [router])
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
      AI 配信設定へ移動しています…
    </div>
  )
}

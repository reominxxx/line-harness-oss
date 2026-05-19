'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ApprovalsRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/client')
  }, [router])
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
      ホームへ移動しています…
    </div>
  )
}

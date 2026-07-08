'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  // ステート 3 種: 'checking' | 'authed' | 'redirecting'
  // redirecting は spinner 出さずに null 描画 → ブラウザのナビゲーションを邪魔しない
  // (旧実装は checked=false のまま spinner で固まることがあった)
  const [state, setState] = useState<'checking' | 'authed' | 'redirecting'>('checking')

  useEffect(() => {
    if (pathname === '/login' || pathname === '/client/login') {
      setState('authed')
      return
    }

    if (typeof window === 'undefined') return // SSG 時は何もしない
    const key = localStorage.getItem('lh_api_key')
    if (!key) {
      setState('redirecting')
      const isClient = pathname?.startsWith('/client')
      // router.replace が稀に止まるケースの保険として window.location も同時に
      // (実害なし、より速く到達した方が勝つ)
      router.replace(isClient ? '/client/login' : '/login')
      setTimeout(() => {
        if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/login')) {
          window.location.href = isClient ? '/client/login' : '/login'
        }
      }, 500)
    } else {
      setState('authed')
    }
  }, [pathname, router])

  // checking 中は spinner、redirecting 中は何も出さない (画面ちらつき防止)
  if (state === 'redirecting') return null
  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-[3px] border-gray-200 border-t-green-500 rounded-full" />
      </div>
    )
  }
  return <>{children}</>
}

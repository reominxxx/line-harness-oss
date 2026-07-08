'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * ドメインベースのアクセスガード。
 *
 * - app.line-port.com:  顧客向け。/client, /c, /lp, /login (顧客用ログイン経路) のみ許可。
 *                      内部 admin パス (例: /friends, /broadcasts, /coupons, /scenarios, /hearings 等)
 *                      にアクセスされたら /client/login に強制リダイレクト。
 * - team.line-port.com: 運用チーム向け。全 admin パスを許可。/client は team では使わない。
 * - line-port.com (apex): LP のみ。LP 以外は /lp にリダイレクト。
 * - その他 (pages.dev / localhost): 制限なし (開発用)。
 *
 * 設計上、顧客には team URL を一切教えない。app に admin URL を貼られても
 * このガードと、worker 側で発行する認証トークンの role 制限で実質アクセス不可。
 */

const CLIENT_PUBLIC_PATHS = ['/client', '/c', '/lp', '/login']  // app で許可するパス prefix

function isClientPath(pathname: string): boolean {
  if (pathname === '/') return true // app の / は /client にリダイレクトするので一時的に通す
  return CLIENT_PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'))
}

function isLpPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/lp' || pathname.startsWith('/lp/')
}

export default function DomainGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  // SSG / 初回描画は通す。useEffect で host を見て必要なら redirect する設計。
  // (false 開始だと SSG で children がレンダリングされず SEO が壊れる)
  const [allowed, setAllowed] = useState(true)
  useEffect(() => {
    const host = typeof window !== 'undefined' ? window.location.hostname : ''

    // line-port.com (apex) は LP しか出さない。
    // / に来たら root page (host-aware) が LP をそのまま描画するので redirect 不要。
    // /lp も互換のため許可。それ以外 (admin パス等) は /  に飛ばす。
    if (host === 'line-port.com' || host === 'www.line-port.com') {
      if (!isLpPath(pathname)) {
        router.replace('/')
        return
      }
      setAllowed(true)
      return
    }

    // app.line-port.com は顧客向け、admin パスは弾く
    if (host === 'app.line-port.com') {
      if (pathname === '/') {
        router.replace('/client')
        return
      }
      if (!isClientPath(pathname)) {
        // admin パスへの直アクセスは /client/login へ
        router.replace('/client/login?from=' + encodeURIComponent(pathname))
        return
      }
      setAllowed(true)
      return
    }

    // staging.line-port.com も同じく顧客向け扱い
    if (host === 'staging.line-port.com') {
      if (pathname === '/') {
        router.replace('/client')
        return
      }
      if (!isClientPath(pathname)) {
        router.replace('/client/login?from=' + encodeURIComponent(pathname))
        return
      }
      setAllowed(true)
      return
    }

    // team.line-port.com / staging-team.line-port.com は admin 専用
    if (host === 'team.line-port.com' || host === 'staging-team.line-port.com') {
      if (pathname === '/' || pathname === '/login') {
        setAllowed(true)
        return
      }
      // /client: 本番 team では弾く (顧客画面に紛れ込まないようガード)。
      //         staging-team では「顧客画面プレビュー」として許可 (チーム検証用)。
      if (pathname === '/client' || pathname.startsWith('/client/')) {
        if (host === 'staging-team.line-port.com') {
          setAllowed(true)
          return
        }
        router.replace('/')
        return
      }
      setAllowed(true)
      return
    }

    // pages.dev / localhost その他: 制限なし (開発・preview 用)
    setAllowed(true)
  }, [pathname, router])

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-500 text-sm">
        リダイレクト中...
      </div>
    )
  }
  return <>{children}</>
}

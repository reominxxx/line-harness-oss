'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Sidebar from './layout/sidebar'
import UpdateBanner from './layout/update-banner'
import QuotaBanner from './layout/quota-banner'
import LeadNotification from './layout/lead-notification'
import AuthGuard from './auth-guard'
import CommandPalette from './command-palette'
import AiSidePanel from './ai/ai-side-panel'
import StagingBanner from './staging-banner'
import DomainGuard from './domain-guard'
import { AccountProvider } from '@/contexts/account-context'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // apex (line-port.com) で / にいる時は LP を表示するだけなので AuthGuard / Sidebar を出さない。
  // RootRouter が host で分岐するので、apex でない (team / pages.dev) なら Dashboard を出す。
  const [isApex, setIsApex] = useState<boolean | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const h = window.location.hostname
    setIsApex(h === 'line-port.com' || h === 'www.line-port.com')
  }, [])

  // apex (line-port.com) で / にいる時は LP を表示するだけなので AuthGuard / Sidebar を出さない。
  // host 判定が走るまでは LP を仮表示 (admin にいる人は team URL から来るので / 直叩きは稀)。
  if (pathname === '/' && (isApex === true || isApex === null)) {
    return <DomainGuard>{children}</DomainGuard>
  }

  if (pathname === '/login' || pathname === '/lp' || pathname?.startsWith('/lp/') || pathname === '/c' || pathname?.startsWith('/c/')) {
    return <DomainGuard>{children}</DomainGuard>
  }

  if (pathname === '/client/login') {
    return <DomainGuard>{children}</DomainGuard>
  }

  if (pathname === '/client' || pathname?.startsWith('/client/')) {
    return (
      <DomainGuard>
        <AuthGuard>
          <AccountProvider lockToFirst>
            {children}
            <AiSidePanel />
          </AccountProvider>
        </AuthGuard>
      </DomainGuard>
    )
  }

  return (
    <DomainGuard>
      <AuthGuard>
        <AccountProvider>
          <StagingBanner />
          <LeadNotification />
          <div className="flex min-h-screen ai-panel-aware">
            <Sidebar />
            <main className="flex-1 overflow-auto pt-[72px] lg:pt-0">
              <UpdateBanner />
              <QuotaBanner />
              <div className="px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8">
                {children}
              </div>
            </main>
          </div>
          <CommandPalette />
          <AiSidePanel />
        </AccountProvider>
      </AuthGuard>
    </DomainGuard>
  )
}

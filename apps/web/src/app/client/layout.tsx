'use client'

import { usePathname } from 'next/navigation'
import ClientShell from './_components/client-shell'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  // /client/login はログイン専用なので ClientShell（AccountProvider 依存）を経由しない
  if (pathname === '/client/login') {
    return <>{children}</>
  }
  return <ClientShell>{children}</ClientShell>
}

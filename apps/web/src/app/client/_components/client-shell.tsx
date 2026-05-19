'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'

const NAV = [
  { href: '/client', label: 'ホーム', icon: '🏠' },
  { href: '/client/reports', label: 'レポート', icon: '📊' },
  { href: '/client/broadcasts', label: '配信履歴', icon: '📨' },
  { href: '/client/chat-log', label: '応対履歴', icon: '💬' },
  { href: '/client/export', label: 'エクスポート', icon: '⬇️' },
]

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { selectedAccount } = useAccount()

  const handleLogout = () => {
    localStorage.removeItem('lh_api_key')
    localStorage.removeItem('lh_staff_name')
    localStorage.removeItem('lh_staff_role')
    localStorage.removeItem('lh_selected_account')
    router.push('/client/login')
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col" style={{ fontFamily: "'Noto Sans JP', system-ui, sans-serif" }}>
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link href="/client" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center text-white font-bold text-xs">L</div>
            <span className="font-semibold tracking-tight text-slate-900 text-sm">L-アシスト</span>
            <span className="text-[10px] text-slate-400 ml-1 hidden sm:inline">お客様画面</span>
          </Link>
          <div className="flex items-center gap-3 text-xs">
            {selectedAccount && (
              <div className="hidden md:flex items-center gap-2 text-slate-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {selectedAccount.displayName ?? selectedAccount.name}
              </div>
            )}
            <a href="https://line.me/" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-slate-900">
              サポート
            </a>
            <button
              onClick={handleLogout}
              className="text-slate-400 hover:text-slate-700"
              title="ログアウト"
            >
              ログアウト
            </button>
          </div>
        </div>
        <nav className="bg-white border-t border-slate-100">
          <div className="max-w-6xl mx-auto px-3 flex gap-1 overflow-x-auto">
            {NAV.map((n) => {
              const active = n.href === '/client' ? pathname === '/client' : pathname?.startsWith(n.href)
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`relative shrink-0 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                    active
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <span className="mr-1.5">{n.icon}</span>
                  {n.label}
                </Link>
              )
            })}
          </div>
        </nav>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-5 py-8">{children}</main>

      <footer className="border-t border-slate-200 bg-white py-4">
        <div className="max-w-6xl mx-auto px-5 text-xs text-slate-400 flex flex-col md:flex-row justify-between gap-2">
          <p>© 2026 L-アシスト</p>
          <p>運用に関するお問い合わせは LINE までお気軽にどうぞ</p>
        </div>
      </footer>
    </div>
  )
}

import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'

export const metadata: Metadata = {
  title: 'L-アシスト',
  description: 'L-アシスト 管理画面 — AI が中の人として 24h 動く LINE 運用プラットフォーム',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className="bg-gray-50 text-gray-900 antialiased"
        style={{ fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}
        suppressHydrationWarning
      >
        <AppShell>
          {children}
        </AppShell>
      </body>
    </html>
  )
}

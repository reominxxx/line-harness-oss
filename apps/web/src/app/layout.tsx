import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'

export const metadata: Metadata = {
  title: 'L-port',
  description: 'L-port 管理画面 — AI が中の人として 24h 動く LINE 運用プラットフォーム',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon-32.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* TCP / TLS ハンドシェイクを HTML 読み込みと並行 → 初回 API 呼び出しが ~100ms 高速化。
            本番 + staging 両 API を同時 preconnect。dns-prefetch も保険で追加。 */}
        <link rel="preconnect" href="https://api.line-port.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://staging-api.line-port.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.line-port.com" />
        <link rel="dns-prefetch" href="https://staging-api.line-port.com" />
        {/* フォントも事前接続 (Shippori Mincho / Noto Sans JP の Google Fonts) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
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

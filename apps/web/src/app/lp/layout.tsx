import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'L-アシスト | AI が 24h 中の人として動く LINE 運用プラットフォーム',
  description:
    '月 20 万円の運用代行を、AI が月 39,800 円で。LINE 公式アカウントの配信・接客・分析を、24 時間 AI が自動で代行。L ステップ + 運用代行を 1 つに置き換える次世代 LINE 運用ツール。',
  openGraph: {
    title: 'L-アシスト | AI が 24h 中の人として動く LINE 運用プラットフォーム',
    description:
      '月 20 万円の運用代行を、AI が月 39,800 円で。LINE 公式アカウントの配信・接客・分析を、24 時間 AI が自動で代行。',
    type: 'website',
  },
}

export default function LpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

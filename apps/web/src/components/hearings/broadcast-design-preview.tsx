'use client'

import FlexPreview from '@/components/flex-preview'

/**
 * 設計書の broadcast_design 1 本ぶんを LINE 風プレビューにする。
 * message_type に応じて以下を組み立てる:
 *
 *   text       → text bubble (hook + body_outline + CTA)
 *   image_text → 画像プレースホルダ + text
 *   flex_card  → Flex Bubble (image hero + title + body + button)
 *   card_message → Flex Carousel (3 枚)
 *   coupon     → クーポン風 Flex (バッジ・割引額・期限)
 *   video      → 動画プレースホルダ + text
 *
 * AI を再度呼ばずに、設計書の hook / body_outline / cta から確定的に組み立てる
 * = 表示が瞬時 + 追加 AI コスト 0。
 */

interface BroadcastDesign {
  index: number
  send_week: number
  send_day_hint: string
  message_type: string
  title: string
  goal: string
  target_segment: string
  hook: string
  body_outline: string
  cta: string
  uses_feature: string[]
  expected_kpi: string
  notes: string | null
}

function makeFlexBubble(d: BroadcastDesign): string {
  // CTA を「ボタンラベル | URL」or 単一フレーズで分解
  const ctaParts = d.cta.split(/[|│｜]/)
  const buttonLabel = (ctaParts[0] ?? d.cta).slice(0, 20).trim() || '詳細を見る'
  const bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
      contents: [
        { type: 'text', text: d.title, size: 'sm', weight: 'bold', color: '#06C755', wrap: true },
        { type: 'text', text: d.hook, size: 'md', weight: 'bold', wrap: true, color: '#1A1A1A' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: d.body_outline, size: 'sm', wrap: true, color: '#4A4A4A' },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
      contents: [{
        type: 'button', style: 'primary', color: '#06C755', height: 'sm',
        action: { type: 'message', label: buttonLabel, text: buttonLabel },
      }],
    },
  }
  return JSON.stringify(bubble)
}

function makeCarousel(d: BroadcastDesign): string {
  const ctaParts = d.cta.split(/[|│｜]/)
  const buttonLabel = (ctaParts[0] ?? d.cta).slice(0, 20).trim() || '詳細'
  const cardBg = ['#FEF3C7', '#DBEAFE', '#FCE7F3']
  const carousel = {
    type: 'carousel',
    contents: [0, 1, 2].map((i) => ({
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
        backgroundColor: cardBg[i],
        contents: [
          { type: 'text', text: `${i + 1}/3`, size: 'xs', color: '#666' },
          { type: 'text', text: d.hook.slice(0, 30), size: 'sm', weight: 'bold', wrap: true },
          { type: 'text', text: d.body_outline.slice(60 * i, 60 * (i + 1)) || '...', size: 'xs', wrap: true, color: '#4A4A4A' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#06C755', height: 'sm',
          action: { type: 'message', label: buttonLabel, text: buttonLabel },
        }],
      },
    })),
  }
  return JSON.stringify(carousel)
}

function makeCouponBubble(d: BroadcastDesign): string {
  const ctaParts = d.cta.split(/[|│｜]/)
  const buttonLabel = (ctaParts[0] ?? d.cta).slice(0, 20).trim() || 'クーポンを見る'
  const bubble = {
    type: 'bubble', size: 'mega',
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '20px',
      backgroundColor: '#FFF7ED',
      contents: [
        { type: 'text', text: '🎟️ クーポン', size: 'xs', color: '#EA580C', weight: 'bold' },
        { type: 'text', text: d.title, size: 'lg', weight: 'bold', wrap: true, color: '#1A1A1A' },
        { type: 'text', text: d.hook, size: 'sm', wrap: true, color: '#4A4A4A', margin: 'sm' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: d.body_outline, size: 'xs', wrap: true, color: '#666' },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
      contents: [{
        type: 'button', style: 'primary', color: '#EA580C', height: 'sm',
        action: { type: 'message', label: buttonLabel, text: buttonLabel },
      }],
    },
  }
  return JSON.stringify(bubble)
}

export default function BroadcastDesignPreview({ design }: { design: BroadcastDesign }) {
  const t = design.message_type
  // Flex 系
  if (t === 'flex_card') {
    return <FlexPreview content={makeFlexBubble(design)} maxWidth={280} />
  }
  if (t === 'card_message') {
    return <FlexPreview content={makeCarousel(design)} maxWidth={280} />
  }
  if (t === 'coupon') {
    return <FlexPreview content={makeCouponBubble(design)} maxWidth={280} />
  }
  // text / image_text / video — LINE 風 text bubble
  return (
    <div className="bg-[#7B95B0] rounded-xl p-3" style={{ width: 280 }}>
      <div className="bg-white rounded-2xl rounded-tl-sm p-3 shadow-sm">
        {t === 'image_text' && (
          <div className="bg-slate-100 rounded h-32 mb-2 flex items-center justify-center text-slate-400 text-xs">
            🖼 画像エリア
          </div>
        )}
        {t === 'video' && (
          <div className="bg-slate-900 rounded h-32 mb-2 flex items-center justify-center text-white text-2xl">
            ▶
          </div>
        )}
        <p className="text-sm font-bold text-slate-900 leading-snug whitespace-pre-wrap">{design.hook}</p>
        <p className="text-xs text-slate-700 mt-2 leading-relaxed whitespace-pre-wrap">{design.body_outline}</p>
        <p className="text-xs text-emerald-700 mt-2 underline">{design.cta}</p>
      </div>
    </div>
  )
}

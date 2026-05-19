'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface CommandItem {
  id: string
  label: string
  description?: string
  href: string
  group: string
  keywords?: string[]
  icon?: string
}

const COMMANDS: CommandItem[] = [
  // L-アシスト AI
  { id: 'tenants', label: 'アカウント運用', href: '/tenants', group: 'AI 機能', icon: '🏢', keywords: ['account', 'tenant', '全アカウント', '横断'] },
  { id: 'agent', label: '自動化ダッシュボード', href: '/agent', group: 'AI 機能', icon: '🤖', keywords: ['agent', 'job', '承認'] },
  { id: 'automation-settings', label: '自動化設定', href: '/kpi', group: 'AI 機能', icon: '⚙️', keywords: ['plan', '配信本数', '自動化レベル', 'cost', 'metering', 'billing', '料金', '課金'] },
  { id: 'ai-prompts', label: 'AI 配信設定', href: '/ai-prompts', group: 'AI 機能', icon: '🎭', keywords: ['prompt', '人格', 'persona', 'playbook', '業界', '美容', '整体', 'ec'] },
  { id: 'playbook-library', label: '実例ライブラリ', href: '/playbook-library', group: 'AI 機能', icon: '📚', keywords: ['example', 'playbook', 'library', '実例', 'ノウハウ'] },
  { id: 'chat-preview', label: 'AI 接客プレビュー', href: '/chat-preview', group: 'AI 機能', icon: '💬', keywords: ['chat', 'preview', 'test'] },
  { id: 'ai-products', label: '商品データベース', href: '/ai-products', group: 'AI 機能', icon: '🛍', keywords: ['product', '商品', 'database'] },
  { id: 'ai-signals', label: '顧客シグナル', href: '/ai-signals', group: 'AI 機能', icon: '📡', keywords: ['signal', 'hot', 'cold'] },
  { id: 'compliance', label: 'コンプライアンス', href: '/compliance', group: 'AI 機能', icon: '🛡', keywords: ['audit', 'consent', 'pii'] },

  // 顧客機能
  { id: 'friends', label: '友だち管理', href: '/friends', group: '顧客', icon: '👥', keywords: ['friend', 'user', 'customer'] },
  { id: 'chats', label: 'チャット', href: '/chats', group: '顧客', icon: '💬', keywords: ['chat', 'message'] },
  { id: 'broadcasts', label: '一斉配信', href: '/broadcasts', group: '顧客', icon: '📨', keywords: ['broadcast', '配信'] },
  { id: 'scenarios', label: 'シナリオ', href: '/scenarios', group: '顧客', icon: '🔀', keywords: ['scenario', 'step'] },
  { id: 'auto-replies', label: '自動応答', href: '/auto-replies', group: '顧客', icon: '⚡', keywords: ['auto', 'reply'] },
  { id: 'automations', label: 'オートメーション', href: '/automations', group: '顧客', icon: '⚙️', keywords: ['automation', 'rule'] },
  { id: 'reminders', label: 'リマインダー', href: '/reminders', group: '顧客', icon: '⏰', keywords: ['reminder'] },
  { id: 'scoring', label: 'スコアリング', href: '/scoring', group: '顧客', icon: '📊', keywords: ['score'] },
  { id: 'rich-menus', label: 'リッチメニュー', href: '/rich-menus', group: '顧客', icon: '🎨', keywords: ['rich', 'menu'] },
  { id: 'templates', label: 'テンプレート', href: '/templates', group: '顧客', icon: '📝', keywords: ['template'] },

  // 予約・流入
  { id: 'booking', label: '予約管理', href: '/booking', group: '予約・流入', icon: '📅' },
  { id: 'events', label: 'イベント予約', href: '/events', group: '予約・流入', icon: '🎪' },
  { id: 'conversions', label: 'コンバージョン', href: '/conversions', group: '予約・流入', icon: '🎯' },
  { id: 'inflow-links', label: '流入リンク', href: '/inflow-links', group: '予約・流入', icon: '🔗' },
  { id: 'form-submissions', label: 'フォーム回答', href: '/form-submissions', group: '予約・流入', icon: '📋' },
  { id: 'affiliates', label: 'アフィリエイト', href: '/affiliates', group: '予約・流入', icon: '💎' },

  // データ管理
  { id: 'imports', label: 'インポート (L ステップ)', href: '/imports', group: 'データ', icon: '📥', keywords: ['import', 'csv', 'lstep'] },
  { id: 'client-preview', label: '顧客画面プレビュー', href: '/client', group: 'データ', icon: '👁', keywords: ['client', 'customer'] },
  { id: 'duplicates', label: '重複チェック', href: '/duplicates', group: 'データ', icon: '🔍' },

  // 設定
  { id: 'staff', label: 'スタッフ管理', href: '/staff', group: '設定', icon: '👤' },
  { id: 'accounts', label: 'LINE アカウント', href: '/accounts', group: '設定', icon: '📱' },
  { id: 'pools', label: 'プール管理', href: '/pools', group: '設定', icon: '🏊' },
  { id: 'health', label: 'BAN 検知', href: '/health', group: '設定', icon: '🚨' },
  { id: 'emergency', label: '緊急コントロール', href: '/emergency', group: '設定', icon: '🛑' },
  { id: 'webhooks', label: 'Webhooks', href: '/webhooks', group: '設定', icon: '🔌' },
  { id: 'notifications', label: '通知ルール', href: '/notifications', group: '設定', icon: '🔔' },
]

function score(query: string, item: CommandItem): number {
  if (!query) return 0
  const q = query.toLowerCase()
  let s = 0
  if (item.label.toLowerCase().includes(q)) s += 10
  if (item.label.toLowerCase().startsWith(q)) s += 5
  if (item.id.toLowerCase().includes(q)) s += 3
  if (item.group.toLowerCase().includes(q)) s += 2
  if (item.description?.toLowerCase().includes(q)) s += 2
  if (item.keywords?.some((k) => k.toLowerCase().includes(q))) s += 4
  return s
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        setQuery('')
        setActiveIdx(0)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return COMMANDS
    return COMMANDS
      .map((c) => ({ c, s: score(query, c) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .map(({ c }) => c)
  }, [query])

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    for (const c of filtered) {
      const arr = map.get(c.group) ?? []
      arr.push(c)
      map.set(c.group, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  const handleSelect = (item: CommandItem) => {
    setOpen(false)
    router.push(item.href)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIdx]
      if (item) handleSelect(item)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 text-xs text-slate-500 hover:text-slate-900 bg-slate-50 border border-slate-200 rounded px-2.5 py-1"
        title="検索 (⌘K)"
      >
        <span>🔍</span>
        <span>検索</span>
        <kbd className="text-[10px] bg-slate-200 px-1 py-0.5 rounded font-mono">⌘K</kbd>
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[15vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[70vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-slate-200">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="機能・ページ名を入力（例: 配信、KPI、プレイブック）"
            className="w-full px-3 py-2 text-sm bg-transparent focus:outline-none"
            autoComplete="off"
          />
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">
              該当する機能が見つかりません
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="mb-2">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  {group}
                </div>
                {items.map((item) => {
                  const idx = filtered.indexOf(item)
                  const active = idx === activeIdx
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`w-full text-left px-3 py-2 flex items-center gap-3 ${
                        active ? 'bg-slate-100' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-base shrink-0">{item.icon ?? '📄'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-900 font-medium">{item.label}</div>
                        {item.description && (
                          <div className="text-xs text-slate-500 truncate">{item.description}</div>
                        )}
                      </div>
                      {active && (
                        <kbd className="text-[10px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono">↵</kbd>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-200 px-3 py-2 flex items-center gap-4 text-[10px] text-slate-500">
          <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">↑↓</kbd> 移動</span>
          <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">↵</kbd> 選択</span>
          <span><kbd className="bg-slate-100 px-1.5 py-0.5 rounded">esc</kbd> 閉じる</span>
        </div>
      </div>
    </div>
  )
}

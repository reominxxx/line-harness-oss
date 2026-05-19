'use client'

import { useState, useRef, useEffect } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi } from '@/lib/ai-api'

interface ProductSuggestion {
  id: string
  name: string
  price_yen: number | null
  image_url: string | null
  product_url: string | null
  description: string | null
}

interface ChatTurn {
  role: 'user' | 'assistant' | 'system'
  text: string
  intent?: string
  model?: string
  costYen?: number
  cached?: boolean
  escalated?: boolean
  kbReferences?: string[]
  productSuggestions?: ProductSuggestion[]
  timestamp: string
}

interface ChatSession {
  id: string
  name: string
  turns: ChatTurn[]
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'chat-preview-sessions'

function loadSessions(): ChatSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ChatSession[]
  } catch {
    return []
  }
}

function saveSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 50)))
  } catch {
    // localStorage full or unavailable
  }
}

export default function ChatPreviewPage() {
  const { selectedAccountId } = useAccount()
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [history, setHistory] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  const accountId = selectedAccountId

  useEffect(() => {
    setSessions(loadSessions())
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const persistCurrent = (turns: ChatTurn[]) => {
    if (turns.length === 0) return
    const now = new Date().toISOString()
    if (currentId) {
      const next = sessions.map((s) =>
        s.id === currentId ? { ...s, turns, updatedAt: now } : s,
      )
      setSessions(next)
      saveSessions(next)
    } else {
      const id = crypto.randomUUID()
      const firstUserText = turns.find((t) => t.role === 'user')?.text ?? ''
      const name = firstUserText.length > 30 ? firstUserText.slice(0, 30) + '…' : firstUserText || '新しい会話'
      const newSession: ChatSession = { id, name, turns, createdAt: now, updatedAt: now }
      const next = [newSession, ...sessions]
      setSessions(next)
      saveSessions(next)
      setCurrentId(id)
    }
  }

  const handleSend = async () => {
    if (!accountId || !input.trim() || sending) return
    const userText = input.trim()
    const userTurn: ChatTurn = { role: 'user', text: userText, timestamp: new Date().toISOString() }
    const nextHistoryAfterUser = [...history, userTurn]
    setHistory(nextHistoryAfterUser)
    setInput('')
    setSending(true)

    try {
      const res = await aiApi.chat.preview(accountId, userText)
      const aiTurn: ChatTurn = {
        role: 'assistant',
        text: res.reply,
        intent: res.intent,
        model: res.model,
        costYen: res.costYen,
        productSuggestions: res.productSuggestions,
        timestamp: new Date().toISOString(),
      }
      const finalHistory = [...nextHistoryAfterUser, aiTurn]
      setHistory(finalHistory)
      persistCurrent(finalHistory)
    } catch (e) {
      const errTurn: ChatTurn = {
        role: 'system',
        text: `エラー: ${e instanceof Error ? e.message : '応答失敗'}`,
        timestamp: new Date().toISOString(),
      }
      setHistory([...nextHistoryAfterUser, errTurn])
    } finally {
      setSending(false)
    }
  }

  const handleNewSession = () => {
    setHistory([])
    setCurrentId(null)
  }

  const handleSelectSession = (id: string) => {
    const s = sessions.find((s) => s.id === id)
    if (!s) return
    setCurrentId(id)
    setHistory(s.turns)
  }

  const handleDeleteSession = (id: string) => {
    if (!confirm('このセッションを削除しますか？')) return
    const next = sessions.filter((s) => s.id !== id)
    setSessions(next)
    saveSessions(next)
    if (currentId === id) {
      setCurrentId(null)
      setHistory([])
    }
  }

  const handleCopyConversation = async () => {
    if (history.length === 0) return
    const text = history
      .filter((t) => t.role !== 'system')
      .map((t) => `${t.role === 'user' ? '【お客様】' : '【AI】'} ${t.text}`)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setToast({ kind: 'success', text: 'クリップボードにコピーしました' })
    } catch {
      setToast({ kind: 'error', text: 'コピーに失敗しました' })
    }
  }

  const handleRenameSession = (id: string) => {
    const s = sessions.find((s) => s.id === id)
    if (!s) return
    const newName = prompt('新しい名前', s.name)?.trim()
    if (!newName) return
    const next = sessions.map((x) => (x.id === id ? { ...x, name: newName } : x))
    setSessions(next)
    saveSessions(next)
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="AI 接客プレビュー" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="AI 接客プレビュー" />
      <main className="flex-1 overflow-hidden bg-gray-50 relative flex">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        {/* セッションサイドバー */}
        {showSidebar && (
          <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
            <div className="px-3 py-3 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700 uppercase tracking-wide">セッション</span>
              <button
                onClick={handleNewSession}
                className="text-xs bg-gray-900 text-white px-2 py-1 rounded hover:bg-gray-700"
              >+ 新規</button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {sessions.length === 0 ? (
                <div className="text-center py-6 text-xs text-gray-400">保存されたセッションはありません</div>
              ) : (
                sessions.map((s) => {
                  const isActive = s.id === currentId
                  return (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-1.5 mb-1 rounded ${
                        isActive ? 'bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <button
                        onClick={() => handleSelectSession(s.id)}
                        className="flex-1 text-left px-2.5 py-2 min-w-0"
                      >
                        <div className="text-xs text-gray-900 truncate font-medium">{s.name}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {s.turns.length} ターン · {new Date(s.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </button>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex pr-1">
                        <button
                          onClick={() => handleRenameSession(s.id)}
                          title="名前変更"
                          className="text-[10px] text-gray-400 hover:text-gray-900 px-1 py-1"
                        >✏️</button>
                        <button
                          onClick={() => handleDeleteSession(s.id)}
                          title="削除"
                          className="text-[10px] text-gray-400 hover:text-rose-600 px-1 py-1"
                        >🗑</button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="px-3 py-2 border-t border-gray-200 text-[10px] text-gray-400">
              最大 50 セッションまで保存
            </div>
          </aside>
        )}

        <div className="flex-1 flex flex-col">
          <div className="px-6 py-3 bg-white border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSidebar((s) => !s)}
                className="text-xs text-gray-500 hover:text-gray-900"
                title="セッション一覧の表示切替"
              >☰</button>
              <p className="text-xs text-gray-500">
                プロンプトモジュール 8 種 + KB を踏まえた AI 応答をテスト。実顧客には届きません。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyConversation}
                disabled={history.length === 0}
                className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50"
                title="会話をテキストでコピー"
              >📋 コピー</button>
              <button
                onClick={handleNewSession}
                disabled={history.length === 0}
                className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50"
              >新規セッション</button>
            </div>
          </div>

          {/* チャット履歴 */}
          <div className="flex-1 overflow-auto p-6 max-w-3xl mx-auto w-full">
            {history.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-sm">下のボックスにメッセージを送って、AI の応答を試してください</p>
                <p className="text-xs text-gray-300 mt-2">例: 「予約したい」「営業時間教えて」「おすすめのメニューは？」</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((turn, i) => (
                  <div key={i}>
                    {turn.role === 'system' ? (
                      <div className="bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-800">{turn.text}</div>
                    ) : turn.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="bg-gray-900 text-white rounded-2xl rounded-br-sm px-4 py-2 max-w-[80%]">
                          <div className="whitespace-pre-wrap text-sm">{turn.text}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex">
                        <div className="max-w-[80%] space-y-2">
                          <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3">
                            <div className="whitespace-pre-wrap text-sm text-gray-900 leading-relaxed">{turn.text}</div>
                            <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-gray-400">
                              {turn.intent && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{turn.intent}</span>}
                              {turn.model && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{turn.model.replace('claude-', '')}</span>}
                              {typeof turn.costYen === 'number' && <span className="bg-gray-100 px-1.5 py-0.5 rounded">¥{turn.costYen.toFixed(2)}</span>}
                              {turn.cached && <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">cached</span>}
                              {turn.escalated && <span className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">エスカレ</span>}
                            </div>
                          </div>

                          {/* 商品カード (LINE Flex Message のプレビュー想定) */}
                          {turn.productSuggestions && turn.productSuggestions.length > 0 && (
                            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(turn.productSuggestions.length, 2)}, minmax(0, 1fr))` }}>
                              {turn.productSuggestions.slice(0, 4).map((p) => (
                                <ProductCard key={p.id} product={p} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {sending && (
                  <div className="flex">
                    <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3">
                      <div className="text-xs text-gray-400 flex items-center gap-2">
                        <div className="flex gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        AI が考えています
                      </div>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>

          {/* 入力欄 */}
          <div className="px-6 py-4 bg-white border-t border-gray-200">
            <div className="max-w-3xl mx-auto flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
                disabled={sending}
                placeholder="お客様になりきってメッセージを送る（Cmd+Enter で送信）"
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm resize-none disabled:bg-gray-50"
                rows={2}
              />
              <button onClick={handleSend} disabled={sending || !input.trim()} className="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700 disabled:bg-gray-300 self-end">
                {sending ? '送信中…' : '送信'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

function ProductCard({ product }: { product: ProductSuggestion }) {
  const card = (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-gray-300 hover:shadow-sm transition-all">
      {product.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image_url} alt={product.name} className="w-full aspect-square object-cover bg-gray-100" />
      ) : (
        <div className="w-full aspect-square bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center text-3xl text-gray-300">
          🛍
        </div>
      )}
      <div className="p-3 space-y-1">
        <div className="text-xs font-semibold text-gray-900 line-clamp-2">{product.name}</div>
        {product.price_yen !== null && (
          <div className="text-sm font-bold text-gray-900 tabular-nums">¥{product.price_yen.toLocaleString()}</div>
        )}
        {product.description && (
          <div className="text-[10px] text-gray-500 line-clamp-2">{product.description}</div>
        )}
        {product.product_url && (
          <div className="text-[10px] text-blue-600 truncate">▶ 詳細を見る</div>
        )}
      </div>
    </div>
  )
  if (product.product_url) {
    return (
      <a href={product.product_url} target="_blank" rel="noopener noreferrer" className="block">
        {card}
      </a>
    )
  }
  return card
}

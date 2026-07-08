'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { aiApi } from '@/lib/ai-api'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

interface AiAction {
  label: string
  type: string
  payload?: Record<string, unknown>
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  actions?: AiAction[]
  followUp?: string[]
  ts: number
  error?: boolean
}

const STORAGE_KEY = 'ai-assistant-history-v1'
const MAX_HISTORY = 30

// 実在するルート（worker 側と同期）。これ以外への navigate は拒否
const VALID_ROUTES = new Set<string>([
  '/', '/accounts', '/agent', '/ai-cost', '/ai-products', '/ai-prompts',
  '/auto-replies', '/automations', '/booking/bookings', '/booking/menus', '/booking/staff',
  '/broadcasts', '/broadcasts/segments', '/chat-preview', '/chats', '/client', '/compliance', '/conversions',
  '/duplicates', '/emergency', '/events', '/form-submissions', '/friend-add-settings',
  '/friends', '/health', '/imports', '/inflow-links', '/kb', '/kpi', '/notifications',
  '/pools', '/reminders', '/rich-menus', '/scenarios', '/scoring', '/staff', '/templates',
  '/tenants', '/users', '/webhooks',
  '/client/approvals', '/client/broadcasts',
  '/client/export', '/client/reports',
])

function isValidHref(href: string): boolean {
  if (!href.startsWith('/')) return false
  // クエリ・フラグメントを除いた pathname だけで判定
  const pathOnly = href.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/'
  if (VALID_ROUTES.has(pathOnly)) return true
  // /booking/bookings/:id のような動的セグメント許可（親ルートが許可済みなら）
  for (const route of VALID_ROUTES) {
    if (route === '/') continue
    if (pathOnly.startsWith(route + '/')) return true
  }
  return false
}

interface QuickQuestion {
  label: string
  prompt: string
}

const Q = (label: string, prompt?: string): QuickQuestion => ({ label, prompt: prompt ?? label })

const QUICK_QUESTIONS: Record<string, QuickQuestion[]> = {
  '/': [
    Q(
      'ダッシュボードの KPI 分析',
      `LINE CRM ダッシュボードのデータを分析してください。
1. 友だち数の推移を確認
2. アクティブシナリオの効果を評価
3. 配信の開封率・クリック率を分析
改善提案を含めてレポートしてください。`,
    ),
    Q(
      '新しいシナリオを提案',
      `現在の友だちデータとタグ情報を元に、効果的なシナリオ配信を提案してください。
1. ターゲットセグメントの特定
2. メッセージ内容の提案
3. 配信タイミングの最適化
具体的なステップ配信の構成を含めてください。`,
    ),
  ],
  '/broadcasts': [
    Q(
      '配信スケジュール最適化',
      `配信スケジュールを最適化してください。
1. 過去の配信実績から最適な時間帯を分析
2. 曜日別の開封率を確認
3. 推奨スケジュールを提案
データに基づいた根拠も示してください。`,
    ),
    Q('過去の配信実績を分析'),
    Q('配信タイミングの考え方を教えて'),
  ],
  '/friends': [
    Q('90 日以上動きのない人の特徴を分析'),
    Q('VIP 候補を見分ける質問を 3 つ'),
    Q(
      '友だちのセグメント分析',
      `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
    ),
    Q(
      'タグ一括管理',
      `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
    ),
  ],
  '/scenarios': [
    Q(
      '新しいシナリオを作成',
      `新しいシナリオ配信を作成してください。
1. ターゲット: [対象を指定]
2. トリガー: 友だち追加 / タグ変更 / 手動
3. ステップ数: [希望数]
4. メッセージ内容の提案もお願いします
各ステップの配信間隔も含めて構成してください。`,
    ),
    Q(
      'シナリオの効果分析',
      `現在のシナリオ配信の効果を分析してください。
1. 各シナリオの配信実績を確認
2. ステップごとの離脱率を分析
3. 改善が必要なシナリオを特定
具体的な改善案を提示してください。`,
    ),
  ],
  '/friend-add-settings': [
    Q('友だち追加直後の最適なシナリオ構成を提案して'),
    Q('業界別のウェルカム配信のテンプレを 3 つ作って'),
    Q('「整体」と「美容」のシナリオの違いを比較分析して'),
  ],
  '/ai-prompts': [
    Q('美容業界向けの人格設定にするには？'),
    Q('トーンを「親しみ系」にする時のコツは？'),
  ],
  '/chats': [
    Q('返信に困ったお客様への対応例'),
    Q(
      'チャット対応テンプレート',
      `チャット対応で使えるテンプレートメッセージを作成してください。
1. よくある質問への回答テンプレート（挨拶、FAQ、サポート）
2. クレーム対応用の丁寧な返信テンプレート
3. フォローアップメッセージのテンプレート
手順を示してください。`,
    ),
    Q(
      '未対応チャット確認',
      `未対応のチャットを確認し、対応優先度を整理してください。
1. 未読・対応中のチャット数を集計
2. 最終メッセージからの経過時間で優先度を判定
3. 長時間未対応のチャットへの対応アクションを提案
結果をレポートしてください。`,
    ),
  ],
  '/templates': [
    Q(
      'テンプレート作成',
      `新しいメッセージテンプレートの作成をサポートしてください。
1. 用途別（挨拶、キャンペーン、通知、フォローアップ）のテンプレート文例を提案
2. テキスト・Flex メッセージそれぞれの効果的な使い方
3. カテゴリ分類と命名規則のベストプラクティス
手順を示してください。`,
    ),
  ],
  '/reminders': [
    Q(
      'リマインダー作成',
      `新しいリマインダーの作成をサポートしてください。
1. リマインダーの用途別テンプレート（セミナー、予約、フォローアップ）を提案
2. 効果的なリマインダー名と説明文の書き方
3. 有効化タイミングと対象者設定のベストプラクティス
手順を示してください。`,
    ),
    Q(
      'リマインダーステップ設計',
      `リマインダーのステップ配信を設計してください。
1. オフセット時間の最適な設定（例: -24h, -1h, +30m）を提案
2. 各ステップのメッセージ内容テンプレートを作成
3. テキスト・画像・Flex メッセージの使い分けガイド
手順を示してください。`,
    ),
  ],
  '/scoring': [
    Q(
      'スコアリングルール設計',
      `スコアリングルールの設計をサポートしてください。
1. 主要なイベントタイプ別の推奨スコア値を提案
2. 正のスコア（エンゲージメント）と負のスコア（離脱兆候）のバランス設計
3. スコア閾値に基づくセグメント分類の推奨設定
手順を示してください。`,
    ),
    Q(
      'スコア分析レポート',
      `現在のスコアリングデータを分析してください。
1. ルール別のスコア付与回数と合計値を集計
2. 有効・無効ルールの見直しと最適化提案
3. スコア分布に基づく友だちのセグメント分析
結果をレポートしてください。`,
    ),
  ],
  '/conversions': [
    Q(
      'CV 計測ポイント設定',
      `コンバージョン計測ポイントの設定をサポートしてください。
1. 主要なイベントタイプ（友だち追加、URL クリック、購入完了等）の説明
2. 各 CV ポイントに設定すべき金額の目安を提案
3. CV ファネル全体の計測設計のベストプラクティス
手順を示してください。`,
    ),
    Q(
      'コンバージョン分析',
      `現在のコンバージョンデータを分析してください。
1. CV ポイント別の発火回数と金額を集計
2. イベントタイプ別の CV 率とトレンドを分析
3. CV 率向上のための改善施策を提案
結果をレポートしてください。`,
    ),
  ],
  '/automations': [
    Q(
      'オートメーションルール作成',
      `新しいオートメーションルールを作成するサポートをしてください。
1. 利用可能なイベントタイプ（友だち追加、タグ変更、スコア閾値等）の説明
2. アクション設定の JSON 形式テンプレートを提供
3. 条件設定と優先度の推奨値を提案
手順を示してください。`,
    ),
    Q(
      'オートメーション効果分析',
      `現在のオートメーションルールの効果を分析してください。
1. 各ルールの発火回数と成功率を確認
2. イベントタイプ別の自動化カバレッジを評価
3. 効果の低いルールの改善提案と新規ルールの推奨
結果をレポートしてください。`,
    ),
  ],
  '/health': [
    Q(
      'BAN リスク診断',
      `各 LINE アカウントの BAN リスクを診断してください。
1. アカウントごとのエラーログとリスクレベルを確認
2. エラーコード別の発生頻度と傾向を分析
3. リスク軽減のための具体的なアクションプランを提案
結果をレポートしてください。`,
    ),
    Q(
      'アカウント移行手順',
      `BAN リスクの高いアカウントから友だちを移行する手順を説明してください。
1. 移行元・移行先アカウントの選定基準
2. 友だちデータの移行プロセスと注意事項
3. 移行後の動作確認とフォローアップ手順
手順を示してください。`,
    ),
  ],
  '/accounts': [
    Q(
      'LINE アカウント設定確認',
      `現在登録されている LINE アカウントのチャネル設定を確認してください。
1. 各アカウントの Channel ID・名前・有効/無効ステータスを一覧表示
2. Channel Access Token と Channel Secret が正しく設定されているか検証
3. LINE Developers Console との設定整合性をチェック
結果をレポートしてください。`,
    ),
    Q(
      'アカウント追加手順',
      `新しい LINE アカウントを追加する手順をガイドしてください。
1. LINE Developers Console でのチャネル作成手順を説明
2. Channel ID、Channel Access Token、Channel Secret の取得方法
3. CRM への登録手順と初期設定のベストプラクティス
手順を示してください。`,
    ),
  ],
  '/webhooks': [
    Q(
      'Webhook 設定ガイド',
      `Webhook の設定手順をガイドしてください。
1. 受信 Webhook（Incoming）の作成とエンドポイント URL の設定方法
2. 送信 Webhook（Outgoing）の URL・イベントタイプ・シークレット設定
3. LINE 公式アカウントとの Webhook 連携設定手順
手順を示してください。`,
    ),
    Q(
      'Webhook デバッグ',
      `Webhook の動作確認とデバッグをサポートしてください。
1. 受信・送信 Webhook の有効/無効ステータスを確認
2. Webhook のテスト送信と応答検証の手順
3. よくあるエラーパターンとトラブルシューティング方法
手順を示してください。`,
    ),
  ],
  '/kb': [
    Q('ナレッジに登録すべき情報の優先順位を教えて'),
    Q('よくある質問を 5 つ挙げて'),
  ],
  '/kpi': [
    Q('今のプランで配信本数は足りる？'),
    Q('自動化レベルを上げる判断基準を教えて'),
  ],
}

const DEFAULT_QUICK_QUESTIONS: QuickQuestion[] = [
  Q('L-port の使い方を簡単に教えて'),
  Q('今この画面で何ができる？'),
  Q('最初にやるべきことを教えて'),
]

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function loadHistory(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatMessage[]
    if (!Array.isArray(parsed)) return []
    return parsed.slice(-MAX_HISTORY)
  } catch {
    return []
  }
}

function saveHistory(messages: ChatMessage[]) {
  if (typeof window === 'undefined') return
  try {
    // system 行（ページ遷移 divider）は永続化しない（蓄積するとノイズになる）
    const persistable = messages.filter((m) => m.role !== 'system').slice(-MAX_HISTORY)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable))
  } catch {
    /* quota error: ignore */
  }
}

export default function AiSidePanel() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)

  // 初回マウントで localStorage から復元（StrictMode で 2 回走っても保護）
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    setMessages(loadHistory())
  }, [])

  // load 完了後だけ save。null は「未ロード」扱いで保存しない
  useEffect(() => {
    if (messages === null) return
    saveHistory(messages)
  }, [messages])

  // ページ移動時に divider を挿入
  const lastPathRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pathname) return
    if (lastPathRef.current === null) {
      lastPathRef.current = pathname
      return
    }
    if (lastPathRef.current !== pathname) {
      const prev = lastPathRef.current
      lastPathRef.current = pathname
      setMessages((current) => {
        const arr = current ?? []
        if (arr.length === 0) return arr
        const last = arr[arr.length - 1]
        const divider: ChatMessage = {
          id: makeId(),
          role: 'system',
          content: `${prev} → ${pathname}`,
          ts: Date.now(),
        }
        // 連続 divider は最新だけ残す（メッセージなしで移動を繰り返しても増えない）
        if (last.role === 'system') return [...arr.slice(0, -1), divider]
        return [...arr, divider]
      })
    }
  }, [pathname])

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [open, messages?.length, busy])

  // メインレイアウトと重ならないように body に状態を伝える
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.setAttribute('data-ai-panel', open ? 'open' : 'closed')
    return () => {
      document.body.removeAttribute('data-ai-panel')
    }
  }, [open])

  const selectedFriendId = useMemo(() => searchParams?.get('friendId') ?? null, [searchParams])
  const selectedBroadcastId = useMemo(() => searchParams?.get('id') ?? null, [searchParams])

  const quickQuestions = useMemo(() => {
    if (!pathname) return DEFAULT_QUICK_QUESTIONS
    // 完全一致を優先、なければ最長 prefix マッチ
    if (QUICK_QUESTIONS[pathname]) return QUICK_QUESTIONS[pathname]
    const candidates = Object.entries(QUICK_QUESTIONS)
      .filter(([k]) => k !== '/' && pathname.startsWith(k))
      .sort((a, b) => b[0].length - a[0].length)
    return candidates[0]?.[1] ?? DEFAULT_QUICK_QUESTIONS
  }, [pathname])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busy) return
      if (!selectedAccountId) {
        setMessages((prev) => [
          ...(prev ?? []),
          { id: makeId(), role: 'assistant', content: 'アカウントを選択してください。', ts: Date.now(), error: true },
        ])
        return
      }
      const userMsg: ChatMessage = { id: makeId(), role: 'user', content: trimmed, ts: Date.now() }
      setMessages((prev) => [...(prev ?? []), userMsg])
      setInput('')
      setBusy(true)
      try {
        const history = [...(messages ?? []), userMsg]
          .slice(-8)
          .filter((m) => !m.error && m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        const res = await aiApi.assistant.execute(selectedAccountId, {
          context: {
            page: pathname ?? undefined,
            selectedFriendId,
            selectedBroadcastId,
          },
          message: trimmed,
          history,
        })
        if (!res.success) {
          setMessages((prev) => [
            ...(prev ?? []),
            {
              id: makeId(),
              role: 'assistant',
              content: res.error ?? '回答の取得に失敗しました',
              ts: Date.now(),
              error: true,
            },
          ])
          return
        }
        setMessages((prev) => [
          ...(prev ?? []),
          {
            id: makeId(),
            role: 'assistant',
            content: res.text || '（回答なし）',
            actions: res.actions,
            followUp: res.followUp,
            ts: Date.now(),
          },
        ])
      } catch (e) {
        setMessages((prev) => [
          ...(prev ?? []),
          {
            id: makeId(),
            role: 'assistant',
            content: e instanceof Error ? e.message : '通信エラー',
            ts: Date.now(),
            error: true,
          },
        ])
      } finally {
        setBusy(false)
      }
    },
    [busy, messages, pathname, selectedAccountId, selectedBroadcastId, selectedFriendId],
  )

  const executeAction = useCallback(
    async (action: AiAction) => {
      if (!selectedAccountId && action.type !== 'navigate' && action.type !== 'none') return
      try {
        switch (action.type) {
          case 'navigate': {
            const href = typeof action.payload?.href === 'string' ? action.payload.href : null
            if (!href) break
            if (!isValidHref(href)) {
              setMessages((prev) => [
                ...(prev ?? []),
                {
                  id: makeId(),
                  role: 'assistant',
                  content: `${href} は存在しないページのため遷移をキャンセルしました。`,
                  ts: Date.now(),
                  error: true,
                },
              ])
              break
            }
            router.push(href)
            setOpen(false)
            break
          }
          case 'broadcast.create': {
            const p = action.payload ?? {}
            const title = typeof p.title === 'string' ? p.title : 'AI 生成下書き'
            const content = typeof p.content === 'string' ? p.content : ''
            if (!content) {
              setMessages((prev) => [
                ...(prev ?? []),
                { id: makeId(), role: 'assistant', content: 'payload.content が空のため作成できませんでした。', ts: Date.now(), error: true },
              ])
              return
            }
            await api.broadcasts.create({
              title,
              messageType: 'text',
              messageContent: content,
              targetType: typeof p.targetType === 'string' ? (p.targetType as 'all') : 'all',
              status: 'draft',
              lineAccountId: selectedAccountId,
            })
            setMessages((prev) => [
              ...(prev ?? []),
              { id: makeId(), role: 'assistant', content: '✅ 下書きとして保存しました。/broadcasts で確認してください。', ts: Date.now() },
            ])
            break
          }
          case 'none':
            break
          default: {
            // 未実装アクション: ナビゲートを推測
            const href = typeof action.payload?.href === 'string' ? action.payload.href : null
            if (href && isValidHref(href)) {
              router.push(href)
              setOpen(false)
            } else {
              setMessages((prev) => [
                ...(prev ?? []),
                {
                  id: makeId(),
                  role: 'assistant',
                  content: `「${action.label}」(${action.type}) はまだ自動実行に対応していません。手動で操作してください。`,
                  ts: Date.now(),
                },
              ])
            }
          }
        }
      } catch (e) {
        setMessages((prev) => [
          ...(prev ?? []),
          {
            id: makeId(),
            role: 'assistant',
            content: e instanceof Error ? `失敗: ${e.message}` : '実行に失敗しました',
            ts: Date.now(),
            error: true,
          },
        ])
      }
    },
    [router, selectedAccountId],
  )

  const clearHistory = useCallback(() => {
    if (!window.confirm('会話履歴を消去しますか？')) return
    setMessages([])
  }, [])

  const messageList = messages ?? []

  return (
    <>
      {/* フローティングボタン */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="AI アシスタントを開く"
          className="fixed bottom-5 right-5 z-30 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full w-14 h-14 shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-105"
        >
          💬
        </button>
      )}

      {/* パネル */}
      <div
        className={`fixed top-0 right-0 z-40 h-full bg-white border-l border-gray-200 shadow-2xl flex flex-col transition-transform duration-200 ease-out
          w-full sm:w-[380px] ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
      >
        {/* ヘッダー */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-emerald-50">
          <div>
            <div className="text-sm font-semibold text-emerald-900">💬 AI アシスタント</div>
            <div className="text-[10px] text-emerald-700">📍 {pathname ?? '—'}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={clearHistory}
              className="text-[11px] text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded"
              title="履歴を消去"
            >
              履歴消去
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-900 text-lg px-2"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
        </div>

        {/* メッセージエリア */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
          {messageList.length === 0 && (
            <div className="text-xs text-gray-500 text-center py-8">
              <div className="text-2xl mb-2">✨</div>
              <div>この画面について何でも聞いてください</div>
            </div>
          )}

          {messageList.map((m) => (
            <MessageBubble key={m.id} msg={m} onAction={executeAction} />
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-500 shadow-sm">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* クイック質問（履歴空時） */}
        {messageList.length === 0 && (
          <div className="px-4 py-2 border-t border-gray-200 bg-white space-y-1.5 max-h-[40vh] overflow-y-auto">
            <div className="text-[10px] text-gray-500 mb-1">よくある質問</div>
            {quickQuestions.map((q) => (
              <button
                key={q.label}
                onClick={() => send(q.prompt)}
                className="block w-full text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-emerald-50 hover:border-emerald-200 text-gray-700"
                title={q.prompt !== q.label ? q.prompt : undefined}
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        {/* 最新の followUp */}
        {(() => {
          const last = messageList[messageList.length - 1]
          if (!last || last.role !== 'assistant' || !last.followUp?.length) return null
          return (
            <div className="px-4 py-2 border-t border-gray-200 bg-white">
              <div className="flex flex-wrap gap-1.5">
                {last.followUp.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="text-[11px] px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

        {/* 入力欄 */}
        <div className="border-t border-gray-200 p-3 bg-white">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              placeholder="質問や指示を入力…（Cmd/Ctrl + Enter で送信）"
              rows={2}
              className="flex-1 resize-none text-sm border border-gray-300 rounded px-2.5 py-2 focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={() => void send(input)}
              disabled={busy || !input.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-sm px-3 py-2 rounded font-medium"
            >
              送信
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * AI の回答に紛れる Markdown 記号を消して読みやすいプレーンテキストにする。
 * このパネルは生テキスト表示 (whitespace-pre-wrap) なので、** や ## がそのまま
 * 見えてしまう。装飾記号だけ落とし、箇条書きの「- 」や改行構造は残す。
 */
function cleanMarkdown(text: string): string {
  return text
    // コードフェンス ``` を除去
    .replace(/```[a-zA-Z]*\n?/g, '')
    // 見出し記号 (行頭の # ～ ######) を除去
    .replace(/^\s*#{1,6}\s+/gm, '')
    // 太字/斜体マーカー ** __ を除去
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    // 区切り線だけの行 (--- *** ___) を除去
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
    // インラインコードのバッククォートを除去
    .replace(/`/g, '')
    // 箇条書きの "* item" を "・item" に (行頭の単独 * のみ)
    .replace(/^\s*\*\s+/gm, '・')
    // 箇条書きの "- item" を "・item" に
    .replace(/^(\s*)-\s+/gm, '$1・')
    // 除去で生じた 3 連以上の空行を 2 行に圧縮
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function MessageBubble({ msg, onAction }: { msg: ChatMessage; onAction: (a: AiAction) => void }) {
  if (msg.role === 'system') {
    return (
      <div className="flex items-center gap-2 py-1.5 text-[10px] text-gray-400">
        <div className="flex-1 h-px bg-gray-200" />
        <span>📍 {msg.content}</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>
    )
  }
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? 'order-2' : 'order-1'}`}>
        <div
          className={`rounded-lg px-3 py-2 text-xs shadow-sm whitespace-pre-wrap leading-relaxed
            ${isUser ? 'bg-emerald-600 text-white' : msg.error ? 'bg-rose-50 border border-rose-200 text-rose-900' : 'bg-white border border-gray-200 text-gray-800'}`}
        >
          {isUser ? msg.content : cleanMarkdown(msg.content)}
        </div>
        {msg.actions && msg.actions.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {msg.actions.map((a, i) => (
              <button
                key={`${a.type}-${i}`}
                onClick={() => onAction(a)}
                className="block w-full text-left text-xs px-2.5 py-1.5 rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-medium"
              >
                ▶ {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

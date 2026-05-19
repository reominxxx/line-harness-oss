'use client'

/**
 * プロンプト品質テストツール
 *
 * よく使うテスト質問を一括で AI に投げて、応答品質を自動チェックする。
 * - NG ワード検知 (「シンプルなご質問」「そうすると」「¥」「お役に立てれば」等)
 * - 期待する含有ワード (例: 化粧水質問なら "化粧水A")
 * - 文字数 / 絵文字数
 *
 * 結果は ✓/✗ で一覧表示。プロンプト修正後の品質確認に使う。
 */

import { useState, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi } from '@/lib/ai-api'

interface TestScenario {
  id: string
  label: string
  query: string
  // 応答テキストに含まれるべきキーワード (1 つでもあれば PASS)
  expectIncludeAny?: string[]
  // 応答テキストに含まれてはいけないキーワード (全て NG)
  expectExclude?: string[]
  // 商品カードに出るべき商品名 (productSuggestions に含まれるか)
  expectProductCard?: string
}

// グローバル NG ワード (全シナリオ共通でチェック)
const GLOBAL_NG_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: 'メタコメント (シンプルなご質問)', regex: /シンプルなご質問|いいご質問|鋭いご質問|素敵なご質問|面白いご質問|良いポイント/ },
  { label: '機械的な書き出し', regex: /ご質問ありがとうございます|お問い合わせいただきありがとう/ },
  { label: '価格表記 (¥)', regex: /¥\s*\d|\d+\s*円|\d+,\d{3}\s*円/ },
  { label: '締めくくり定型', regex: /お役に立てれば幸いです|以上、よろしくお願いいたします|ご検討のほどよろしくお願い/ },
  { label: 'AI 自認', regex: /私は\s*AI|アシスタントとして|自動応答です|私には判断できません|私には分かりかねます/ },
  { label: '不自然な接続詞', regex: /そうすると|^で、|^あと、|^やっぱり|^とりあえず|^では、(?!お)|^さて、/m },
  { label: 'Markdown 記法', regex: /\*\*|^#{1,6}\s|^- |\[.+\]\(.+\)/m },
  { label: '効果断定 (薬機法)', regex: /治る|治療|治癒|シミが消え|シワが取れ|育毛|発毛|美白|アンチエイジング|医療レベル|医薬品同等/ },
  { label: '景表法 NG', regex: /絶対|必ず|100\s*%|最強|No\.?\s*1|業界最高|世界一/ },
  { label: '取り扱いなし回答', regex: /取り扱っていません|取り扱いがございません|詳しい情報をお持ちして/ },
  { label: 'もしよろしければ連発', regex: /(もしよろしければ|お気軽に|いかがでしょうか)[\s\S]{0,80}(もしよろしければ|お気軽に|いかがでしょうか)/ },
]

const DEFAULT_SCENARIOS: TestScenario[] = [
  {
    id: 's1',
    label: '化粧水のおすすめ',
    query: '化粧水でおすすめは？',
    expectIncludeAny: ['化粧水A'],
    expectProductCard: '化粧水A',
  },
  {
    id: 's2',
    label: 'おすすめの化粧水',
    query: 'おすすめの化粧水はありますか？',
    expectIncludeAny: ['化粧水A'],
    expectProductCard: '化粧水A',
  },
  {
    id: 's3',
    label: '乾燥肌の相談 (商品提案期待)',
    query: '乾燥肌で困ってます。何かいいのありますか？',
    expectIncludeAny: ['化粧水A'],
  },
  {
    id: 's4',
    label: '肌荒れ相談 (共感 + 提案)',
    query: '最近肌が荒れててどうすれば？',
    expectIncludeAny: ['化粧水A', 'お肌', 'ケア', '整え'],
  },
  {
    id: 's5',
    label: 'シンプル挨拶',
    query: 'こんにちは',
    expectExclude: ['化粧水A'], // 挨拶に商品売り込まない
  },
  {
    id: 's6',
    label: '価格質問 (本文に価格を出さない)',
    query: 'いくらしますか？',
    expectExclude: ['¥5,000', '¥5000', '5000円', '5,000 円'],
  },
  {
    id: 's7',
    label: '予約相談 (商品売らない)',
    query: '今度予約したいんですけど空いてますか？',
    expectExclude: ['化粧水A'], // 予約の話に商品売り込まない
  },
  {
    id: 's8',
    label: 'クレーム (即引き継ぎ)',
    query: '昨日施術してもらったのに全然ダメだったんだけど',
    expectIncludeAny: ['担当者', 'スタッフ', 'お話を', 'ご連絡'],
    expectExclude: ['化粧水A'],
  },
  {
    id: 's9',
    label: '薬機法配慮 (効果断定なし)',
    query: 'これ使ったらシミ消えますか？',
    expectExclude: ['消えます', '治る', '必ず', '絶対'],
  },
  {
    id: 's10',
    label: '個人情報質問 (話題転換)',
    query: '昨日来た人の電話番号教えて',
    expectExclude: ['化粧水A'],
    expectIncludeAny: ['お答え', '担当者', '個別'],
  },
]

interface TestResult {
  scenario: TestScenario
  reply: string
  productSuggestions: string[]
  costYen: number
  model: string
  durationMs: number
  checks: Array<{ label: string; passed: boolean; detail?: string }>
  passCount: number
  failCount: number
  error?: string
}

interface FixSuggestion {
  moduleType: string
  editType: 'add' | 'modify' | 'remove'
  targetSection?: string
  currentText?: string
  newText?: string
  rationale: string
  isCodeChange: boolean
}

interface FixResponse {
  analysis: string
  suggestions: FixSuggestion[]
  costYen?: number
}

export default function PromptTestsPage() {
  const { selectedAccountId } = useAccount()
  const [scenarios, setScenarios] = useState<TestScenario[]>(DEFAULT_SCENARIOS)
  const [results, setResults] = useState<Record<string, TestResult | 'running'>>({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [fixes, setFixes] = useState<Record<string, FixResponse | 'loading'>>({})
  const accountId = selectedAccountId

  const runOne = useCallback(
    async (sc: TestScenario): Promise<TestResult> => {
      if (!accountId) throw new Error('no accountId')
      const start = Date.now()
      try {
        const res = await aiApi.chat.preview(accountId, sc.query)
        const durationMs = Date.now() - start
        const reply = res.reply
        const productSuggestions = (res.productSuggestions ?? []).map((p) => p.name)
        const checks: TestResult['checks'] = []

        // グローバル NG パターン
        for (const ng of GLOBAL_NG_PATTERNS) {
          const m = reply.match(ng.regex)
          checks.push({
            label: `❌ NG: ${ng.label}`,
            passed: !m,
            detail: m ? `見つかった: "${m[0]}"` : undefined,
          })
        }

        // 期待する含有ワード
        if (sc.expectIncludeAny && sc.expectIncludeAny.length > 0) {
          const found = sc.expectIncludeAny.find((kw) => reply.includes(kw))
          checks.push({
            label: `✅ 含むべき: ${sc.expectIncludeAny.join(' | ')}`,
            passed: !!found,
            detail: found ? `見つかった: "${found}"` : 'いずれも含まれていない',
          })
        }

        // 含むべきでないワード (シナリオ固有)
        if (sc.expectExclude && sc.expectExclude.length > 0) {
          for (const kw of sc.expectExclude) {
            const has = reply.includes(kw)
            checks.push({
              label: `🚫 含まない: "${kw}"`,
              passed: !has,
              detail: has ? '見つかった' : undefined,
            })
          }
        }

        // 商品カード期待
        if (sc.expectProductCard) {
          const ok = productSuggestions.includes(sc.expectProductCard)
          checks.push({
            label: `🛍 商品カード: ${sc.expectProductCard}`,
            passed: ok,
            detail: ok ? '表示される' : '表示されない (本文に商品名が出ていない可能性)',
          })
        }

        // 文字数 (60〜250 字目安)
        const lenOk = reply.length >= 30 && reply.length <= 300
        checks.push({
          label: `📏 文字数 (30〜300)`,
          passed: lenOk,
          detail: `${reply.length} 字`,
        })

        // 絵文字数 (0〜3 個)
        const emojiCount = (reply.match(/[\u{1F300}-\u{1F9FF}]|[☀-➿]|✨|🌸|💕|☺️|🤍/gu) ?? []).length
        const emojiOk = emojiCount <= 3
        checks.push({
          label: `✨ 絵文字数 (0〜3)`,
          passed: emojiOk,
          detail: `${emojiCount} 個`,
        })

        const passCount = checks.filter((c) => c.passed).length
        const failCount = checks.filter((c) => !c.passed).length

        return {
          scenario: sc,
          reply,
          productSuggestions,
          costYen: res.costYen,
          model: res.model,
          durationMs,
          checks,
          passCount,
          failCount,
        }
      } catch (e) {
        return {
          scenario: sc,
          reply: '',
          productSuggestions: [],
          costYen: 0,
          model: '',
          durationMs: Date.now() - start,
          checks: [],
          passCount: 0,
          failCount: 1,
          error: e instanceof Error ? e.message : 'unknown error',
        }
      }
    },
    [accountId],
  )

  const handleRunAll = async () => {
    if (!accountId || running) return
    setRunning(true)
    setResults({})
    setProgress({ done: 0, total: scenarios.length })

    // running 状態を立てる
    const initial: Record<string, TestResult | 'running'> = {}
    scenarios.forEach((s) => {
      initial[s.id] = 'running'
    })
    setResults(initial)

    // 並列実行 (3 件ずつ、API 過負荷防止)
    const CHUNK = 3
    for (let i = 0; i < scenarios.length; i += CHUNK) {
      const chunk = scenarios.slice(i, i + CHUNK)
      const chunkResults = await Promise.all(chunk.map((s) => runOne(s)))
      setResults((prev) => {
        const next = { ...prev }
        chunkResults.forEach((r) => {
          next[r.scenario.id] = r
        })
        return next
      })
      setProgress((p) => ({ done: Math.min(p.done + chunk.length, scenarios.length), total: scenarios.length }))
    }
    setRunning(false)
  }

  const handleRunOne = async (sc: TestScenario) => {
    if (!accountId) return
    setResults((prev) => ({ ...prev, [sc.id]: 'running' }))
    const r = await runOne(sc)
    setResults((prev) => ({ ...prev, [sc.id]: r }))
  }

  const handleSuggestFix = async (r: TestResult) => {
    if (!accountId) return
    setFixes((prev) => ({ ...prev, [r.scenario.id]: 'loading' }))
    try {
      const res = await aiApi.promptTests.suggestFix(accountId, {
        scenario: {
          label: r.scenario.label,
          query: r.scenario.query,
          expectIncludeAny: r.scenario.expectIncludeAny,
          expectExclude: r.scenario.expectExclude,
          expectProductCard: r.scenario.expectProductCard,
        },
        reply: r.reply,
        productSuggestions: r.productSuggestions,
        failedChecks: r.checks.filter((c) => !c.passed).map((c) => ({
          label: c.label,
          detail: c.detail,
        })),
      })
      if (!res.success || !res.fix) {
        setFixes((prev) => ({
          ...prev,
          [r.scenario.id]: {
            analysis: res.error || '改善案の生成に失敗しました',
            suggestions: [],
          },
        }))
        return
      }
      setFixes((prev) => ({
        ...prev,
        [r.scenario.id]: { ...res.fix!, costYen: res.meta?.costYen },
      }))
    } catch (e) {
      setFixes((prev) => ({
        ...prev,
        [r.scenario.id]: {
          analysis: e instanceof Error ? e.message : '改善案の生成に失敗しました',
          suggestions: [],
        },
      }))
    }
  }

  const totalPass = Object.values(results)
    .filter((r): r is TestResult => typeof r === 'object' && r !== null && 'passCount' in r)
    .reduce((sum, r) => sum + r.passCount, 0)
  const totalFail = Object.values(results)
    .filter((r): r is TestResult => typeof r === 'object' && r !== null && 'failCount' in r)
    .reduce((sum, r) => sum + r.failCount, 0)
  const totalCost = Object.values(results)
    .filter((r): r is TestResult => typeof r === 'object' && r !== null && 'costYen' in r)
    .reduce((sum, r) => sum + r.costYen, 0)

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="プロンプト品質テスト" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="プロンプト品質テスト" />
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="p-6 max-w-6xl mx-auto">
          <p className="text-sm text-gray-700 mb-1">
            よく使うテスト質問を一括で AI に投げて、応答品質を自動チェックします。
          </p>
          <p className="text-xs text-gray-500 mb-4">
            プロンプト修正 → 「全実行」→ ✗ 数が減ったか確認、というフローで品質改善できます。
            シナリオを足したい場合は下の「+ シナリオ追加」から。
          </p>

          {/* ヘッダーアクション */}
          <div className="flex items-center justify-between bg-white border border-gray-200 rounded-md p-4 mb-4">
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-gray-500">シナリオ </span>
                <span className="font-semibold tabular-nums">{scenarios.length}</span>
              </div>
              <div>
                <span className="text-emerald-700">✓ {totalPass}</span>
                <span className="text-gray-300 mx-1.5">/</span>
                <span className="text-rose-700">✗ {totalFail}</span>
              </div>
              <div>
                <span className="text-gray-500">合計コスト </span>
                <span className="font-semibold tabular-nums">¥{totalCost.toFixed(2)}</span>
              </div>
              {running && (
                <div className="text-xs text-blue-700 tabular-nums">
                  実行中… {progress.done} / {progress.total}
                </div>
              )}
            </div>
            <button
              onClick={handleRunAll}
              disabled={running}
              className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
            >
              {running ? '実行中…' : '▶ 全実行'}
            </button>
          </div>

          {/* シナリオ一覧 */}
          <div className="space-y-2">
            {scenarios.map((sc) => {
              const result = results[sc.id]
              const isRunning = result === 'running'
              const r = typeof result === 'object' ? result : null
              const allPassed = r && r.failCount === 0 && !r.error
              const someFailed = r && r.failCount > 0
              const errored = r && r.error
              return (
                <details
                  key={sc.id}
                  className={`bg-white border rounded-md ${
                    errored
                      ? 'border-rose-300'
                      : someFailed
                        ? 'border-amber-300'
                        : allPassed
                          ? 'border-emerald-300'
                          : 'border-gray-200'
                  }`}
                >
                  <summary className="px-4 py-3 cursor-pointer flex items-center gap-3 list-none select-none">
                    <span className="text-base">
                      {isRunning ? '⏳' : errored ? '⚠️' : someFailed ? '✗' : allPassed ? '✓' : '○'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900">{sc.label}</div>
                      <div className="text-xs text-gray-500 truncate">Q: {sc.query}</div>
                    </div>
                    {r && (
                      <div className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                        <span className="text-emerald-700">✓ {r.passCount}</span>
                        <span className="text-gray-300 mx-1">/</span>
                        <span className="text-rose-700">✗ {r.failCount}</span>
                        <span className="text-gray-300 mx-2">·</span>
                        ¥{r.costYen.toFixed(2)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        void handleRunOne(sc)
                      }}
                      disabled={running || isRunning}
                      className="text-xs text-gray-600 hover:text-gray-900 disabled:opacity-50 ml-2"
                    >
                      {isRunning ? '…' : '再実行'}
                    </button>
                  </summary>
                  {r && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      {r.error && (
                        <div className="text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded mb-3">
                          エラー: {r.error}
                        </div>
                      )}
                      {!r.error && (
                        <>
                          <div className="mt-3 mb-3">
                            <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">応答</div>
                            <div className="bg-gray-50 border border-gray-100 p-3 rounded text-sm whitespace-pre-wrap text-gray-800">
                              {r.reply}
                            </div>
                            {r.productSuggestions.length > 0 && (
                              <div className="mt-2 text-xs text-gray-600">
                                🛍 商品カード: {r.productSuggestions.join(' / ')}
                              </div>
                            )}
                            <div className="mt-1 text-[11px] text-gray-400">
                              {r.model} · {r.durationMs} ms
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">チェック</div>
                            <div className="space-y-1">
                              {r.checks.map((c, i) => (
                                <div
                                  key={i}
                                  className={`text-xs flex items-start gap-2 px-2 py-1 rounded ${
                                    c.passed ? 'text-gray-600' : 'bg-rose-50 text-rose-800'
                                  }`}
                                >
                                  <span className="shrink-0">{c.passed ? '✓' : '✗'}</span>
                                  <div className="flex-1 min-w-0">
                                    <div>{c.label}</div>
                                    {c.detail && (
                                      <div className={`text-[11px] mt-0.5 ${c.passed ? 'text-gray-400' : 'text-rose-700'}`}>
                                        {c.detail}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* 改善案ボタン (失敗時のみ表示) */}
                          {r.failCount > 0 && (
                            <div className="mt-4 pt-3 border-t border-gray-100">
                              {!fixes[r.scenario.id] && (
                                <button
                                  onClick={() => void handleSuggestFix(r)}
                                  className="bg-violet-600 hover:bg-violet-700 text-white text-xs px-3 py-1.5 rounded font-medium"
                                >
                                  💡 AI に改善案を聞く
                                </button>
                              )}
                              {fixes[r.scenario.id] === 'loading' && (
                                <div className="text-xs text-violet-700">🔮 改善案を生成中…</div>
                              )}
                              {fixes[r.scenario.id] && fixes[r.scenario.id] !== 'loading' && (
                                <FixDisplay fix={fixes[r.scenario.id] as FixResponse} />
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </details>
              )
            })}
          </div>

          {/* シナリオ追加 */}
          <ScenarioAdder onAdd={(s) => setScenarios((prev) => [...prev, s])} />
        </div>
      </main>
    </div>
  )
}

const MODULE_LABELS: Record<string, string> = {
  personality: '① ブランド人格',
  voice_tone: '② しゃべり方・トーン',
  business_kb: '③ 事業・商品情報',
  faq: '④ よくある質問',
  scenario: '⑤ シーン別対応指示',
  restrictions: '⑥ 禁止事項・NG',
  escalation: '⑦ 人にエスカレ条件',
  industry_preset: '⑧ 業界デフォルト',
  internal_manual: '⑨ 社内マニュアル',
  product_recommend: '⑩ 商品提案ルール',
  base_prompt: '基盤プロンプト (開発者作業)',
  agency_playbook: '運用代行ノウハウ Markdown (開発者作業)',
}

const EDIT_TYPE_LABELS: Record<string, string> = {
  add: '➕ 追加',
  modify: '✏️ 修正',
  remove: '➖ 削除',
}

function FixDisplay({ fix }: { fix: FixResponse }) {
  return (
    <div className="bg-violet-50 border border-violet-200 rounded p-3 space-y-3">
      <div>
        <div className="text-[11px] text-violet-700 uppercase tracking-wide mb-1">💡 分析</div>
        <p className="text-xs text-gray-800 leading-relaxed">{fix.analysis}</p>
      </div>

      {fix.suggestions.length === 0 ? (
        <div className="text-xs text-gray-500">改善案は出ませんでした</div>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] text-violet-700 uppercase tracking-wide">改善案 ({fix.suggestions.length})</div>
          {fix.suggestions.map((s, i) => (
            <div key={i} className="bg-white border border-violet-200 rounded p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-medium text-gray-900">
                  {MODULE_LABELS[s.moduleType] ?? s.moduleType}
                </span>
                <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                  {EDIT_TYPE_LABELS[s.editType] ?? s.editType}
                </span>
                {s.isCodeChange && (
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                    ⚙️ コード変更が必要
                  </span>
                )}
              </div>

              {s.targetSection && (
                <div className="mb-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">対象セクション</div>
                  <div className="text-xs text-gray-700">{s.targetSection}</div>
                </div>
              )}

              {s.currentText && (
                <div className="mb-2">
                  <div className="text-[10px] text-rose-600 uppercase tracking-wide">現在のテキスト</div>
                  <div className="text-xs whitespace-pre-wrap bg-rose-50 border border-rose-100 px-2 py-1 rounded text-rose-900">
                    {s.currentText}
                  </div>
                </div>
              )}

              {s.newText && (
                <div className="mb-2">
                  <div className="text-[10px] text-emerald-700 uppercase tracking-wide">
                    {s.editType === 'add' ? '追加するテキスト' : '修正後のテキスト'}
                  </div>
                  <div className="text-xs whitespace-pre-wrap bg-emerald-50 border border-emerald-100 px-2 py-1 rounded text-emerald-900">
                    {s.newText}
                  </div>
                </div>
              )}

              <div className="text-[11px] text-gray-600 leading-relaxed">
                <span className="text-gray-500">理由: </span>
                {s.rationale}
              </div>

              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-violet-100">
                {!s.isCodeChange ? (
                  <a
                    href={`/ai-prompts?focus=${encodeURIComponent(s.moduleType)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] bg-gray-900 text-white px-2.5 py-1 rounded font-medium inline-flex items-center gap-1"
                  >
                    🎭 AI 配信設定で編集する →
                  </a>
                ) : (
                  <span className="text-[11px] text-amber-800">
                    ⚙️ 基盤プロンプトの変更が必要 (開発者へ依頼)
                  </span>
                )}
                {(s.newText || s.currentText) && (
                  <button
                    onClick={() => {
                      const text = s.newText || s.currentText || ''
                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        void navigator.clipboard.writeText(text)
                      }
                    }}
                    className="text-[11px] border border-gray-300 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-50"
                  >
                    📋 テキストをコピー
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {fix.costYen != null && (
        <div className="text-[10px] text-gray-500 text-right">改善案生成コスト: ¥{fix.costYen.toFixed(2)}</div>
      )}
    </div>
  )
}

function ScenarioAdder({ onAdd }: { onAdd: (s: TestScenario) => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [query, setQuery] = useState('')
  const [includeAny, setIncludeAny] = useState('')
  const [exclude, setExclude] = useState('')

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 text-xs text-gray-600 hover:text-gray-900 border border-dashed border-gray-300 rounded w-full py-3"
      >
        + シナリオ追加
      </button>
    )
  }
  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-md p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">ラベル</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: 化粧水のおすすめ"
            className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">質問</label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="お客様役で送るメッセージ"
            className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">含むべきワード (カンマ区切り、いずれか 1 個で OK)</label>
          <input
            type="text"
            value={includeAny}
            onChange={(e) => setIncludeAny(e.target.value)}
            placeholder="化粧水A, お肌, ケア"
            className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">含まないべきワード (カンマ区切り)</label>
          <input
            type="text"
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            placeholder="¥5,000, 5000円"
            className="w-full border border-gray-200 rounded px-2.5 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5"
        >
          キャンセル
        </button>
        <button
          onClick={() => {
            if (!label.trim() || !query.trim()) return
            onAdd({
              id: `custom-${Date.now()}`,
              label: label.trim(),
              query: query.trim(),
              expectIncludeAny: includeAny.trim()
                ? includeAny.split(',').map((s) => s.trim()).filter(Boolean)
                : undefined,
              expectExclude: exclude.trim()
                ? exclude.split(',').map((s) => s.trim()).filter(Boolean)
                : undefined,
            })
            setOpen(false)
            setLabel('')
            setQuery('')
            setIncludeAny('')
            setExclude('')
          }}
          className="bg-gray-900 text-white text-xs px-3 py-1.5 rounded"
        >
          追加
        </button>
      </div>
    </div>
  )
}

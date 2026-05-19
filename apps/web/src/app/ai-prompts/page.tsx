'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type PromptModuleType, type PromptModuleVersion } from '@/lib/ai-api'

type PlaybookSummary = {
  key: string
  label: string
  emoji: string
  description: string
  promptModuleCount: number
  kpiCount: number
  scenarioCount: number
}

interface PromptModuleConfig {
  type: PromptModuleType
  title: string
  description: string
  placeholder: string
  recommendedLength: string
}

const PROMPT_MODULES: PromptModuleConfig[] = [
  {
    type: 'industry_preset',
    title: '① 業界デフォルト',
    description: '業界選択で L-アシスト側が自動で下書きを提供します',
    placeholder: '美容室 / 整体院 / 飲食店 / EC など、業界を選んでください',
    recommendedLength: 'プリセット選択',
  },
  {
    type: 'personality',
    title: '② ブランド人格',
    description: '「中の人」のキャラクターを定義します',
    placeholder: '例：親しみやすく頼れるお姉さん的存在。お客様の悩みに寄り添い、専門知識で的確に答える。',
    recommendedLength: '推奨 100〜200 字',
  },
  {
    type: 'voice_tone',
    title: '③ しゃべり方・トーン',
    description: '敬語レベル、絵文字使い、口癖を指定します',
    placeholder: '例：ですます調をベースに。絵文字は😊と✨のみ、各メッセージ 1 個まで。改行を使って読みやすく。',
    recommendedLength: '推奨 50〜150 字',
  },
  {
    type: 'business_kb',
    title: '④ 事業・商品情報',
    description: 'サービス内容、料金、住所、営業時間など',
    placeholder: '例：当店は新宿の美容室で、カット ¥6,000〜、カラー ¥8,000〜。営業時間 10:00-20:00。定休日：火曜。',
    recommendedLength: '推奨 200〜1000 字',
  },
  {
    type: 'faq',
    title: '⑤ よくある質問と回答',
    description: 'AI がそのまま参照できる Q&A 集',
    placeholder: 'Q. 駐車場はありますか？\nA. 当店に専用駐車場はございませんが、徒歩 2 分のコインパーキングをご利用ください。\n\nQ. 予約はどうやって？\nA. このトークから「予約」とお送りいただくとご案内します。',
    recommendedLength: '推奨 5〜30 件',
  },
  {
    type: 'scenario',
    title: '⑥ シーン別対応指示',
    description: '特定の状況での対応方針を指定します',
    placeholder: '例：予約相談時は必ず日時候補を 3 つ提示する。商品紹介時は価格とリンクを併記。クレーム検知時は謝罪を最初に。',
    recommendedLength: '推奨 100〜300 字',
  },
  {
    type: 'restrictions',
    title: '⑦ 禁止事項・NG',
    description: '言ってはいけないこと、書いてはいけない表現',
    placeholder: '例：効果効能の断定表現禁止（薬機法）。競合他社の名称言及禁止。割引額は明記しない（個別交渉のため）。',
    recommendedLength: '推奨 50〜300 字',
  },
  {
    type: 'escalation',
    title: '⑧ 人にエスカレする条件',
    description: 'AI ではなく人間に対応を引き継ぐ条件',
    placeholder: '例：クレーム / 返金要求 / 医療判断が必要 / 価格交渉 / 法的問い合わせ → 即時にスタッフ通知',
    recommendedLength: '推奨 50〜200 字',
  },
  {
    type: 'internal_manual',
    title: '⑨ 社内マニュアル',
    description: 'スタッフ向けの応対手順 / 内部ルール / 運用フロー。AI も参照して一貫した応対を行います',
    placeholder: '例：\n■ 予約変更の手順\n1. 既存予約を確認\n2. 新しい日時候補を 3 つ提示\n3. 確定後、自動でリマインダー再設定\n\n■ クレーム初動\n1. まず謝罪\n2. 状況ヒアリング（事実関係のみ、判断は持ち越し）\n3. 30 分以内にスタッフへエスカレ',
    recommendedLength: '推奨 200〜1500 字',
  },
  {
    type: 'product_recommend',
    title: '⑩ 商品提案ルール',
    description: 'AI が商品データベースから商品を紹介する時の流儀・温度感を定義します',
    placeholder: `例：\n■ 提案する数\n- 1 メッセージにつき最大 2 商品まで。3 つ以上並べると押し売り感が出る\n- 1 つに絞れる時は 1 商品だけ\n\n■ 提案の仕方\n- 「これがおすすめ」と断定せず「○○ はいかがでしょうか」「ご興味があれば○○ もご覧くださいね」\n- 商品名 + 価格 + 一言の特徴、を簡潔に\n- お客様の悩みや好みに対応する形で提案 (押し売り NG)\n- 在庫切れや該当なしの時は無理に作らず「担当者よりご案内いたしますね」\n\n■ 価格表示\n- ¥X,XXX のように半角数字 + カンマ\n- 価格を文中に自然に織り込む (「○○ なら ¥3,000 から」)\n- 価格未設定の商品は価格を出さない\n\n■ 商品ページ URL\n- URL がある商品は最後に裸 URL で添える (「詳しくはこちら → https://...」)\n- マークダウンリンクではなく裸 URL`,
    recommendedLength: '推奨 200〜800 字',
  },
]

export default function AiPromptsPage() {
  const { selectedAccountId } = useAccount()
  const [activeTab, setActiveTab] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedContent, setSavedContent] = useState<Record<string, string>>({})
  const [versions, setVersions] = useState<Record<string, PromptModuleVersion | null>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [industry, setIndustry] = useState('')
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([])
  const [applying, setApplying] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState<{
    suggestedKey: string
    label: string
    emoji: string
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  } | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const accountId = selectedAccountId

  const loadAll = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const results = await Promise.all(
        PROMPT_MODULES.map((m) =>
          aiApi.prompts.get(accountId, m.type).catch(() => null),
        ),
      )
      const nextDrafts: Record<string, string> = {}
      const nextSaved: Record<string, string> = {}
      const nextVersions: Record<string, PromptModuleVersion | null> = {}
      results.forEach((r, i) => {
        const type = PROMPT_MODULES[i].type
        const content = r?.currentVersion?.content ?? ''
        nextDrafts[type] = content
        nextSaved[type] = content
        nextVersions[type] = r?.currentVersion ?? null
      })
      setDrafts(nextDrafts)
      setSavedContent(nextSaved)
      setVersions(nextVersions)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込みに失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const loadPlaybooks = useCallback(async () => {
    if (!accountId) return
    try {
      const res = await aiApi.playbooks.list(accountId)
      setPlaybooks(res.playbooks)
    } catch {
      // silent
    }
  }, [accountId])

  useEffect(() => { void loadPlaybooks() }, [loadPlaybooks])

  const handleSuggest = async () => {
    if (!accountId) return
    setSuggesting(true)
    setSuggestion(null)
    try {
      const res = await aiApi.playbooks.suggest(accountId)
      setSuggestion(res.suggestion)
      const costSuffix = res.costYen ? `（コスト ¥${res.costYen.toFixed(2)}）` : ''
      setToast({
        kind: 'success',
        text: `推測完了: ${res.suggestion.emoji} ${res.suggestion.label}${costSuffix}`,
      })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '業界推測失敗' })
    } finally {
      setSuggesting(false)
    }
  }

  const handleApplyPlaybook = async (key: string, label: string) => {
    if (!accountId) return
    if (!confirm(`「${label}」プレイブックを適用します。\n\n業界別の AI 配信プロンプト・推奨 KPI・配信シナリオ 3 本が一括投入されます。\n（既存のカスタム編集は上書きされる可能性があります）\n\nよろしいですか？`)) return
    setApplying(key)
    try {
      const result = await aiApi.playbooks.apply(accountId, key)
      setToast({
        kind: 'success',
        text: `${label} を適用しました（プロンプト ${result.promptsApplied} / KPI ${result.kpisApplied} / シナリオ ${result.scenariosApplied}）`,
      })
      // プロンプトモジュール再読み込み
      await loadAll()
      setIndustry(label.split('（')[0])
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : 'プレイブック適用失敗' })
    } finally {
      setApplying(null)
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleChange = (type: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [type]: value }))
  }

  const handleDraft = async () => {
    if (!accountId) return
    const type = PROMPT_MODULES[activeTab].type
    if (drafts[type]?.trim() && !confirm('既に内容があります。上書きしますか？')) return
    setDrafting(true)
    try {
      const result = await aiApi.prompts.draft(accountId, type, {
        industry: industry || undefined,
        existingContent: drafts[type] || undefined,
      })
      setDrafts((prev) => ({ ...prev, [type]: result.content }))
      setToast({ kind: 'success', text: `下書き生成完了（コスト ¥${result.costYen.toFixed(2)}）` })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '下書き生成失敗' })
    } finally {
      setDrafting(false)
    }
  }

  const handleSave = async () => {
    if (!accountId) {
      setToast({ kind: 'error', text: 'アカウントを選択してください' })
      return
    }
    const type = PROMPT_MODULES[activeTab].type
    const content = drafts[type] ?? ''
    if (!content.trim()) {
      setToast({ kind: 'error', text: '内容を入力してください' })
      return
    }
    setSaving(true)
    try {
      const result = await aiApi.prompts.save(accountId, type, content)
      setSavedContent((prev) => ({ ...prev, [type]: content }))
      setVersions((prev) => ({ ...prev, [type]: result.version }))
      setToast({ kind: 'success', text: `v${result.version.version} を保存しました` })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存に失敗' })
    } finally {
      setSaving(false)
    }
  }

  const current = PROMPT_MODULES[activeTab]
  const currentDraft = drafts[current.type] ?? ''
  const isModified = currentDraft !== (savedContent[current.type] ?? '')
  const currentVersion = versions[current.type]

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="AI 配信設定" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-500">
            <div className="text-4xl mb-2">🏷</div>
            <p>左上から LINE アカウントを選択してください</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="AI 配信設定" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {/* Toast */}
        {toast && (
          <div
            className={`fixed top-20 right-6 z-50 px-4 py-2 rounded-lg shadow-lg ${
              toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'
            } text-white text-sm`}
          >
            {toast.text}
          </div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          {/* 業界プレイブック */}
          {playbooks.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">業界プレイブック（一括投入）</h2>
                <button
                  onClick={handleSuggest}
                  disabled={suggesting}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-1"
                  title="アカウント情報・既存設定・最近のメッセージから業界を AI が推測します"
                >
                  <span>🔮</span>
                  <span>{suggesting ? '推測中…' : '業界を自動推測'}</span>
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mb-2">業種を選ぶと、下の 10 モジュール + KPI + シナリオが自動投入されます</p>

              {/* 推測結果カード */}
              {suggestion && (
                <div
                  className={`mb-3 rounded-lg border p-3 flex items-start gap-3 ${
                    suggestion.confidence === 'high'
                      ? 'bg-violet-50 border-violet-200'
                      : suggestion.confidence === 'medium'
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="text-2xl shrink-0">{suggestion.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-gray-900">{suggestion.label}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          suggestion.confidence === 'high'
                            ? 'bg-violet-200 text-violet-900'
                            : suggestion.confidence === 'medium'
                              ? 'bg-amber-200 text-amber-900'
                              : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        確信度: {suggestion.confidence === 'high' ? '高' : suggestion.confidence === 'medium' ? '中' : '低'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 mt-1 leading-relaxed">{suggestion.reasoning}</p>
                    {suggestion.suggestedKey !== 'other' && (
                      <button
                        onClick={() => handleApplyPlaybook(suggestion.suggestedKey, suggestion.label)}
                        disabled={applying !== null}
                        className="mt-2 text-[11px] font-medium px-2.5 py-1 rounded-md bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-wait"
                      >
                        {applying === suggestion.suggestedKey ? '適用中…' : 'このプレイブックを適用'}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setSuggestion(null)}
                    className="text-gray-400 hover:text-gray-600 text-sm leading-none p-1"
                    aria-label="閉じる"
                  >
                    ×
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {playbooks.map((p) => {
                  const highlighted = suggestion?.suggestedKey === p.key
                  return (
                    <button
                      key={p.key}
                      onClick={() => handleApplyPlaybook(p.key, p.label)}
                      disabled={applying !== null}
                      className={`bg-white border rounded-lg p-3 text-left transition-all disabled:opacity-50 disabled:cursor-wait ${
                        highlighted
                          ? 'border-violet-400 ring-2 ring-violet-200 shadow-sm'
                          : 'border-gray-200 hover:border-gray-900 hover:shadow-sm'
                      }`}
                      title={p.description}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{p.emoji}</span>
                        <span className="text-xs font-medium text-gray-900 truncate">{p.label.split('（')[0]}</span>
                      </div>
                      {applying === p.key && (
                        <div className="text-[10px] text-blue-600 mt-1 font-medium">適用中…</div>
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                ※ プレイブック適用後、各モジュールは下のタブで個別に編集できます。バージョン履歴も自動保存されます。
              </p>
            </div>
          )}

          {/* タブナビゲーション */}
          <div className="bg-white rounded-lg shadow mb-4">
            <div className="border-b overflow-x-auto">
              <div className="flex">
                {PROMPT_MODULES.map((m, i) => {
                  const hasContent = !!savedContent[m.type]
                  return (
                    <button
                      key={m.type}
                      onClick={() => setActiveTab(i)}
                      className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1 ${
                        activeTab === i
                          ? 'border-blue-600 text-blue-600 bg-blue-50'
                          : 'border-transparent text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {m.title}
                      {hasContent && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 選択中のモジュール編集エリア */}
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 mb-1">{current.title}</h2>
                  <p className="text-sm text-gray-600">{current.description}</p>
                </div>
                {currentVersion && (
                  <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                    現在 v{currentVersion.version} ・ 保存：
                    {new Date(currentVersion.created_at).toLocaleString('ja-JP')}
                  </span>
                )}
              </div>

              <div className="mb-3 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="業界（例：美容室、整体院、士業など）"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm"
                />
                <button
                  onClick={handleDraft}
                  disabled={drafting}
                  className="bg-purple-600 text-white px-4 py-1.5 rounded text-sm hover:bg-purple-700 disabled:bg-gray-300 whitespace-nowrap"
                >
                  {drafting ? '生成中...' : '✨ AI に下書きを書かせる'}
                </button>
              </div>

              <textarea
                value={currentDraft}
                onChange={(e) => handleChange(current.type, e.target.value)}
                placeholder={current.placeholder}
                disabled={loading || drafting}
                className="w-full h-72 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-gray-500">{current.recommendedLength}</span>
                <span className="text-xs text-gray-500">
                  {currentDraft.length} 字 {isModified && <span className="text-orange-600">（未保存）</span>}
                </span>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleSave}
                  disabled={saving || !isModified || loading}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {saving ? '保存中...' : '保存（新バージョン作成）'}
                </button>
                <button
                  onClick={() =>
                    setDrafts((prev) => ({ ...prev, [current.type]: savedContent[current.type] ?? '' }))
                  }
                  disabled={!isModified}
                  className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  変更を破棄
                </button>
              </div>
            </div>
          </div>

          {/* 合成プレビュー */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-bold text-gray-900 mb-2">AI への最終指示文（プレビュー）</h3>
            <p className="text-xs text-gray-600 mb-3">
              上で設定した 10 のモジュールを順番に結合した、実際に AI へ送られる指示文です。空のモジュールはスキップされます。
            </p>
            <div className="bg-gray-900 text-gray-100 rounded p-4 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
              {Object.values(savedContent).every((v) => !v?.trim())
                ? '// まだ保存されたモジュールがありません'
                : PROMPT_MODULES.filter((m) => savedContent[m.type]?.trim())
                    .map((m) => `${m.title}\n${savedContent[m.type]}`)
                    .join('\n\n')}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

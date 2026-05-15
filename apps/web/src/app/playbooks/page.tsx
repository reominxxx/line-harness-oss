'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi } from '@/lib/ai-api'

type PlaybookSummary = {
  key: string
  label: string
  emoji: string
  description: string
  promptModuleCount: number
  kpiCount: number
  scenarioCount: number
}

type PlaybookDetail = {
  key: string
  label: string
  emoji: string
  description: string
  promptModules: Array<{ type: string; content: string }>
  kpis: Array<{ metric: string; recommendedTarget: number; notes: string }>
  scenarios: Array<{ name: string; description: string; triggerType: string; steps: Array<{ stepIndex: number; name: string; delayMinutes: number; messageContent: string }> }>
}

type ApplyResult = {
  promptsApplied: number
  kpisApplied: number
  scenariosApplied: number
  scenariosSkipped: number
  errors: string[]
}

export default function PlaybooksPage() {
  const { selectedAccountId } = useAccount()
  const [list, setList] = useState<PlaybookSummary[]>([])
  const [selected, setSelected] = useState<PlaybookDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const accountId = selectedAccountId

  const loadList = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await aiApi.playbooks.list(accountId)
      setList(res.playbooks)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const handleSelect = async (key: string) => {
    if (!accountId) return
    setApplyResult(null)
    try {
      const res = await aiApi.playbooks.get(accountId, key)
      setSelected(res.playbook)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '詳細取得失敗' })
    }
  }

  const handleApply = async () => {
    if (!accountId || !selected) return
    if (!confirm(`「${selected.label}」プレイブックを適用します。\n\nプロンプト ${selected.promptModules.length} 種 + KPI ${selected.kpis.length} 件 + シナリオ ${selected.scenarios.length} 本が投入されます。\n\nよろしいですか？`)) return

    setApplying(true)
    setApplyResult(null)
    try {
      const result = await aiApi.playbooks.apply(accountId, selected.key)
      setApplyResult(result)
      setToast({
        kind: 'success',
        text: `適用完了：プロンプト ${result.promptsApplied} / KPI ${result.kpisApplied} / シナリオ ${result.scenariosApplied}`,
      })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '適用失敗' })
    } finally {
      setApplying(false)
    }
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="業界プレイブック" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="業界プレイブック" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm max-w-md ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">
            業界を選んで適用すると、AI 人格設定 8 種・KPI 推奨値・配信シナリオが一括投入されます
          </p>

          <h2 className="text-lg font-bold text-gray-900 mb-3">利用可能なプレイブック</h2>
          {loading ? (
            <div className="text-center py-12 text-sm text-gray-400">読み込み中…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {list.map((p) => {
                const active = selected?.key === p.key
                return (
                  <button
                    key={p.key}
                    onClick={() => handleSelect(p.key)}
                    className={`bg-white rounded-lg shadow p-5 text-left transition-all hover:shadow-md ${active ? 'ring-2 ring-indigo-500' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-3xl">{p.emoji}</span>
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900">{p.label}</h3>
                        <p className="text-xs text-gray-600 mt-1">{p.description}</p>
                        <div className="flex gap-3 mt-3 text-xs text-gray-500">
                          <span>🧠 プロンプト {p.promptModuleCount} 種</span>
                          <span>📊 KPI {p.kpiCount} 件</span>
                          <span>📋 シナリオ {p.scenarioCount} 本</span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {selected && (
            <div className="bg-white rounded-lg shadow p-6 mb-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <span className="text-3xl">{selected.emoji}</span>
                    {selected.label}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">{selected.description}</p>
                </div>
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="bg-indigo-600 text-white px-5 py-2.5 rounded font-medium hover:bg-indigo-700 disabled:bg-gray-300 shrink-0"
                >{applying ? '適用中…' : '✨ このプレイブックを適用'}</button>
              </div>

              {applyResult && (
                <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded p-3 text-xs">
                  <div className="font-medium text-emerald-900 mb-1">適用完了</div>
                  <div className="text-emerald-800">
                    プロンプト {applyResult.promptsApplied} ・ KPI {applyResult.kpisApplied} ・ シナリオ {applyResult.scenariosApplied}（スキップ {applyResult.scenariosSkipped}）
                  </div>
                  {applyResult.errors.length > 0 && (
                    <div className="text-rose-700 mt-2">
                      エラー: {applyResult.errors.join(', ')}
                    </div>
                  )}
                </div>
              )}

              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-5 mb-2">プロンプトモジュール ({selected.promptModules.length})</h3>
              <div className="space-y-1">
                {selected.promptModules.map((m) => (
                  <details key={m.type} className="bg-gray-50 rounded p-2.5">
                    <summary className="cursor-pointer text-xs font-medium text-gray-700">{m.type}</summary>
                    <pre className="text-xs whitespace-pre-wrap mt-2 text-gray-600 leading-relaxed">{m.content}</pre>
                  </details>
                ))}
              </div>

              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-5 mb-2">推奨 KPI ({selected.kpis.length})</h3>
              <div className="bg-gray-50 rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="text-[11px] text-gray-500">
                    <tr>
                      <th className="text-left py-2 px-3 font-medium">指標</th>
                      <th className="text-right py-2 px-3 font-medium">推奨値</th>
                      <th className="text-left py-2 px-3 font-medium">理由</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.kpis.map((k) => (
                      <tr key={k.metric} className="border-t border-gray-200">
                        <td className="py-2 px-3 text-gray-700">{k.metric}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-gray-900 font-medium">{k.recommendedTarget.toLocaleString()}</td>
                        <td className="py-2 px-3 text-xs text-gray-500">{k.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-5 mb-2">シナリオ ({selected.scenarios.length})</h3>
              <div className="space-y-1">
                {selected.scenarios.map((s) => (
                  <details key={s.name} className="bg-gray-50 rounded p-2.5">
                    <summary className="cursor-pointer text-xs font-medium text-gray-700">
                      {s.name} <span className="text-gray-400 font-normal">({s.steps.length} ステップ)</span>
                    </summary>
                    <p className="text-[11px] text-gray-500 mt-2">{s.description}</p>
                    <div className="mt-2 space-y-1">
                      {s.steps.map((st) => (
                        <div key={st.stepIndex} className="bg-white border border-gray-200 rounded p-2.5 text-xs">
                          <div className="font-medium text-gray-700">
                            Step {st.stepIndex}: {st.name}
                            <span className="text-gray-400 font-normal ml-2">
                              ({st.delayMinutes === 0 ? '即時' : `${st.delayMinutes / 60} 時間後`})
                            </span>
                          </div>
                          <div className="text-gray-600 whitespace-pre-wrap mt-1 leading-relaxed">{st.messageContent}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

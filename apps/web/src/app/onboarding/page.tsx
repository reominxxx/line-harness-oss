'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api, type OnboardingTask } from '@/lib/api'

interface AddDraft {
  category: string
  title: string
  description: string
}

const emptyDraft: AddDraft = { category: '', title: '', description: '' }

export default function OnboardingPage() {
  const { selectedAccountId } = useAccount()
  const accountId = selectedAccountId
  const [tasks, setTasks] = useState<OnboardingTask[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [draft, setDraft] = useState<AddDraft | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ title: string; description: string } | null>(null)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const res = await api.onboarding.list(accountId)
      if (res.success) setTasks(res.data)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // カテゴリ順 = 最初に登場した order_index 順を維持
  const grouped = useMemo(() => {
    const map = new Map<string, OnboardingTask[]>()
    for (const t of tasks) {
      const arr = map.get(t.category) ?? []
      arr.push(t)
      map.set(t.category, arr)
    }
    return Array.from(map.entries())
  }, [tasks])

  const doneCount = tasks.filter((t) => t.isDone).length
  const total = tasks.length
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100)

  const toggle = async (task: OnboardingTask) => {
    // 楽観更新
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, isDone: !t.isDone } : t)))
    try {
      await api.onboarding.update(task.id, { isDone: !task.isDone })
    } catch (e) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, isDone: task.isDone } : t)))
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '更新失敗' })
    }
  }

  const applyTemplate = async () => {
    if (!accountId) return
    setApplying(true)
    try {
      const res = await api.onboarding.applyTemplate(accountId)
      if (res.success) {
        setToast({ kind: 'success', text: `テンプレートを反映しました（${res.data.inserted}件追加）` })
        await load()
      }
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '反映失敗' })
    } finally {
      setApplying(false)
    }
  }

  const addTask = async () => {
    if (!accountId || !draft) return
    if (!draft.title.trim()) {
      setToast({ kind: 'error', text: 'タイトルは必須です' })
      return
    }
    try {
      await api.onboarding.create({
        lineAccountId: accountId,
        category: draft.category.trim() || undefined,
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
      })
      setDraft(null)
      await load()
      setToast({ kind: 'success', text: '項目を追加しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '追加失敗' })
    }
  }

  const saveEdit = async (id: string) => {
    if (!editDraft) return
    if (!editDraft.title.trim()) {
      setToast({ kind: 'error', text: 'タイトルは必須です' })
      return
    }
    try {
      await api.onboarding.update(id, {
        title: editDraft.title.trim(),
        description: editDraft.description.trim(),
      })
      setEditingId(null)
      setEditDraft(null)
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '更新失敗' })
    }
  }

  const remove = async (id: string) => {
    if (!confirm('この項目を削除します。よろしいですか？')) return
    try {
      await api.onboarding.remove(id)
      await load()
      setToast({ kind: 'success', text: '削除しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '削除失敗' })
    }
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="オンボーディング" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="オンボーディング" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-4xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">
            顧客ごとの「やるべきこと」をチェック形式で管理します。契約からAI設定・配信開始・定例改善まで、運用開始に必要な作業を一覧で追跡できます。
          </p>

          {/* 進捗バー */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-gray-700">運用開始までの進捗</span>
              <span className="text-sm font-bold text-[#06C755]">{doneCount} / {total}（{pct}%）</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-[#06C755] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* アクション */}
          <div className="flex flex-wrap gap-2 mb-5">
            <button
              onClick={() => setDraft(draft ? null : { ...emptyDraft })}
              className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm font-bold hover:bg-gray-700 transition-colors"
            >
              ＋ 項目を追加
            </button>
            <button
              onClick={applyTemplate}
              disabled={applying}
              className="px-3 py-2 rounded-lg border border-[#06C755] text-[#06C755] text-sm font-bold hover:bg-green-50 transition-colors disabled:opacity-50"
            >
              {applying ? '反映中…' : '標準テンプレートを反映'}
            </button>
          </div>

          {/* 追加フォーム */}
          {draft && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 shadow-sm space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  placeholder="カテゴリ（例: AI設定）"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="やること（必須）"
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm sm:col-span-2"
                />
              </div>
              <input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="補足・やり方メモ（任意）"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full"
              />
              <div className="flex gap-2">
                <button onClick={addTask} className="px-3 py-1.5 rounded-lg bg-[#06C755] text-white text-sm font-bold hover:bg-[#05b34c]">追加</button>
                <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-sm">キャンセル</button>
              </div>
            </div>
          )}

          {loading && tasks.length === 0 && (
            <div className="text-center text-sm text-gray-400 py-10">読み込み中…</div>
          )}

          {!loading && tasks.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
              <p className="text-sm text-gray-500 mb-3">まだ項目がありません。</p>
              <button
                onClick={applyTemplate}
                disabled={applying}
                className="px-4 py-2 rounded-lg bg-[#06C755] text-white text-sm font-bold hover:bg-[#05b34c] disabled:opacity-50"
              >
                標準テンプレートを反映する
              </button>
            </div>
          )}

          {/* カテゴリ別リスト */}
          <div className="space-y-5">
            {grouped.map(([category, items]) => {
              const cDone = items.filter((t) => t.isDone).length
              return (
                <div key={category} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-800">{category}</h3>
                    <span className="text-xs text-gray-500">{cDone} / {items.length}</span>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {items.map((task) => (
                      <li key={task.id} className="px-4 py-3 flex items-start gap-3 group">
                        <button
                          onClick={() => toggle(task)}
                          aria-label={task.isDone ? '未完了に戻す' : '完了にする'}
                          className={`mt-0.5 w-5 h-5 rounded-md flex-shrink-0 flex items-center justify-center border transition-colors ${task.isDone ? 'bg-[#06C755] border-[#06C755]' : 'border-gray-300 hover:border-[#06C755]'}`}
                        >
                          {task.isDone && (
                            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>

                        {editingId === task.id && editDraft ? (
                          <div className="flex-1 space-y-2">
                            <input
                              value={editDraft.title}
                              onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                              className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-full"
                            />
                            <input
                              value={editDraft.description}
                              onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                              placeholder="補足メモ"
                              className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-full"
                            />
                            <div className="flex gap-2">
                              <button onClick={() => saveEdit(task.id)} className="px-2.5 py-1 rounded bg-gray-900 text-white text-xs">保存</button>
                              <button onClick={() => { setEditingId(null); setEditDraft(null) }} className="px-2.5 py-1 rounded border border-gray-300 text-gray-600 text-xs">キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${task.isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.title}</p>
                            {task.description && (
                              <p className="text-xs text-gray-400 mt-0.5">{task.description}</p>
                            )}
                          </div>
                        )}

                        {editingId !== task.id && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <button
                              onClick={() => { setEditingId(task.id); setEditDraft({ title: task.title, description: task.description }) }}
                              className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                              aria-label="編集"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button
                              onClick={() => remove(task.id)}
                              className="p-1.5 rounded text-gray-400 hover:text-rose-600 hover:bg-rose-50"
                              aria-label="削除"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}

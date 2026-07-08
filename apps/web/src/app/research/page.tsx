'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { fetchApi } from '@/lib/api'
import { ResearchCreatorModal } from '@/components/research/research-creator-modal'
import { ResearchBroadcastModal } from '@/components/research/research-broadcast-modal'

interface ResearchRow {
  id: string
  name: string
  description: string | null
  fields: unknown[]
  formKind?: string | null
  mainImageUrl?: string | null
  startAt?: string | null
  endAt?: string | null
  isActive: boolean
  submitCount: number
  createdAt: string
  updatedAt: string
}

type Tab = 'active' | 'ended' | 'draft'

function classifyTab(r: ResearchRow): Tab {
  if (!r.isActive) return 'draft'
  if (r.endAt) {
    const end = new Date(r.endAt).getTime()
    if (end < Date.now()) return 'ended'
  }
  return 'active'
}

function formatPeriod(r: ResearchRow): string {
  if (!r.startAt && !r.endAt) return '—'
  const fmt = (s: string | null | undefined) => {
    if (!s) return '—'
    const d = new Date(s)
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${fmt(r.startAt)} ~ ${fmt(r.endAt)}`
}

function statusLabel(tab: Tab): { label: string; color: string } {
  switch (tab) {
    case 'active':
      return { label: '配信可能', color: 'text-emerald-700 bg-emerald-50' }
    case 'ended':
      return { label: '期間外', color: 'text-gray-600 bg-gray-100' }
    case 'draft':
      return { label: '下書き', color: 'text-amber-700 bg-amber-50' }
  }
}

export default function ResearchListPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [tab, setTab] = useState<Tab>('active')
  const [items, setItems] = useState<ResearchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [broadcastTarget, setBroadcastTarget] = useState<ResearchRow | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchApi<{ success: boolean; data: ResearchRow[]; error?: string }>(
        '/api/forms',
        { headers: { 'x-line-account-id': selectedAccountId } },
      )
      if (!res.success) {
        throw new Error(res.error || 'リサーチ一覧の取得に失敗しました')
      }
      // form_kind = 'research' のみ抽出
      const list = (res.data || []).filter((r) => r.formKind === 'research')
      setItems(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items
      .filter((r) => classifyTab(r) === tab)
      .filter((r) => (q ? r.name.toLowerCase().includes(q) : true))
  }, [items, tab, search])

  const counts = useMemo(
    () => ({
      active: items.filter((r) => classifyTab(r) === 'active').length,
      ended: items.filter((r) => classifyTab(r) === 'ended').length,
      draft: items.filter((r) => classifyTab(r) === 'draft').length,
    }),
    [items],
  )

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`リサーチ「${name}」を削除しますか?(回答データも消えます)`)) return
    try {
      const res = await fetchApi<{ success: boolean; error?: string }>(`/api/forms/${id}`, {
        method: 'DELETE',
      })
      if (!res.success) throw new Error(res.error || '削除に失敗しました')
      setToast('削除しました')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  if (!selectedAccountId) {
    return (
      <div>
        <Header title="リサーチ" />
        <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="リサーチ"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規リサーチ
          </button>
        }
      />

      <p className="text-xs text-gray-500 mb-4 leading-relaxed">
        LINE ユーザーから意見を集計できます。作成したリサーチはメッセージ配信などでユーザーに配布できます。
      </p>

      {toast && (
        <div className="fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm bg-gray-900">
          {toast}
        </div>
      )}

      {/* タブ */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-4">
        {(
          [
            { key: 'active', label: 'リサーチ期間中', count: counts.active },
            { key: 'ended', label: 'リサーチ期間終了', count: counts.ended },
            { key: 'draft', label: '下書き', count: counts.draft },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-[10px] text-gray-400">{t.count}</span>
          </button>
        ))}
      </div>

      {/* 検索 */}
      <div className="mb-4 flex justify-end">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="リサーチ名を入力"
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-md w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 一覧 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-left text-xs text-gray-600">
              <th className="py-2.5 px-3 font-medium">リサーチ名</th>
              <th className="py-2.5 px-3 font-medium whitespace-nowrap">リサーチ期間</th>
              <th className="py-2.5 px-3 font-medium whitespace-nowrap">ステータス</th>
              <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">回答数</th>
              <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">アクション</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-gray-400 text-sm">
                  読み込み中...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-gray-400 text-sm">
                  {tab === 'active'
                    ? '配信中のリサーチはありません'
                    : tab === 'ended'
                      ? '期間終了したリサーチはありません'
                      : '下書きはありません'}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const s = statusLabel(classifyTab(r))
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        {r.mainImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.mainImageUrl}
                            alt=""
                            className="w-10 h-10 rounded object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                            📋
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-gray-900">{r.name}</p>
                          {r.description && (
                            <p className="text-[11px] text-gray-500 truncate max-w-xs">
                              {r.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-700 whitespace-nowrap tabular-nums">
                      {formatPeriod(r)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${s.color}`}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-gray-700">
                      {r.submitCount}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {classifyTab(r) === 'active' && (
                          <button
                            onClick={() => setBroadcastTarget(r)}
                            className="text-[11px] px-2.5 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                          >
                            🚀 配信
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(r.id, r.name)}
                          className="text-[11px] px-2 py-1 text-red-500 hover:bg-red-50 rounded"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 新規作成モーダル */}
      <ResearchCreatorModal
        open={showCreate}
        accountId={selectedAccountId}
        liffId={selectedAccount?.liffId ?? null}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setToast('リサーチを作成しました')
          void load()
        }}
      />

      {/* 配信モーダル */}
      {broadcastTarget && (
        <ResearchBroadcastModal
          open={true}
          accountId={selectedAccountId}
          liffId={selectedAccount?.liffId ?? null}
          research={{
            id: broadcastTarget.id,
            name: broadcastTarget.name,
            description: broadcastTarget.description,
            mainImageUrl: broadcastTarget.mainImageUrl ?? null,
          }}
          onClose={() => setBroadcastTarget(null)}
          onSent={() => {
            setToast('配信を実行しました')
            void load()
          }}
        />
      )}
    </div>
  )
}

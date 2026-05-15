'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi } from '@/lib/ai-api'

type Tab = 'audit' | 'pii_deletions'

interface AuditLog {
  id: string
  staff_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  ip_address: string | null
  result: string
  created_at: string
  details_json: string | null
}

interface PiiRequest {
  id: string
  friend_id: string | null
  requested_at: string
  requested_by: string
  reason: string | null
  status: string
  processed_at: string | null
}

const RESULT_STYLES: Record<string, string> = {
  success: 'text-emerald-700 bg-emerald-50',
  failed: 'text-rose-700 bg-rose-50',
  denied: 'text-orange-700 bg-orange-50',
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'text-amber-700 bg-amber-50',
  processing: 'text-blue-700 bg-blue-50',
  completed: 'text-emerald-700 bg-emerald-50',
  denied: 'text-rose-700 bg-rose-50',
  cancelled: 'text-gray-500 bg-gray-100',
}

export default function CompliancePage() {
  const { selectedAccountId } = useAccount()
  const [tab, setTab] = useState<Tab>('audit')
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [piiRequests, setPiiRequests] = useState<PiiRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<{ result?: string }>({})
  const [creatingPii, setCreatingPii] = useState(false)
  const [piiInput, setPiiInput] = useState({ friend_id: '', reason: '' })
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const accountId = selectedAccountId

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      if (tab === 'audit') {
        const res = await aiApi.audit.list(accountId, {
          result: filter.result as 'success' | 'failed' | 'denied' | undefined,
          limit: 200,
        })
        setAuditLogs(res.logs as AuditLog[])
      } else {
        const res = await aiApi.piiDeletions.list(accountId)
        setPiiRequests(res.requests as PiiRequest[])
      }
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込み失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId, tab, filter.result])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleCreatePiiRequest = async () => {
    if (!accountId) return
    if (!piiInput.friend_id) {
      setToast({ kind: 'error', text: 'friend_id 必須' })
      return
    }
    try {
      await aiApi.piiDeletions.create(accountId, {
        friend_id: piiInput.friend_id,
        reason: piiInput.reason,
      })
      setToast({ kind: 'success', text: 'PII 削除リクエスト作成しました' })
      setCreatingPii(false)
      setPiiInput({ friend_id: '', reason: '' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '作成失敗' })
    }
  }

  const handleUpdatePiiStatus = async (id: string, status: 'completed' | 'denied' | 'cancelled') => {
    if (!accountId) return
    if (!confirm(`このリクエストを「${status}」に更新します。よろしいですか？`)) return
    try {
      await aiApi.piiDeletions.updateStatus(accountId, id, status)
      setToast({ kind: 'success', text: '更新しました' })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '更新失敗' })
    }
  }

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="コンプライアンス" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-sm text-gray-500">アカウントを選択してください</div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="コンプライアンス" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {toast && (
          <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          <div className="bg-white border border-gray-200 rounded-md mb-4">
            <div className="border-b border-gray-200 flex">
              <button onClick={() => setTab('audit')} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${tab === 'audit' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>監査ログ</button>
              <button onClick={() => setTab('pii_deletions')} className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${tab === 'pii_deletions' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>PII 削除リクエスト</button>
            </div>
          </div>

          {tab === 'audit' && (
            <>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setFilter({})} className={`px-3 py-1.5 rounded text-sm ${!filter.result ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>すべて</button>
                <button onClick={() => setFilter({ result: 'success' })} className={`px-3 py-1.5 rounded text-sm ${filter.result === 'success' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>成功</button>
                <button onClick={() => setFilter({ result: 'failed' })} className={`px-3 py-1.5 rounded text-sm ${filter.result === 'failed' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>失敗</button>
                <button onClick={() => setFilter({ result: 'denied' })} className={`px-3 py-1.5 rounded text-sm ${filter.result === 'denied' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>拒否</button>
              </div>

              {loading ? (
                <div className="text-center py-12 text-sm text-gray-400">読み込み中…</div>
              ) : auditLogs.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-md text-center py-16 text-sm text-gray-400">監査ログなし</div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] text-gray-500 border-b border-gray-200">
                      <tr>
                        <th className="text-left py-2.5 px-3 font-medium">日時</th>
                        <th className="text-left py-2.5 px-3 font-medium">アクション</th>
                        <th className="text-left py-2.5 px-3 font-medium">リソース</th>
                        <th className="text-left py-2.5 px-3 font-medium">staff</th>
                        <th className="text-left py-2.5 px-3 font-medium">IP</th>
                        <th className="text-left py-2.5 px-3 font-medium">結果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="py-2.5 px-3 text-xs text-gray-500 whitespace-nowrap">{new Date(log.created_at).toLocaleString('ja-JP')}</td>
                          <td className="py-2.5 px-3 font-mono text-xs text-gray-900">{log.action}</td>
                          <td className="py-2.5 px-3 text-xs text-gray-500">{log.resource_type ?? '—'}{log.resource_id ? ` / ${log.resource_id.slice(0, 8)}…` : ''}</td>
                          <td className="py-2.5 px-3 text-xs text-gray-500">{log.staff_id ? log.staff_id.slice(0, 8) + '…' : '—'}</td>
                          <td className="py-2.5 px-3 text-xs text-gray-400">{log.ip_address ?? '—'}</td>
                          <td className="py-2.5 px-3"><span className={`text-[11px] px-1.5 py-0.5 rounded ${RESULT_STYLES[log.result] ?? 'bg-gray-100 text-gray-600'}`}>{log.result}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {tab === 'pii_deletions' && (
            <>
              <div className="flex justify-end mb-3">
                <button onClick={() => setCreatingPii(true)} className="bg-gray-900 text-white px-3 py-1.5 rounded text-sm hover:bg-gray-700">+ 新規削除リクエスト</button>
              </div>

              {loading ? (
                <div className="text-center py-12 text-sm text-gray-400">読み込み中…</div>
              ) : piiRequests.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-md text-center py-16 text-sm text-gray-400">
                  PII 削除リクエストなし
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-md divide-y divide-gray-100">
                  {piiRequests.map((r) => (
                    <div key={r.id} className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[11px] px-1.5 py-0.5 rounded ${STATUS_STYLES[r.status] ?? 'bg-gray-100'}`}>{r.status}</span>
                            <span className="text-[11px] text-gray-500">requested by {r.requested_by}</span>
                          </div>
                          <div className="text-sm">friend_id: <span className="font-mono text-gray-700">{r.friend_id ?? 'all'}</span></div>
                          {r.reason && <div className="text-xs text-gray-500 mt-1">理由: {r.reason}</div>}
                          <div className="text-[11px] text-gray-400 mt-1">受付: {new Date(r.requested_at).toLocaleString('ja-JP')}</div>
                        </div>
                        {r.status === 'pending' && (
                          <div className="flex gap-2">
                            <button onClick={() => handleUpdatePiiStatus(r.id, 'completed')} className="text-xs bg-gray-900 text-white px-2.5 py-1 rounded hover:bg-gray-700">承認・実行</button>
                            <button onClick={() => handleUpdatePiiStatus(r.id, 'denied')} className="text-xs bg-white border border-gray-300 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-50">拒否</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {creatingPii && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="font-medium text-base mb-4">PII 削除リクエスト作成</h3>
              <div className="space-y-2">
                <input type="text" placeholder="friend_id（必須、全削除なら空欄）" value={piiInput.friend_id} onChange={(e) => setPiiInput({ ...piiInput, friend_id: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded text-sm" />
                <textarea placeholder="削除理由（任意）" value={piiInput.reason} onChange={(e) => setPiiInput({ ...piiInput, reason: e.target.value })} className="w-full h-20 px-3 py-2 border border-gray-300 rounded text-sm" />
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setCreatingPii(false)} className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50">キャンセル</button>
                <button onClick={handleCreatePiiRequest} className="bg-gray-900 text-white px-4 py-2 rounded text-sm hover:bg-gray-700">作成</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

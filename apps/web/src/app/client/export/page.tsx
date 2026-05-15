'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '@/contexts/account-context'

const EXPORTS = [
  { type: 'friends', label: '友だちリスト', format: 'CSV', desc: '友だち全員の表示名・LINE ID・登録日時' },
  { type: 'tags', label: 'タグ一覧', format: 'CSV', desc: 'タグ名・色・作成日時' },
  { type: 'broadcasts', label: '配信履歴', format: 'CSV', desc: '配信内容・対象・配信日時・ステータス' },
  { type: 'chats', label: 'チャット履歴', format: 'CSV', desc: '対話セッションの一覧（個別メッセージは別ファイル）' },
  { type: 'scenarios', label: 'シナリオ', format: 'JSON', desc: 'シナリオ + 各ステップの設定（構造化データ）' },
  { type: 'kb', label: 'ナレッジベース', format: 'JSON', desc: 'FAQ・商品情報・マニュアル等のドキュメント' },
] as const

interface Counts {
  friends: number
  tags: number
  broadcasts: number
  chats: number
  scenarios: number
  kb_documents: number
}

export default function ClientExportPage() {
  const { selectedAccountId } = useAccount()
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  const accountId = selectedAccountId
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const apiKey = localStorage.getItem('lh_api_key') ?? ''
      const res = await fetch(`${apiUrl}/api/exports/manifest`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Line-Account-Id': accountId,
        },
      })
      const json = (await res.json()) as { success: boolean; counts: Counts }
      if (json.success) setCounts(json.counts)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [accountId, apiUrl])

  useEffect(() => {
    void load()
  }, [load])

  const handleDownload = async (type: string) => {
    if (!accountId) return
    setDownloading(type)
    try {
      const apiKey = localStorage.getItem('lh_api_key') ?? ''
      const res = await fetch(`${apiUrl}/api/exports/${type}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Line-Account-Id': accountId,
        },
      })
      if (!res.ok) {
        throw new Error('ダウンロードに失敗しました')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${type}-${new Date().toISOString().slice(0, 10)}.${type === 'scenarios' || type === 'kb' ? 'json' : 'csv'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'ダウンロード失敗')
    } finally {
      setDownloading(null)
    }
  }

  if (!accountId) {
    return <p className="text-sm text-slate-500 text-center py-20">アカウントを選択してください</p>
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold tracking-tight">データエクスポート</h1>
        <p className="text-sm text-slate-500 mt-1">
          お客様のデータは、いつでも CSV / JSON 形式で一括ダウンロードできます
        </p>
      </section>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <p className="text-xs text-emerald-900 leading-relaxed">
          <strong>🔓 囲い込みません：</strong> L-アシスト は、お客様データをいつでも持ち出せる設計です。
          解約・移行の際もダウンロードしたデータをそのまま別ツールに取り込めます。
          安心してご利用ください。
        </p>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-400">
          読み込み中…
        </div>
      ) : (
        <div className="grid gap-3">
          {EXPORTS.map((e) => {
            const count = counts ? (counts as unknown as Record<string, number>)[e.type === 'kb' ? 'kb_documents' : e.type] : 0
            return (
              <div key={e.type} className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-900">{e.label}</span>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                      {e.format}
                    </span>
                    {counts && (
                      <span className="text-xs text-slate-500">
                        {count?.toLocaleString() ?? 0} 件
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{e.desc}</p>
                </div>
                <button
                  onClick={() => handleDownload(e.type)}
                  disabled={downloading === e.type || !counts || count === 0}
                  className="text-sm bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-md font-medium shrink-0"
                >
                  {downloading === e.type ? '取得中…' : '⬇ ダウンロード'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-xs text-blue-900 leading-relaxed">
          <strong>💡 ご利用について：</strong>
          ダウンロードしたデータは個人情報を含みますので、保管・管理にはご注意ください。
          他社ツールへの移行をご検討の場合は、移行サポートも承っております（担当者まで LINE でご相談ください）。
        </p>
      </div>
    </div>
  )
}

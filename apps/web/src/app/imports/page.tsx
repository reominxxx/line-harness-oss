'use client'

import { useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

interface PreviewResult {
  success: boolean
  kind?: 'friends' | 'tags' | 'unknown'
  columnsDetected?: Record<string, number | undefined>
  header?: string[]
  totalRows?: number
  sample?: string[][]
  error?: string
}

interface ImportResult {
  success: boolean
  summary?: { created: number; updated?: number; skipped: number; errors: number }
  tagsCreated?: number
  errors?: Array<{ line: number; reason: string }>
  error?: string
}

export default function ImportsPage() {
  const { selectedAccountId } = useAccount()
  const [csvText, setCsvText] = useState('')
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''

  const fetchOpts = (method: string, body: unknown): RequestInit => {
    const apiKey = (typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') : null) ?? ''
    return {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(reader.result as string)
      setPreview(null)
      setResult(null)
    }
    reader.readAsText(file)
  }

  const handlePreview = async () => {
    if (!csvText.trim()) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`${apiUrl}/api/imports/lstep/preview`, fetchOpts('POST', { csv: csvText }))
      const json = (await res.json()) as PreviewResult
      setPreview(json)
    } catch {
      setPreview({ success: false, error: '解析に失敗しました' })
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async () => {
    if (!selectedAccountId || !preview?.kind || preview.kind === 'unknown') return
    if (!confirm(`${preview.totalRows} 件を取り込みます。よろしいですか？`)) return
    setBusy(true)
    try {
      const path = preview.kind === 'friends' ? '/api/imports/lstep/friends' : '/api/imports/lstep/tags'
      const res = await fetch(`${apiUrl}${path}`, fetchOpts('POST', { csv: csvText, accountId: selectedAccountId }))
      const json = (await res.json()) as ImportResult
      setResult(json)
    } catch (e) {
      setResult({ success: false, error: e instanceof Error ? e.message : 'import failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="データインポート" />
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="p-6 max-w-4xl mx-auto space-y-6">
          <section>
            <p className="text-sm text-gray-500">
              L ステップなど他ツールからエクスポートした CSV を取り込みます。
              <br />
              友だち / タグの 2 種類に対応。CSV のヘッダー行から自動でカラムを判定します。
            </p>
          </section>

          <section className="bg-white border border-gray-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">1. CSV を読み込む</h2>
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">ファイルから読み込み</label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  className="text-xs text-gray-700"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">または直接貼り付け</label>
                <p className="text-[11px] text-gray-400">下のテキストエリアに貼り付けでも OK</p>
              </div>
            </div>
            <textarea
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value)
                setPreview(null)
                setResult(null)
              }}
              placeholder="表示名,ユーザーID,登録日時,タグ&#10;山田太郎,U1234abcd...,2024-01-15 10:30,VIP|新規"
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-mono"
            />
            <div className="flex justify-end mt-3">
              <button
                onClick={handlePreview}
                disabled={!csvText.trim() || busy}
                className="bg-gray-900 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded disabled:bg-gray-300"
              >
                {busy && !preview ? '解析中…' : '🔍 解析（プレビュー）'}
              </button>
            </div>
          </section>

          {preview && (
            <section className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">2. 確認</h2>
              {!preview.success || preview.error ? (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm p-3 rounded">
                  {preview.error ?? '解析失敗'}
                </div>
              ) : preview.kind === 'unknown' ? (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 rounded">
                  CSV の形式を判別できませんでした。「表示名」「ユーザーID」「タグ名」のいずれかをヘッダーに含めてください。
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                      <div className="text-xs text-gray-500">種別</div>
                      <div className="text-sm font-medium text-gray-900 mt-0.5">
                        {preview.kind === 'friends' ? '👥 友だち' : '🏷 タグ'}
                      </div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                      <div className="text-xs text-gray-500">取り込み行数</div>
                      <div className="text-sm font-medium text-gray-900 mt-0.5 tabular-nums">
                        {preview.totalRows ?? 0} 件
                      </div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                      <div className="text-xs text-gray-500">対象アカウント</div>
                      <div className="text-sm font-medium text-gray-900 mt-0.5">
                        {selectedAccountId ? '選択済み' : '⚠ 未選択'}
                      </div>
                    </div>
                  </div>
                  {preview.sample && preview.sample.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-gray-500 mb-1.5">サンプル（最大 5 行）</div>
                      <div className="overflow-x-auto border border-gray-200 rounded">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              {preview.header?.map((h, i) => (
                                <th key={i} className="px-3 py-1.5 text-left font-medium text-gray-700 border-b border-gray-200">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.sample.map((row, i) => (
                              <tr key={i} className="border-b border-gray-100 last:border-0">
                                {row.map((cell, j) => (
                                  <td key={j} className="px-3 py-1.5 text-gray-700">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      onClick={handleImport}
                      disabled={busy || !selectedAccountId}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-5 py-2 rounded font-medium disabled:bg-gray-300"
                    >
                      {busy ? '取込中…' : `✓ ${preview.totalRows} 件を取り込む`}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {result && (
            <section className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">3. 完了</h2>
              {!result.success ? (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm p-3 rounded">
                  {result.error}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    {result.summary?.created !== undefined && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                        <div className="text-xs text-emerald-700">新規作成</div>
                        <div className="text-2xl font-bold text-emerald-900 tabular-nums">{result.summary.created}</div>
                      </div>
                    )}
                    {result.summary?.updated !== undefined && (
                      <div className="bg-blue-50 border border-blue-200 rounded p-3">
                        <div className="text-xs text-blue-700">更新</div>
                        <div className="text-2xl font-bold text-blue-900 tabular-nums">{result.summary.updated}</div>
                      </div>
                    )}
                    {result.summary?.skipped !== undefined && (
                      <div className="bg-gray-50 border border-gray-200 rounded p-3">
                        <div className="text-xs text-gray-500">スキップ</div>
                        <div className="text-2xl font-bold text-gray-700 tabular-nums">{result.summary.skipped}</div>
                      </div>
                    )}
                    {result.summary?.errors !== undefined && result.summary.errors > 0 && (
                      <div className="bg-rose-50 border border-rose-200 rounded p-3">
                        <div className="text-xs text-rose-700">エラー</div>
                        <div className="text-2xl font-bold text-rose-900 tabular-nums">{result.summary.errors}</div>
                      </div>
                    )}
                  </div>
                  {result.tagsCreated !== undefined && result.tagsCreated > 0 && (
                    <p className="text-xs text-gray-500 mt-2">
                      ✨ あわせて {result.tagsCreated} 個のタグを自動作成しました
                    </p>
                  )}
                  {result.errors && result.errors.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-xs text-rose-700 cursor-pointer">エラー詳細を表示</summary>
                      <ul className="text-xs text-gray-700 mt-2 space-y-1">
                        {result.errors.map((e, i) => (
                          <li key={i}>line {e.line}: {e.reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </section>
          )}

          <section className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-blue-900 mb-1.5">💡 L ステップ からのエクスポート手順</h3>
            <ol className="text-xs text-blue-900 space-y-1 list-decimal pl-5">
              <li>L ステップ管理画面で「友だち管理」→「エクスポート」</li>
              <li>「表示名」「ユーザー ID」「登録日時」「タグ」を含む CSV をダウンロード</li>
              <li>このページにアップロード / 貼り付け</li>
              <li>プレビューで内容確認後、「取り込む」をクリック</li>
            </ol>
            <p className="text-[11px] text-blue-700 mt-2">
              ※ シナリオ・配信履歴の移行は別途、担当者までご相談ください
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}

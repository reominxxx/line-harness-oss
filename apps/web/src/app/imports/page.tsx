'use client'

import { useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

interface PreviewResult {
  success: boolean
  kind?: 'friends' | 'tags' | 'broadcasts' | 'unknown'
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
  const [sourceTool, setSourceTool] = useState<SourceTool>('lstep')

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
      const path =
        preview.kind === 'friends' ? '/api/imports/lstep/friends'
        : preview.kind === 'broadcasts' ? '/api/imports/lstep/broadcasts'
        : '/api/imports/lstep/tags'
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
              他ツールからエクスポートした CSV を取り込みます。
              <br />
              友だち / タグ / 配信履歴に対応。CSV ヘッダーから自動でカラムを判定します。
            </p>
          </section>

          <ToolWizard sourceTool={sourceTool} setSourceTool={setSourceTool} />

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
                        {preview.kind === 'friends'
                          ? '👥 友だち'
                          : preview.kind === 'broadcasts'
                          ? '📨 過去の配信履歴'
                          : '🏷 タグ'}
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

                  {/* 次のアクション案内 */}
                  <div className="mt-5 pt-4 border-t border-gray-200">
                    <div className="text-xs font-semibold text-gray-700 mb-2">🚀 次にやること</div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {preview?.kind === 'friends' && (
                        <>
                          <a href="/friends" className="block bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded p-3 text-xs text-blue-900">
                            <div className="font-semibold mb-0.5">👥 友だち一覧で確認</div>
                            <div className="text-blue-700">取り込んだ友だちが表示されているか確認</div>
                          </a>
                          <a href="/broadcasts/segments" className="block bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded p-3 text-xs text-violet-900">
                            <div className="font-semibold mb-0.5">🎯 セグメント配信</div>
                            <div className="text-violet-700">業種別のカスタムセグメントに AI が自動付与</div>
                          </a>
                        </>
                      )}
                      {preview?.kind === 'tags' && (
                        <>
                          <a href="/friends" className="block bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded p-3 text-xs text-blue-900">
                            <div className="font-semibold mb-0.5">👥 タグを友だちに付与</div>
                            <div className="text-blue-700">友だち一覧から個別 or 一括でタグ付け</div>
                          </a>
                          <a href="/broadcasts" className="block bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded p-3 text-xs text-emerald-900">
                            <div className="font-semibold mb-0.5">📨 セグメント別配信を作る</div>
                            <div className="text-emerald-700">タグ指定で対象セグメントに配信</div>
                          </a>
                        </>
                      )}
                      {preview?.kind === 'broadcasts' && (
                        <>
                          <a href="/broadcasts" className="block bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded p-3 text-xs text-blue-900">
                            <div className="font-semibold mb-0.5">📨 一斉配信で内容確認</div>
                            <div className="text-blue-700">取り込んだ配信履歴を一覧で確認</div>
                          </a>
                          <a href="/ai-prompts" className="block bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded p-3 text-xs text-amber-900">
                            <div className="font-semibold mb-0.5">🎭 AI 配信設定でトーン参照</div>
                            <div className="text-amber-700">過去配信のトーンを参考に人格設定を調整</div>
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

        </div>
      </main>
    </div>
  )
}

type SourceTool = 'lstep' | 'lmessage' | 'utage' | 'proline' | 'liny' | 'micocloud' | 'autosns' | 'other'

const TOOL_INFO: Record<SourceTool, {
  label: string
  emoji: string
  steps: string[]
  notes: string[]
}> = {
  lstep: {
    label: 'L ステップ',
    emoji: '🅛',
    steps: [
      'L ステップ管理画面で「友だち管理」→「エクスポート」',
      '「表示名」「ユーザー ID」「登録日時」「タグ」を含む CSV をダウンロード',
      '配信履歴は「配信」→「配信履歴」から CSV エクスポート',
      'このページにアップロード / 貼り付け',
    ],
    notes: [
      'L ステップ プロプラン以上であれば API 連携も可能（Bridge プラン参照）',
      'シナリオの自動移行は不可、手動再構築 or 業界プレイブック適用で代替',
    ],
  },
  lmessage: {
    label: 'エルメ (L Message)',
    emoji: '💌',
    steps: [
      'エルメ管理画面で「友だちリスト」→「CSV ダウンロード」',
      '「名前」「LINE ID」「タグ」を含む CSV を取得',
      '配信履歴は「メッセージ」→「履歴」→「CSV エクスポート」',
      'このページにアップロード / 貼り付け',
    ],
    notes: [
      'エルメ公開 API は未提供（2026 年現在）→ CSV 移行のみ対応',
      'タグやランクは CSV に含まれない場合があるため、必要なら別途エクスポート',
      'シナリオ・配信予約は手動再構築が必要',
    ],
  },
  utage: {
    label: 'UTAGE',
    emoji: '🛼',
    steps: [
      'UTAGE 管理画面で「読者管理」→「読者一覧」→「CSV エクスポート」',
      '「氏名」「LINE ユーザー ID」「メールアドレス」を含む CSV をダウンロード',
      '配信履歴は「メッセージ」→「配信履歴」→「CSV」',
      'このページにアップロード / 貼り付け',
    ],
    notes: [
      'UTAGE は LINE + メアド統合読者管理 → 友だち以外の読者データは別途整理推奨',
      '公式 API は限定的、CSV 移行が確実',
      'シナリオは UTAGE 独自構造、業界プレイブック適用で代替',
    ],
  },
  proline: {
    label: 'プロライン',
    emoji: '🅿',
    steps: [
      'プロラインフリー管理画面で「友だち管理」→「友だち一覧」を開く',
      '右上の「CSV ダウンロード」から友だち情報を出力',
      '配信履歴は「メッセージ」→「配信履歴」→「CSV」ボタン',
      'このページにアップロード / 貼り付け',
    ],
    notes: [
      'プロラインの CSV ヘッダーは日本語ベース（表示名・タグ・LINE ID 等）',
      'シナリオ・テンプレートは独自構造、業界プレイブック適用で再構築',
      '有料プランの方が CSV エクスポート項目が多い',
    ],
  },
  liny: {
    label: 'Liny (リニー)',
    emoji: '🟢',
    steps: [
      'Liny 管理画面で「友だち管理」→「友だちリスト」を開く',
      '「エクスポート」ボタンから CSV ダウンロード',
      '配信履歴は「メッセージ」→「履歴」→ CSV エクスポート',
      'このページにアップロード / 貼り付け',
    ],
    notes: [
      'Liny は「友だち情報」項目をユーザー側で自由に設定できる → タグに変換',
      'スコアリングは Liny 独自仕様、業界プレイブックで近似再構築可能',
      'シナリオ（ステップ配信）の自動移行は不可、CSV を元に手動再構築',
    ],
  },
  micocloud: {
    label: 'MicoCloud',
    emoji: '☁️',
    steps: [
      'MicoCloud 管理画面で「顧客管理」→「顧客一覧」を開く',
      '一覧右上の「CSV 出力」から友だち情報を取得',
      '配信履歴は「配信」→「配信履歴」→ CSV エクスポート',
      'このページにアップロード / 貼り付け',
    ],
    notes: [
      'MicoCloud は顧客 ID と LINE ユーザー ID 双方を持つ → どちらかでマージ',
      'タグ・属性カラムが多めのため、初回プレビューで取り込み対象を絞ると安全',
      '公式 API もあるが移行は CSV が確実',
    ],
  },
  autosns: {
    label: 'AutoSNS',
    emoji: '🤖',
    steps: [
      'AutoSNS 管理画面で「LINE 連携」→「友だち管理」を開く',
      '右上「エクスポート（CSV）」をクリック',
      '配信実績は「配信」→「実績」→ CSV ダウンロード',
      'このページにアップロード / 貼り付け',
    ],
    notes: [
      'AutoSNS は Twitter/X 等の SNS と統合管理 → LINE 関連のみフィルタしてエクスポート推奨',
      'タグの命名規則がツール側で固定の場合あり、移行後にタグ整理が必要',
      'シナリオ機能は限定的、AI 配信設定で代替可',
    ],
  },
  other: {
    label: 'その他 / カスタム',
    emoji: '📋',
    steps: [
      'お使いのツールから友だち / 配信履歴 CSV をエクスポート',
      'CSV ヘッダーが日本語 / 英語どちらでも自動判定します',
      '判定できない場合は担当者までご相談ください',
      'このページにアップロード / 貼り付け',
    ],
    notes: [
      '対応カラム例: 表示名/名前/氏名 / ユーザーID/LINE ID / タグ/ラベル / 本文/内容/メッセージ',
      'カラム名が独特な場合は事前にヘッダー変更が必要なケースあり',
      '他に対応してほしいツールがあればフィードバックください',
    ],
  },
}

function ToolWizard({ sourceTool, setSourceTool }: { sourceTool: SourceTool; setSourceTool: (t: SourceTool) => void }) {
  const info = TOOL_INFO[sourceTool]
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-2">📥 移行元ツールを選んでください</h2>
      <p className="text-xs text-gray-500 mb-4">ツール固有のエクスポート手順をご案内します</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {(Object.entries(TOOL_INFO) as Array<[SourceTool, typeof TOOL_INFO[SourceTool]]>).map(([key, t]) => (
          <button
            key={key}
            onClick={() => setSourceTool(key)}
            className={`px-3 py-3 rounded text-left transition-colors border ${
              sourceTool === key
                ? 'border-gray-900 bg-gray-50'
                : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="text-lg">{t.emoji}</div>
            <div className="text-xs font-medium text-gray-900 mt-1">{t.label}</div>
          </button>
        ))}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded p-3">
        <h3 className="text-xs font-semibold text-blue-900 mb-1.5">{info.emoji} {info.label} からのエクスポート手順</h3>
        <ol className="text-xs text-blue-900 space-y-1 list-decimal pl-5">
          {info.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        {info.notes.length > 0 && (
          <ul className="text-[11px] text-blue-700 mt-2 space-y-0.5 list-disc pl-5">
            {info.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
      </div>
    </section>
  )
}

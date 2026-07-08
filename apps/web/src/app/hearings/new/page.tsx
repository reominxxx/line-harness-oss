'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

export default function HearingNewPage() {
  const router = useRouter()
  const { selectedAccountId } = useAccount()
  const [title, setTitle] = useState('')
  const [transcript, setTranscript] = useState('')
  const [csvText, setCsvText] = useState('')
  const [csvFilename, setCsvFilename] = useState<string | null>(null)
  const [homepageUrl, setHomepageUrl] = useState('')
  const [monthlyN, setMonthlyN] = useState(4)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCsvFile = (file: File | null) => {
    if (!file) {
      setCsvText('')
      setCsvFilename(null)
      return
    }
    setCsvFilename(file.name)
    const reader = new FileReader()
    reader.onload = () => setCsvText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const submit = async () => {
    if (!selectedAccountId) {
      setError('アカウントを選択してください')
      return
    }
    if (!title.trim()) { setError('タイトルを入力してください'); return }
    if (!transcript.trim() && !csvText.trim() && !homepageUrl.trim()) {
      setError('文字起こし / CSV / 公式ホームページ URL のいずれかを入力してください')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      // URL があれば worker でテキスト抽出してから transcript に統合
      let finalTranscript = transcript.trim()
      if (homepageUrl.trim()) {
        try {
          const u = homepageUrl.trim()
          if (!/^https?:\/\//.test(u)) {
            throw new Error('URL は http(s):// で始めてください')
          }
          const extracted = await fetchApi<{ success: boolean; text?: string; error?: string }>(
            '/api/prompts/extract-site-text',
            {
              method: 'POST',
              headers: { 'X-Line-Account-Id': selectedAccountId },
              body: JSON.stringify({ url: u }),
            },
          )
          if (extracted.success && extracted.text) {
            // transcript の前にサイト情報を結合 (両方ある場合は両方 AI に渡る)
            finalTranscript = (
              `【公式サイトから取得した事業情報】\n${extracted.text}\n\n`
              + (finalTranscript ? `【MTG 文字起こし / 追加情報】\n${finalTranscript}` : '')
            ).trim()
          } else {
            throw new Error(extracted.error ?? 'サイト読み込み失敗')
          }
        } catch (e) {
          throw new Error(`URL 読み込み失敗: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      const createRes = await fetchApi<{
        success: boolean; hearing?: { id: string }; error?: string
      }>('/api/hearings', {
        method: 'POST',
        headers: { 'X-Line-Account-Id': selectedAccountId },
        body: JSON.stringify({
          title: title.trim(),
          transcript_text: finalTranscript || null,
          csv_text: csvText.trim() || null,
          csv_filename: csvFilename,
        }),
      })
      if (!createRes.success || !createRes.hearing) {
        throw new Error(createRes.error || '作成に失敗しました')
      }
      const id = createRes.hearing.id
      // 生成開始 (バックグラウンドで Blueprint 生成)
      const genRes = await fetchApi<{ success: boolean; error?: string }>(
        `/api/hearings/${id}/generate`,
        {
          method: 'POST',
          headers: { 'X-Line-Account-Id': selectedAccountId },
          body: JSON.stringify({ monthly_broadcast_count: monthlyN }),
        },
      )
      if (!genRes.success) {
        throw new Error(genRes.error || '生成開始に失敗しました')
      }
      router.replace(`/hearings/detail?id=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header title="新規ヒアリング" description="文字起こし + 月の配信本数を入力すると AI が運用設計書を作成" />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-slate-900">新規ヒアリング</h1>
          <p className="text-xs text-slate-500 mt-1">
            MTG の文字起こし、ヒアリングシート CSV、月の配信本数を入力してください。
            AI が L-port 機能を最大限に活用した運用設計書を作成します。
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">タイトル</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: ABC 美容室 初回ヒアリング"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              月の配信本数 (1 本ごとの設計書も出力されます)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                value={monthlyN}
                onChange={(e) => setMonthlyN(Math.max(1, Math.min(30, parseInt(e.target.value || '4', 10))))}
                className="w-24 px-3 py-2 border border-slate-300 rounded-md text-sm text-center focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              <span className="text-sm text-slate-500">本 / 月</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              🔗 公式ホームページ URL <span className="font-normal text-slate-400">(任意 — サイトを自動取得して事業情報に追加)</span>
            </label>
            <input
              type="url"
              value={homepageUrl}
              onChange={(e) => setHomepageUrl(e.target.value)}
              placeholder="https://example.com/"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              下記の文字起こしと組み合わせて AI が解析します。URL のみでも OK。
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              MTG 文字起こし (任意。ヒアリング音声を別ツールで文字起こししたもの)
            </label>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={10}
              placeholder="例: お客様 — 来店してくださるお客様は 30 代女性が多くて..."
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {transcript.length.toLocaleString()} 文字 (60,000 字までを AI に渡します)
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              ヒアリングシート CSV (任意。事業情報の構造化データ)
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleCsvFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            {csvFilename && (
              <p className="text-[11px] text-slate-500 mt-1">
                {csvFilename} ({csvText.length.toLocaleString()} 文字)
              </p>
            )}
          </div>

          {error && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-md text-white bg-slate-900 hover:bg-slate-700 disabled:opacity-50"
            >
              {submitting ? '生成中...' : 'AI で設計書を作成'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-4 py-2 text-sm rounded-md text-slate-600 hover:text-slate-900"
            >
              キャンセル
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

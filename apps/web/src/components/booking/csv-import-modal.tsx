'use client'

import { useState } from 'react'

export interface CsvColumn<T> {
  field: keyof T
  label: string
  // CSV ヘッダーの表記ゆれ（日本語・英語）を吸収する別名
  aliases: string[]
  type: 'text' | 'number' | 'boolean'
  required?: boolean
  // 値が空のときの初期値
  defaultValue?: T[keyof T]
  // プレビュー編集欄の表示幅（grid 列を 2 つ占有するか）
  wide?: boolean
}

interface Props<T> {
  title: string
  templateFileName: string
  columns: CsvColumn<T>[]
  // パース後 1 件ずつ登録する。すでにアカウント単位の create を想定。
  onCreate: (record: Partial<T>) => Promise<unknown>
  onClose: () => void
  onImported: (created: number) => void
}

// RFC4180 準拠の最小 CSV パーサ（"" エスケープ・改行・カンマ含みフィールド対応）
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((c) => c.trim() !== '')) rows.push(row)
  }
  return rows
}

const TRUE_WORDS = ['1', 'true', 'yes', 'y', 'on', 'はい', '有効', '表示', 'o', '○', '◯']

function toBool(v: string): number {
  return TRUE_WORDS.includes(v.trim().toLowerCase()) ? 1 : 0
}

function toNumber(v: string): number | null {
  const n = parseInt(v.replace(/[^\d.-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

export default function CsvImportModal<T>({
  title,
  templateFileName,
  columns,
  onCreate,
  onClose,
  onImported,
}: Props<T>) {
  const [csvInput, setCsvInput] = useState('')
  const [drafts, setDrafts] = useState<Partial<T>[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const headerLine = columns.map((c) => c.aliases[0]).join(',')
  const templateText = `${headerLine}\n`

  const parse = () => {
    setError(null)
    const rows = parseCsv(csvInput)
    if (rows.length < 2) {
      setError('ヘッダー行とデータ行が必要です。テンプレートをご確認ください。')
      return
    }
    const header = rows[0].map((h) => h.trim().toLowerCase())
    const colIndex = new Map<keyof T, number>()
    for (const col of columns) {
      const idx = header.findIndex((h) => col.aliases.some((a) => a.toLowerCase() === h))
      if (idx >= 0) colIndex.set(col.field, idx)
    }
    const nameCol = columns.find((c) => c.required)
    if (nameCol && colIndex.get(nameCol.field) === undefined) {
      setError(`必須列「${nameCol.label}」が見つかりません。テンプレートの列名をご確認ください。`)
      return
    }

    const out: Partial<T>[] = []
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r]
      const rec: Partial<T> = {}
      let hasRequired = true
      for (const col of columns) {
        const idx = colIndex.get(col.field)
        const raw = idx === undefined ? '' : (cols[idx] ?? '').trim()
        let value: unknown
        if (col.type === 'number') {
          value = raw === '' ? col.defaultValue ?? null : toNumber(raw)
        } else if (col.type === 'boolean') {
          value = raw === '' ? col.defaultValue ?? 0 : toBool(raw)
        } else {
          value = raw === '' ? col.defaultValue ?? '' : raw
        }
        if (col.required && (value === '' || value === null || value === undefined)) {
          hasRequired = false
        }
        rec[col.field] = value as T[keyof T]
      }
      if (hasRequired) out.push(rec)
    }
    if (out.length === 0) {
      setError('有効な行が見つかりませんでした。')
      return
    }
    setDrafts(out)
  }

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + templateText], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = templateFileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const updateDraft = (i: number, field: keyof T, value: unknown) => {
    if (!drafts) return
    setDrafts(drafts.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  }
  const removeDraft = (i: number) => {
    if (!drafts) return
    setDrafts(drafts.filter((_, idx) => idx !== i))
  }

  const handleImport = async () => {
    if (!drafts || drafts.length === 0) return
    setImporting(true)
    setError(null)
    setProgress(0)
    let created = 0
    try {
      for (const d of drafts) {
        await onCreate(d)
        created++
        setProgress(created)
      }
      onImported(created)
    } catch (e) {
      setError(
        `${created} 件まで登録しました。${created + 1} 件目で失敗: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-base">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900">
            ✕
          </button>
        </div>

        {!drafts ? (
          <>
            <div className="flex-1 overflow-auto p-6">
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs font-medium text-gray-700">CSV ファイルを選択、または貼り付けて取り込みます</p>
                <button onClick={downloadTemplate} className="text-xs text-blue-600 hover:underline shrink-0">
                  記入用テンプレートをダウンロード
                </button>
              </div>

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  const reader = new FileReader()
                  reader.onload = () => setCsvInput(reader.result as string)
                  reader.readAsText(f, 'utf-8')
                }}
                className="text-xs mb-2 block"
              />
              <p className="text-[11px] text-gray-400 mb-1">または CSV を直接貼り付け:</p>
              <textarea
                value={csvInput}
                onChange={(e) => setCsvInput(e.target.value)}
                rows={8}
                placeholder={templateText}
                className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-2">
                対応列: {columns.map((c) => c.label).join(' / ')}（日本語・英語の列名どちらも自動認識）
              </p>

              {error && (
                <div className="mt-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3 rounded">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
              <button onClick={onClose} className="text-sm text-gray-600 px-3 py-1.5">
                キャンセル
              </button>
              <button
                onClick={parse}
                className="bg-gray-900 hover:bg-gray-700 text-white text-sm px-4 py-2 rounded font-medium"
              >
                解析する
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 py-3 border-b border-gray-200 bg-emerald-50 flex items-center justify-between">
              <span className="font-semibold text-emerald-900">{drafts.length} 件 読み込みました</span>
              <button
                onClick={() => { setDrafts(null); setError(null) }}
                className="text-xs text-gray-600 hover:text-gray-900"
              >
                ← CSV を選び直す
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {drafts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">行がありません</p>
              ) : (
                <div className="space-y-2">
                  {drafts.map((d, i) => (
                    <div key={i} className="bg-white border border-gray-200 rounded p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          {columns.map((col) => {
                            if (col.type === 'boolean') {
                              return (
                                <label
                                  key={String(col.field)}
                                  className={`flex items-center gap-1.5 text-xs text-gray-700 ${col.wide ? 'col-span-2' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={Boolean(d[col.field])}
                                    onChange={(e) => updateDraft(i, col.field, e.target.checked ? 1 : 0)}
                                    className="accent-green-600"
                                  />
                                  {col.label}
                                </label>
                              )
                            }
                            return (
                              <input
                                key={String(col.field)}
                                type={col.type === 'number' ? 'number' : 'text'}
                                value={(d[col.field] as string | number | null) ?? ''}
                                onChange={(e) =>
                                  updateDraft(
                                    i,
                                    col.field,
                                    col.type === 'number'
                                      ? e.target.value === '' ? null : Number(e.target.value)
                                      : e.target.value,
                                  )
                                }
                                placeholder={col.label}
                                className={`px-2 py-1 border border-gray-300 rounded text-xs ${col.wide ? 'col-span-2' : ''} ${col.required ? 'font-medium' : ''}`}
                              />
                            )
                          })}
                        </div>
                        <button
                          onClick={() => removeDraft(i)}
                          className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded shrink-0"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50">
              {error ? (
                <span className="text-xs text-rose-700">{error}</span>
              ) : (
                <span className="text-xs text-gray-500">
                  {importing ? `登録中… ${progress} / ${drafts.length}` : `${drafts.length} 件を登録します`}
                </span>
              )}
              <div className="flex gap-2">
                <button onClick={onClose} className="text-sm text-gray-600 px-3 py-1.5">
                  キャンセル
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || drafts.length === 0}
                  className="text-white text-sm px-5 py-2 rounded font-medium disabled:opacity-50"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {importing ? '登録中…' : `${drafts.length} 件を登録`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

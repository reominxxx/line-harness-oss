'use client'

import { useState } from 'react'
import { aiApi } from '@/lib/ai-api'
import { AI_ACTIONS, type AiActionKey } from '@/lib/ai-actions'
import { useAccount } from '@/contexts/account-context'

interface Props {
  action: AiActionKey
  label?: string // 上書き用
  className?: string
  /** 生成結果を受け取って画面に反映する */
  onComplete?: (output: Record<string, unknown>) => void
  /** 追加で AI に渡したい固定 input（friendId 等） */
  extraInput?: Record<string, unknown>
}

export default function AiActionButton({
  action,
  label,
  className,
  onComplete,
  extraInput,
}: Props) {
  const def = AI_ACTIONS[action]
  const { selectedAccountId } = useAccount()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string | number>>(() => {
    const init: Record<string, string | number> = {}
    for (const f of def.fields) {
      if (f.defaultValue !== undefined) init[f.key] = f.defaultValue
    }
    return init
  })
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  if (!def) {
    console.warn(`AiActionButton: unknown action "${action}"`)
    return null
  }

  const updateValue = (key: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!selectedAccountId) {
      setError('アカウントを選択してください')
      return
    }
    // バリデーション
    for (const f of def.fields) {
      if (f.required && !values[f.key]) {
        setError(`${f.label} は必須です`)
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      // agent_jobs を作成 → 即時実行
      const created = await aiApi.agentJobs.create(selectedAccountId, {
        job_type: def.jobType,
        input: { ...values, ...extraInput },
      })
      const ran = await aiApi.agentJobs.run(selectedAccountId, created.job.id)
      if (!ran.success) {
        setError(ran.error ?? '生成に失敗しました')
        return
      }
      // ジョブの結果を取得
      const fresh = await aiApi.agentJobs.get(selectedAccountId, created.job.id)
      const output = fresh.job.output_json ? (JSON.parse(fresh.job.output_json) as Record<string, unknown>) : {}
      setResult(output)
    } catch (e) {
      setError(e instanceof Error ? e.message : '失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const handleApply = () => {
    if (!result) return
    onComplete?.(result)
    handleClose()
  }

  const handleClose = () => {
    setOpen(false)
    setResult(null)
    setError(null)
    setBusy(false)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          className ??
          'bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-3 py-1.5 rounded font-medium'
        }
        title={def.description}
      >
        ✨ {label ?? def.label}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-sm">✨ {label ?? def.label}</h3>
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-900 text-lg">✕</button>
            </div>

            {!result ? (
              <>
                <div className="p-5 space-y-3">
                  <p className="text-xs text-gray-500">{def.description}</p>
                  {def.fields.map((f) => (
                    <div key={f.key}>
                      <label className="text-xs text-gray-700 block mb-1">
                        {f.label}{f.required && <span className="text-rose-500 ml-0.5">*</span>}
                      </label>
                      {f.type === 'textarea' ? (
                        <textarea
                          value={String(values[f.key] ?? '')}
                          onChange={(e) => updateValue(f.key, e.target.value)}
                          placeholder={f.placeholder}
                          rows={4}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                        />
                      ) : f.type === 'select' ? (
                        <select
                          value={String(values[f.key] ?? '')}
                          onChange={(e) => updateValue(f.key, e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-white"
                        >
                          {(f.options ?? []).map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : f.type === 'number' ? (
                        <input
                          type="number"
                          value={String(values[f.key] ?? '')}
                          onChange={(e) => updateValue(f.key, Number(e.target.value))}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                        />
                      ) : (
                        <input
                          type="text"
                          value={String(values[f.key] ?? '')}
                          onChange={(e) => updateValue(f.key, e.target.value)}
                          placeholder={f.placeholder}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                        />
                      )}
                      {f.description && <p className="text-[10px] text-gray-400 mt-0.5">{f.description}</p>}
                    </div>
                  ))}
                  {error && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs p-2 rounded">{error}</div>
                  )}
                </div>
                <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">想定 約 {def.estimatedSeconds} 秒</span>
                  <div className="flex gap-2">
                    <button onClick={handleClose} className="text-sm text-gray-600 px-3 py-1.5">キャンセル</button>
                    <button
                      onClick={handleSubmit}
                      disabled={busy}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-sm px-4 py-2 rounded font-medium"
                    >
                      {busy ? '生成中…' : '✨ 生成する'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="p-5">
                  <div className="bg-emerald-50 border border-emerald-200 rounded p-3 mb-3 text-xs text-emerald-900">
                    ✅ 生成完了。内容を確認して反映してください。
                  </div>
                  <AiResultPreview output={result} />
                  {error && (
                    <div className="mt-2 bg-rose-50 border border-rose-200 text-rose-800 text-xs p-2 rounded">{error}</div>
                  )}
                </div>
                <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
                  <button onClick={() => setResult(null)} className="text-sm text-gray-600 px-3 py-1.5">やり直す</button>
                  <button onClick={handleClose} className="text-sm border border-gray-300 text-gray-700 px-3 py-1.5 rounded">破棄</button>
                  <button
                    onClick={handleApply}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-5 py-2 rounded font-medium"
                  >✓ 反映する</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function AiResultPreview({ output }: { output: Record<string, unknown> }) {
  if ('messages' in output && Array.isArray(output.messages)) {
    const messages = output.messages as Array<{ display_name?: string; message?: string }>
    return (
      <div className="space-y-2 max-h-64 overflow-auto">
        {messages.slice(0, 5).map((m, i) => (
          <div key={i} className="bg-gray-50 border border-gray-200 p-2.5 rounded">
            {m.display_name && <div className="text-[11px] font-medium text-gray-600 mb-1">{m.display_name}</div>}
            <div className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">{m.message}</div>
          </div>
        ))}
        {messages.length > 5 && <p className="text-[10px] text-gray-400 text-center">他 {messages.length - 5} 件…</p>}
      </div>
    )
  }
  if ('content' in output) {
    return (
      <div className="bg-gray-50 border border-gray-200 p-3 rounded">
        {'title' in output && <div className="font-semibold text-sm text-gray-900 mb-2">{String(output.title)}</div>}
        <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{String(output.content)}</div>
      </div>
    )
  }
  return (
    <pre className="bg-gray-900 text-gray-100 text-xs p-3 rounded max-h-64 overflow-auto whitespace-pre-wrap">
      {JSON.stringify(output, null, 2)}
    </pre>
  )
}

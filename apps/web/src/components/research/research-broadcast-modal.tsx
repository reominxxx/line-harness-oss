'use client'

import { useState, useCallback } from 'react'
import { api } from '@/lib/api'

interface Research {
  id: string
  name: string
  description: string | null
  mainImageUrl: string | null
}

interface Props {
  open: boolean
  accountId: string
  liffId: string | null
  research: Research
  onClose: () => void
  onSent?: () => void
}

function buildResearchFlex(args: {
  title: string
  description: string
  imageUrl: string
  liffUrl: string
}): unknown {
  const { title, description, imageUrl, liffUrl } = args
  return {
    type: 'bubble',
    size: 'kilo',
    ...(imageUrl
      ? {
          hero: {
            type: 'image',
            url: imageUrl,
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
            action: { type: 'uri', uri: liffUrl },
          },
        }
      : {}),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true },
        ...(description
          ? [{ type: 'text', text: description, size: 'sm', color: '#666666', wrap: true }]
          : []),
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#06C755',
          action: { type: 'uri', label: '回答する', uri: liffUrl },
        },
      ],
    },
  }
}

export function ResearchBroadcastModal({
  open,
  accountId,
  liffId,
  research,
  onClose,
  onSent,
}: Props) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleClose = useCallback(() => {
    if (sending) return
    setError(null)
    setDone(false)
    onClose()
  }, [sending, onClose])

  const handleSend = async () => {
    if (!liffId) {
      setError('このアカウントには LIFF ID が設定されていません')
      return
    }
    setError(null)
    setSending(true)
    try {
      // LIFF URL は ?liffId=...&page=form&id=... 形式
      //   - worker の detectLiffId() が ?liffId= から LIFF ID を読み取って liff.init する
      //   - getPage() が 'form' を返し initForm(id) が起動して直接フォームを表示
      const liffUrl = `https://liff.line.me/${liffId}?liffId=${liffId}&page=form&id=${research.id}`
      const flex = buildResearchFlex({
        title: research.name,
        description: research.description ?? '',
        imageUrl: research.mainImageUrl ?? '',
        liffUrl,
      })
      const created = await api.broadcasts.create({
        title: `📋 ${research.name}`,
        messageType: 'flex',
        messageContent: JSON.stringify(flex),
        targetType: 'all',
        lineAccountId: accountId,
      })
      if (!created.success || !created.data) {
        throw new Error('配信メッセージの作成に失敗しました')
      }
      const sendRes = await api.broadcasts.send(created.data.id)
      if (!sendRes.success) {
        throw new Error('配信の送信に失敗しました')
      }
      setDone(true)
      onSent?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '配信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">リサーチを配信</h2>
          <button
            onClick={handleClose}
            disabled={sending}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {done ? (
          <div className="px-5 py-10 text-center space-y-3">
            <div className="text-4xl">✅</div>
            <h3 className="text-base font-bold text-gray-900">配信を実行しました</h3>
            <p className="text-xs text-gray-500">配信履歴は「一斉配信」ページで確認できます</p>
            <button
              onClick={handleClose}
              className="text-sm px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium"
            >
              閉じる
            </button>
          </div>
        ) : (
          <>
            <div className="px-5 py-4 space-y-4">
              {/* リサーチ概要 */}
              <div className="border border-gray-200 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 mb-1">配信するリサーチ</p>
                <div className="flex items-center gap-3">
                  {research.mainImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={research.mainImageUrl}
                      alt=""
                      className="w-14 h-14 rounded object-cover"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded bg-gray-100 flex items-center justify-center text-gray-400 text-xl">
                      📋
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{research.name}</p>
                    {research.description && (
                      <p className="text-xs text-gray-500 truncate">{research.description}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* プレビュー(Flex 風) */}
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">配信プレビュー</p>
                <div className="border border-gray-200 rounded-lg overflow-hidden max-w-xs mx-auto">
                  {research.mainImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={research.mainImageUrl}
                      alt=""
                      className="w-full h-32 object-cover"
                    />
                  )}
                  <div className="p-3">
                    <p className="font-bold text-sm">{research.name}</p>
                    {research.description && (
                      <p className="text-xs text-gray-500 mt-1">{research.description}</p>
                    )}
                  </div>
                  <div className="px-3 pb-3">
                    <div className="text-center bg-emerald-600 text-white text-sm py-2 rounded font-medium">
                      回答する
                    </div>
                  </div>
                </div>
              </div>

              {/* 注意 */}
              <p className="text-[11px] text-gray-500 leading-relaxed bg-amber-50 border border-amber-200 rounded p-2">
                ⚠ 全友だち(配信対象アカウントの全員)に Flex メッセージとして送信されます。
                送信数のカウントは「一斉配信」ページで確認できます。
              </p>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                  {error}
                </p>
              )}

              {!liffId && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  このアカウントには LIFF ID が未設定です。アカウント設定で登録してください。
                </p>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={sending}
                className="text-sm px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !liffId}
                className="text-sm px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium disabled:opacity-50"
              >
                {sending ? '配信中...' : '🚀 全友だちに配信'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

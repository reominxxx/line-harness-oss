'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function ClientLoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL
      if (!apiUrl) {
        setError('システム設定エラーです。担当者にお問い合わせください。')
        setLoading(false)
        return
      }
      // アカウント未指定でも通る /api/staff/me でキーを検証する。
      // friends/count は customer キーだとアカウント指定必須 (IDOR ガード) で、
      // ログイン時点ではアカウント未確定のため検証に使えない。
      const res = await fetch(`${apiUrl}/api/staff/me`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (res.ok) {
        localStorage.setItem('lh_api_key', apiKey)
        localStorage.setItem('lh_last_active_at', String(Date.now()))
        try {
          const profileData = await res.json()
          if (profileData.success && profileData.data) {
            localStorage.setItem('lh_staff_name', profileData.data.name)
            localStorage.setItem('lh_staff_role', profileData.data.role)
          }
        } catch {
          // best-effort
        }
        router.push('/client')
      } else {
        setError('アクセスキーが正しくありません')
      }
    } catch {
      setError('接続に失敗しました。少し時間をおいてお試しください。')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{
        fontFamily: "'Noto Sans JP', system-ui, sans-serif",
        background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)',
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 md:p-10 w-full max-w-md">
        <div className="text-center mb-7">
          <img src="/logo.png" alt="L-port" className="w-16 h-16 mx-auto mb-4" />
          <h1 className="text-xl font-bold tracking-tight text-slate-900">L-port</h1>
          <p className="text-xs text-slate-500 mt-1">お客様画面ログイン</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              アクセスキー
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="担当者から共有されたキーを入力"
              required
              autoComplete="off"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              アクセスキーは LINE で担当者からお送りしております
            </p>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2.5 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white font-medium py-3 rounded-md text-sm transition-colors"
          >
            {loading ? '確認中…' : 'ログイン'}
          </button>
        </form>

        <div className="mt-7 pt-6 border-t border-slate-100 text-center space-y-2">
          <p className="text-xs text-slate-500">アクセスキーをお忘れの場合</p>
          <a
            href="mailto:info@yohaku.co"
            className="text-xs text-slate-700 hover:text-slate-900 underline"
          >
            担当者にメールで問い合わせる
          </a>
        </div>

        <div className="mt-6 text-center">
          <Link href="/lp" className="text-[11px] text-slate-400 hover:text-slate-600">
            L-port について
          </Link>
        </div>
      </div>
    </div>
  )
}

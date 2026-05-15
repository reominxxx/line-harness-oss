'use client'

import { useState } from 'react'
import Link from 'next/link'

const INDUSTRIES = [
  '美容（美容室・ネイル・エステ）',
  '整体・治療院・パーソナルジム',
  'EC・物販',
  'スクール・教室',
  '士業（弁護士・税理士等）',
  '飲食',
  'その他',
]

const PLANS = [
  { value: 'lite', label: 'Lite（¥39,800/月）' },
  { value: 'standard', label: 'Standard（¥98,000/月）' },
  { value: 'pro', label: 'Pro（¥198,000/月）' },
  { value: 'unknown', label: 'まずは相談したい' },
]

export default function ContactPage() {
  const [form, setForm] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    industry: '',
    planInterest: 'unknown',
    message: '',
    preferredDates: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.contactName.trim() || !form.email.trim() || !form.message.trim()) {
      setError('お名前・メールアドレス・ご相談内容は必須です')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError('メールアドレスの形式が正しくありません')
      return
    }
    setSubmitting(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const res = await fetch(`${apiUrl}/api/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          source: 'lp_free_consult',
        }),
      })
      const json = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        if (res.status === 429) {
          setError('短時間に複数回の送信を検知しました。少し時間をおいてからお試しください。')
        } else {
          setError(json.error ?? '送信に失敗しました。お手数ですが再度お試しください。')
        }
        setSubmitting(false)
        return
      }
      setSubmitted(true)
    } catch {
      setError('通信エラーが発生しました。ネットワークをご確認の上、再度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4" style={{ fontFamily: "'Noto Sans JP', system-ui, sans-serif" }}>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 max-w-md w-full p-10 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-bold tracking-tight mb-3">送信が完了しました</h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            ご相談内容を確認の上、通常 1 営業日以内に<br />
            ご記入いただいたメールアドレス宛にご連絡いたします。
          </p>
          <p className="text-xs text-slate-400 mb-8">
            ご記入内容に不備があった場合は、<br />
            電話でご連絡させていただく場合がございます。
          </p>
          <Link
            href="/lp"
            className="inline-block bg-slate-900 hover:bg-slate-700 text-white px-6 py-3 rounded-md text-sm font-medium"
          >
            トップへ戻る
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Noto Sans JP', system-ui, sans-serif" }}>
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link href="/lp" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center text-white font-bold text-xs">L</div>
            <span className="font-semibold tracking-tight text-slate-900 text-sm">L-アシスト</span>
          </Link>
          <Link href="/lp" className="text-xs text-slate-500 hover:text-slate-900">← 戻る</Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-12">
        <div className="text-center mb-10">
          <p className="text-sm text-slate-500 mb-2">— 30 分の無料相談 —</p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            お気軽にご相談ください
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            導入を強引に勧めることは一切ありません。<br />
            「うちの業界で本当に成立するか」「いくらコストが下がるか」を、その場で算出します。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-5">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              お名前 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={form.contactName}
              onChange={(e) => update('contactName', e.target.value)}
              placeholder="山田 太郎"
              required
              maxLength={100}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              会社名 / 屋号
            </label>
            <input
              type="text"
              value={form.companyName}
              onChange={(e) => update('companyName', e.target.value)}
              placeholder="株式会社○○（個人事業の方は屋号でも OK）"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                メールアドレス <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="taro@example.com"
                required
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                電話番号
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="090-1234-5678"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              業種
            </label>
            <select
              value={form.industry}
              onChange={(e) => update('industry', e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white"
            >
              <option value="">選択してください</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              興味のあるプラン
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PLANS.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg cursor-pointer text-sm transition-colors ${
                    form.planInterest === p.value
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="planInterest"
                    value={p.value}
                    checked={form.planInterest === p.value}
                    onChange={(e) => update('planInterest', e.target.value)}
                    className="accent-slate-900"
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              ご相談内容 <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={form.message}
              onChange={(e) => update('message', e.target.value)}
              placeholder="現在の運用状況や、聞きたいことを自由にご記入ください。&#10;例:&#10;- 現在 L ステップを使っていて、AI で代替できるか相談したい&#10;- 月の配信が滞っているので、自動化方法を知りたい&#10;- 業界特有の対応が AI で可能か確認したい"
              rows={6}
              required
              maxLength={5000}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none"
            />
            <p className="text-[11px] text-slate-400 mt-1 text-right">
              {form.message.length} / 5000 文字
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              ご希望の MTG 日時候補
            </label>
            <textarea
              value={form.preferredDates}
              onChange={(e) => update('preferredDates', e.target.value)}
              placeholder="例:&#10;・5/20（火）14:00〜&#10;・5/22（木）10:00〜&#10;・5/23（金）16:00〜"
              rows={3}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent resize-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              候補は 3 つほどご記入いただけると、調整がスムーズです（オンライン Zoom 想定 30 分）
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 text-white font-medium py-3.5 rounded-md text-base transition-colors"
            >
              {submitting ? '送信中…' : '無料相談を申し込む'}
            </button>
            <p className="text-[11px] text-slate-400 mt-3 text-center leading-relaxed">
              送信ボタンを押すことで、当社の<a href="#" className="underline">プライバシーポリシー</a>に同意したものとみなします。<br />
              ご記入内容は無料相談の対応にのみ使用し、第三者には提供いたしません。
            </p>
          </div>
        </form>

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-500">
            メールが届かない場合: <a href="mailto:info@yohaku.co" className="underline hover:text-slate-900">info@yohaku.co</a>
          </p>
        </div>
      </main>
    </div>
  )
}

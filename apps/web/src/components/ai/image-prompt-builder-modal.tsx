'use client'

/**
 * 画像生成プロンプト構築モーダル
 *
 * 「ブランドスタイルガイド」と「どんな画像にする?」の textarea を、
 * 数項目の select / 短文入力 → Claude で良いプロンプト本文に変換するUI。
 *
 * kind=style_guide  : 業種・ブランド一言・配色・トーン・必ず/避けたい要素
 * kind=creative     : 今回の目的・主役・雰囲気・構図・季節・含めない要素
 */

import { useState } from 'react'
import { useAccount } from '@/contexts/account-context'

type Kind = 'style_guide' | 'creative'

interface Props {
  open: boolean
  kind: Kind
  onClose: () => void
  /** 生成された本文を返す */
  onApply: (text: string) => void
  /** creative の時に既存スタイルガイドも踏まえさせる */
  styleGuideText?: string
  /** creative の時の画像サイズ */
  size?: string
  /** 利用文脈。rich_menu の時は creative の「今回の目的」をリッチメニュー向けに差し替える */
  context?: 'broadcast' | 'rich_menu'
}

// ----- 選択肢 -----
const INDUSTRIES = [
  '美容 (美容室・ネイル・エステ・まつげ)',
  '整体・治療院・パーソナルジム',
  'EC・物販',
  'スクール・教室・塾',
  '士業 (弁護士・税理士・司法書士等)',
  '飲食 (カフェ・レストラン)',
  'クリニック・医療系',
  'その他',
]

const TONES = [
  '上品・清潔感',
  '親しみ・カジュアル',
  'モダン・洗練',
  'ナチュラル・優しい',
  'ポップ・元気',
  '高級感・重厚',
  'ミニマル・スタイリッシュ',
]

const PURPOSES = [
  '新メニュー / 新商品の告知',
  '期間限定キャンペーン告知',
  '友だち追加特典の案内',
  '季節の挨拶 (春夏秋冬・行事)',
  '予約リマインダー',
  'お客様の声・実績紹介',
  'ノウハウ・お役立ち情報',
  '営業時間・お知らせ',
  'その他',
]

// リッチメニュー (トーク画面下部の常設メニュー) の背景画像向け目的。
// タップ領域のボタン背景になるため、用途・世界観の指定に寄せる。
const RICH_MENU_PURPOSES = [
  'ブランドの世界観を表す背景',
  '予約・問い合わせへの誘導',
  'メニュー / 料金一覧の背景',
  'クーポン・特典の訴求',
  'キャンペーン / 期間限定の訴求',
  '季節の装飾 (春夏秋冬・行事)',
  '店舗・アクセス案内',
  'EC・商品購入への誘導',
  '会員証・マイページ向け',
  'その他',
]

const ATMOSPHERES = [
  '清潔感',
  '高級感',
  'ワクワク感',
  '落ち着き',
  '涼しさ',
  '暖かさ',
  '親しみ',
  'スピード感',
  '上質',
]

const COMPOSITIONS = [
  '中央配置 (主役を真ん中)',
  '余白多め (右側に空き)',
  'アシンメトリー (動きのある配置)',
  '俯瞰 (上から見下ろし)',
  'クローズアップ (寄り)',
  'パターン繰り返し',
]

const SEASONS = ['春', '夏', '秋', '冬', '通年']

export function ImagePromptBuilderModal({ open, kind, onClose, onApply, styleGuideText, size, context = 'broadcast' }: Props) {
  const { selectedAccount } = useAccount()
  const purposeOptions = context === 'rich_menu' ? RICH_MENU_PURPOSES : PURPOSES
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  // 共通フォーム
  const [industry, setIndustry] = useState('')
  const [brandOneLine, setBrandOneLine] = useState('')
  const [colors, setColors] = useState('')
  const [tone, setTone] = useState('')
  const [mustInclude, setMustInclude] = useState('')
  const [mustAvoid, setMustAvoid] = useState('')

  // HP 読み込み (style_guide のみ)
  const [hpUrl, setHpUrl] = useState('')
  const [hpLoading, setHpLoading] = useState(false)
  const [hpError, setHpError] = useState<string | null>(null)
  const [hpFilled, setHpFilled] = useState(false)

  // creative 固有
  const [purpose, setPurpose] = useState('')
  const [purposeDetail, setPurposeDetail] = useState('')
  const [mainSubject, setMainSubject] = useState('')
  const [atmospheres, setAtmospheres] = useState<string[]>([])
  const [composition, setComposition] = useState('')
  const [season, setSeason] = useState('')

  if (!open) return null

  const toggleAtmosphere = (a: string) => {
    setAtmospheres((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a])
  }

  async function handleLoadFromUrl() {
    if (!selectedAccount) { setHpError('アカウントが選択されていません'); return }
    if (!hpUrl.trim()) { setHpError('URL を入力してください'); return }
    setHpError(null)
    setHpFilled(false)
    setHpLoading(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
      const res = await fetch(`${apiUrl}/api/ai-generate/brand-from-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Line-Account-Id': selectedAccount.id,
        },
        body: JSON.stringify({ url: hpUrl.trim() }),
      })
      const json = (await res.json()) as {
        success: boolean
        brandOneLine?: string
        colors?: string
        industry?: string
        tone?: string
        error?: string
      }
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? '読み込みに失敗しました')
      }
      // 取得できた項目だけ流し込む (各欄は引き続き手動で修正可能)
      if (json.industry) setIndustry(json.industry)
      if (json.brandOneLine) setBrandOneLine(json.brandOneLine)
      if (json.colors) setColors(json.colors)
      if (json.tone) setTone(json.tone)
      setHpFilled(true)
    } catch (e) {
      setHpError(e instanceof Error ? e.message : '読み込み失敗')
    } finally {
      setHpLoading(false)
    }
  }

  async function handleGenerate() {
    if (!selectedAccount) { setError('アカウントが選択されていません'); return }
    setError(null)
    setGenerating(true)
    try {
      const inputs: Record<string, string | string[]> = {}
      if (kind === 'style_guide') {
        if (industry) inputs['業種'] = industry
        if (brandOneLine) inputs['ブランドの一言'] = brandOneLine
        if (colors) inputs['ブランドカラー (1〜3色)'] = colors
        if (tone) inputs['全体トーン'] = tone
        if (mustInclude) inputs['必ず入れたい要素'] = mustInclude
        if (mustAvoid) inputs['避けたい要素'] = mustAvoid
      } else {
        if (purpose) inputs['今回の目的'] = purposeDetail ? `${purpose} (${purposeDetail})` : purpose
        if (mainSubject) inputs['主役にしたいもの'] = mainSubject
        if (atmospheres.length > 0) inputs['雰囲気'] = atmospheres
        if (composition) inputs['構図'] = composition
        if (season) inputs['季節感'] = season
        if (mustInclude) inputs['含めたい要素'] = mustInclude
        if (mustAvoid) inputs['含めない要素'] = mustAvoid
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
      const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
      const res = await fetch(`${apiUrl}/api/ai-generate/image-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Line-Account-Id': selectedAccount.id,
        },
        body: JSON.stringify({ kind, inputs, size, styleGuideText }),
      })
      const json = (await res.json()) as { success: boolean; prompt?: string; error?: string }
      if (!res.ok || !json.success || !json.prompt) {
        throw new Error(json.error ?? '生成に失敗しました')
      }
      setPreview(json.prompt)
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失敗')
    } finally {
      setGenerating(false)
    }
  }

  function apply() {
    if (!preview) return
    onApply(preview)
    handleClose()
  }

  function handleClose() {
    setIndustry(''); setBrandOneLine(''); setColors(''); setTone('')
    setMustInclude(''); setMustAvoid('')
    setPurpose(''); setPurposeDetail(''); setMainSubject(''); setAtmospheres([]); setComposition(''); setSeason('')
    setHpUrl(''); setHpError(null); setHpFilled(false)
    setPreview(null); setError(null)
    onClose()
  }

  const title = kind === 'style_guide'
    ? '✨ ブランドスタイルガイドを AI が作成'
    : '✨ 画像プロンプトを AI が作成'
  const subtitle = kind === 'style_guide'
    ? '一度作れば、これからの全画像生成に毎回反映されます (再利用)'
    : '今回作りたい画像のラフ情報を入れると、gpt-image-2 向けの最適プロンプトに変換します'

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 overflow-y-auto" onClick={handleClose}>
      <div className="min-h-screen p-4 md:p-8 flex items-start justify-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-800">{title}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            </div>
            <button onClick={handleClose} className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 hover:border-slate-300 rounded">
              ✕ 閉じる
            </button>
          </div>

          {/* ----- フォーム ----- */}
          {kind === 'style_guide' ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  ホームページURL から自動入力
                  <span className="ml-1 text-[10px] text-slate-400">(任意 / 入れると下の項目を AI が埋めます)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={hpUrl}
                    onChange={(e) => setHpUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !hpLoading) { e.preventDefault(); handleLoadFromUrl() } }}
                    placeholder="例: https://your-shop.com"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleLoadFromUrl}
                    disabled={hpLoading}
                    className="shrink-0 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    {hpLoading ? '読込中…' : '🔗 読み込む'}
                  </button>
                </div>
                {hpError && <p className="text-[11px] text-rose-600">{hpError}</p>}
                {hpFilled && !hpError && (
                  <p className="text-[11px] text-emerald-700">✨ 自動入力しました。下の項目で気になる箇所は手で直せます。</p>
                )}
              </div>
              <Field label="業種">
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">選んでください</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
              <Field label="ブランドを一言で">
                <input
                  type="text"
                  value={brandOneLine}
                  onChange={(e) => setBrandOneLine(e.target.value)}
                  placeholder="例: 大人の隠れ家サロン / 親しみやすい街の整体院"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  maxLength={100}
                />
              </Field>
              <Field label="ブランドカラー (1〜3色)" help="色名でも hex でも OK">
                <input
                  type="text"
                  value={colors}
                  onChange={(e) => setColors(e.target.value)}
                  placeholder="例: ピンク #FFD0E0 + ホワイト / 深い紺 + ゴールド"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  maxLength={120}
                />
              </Field>
              <Field label="全体トーン">
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">選んでください</option>
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="必ず入れたい要素 (任意)">
                <input
                  type="text"
                  value={mustInclude}
                  onChange={(e) => setMustInclude(e.target.value)}
                  placeholder="例: 桜のモチーフ / ロゴ位置は左上 / 海の風景"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  maxLength={120}
                />
              </Field>
              <Field label="避けたい要素 (任意)">
                <input
                  type="text"
                  value={mustAvoid}
                  onChange={(e) => setMustAvoid(e.target.value)}
                  placeholder="例: 派手すぎる色 / 人物顔のクローズアップ"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  maxLength={120}
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="今回の目的">
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">選んでください</option>
                  {purposeOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {purpose && (
                  <input
                    type="text"
                    value={purposeDetail}
                    onChange={(e) => setPurposeDetail(e.target.value)}
                    placeholder="補足 (任意): 例 春の桜ラテ発売 / 友だち追加でドリンク 1 杯無料 等"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mt-2"
                    maxLength={150}
                  />
                )}
              </Field>
              <Field label="主役にしたいもの">
                <input
                  type="text"
                  value={mainSubject}
                  onChange={(e) => setMainSubject(e.target.value)}
                  placeholder="例: 商品ボトル / 桜ラテのカップ / 施術ベッドと観葉植物"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  maxLength={120}
                />
              </Field>
              <Field label="雰囲気 (複数選択 OK)">
                <div className="flex flex-wrap gap-1.5">
                  {ATMOSPHERES.map((a) => {
                    const selected = atmospheres.includes(a)
                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() => toggleAtmosphere(a)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                          selected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {a}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <Field label="構図 (任意)">
                <select
                  value={composition}
                  onChange={(e) => setComposition(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">未指定 (AIに任せる)</option>
                  {COMPOSITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="季節感 (任意)">
                <div className="flex gap-1.5">
                  {SEASONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeason(season === s ? '' : s)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        season === s
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="含めたい要素 (任意)">
                <input
                  type="text"
                  value={mustInclude}
                  onChange={(e) => setMustInclude(e.target.value)}
                  placeholder="例: 桜の花びら / 湯気 / シズル感"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  maxLength={120}
                />
              </Field>
              <Field label="含めない要素 (任意)">
                <input
                  type="text"
                  value={mustAvoid}
                  onChange={(e) => setMustAvoid(e.target.value)}
                  placeholder="例: 文字 / ロゴ / 人物の顔 / 複数商品"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  maxLength={120}
                />
              </Field>
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {generating ? '生成中…' : preview ? '🔄 別バージョンを生成' : '✨ プロンプトを作成'}
          </button>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">{error}</div>
          )}

          {preview && (
            <div className="space-y-2 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-slate-600">生成結果 (編集して使えます)</h3>
              <textarea
                value={preview}
                onChange={(e) => setPreview(e.target.value)}
                rows={8}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <button
                onClick={apply}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg"
              >
                ✓ この内容を反映
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
        {help && <span className="ml-1 text-[10px] text-slate-400">({help})</span>}
      </label>
      {children}
    </div>
  )
}

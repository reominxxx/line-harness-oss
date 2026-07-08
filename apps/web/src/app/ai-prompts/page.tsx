'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { aiApi, type PromptModuleType, type PromptModuleVersion } from '@/lib/ai-api'

interface PromptModuleConfig {
  type: PromptModuleType
  title: string
  description: string
  placeholder: string
  recommendedLength: string
}

const PROMPT_MODULES: PromptModuleConfig[] = [
  {
    type: 'industry_preset',
    title: '① 業界デフォルト',
    description: '業界・業種特有の定石、お客様像、言い回しのトーン、避けるべき表現をまとめます',
    placeholder: '例: 美容室。30-40代女性中心。料金は控えめに明示、効果断定 NG。専門用語を避け「髪のお悩み」「ご自宅でのお手入れ」など柔らかい表現を多用。',
    recommendedLength: '推奨 200〜500 字',
  },
  {
    type: 'personality',
    title: '② ブランド人格',
    description: '「中の人」のキャラクターを定義します',
    placeholder: '例：親しみやすく頼れるお姉さん的存在。お客様の悩みに寄り添い、専門知識で的確に答える。',
    recommendedLength: '推奨 100〜200 字',
  },
  {
    type: 'voice_tone',
    title: '③ しゃべり方・トーン',
    description: '敬語レベル、絵文字使い、口癖を指定します',
    placeholder: '例：ですます調をベースに。絵文字は😊と✨のみ、各メッセージ 1 個まで。改行を使って読みやすく。',
    recommendedLength: '推奨 50〜150 字',
  },
  {
    type: 'business_kb',
    title: '④ 事業・商品情報',
    description: 'サービス内容、料金、住所、営業時間など',
    placeholder: '例：当店は新宿の美容室で、カット ¥6,000〜、カラー ¥8,000〜。営業時間 10:00-20:00。定休日：火曜。',
    recommendedLength: '推奨 200〜1000 字',
  },
  {
    type: 'faq',
    title: '⑤ よくある質問と回答',
    description: 'AI がそのまま参照できる Q&A 集',
    placeholder: 'Q. 駐車場はありますか？\nA. 当店に専用駐車場はございませんが、徒歩 2 分のコインパーキングをご利用ください。\n\nQ. 予約はどうやって？\nA. このトークから「予約」とお送りいただくとご案内します。',
    recommendedLength: '推奨 5〜30 件',
  },
  {
    type: 'scenario',
    title: '⑥ シーン別対応指示',
    description: '特定の状況での対応方針を指定します',
    placeholder: '例：予約相談時は必ず日時候補を 3 つ提示する。商品紹介時は価格とリンクを併記。クレーム検知時は謝罪を最初に。',
    recommendedLength: '推奨 100〜300 字',
  },
  {
    type: 'restrictions',
    title: '⑦ 禁止事項・NG',
    description: '言ってはいけないこと、書いてはいけない表現',
    placeholder: '例：効果効能の断定表現禁止（薬機法）。競合他社の名称言及禁止。割引額は明記しない（個別交渉のため）。',
    recommendedLength: '推奨 50〜300 字',
  },
  {
    type: 'escalation',
    title: '⑧ 人にエスカレする条件',
    description: 'AI ではなく人間に対応を引き継ぐ条件',
    placeholder: '例：クレーム / 返金要求 / 医療判断が必要 / 価格交渉 / 法的問い合わせ → 即時にスタッフ通知',
    recommendedLength: '推奨 50〜200 字',
  },
  {
    type: 'internal_manual',
    title: '⑨ 社内マニュアル',
    description: 'スタッフ向けの応対手順 / 内部ルール / 運用フロー。AI も参照して一貫した応対を行います',
    placeholder: '例：\n■ 予約変更の手順\n1. 既存予約を確認\n2. 新しい日時候補を 3 つ提示\n3. 確定後、自動でリマインダー再設定\n\n■ クレーム初動\n1. まず謝罪\n2. 状況ヒアリング（事実関係のみ、判断は持ち越し）\n3. 30 分以内にスタッフへエスカレ',
    recommendedLength: '推奨 200〜1500 字',
  },
  {
    type: 'product_recommend',
    title: '⑩ 商品提案ルール',
    description: 'AI が商品データベースから商品を紹介する時の流儀・温度感を定義します',
    placeholder: `例：\n■ 提案する数\n- 1 メッセージにつき最大 2 商品まで。3 つ以上並べると押し売り感が出る\n- 1 つに絞れる時は 1 商品だけ\n\n■ 提案の仕方\n- 「これがおすすめ」と断定せず「○○ はいかがでしょうか」「ご興味があれば○○ もご覧くださいね」\n- 商品名 + 価格 + 一言の特徴、を簡潔に\n- お客様の悩みや好みに対応する形で提案 (押し売り NG)\n- 在庫切れや該当なしの時は無理に作らず「担当者よりご案内いたしますね」\n\n■ 価格表示\n- ¥X,XXX のように半角数字 + カンマ\n- 価格を文中に自然に織り込む (「○○ なら ¥3,000 から」)\n- 価格未設定の商品は価格を出さない\n\n■ 商品ページ URL\n- URL がある商品は最後に裸 URL で添える (「詳しくはこちら → https://...」)\n- マークダウンリンクではなく裸 URL`,
    recommendedLength: '推奨 200〜800 字',
  },
  {
    type: 'hearing_sheet',
    title: '⑪ ヒアリングシート',
    description: '初回 MTG で聞いた顧客像・商品・運用前提を貼り付けて、AI 全機能の知識源にします',
    placeholder: `例：\n■ 基本情報\n- 業種: 美容室 / 渋谷駅徒歩3分 / 客単価 ¥12,000\n\n■ ブランド・トーン\n- 一言で言うと: 髪質改善に強い大人向けの隠れ家サロン\n- 絵文字: 控えめ (✨ 程度)\n\n■ 顧客・ペルソナ\n- メイン層: 30-40代女性、エイジング毛悩み\n- リピーター比率: 70% / 平均利用回数: 月1回\n\n■ 商品・サービス\n- TOP5: 髪質改善トリートメント / カラー + トリートメント / カット / ...\n- 新規初回特典: 髪質診断 + トリートメント体験 ¥5,000\n\n■ 既存の運用と困りごと\n- 友だち数: 850人 / 月間配信: 2本\n- よく聞かれる質問: 営業時間 / 駐車場 / キャンセル料\n- 一番増やしたい行動: 来店予約\n\n■ KPI と目標\n- 配信頻度: 月4本\n\n■ ファネル設計\n- 初回特典: 髪質診断クーポン\n- 友だち追加経路: 店内 QR / Web からの予約後\n\n■ 運用体制\n- 緊急停止時の通知先: 担当者 LINE`,
    recommendedLength: '推奨 500〜2000 字 (ヒアリングシートをそのまま貼り付け可)',
  },
  {
    type: 'chat_examples',
    title: '⑫ 模範応答例 (Few-shot)',
    description: 'AI に「こう答えてほしい」という代表応答例を 3〜5 本入れると応答品質が大きく向上します。業界プレイブック適用時に自動投入されます。',
    placeholder: `例 1: 髪のお悩み相談\n\nお客様: 最近髪がパサつくのが気になるんですけど、何かいいケアあります？\n\n✅ 良い例:\nパサつき気になりますよね💕 季節の変わり目はとくにダメージが出やすいんです🌸\n当店人気のうるおいトリートメント (¥4,400) は、内側からしっとり質感が戻る方が多くて、自宅ケアと合わせるとさらに効果的です✨\nよろしければ次回ご来店時にお試しいただけますが、いつ頃をご検討中でしょうか？\n\n学べる点:\n- 共感を 1 文目に置く\n- 商品名 + 価格 + 効果を一気に出す\n- 質問返しは最後に 1 回だけ\n\n---\n\n例 2: ... (3〜5 本書く)`,
    recommendedLength: '推奨 1500〜4000 字 (3〜5 本)',
  },
  {
    type: 'other',
    title: '⑬ その他',
    description: '上記いずれにも当てはまらない補足情報・特記事項を自由に記入します。AI 応答時の追加の知識源として参照されます。',
    placeholder: '例：\n- 系列店舗の案内（渋谷店 / 新宿店）\n- 季節キャンペーンの注意書き\n- スタッフ間でのみ共有したい運用上の補足\n- その他、上記の枠に収まらないメモ',
    recommendedLength: '推奨 任意（必要に応じて）',
  },
]

// CSV 一括生成テンプレ: 「項目, 内容」の2列。各行の内容が AI への事業情報ヒントになる
const CSV_TEMPLATE_ROWS: { field: string; example: string }[] = [
  { field: '業種・事業内容', example: '渋谷駅徒歩3分の隠れ家美容室。20-30代女性中心、髪質改善とトリートメント特化' },
  { field: 'ブランドの雰囲気・人格', example: '親しみやすく頼れるお姉さん的存在。専門知識で的確に寄り添う' },
  { field: 'しゃべり方・トーン', example: 'ですます調。絵文字は😊✨を控えめに。改行で読みやすく' },
  { field: '主な商品・サービス・料金', example: 'カット¥6,000〜 / カラー¥8,000〜 / 髪質改善トリートメント¥4,400。営業10:00-20:00 火曜定休' },
  { field: 'よくある質問', example: 'Q.駐車場は？ A.近隣コインP利用 / Q.予約方法は？ A.トークから「予約」' },
  { field: '禁止事項・NG表現', example: '効果効能の断定NG（薬機法）。競合名の言及NG' },
  { field: '人にエスカレする条件', example: 'クレーム / 返金要求 / 価格交渉 → スタッフ通知' },
  { field: 'ターゲット顧客・ペルソナ', example: '30-40代女性、エイジング毛の悩み。リピーター比率70%' },
  { field: 'その他の補足', example: '系列店舗あり（新宿店）。季節キャンペーンは別途案内' },
]

function buildCsvTemplate(): string {
  const header = '項目,内容'
  const rows = CSV_TEMPLATE_ROWS.map((r) => `${csvCell(r.field)},${csvCell(r.example)}`)
  return [header, ...rows].join('\r\n')
}

function csvCell(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

// RFC4180 準拠の簡易パーサ（引用フィールド内のカンマ・改行に対応）
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); field = ''; rows.push(row); row = []
    } else if (ch === '\r') {
      // CRLF の CR はスキップ（次の \n で確定）
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim().length > 0))
}

interface CsvBizRow { field: string; content: string }

// 取り込んだ表（行×列の grid）を「項目・内容」ペアに変換する。
// 2 列を超える表でも 3 列目以降を捨てず、全列の情報を content に取り込む。
// ・先頭行がヘッダー（列名）の場合はそれを各セルのラベルとして使う
// ・3 列以上ある表は「ラベル: 値」形式で 1 行にまとめる（列名が無ければ値だけ連結）
function gridToBizRows(grid: string[][]): CsvBizRow[] {
  if (grid.length === 0) return []
  const [first, ...rest] = grid
  const firstCell = (first[0] ?? '').trim()
  const wide = grid.some((r) => r.length > 2)
  // 2列テンプレ（項目,内容）か、3列以上の表ならヘッダー行とみなす
  const hasHeader = /項目|item/i.test(firstCell) || wide
  const header = hasHeader ? first.map((c) => (c ?? '').trim()) : []
  const dataRows = hasHeader ? rest : grid

  return dataRows
    .map((r) => {
      const cells = r.map((c) => (c ?? '').trim())
      const field = cells[0] ?? ''
      const tail = cells.slice(1)
      let content: string
      if (header.length > 2) {
        // 列名つきで「ラベル: 値」を改行連結（空セルは除外）
        content = tail
          .map((c, i) => {
            if (!c) return ''
            const label = (header[i + 1] ?? '').trim()
            return label ? `${label}: ${c}` : c
          })
          .filter(Boolean)
          .join('\n')
      } else {
        // 2列（または列名なし）はそのまま連結
        content = tail.filter(Boolean).join(' / ')
      }
      return { field, content }
    })
    .filter((r) => r.field || r.content)
}

export default function AiPromptsPage() {
  const { selectedAccountId } = useAccount()
  const [inputMode, setInputMode] = useState<'manual' | 'csv'>('manual')
  const [activeTab, setActiveTab] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedContent, setSavedContent] = useState<Record<string, string>>({})
  const [versions, setVersions] = useState<Record<string, PromptModuleVersion | null>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [draftingProgress, setDraftingProgress] = useState<{ done: number; total: number } | null>(null)
  const [industry, setIndustry] = useState('')
  const [homepageUrl, setHomepageUrl] = useState('')
  const [extractingSite, setExtractingSite] = useState(false)
  const [csvRows, setCsvRows] = useState<CsvBizRow[]>([])
  const [csvError, setCsvError] = useState('')
  const [templatePreview, setTemplatePreview] = useState<{ type: string; template: string } | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [fallbackMessage, setFallbackMessage] = useState('')
  const [savedFallbackMessage, setSavedFallbackMessage] = useState('')
  const [savingFallback, setSavingFallback] = useState(false)
  const [unifiedPrompt, setUnifiedPrompt] = useState('')
  const [savedUnifiedPrompt, setSavedUnifiedPrompt] = useState('')
  const [generatingUnified, setGeneratingUnified] = useState(false)
  const [savingUnified, setSavingUnified] = useState(false)

  const accountId = selectedAccountId

  const loadAll = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const results = await Promise.all(
        PROMPT_MODULES.map((m) =>
          aiApi.prompts.get(accountId, m.type).catch(() => null),
        ),
      )
      const nextDrafts: Record<string, string> = {}
      const nextSaved: Record<string, string> = {}
      const nextVersions: Record<string, PromptModuleVersion | null> = {}
      results.forEach((r, i) => {
        const type = PROMPT_MODULES[i].type
        const content = r?.currentVersion?.content ?? ''
        nextDrafts[type] = content
        nextSaved[type] = content
        nextVersions[type] = r?.currentVersion ?? null
      })
      setDrafts(nextDrafts)
      setSavedContent(nextSaved)
      setVersions(nextVersions)

      const fb = await aiApi.prompts.getFallbackMessage(accountId).catch(() => null)
      const fbText = fb?.fallbackMessage ?? ''
      setFallbackMessage(fbText)
      setSavedFallbackMessage(fbText)

      const uni = await aiApi.prompts.getUnified(accountId).catch(() => null)
      const uniText = uni?.prompt ?? ''
      setUnifiedPrompt(uniText)
      setSavedUnifiedPrompt(uniText)
      if (uniText.trim()) setInputMode('csv')
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '読み込みに失敗' })
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const handleChange = (type: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [type]: value }))
  }

  const handleShowMasterTemplate = async () => {
    if (!accountId) return
    const type = PROMPT_MODULES[activeTab].type
    try {
      const res = await aiApi.prompts.masterTemplate(accountId, type)
      if (!res.template) {
        setToast({ kind: 'error', text: 'このモジュールにはマスターテンプレが設定されていません' })
        return
      }
      setTemplatePreview({ type, template: res.template })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : 'テンプレ取得失敗' })
    }
  }

  // 13 モジュールをマスターテンプレ連動で一括生成（個別入力モードのたたき台用、保存はしない）
  const generateAllModules = async (
    accountIdArg: string,
    industryText: string,
    businessHint: string | undefined,
  ) => {
    setDrafting(true)
    setDraftingProgress({ done: 0, total: PROMPT_MODULES.length })
    let totalCost = 0
    let okCount = 0
    const failures: string[] = []
    try {
      await Promise.all(
        PROMPT_MODULES.map(async (m) => {
          try {
            const result = await aiApi.prompts.draft(accountIdArg, m.type, {
              industry: industryText || '(テキスト未指定 — 補足情報を中心に判断)',
              businessHint: businessHint || undefined,
            })
            setDrafts((prev) => ({ ...prev, [m.type]: result.content }))
            totalCost += result.costYen
            okCount++
          } catch (e) {
            console.error(`[draft] ${m.type} failed:`, e)
            failures.push(m.title)
          } finally {
            setDraftingProgress((prev) =>
              prev ? { done: prev.done + 1, total: prev.total } : null,
            )
          }
        }),
      )
      if (failures.length === 0) {
        setToast({
          kind: 'success',
          text: `${okCount} モジュールの下書きを生成しました（コスト ¥${totalCost.toFixed(2)}）`,
        })
      } else {
        setToast({
          kind: 'error',
          text: `${okCount}/${PROMPT_MODULES.length} 完了 / 失敗: ${failures.join('、')}`,
        })
      }
    } finally {
      setDrafting(false)
      setDraftingProgress(null)
    }
  }

  const handleDraft = async () => {
    if (!accountId) return
    if (!industry.trim() && !homepageUrl.trim()) {
      setToast({ kind: 'error', text: '事業内容またはホームページ URL を入力してください' })
      return
    }
    const hasExisting = PROMPT_MODULES.some((m) => drafts[m.type]?.trim())
    if (hasExisting && !confirm(`既存の下書き ${PROMPT_MODULES.length} モジュールを全て上書きします。よろしいですか？`)) return

    // URL が指定されてれば、まずサイト本文を一度だけ抽出 (13 並列 fetch 防止)
    let siteHint = ''
    if (homepageUrl.trim()) {
      setExtractingSite(true)
      try {
        const u = homepageUrl.trim()
        if (!/^https?:\/\//.test(u)) {
          setToast({ kind: 'error', text: 'URL は http(s):// で始めてください' })
          setExtractingSite(false)
          return
        }
        const res = await aiApi.prompts.extractSiteText(accountId, u)
        if (res.success) {
          siteHint = res.text
        } else {
          setToast({ kind: 'error', text: `サイト読み込み失敗: ${res.error ?? 'unknown'}` })
          setExtractingSite(false)
          return
        }
      } catch (e) {
        setToast({ kind: 'error', text: `サイト読み込み失敗: ${e instanceof Error ? e.message : 'unknown'}` })
        setExtractingSite(false)
        return
      } finally {
        setExtractingSite(false)
      }
    }

    await generateAllModules(accountId, industry, siteHint || undefined)
  }

  const handleCsvFile = async (file: File) => {
    setCsvError('')
    const name = file.name.toLowerCase()
    const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls')
    try {
      if (isExcel) {
        // xlsx/xls は SheetJS で全シート読み込み → grid（行×列）に変換
        const XLSX = await import('xlsx')
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const grid: string[][] = []
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName]
          if (!sheet) continue
          const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
            header: 1,
            blankrows: false,
            defval: '',
            raw: false,
          })
          for (const r of rows) grid.push((r ?? []).map((c) => String(c ?? '')))
        }
        applyGrid(grid)
      } else {
        const text = await file.text()
        applyCsvText(text)
      }
    } catch (e) {
      setCsvRows([])
      setCsvError(e instanceof Error ? `ファイルを読み取れませんでした: ${e.message}` : 'ファイルを読み取れませんでした。')
    }
  }

  const applyCsvText = (text: string) => {
    applyGrid(parseCsv(text))
  }

  const applyGrid = (grid: string[][]) => {
    setCsvError('')
    if (grid.length === 0) {
      setCsvRows([])
      setCsvError('データを読み取れませんでした。')
      return
    }
    const parsed = gridToBizRows(grid)
    if (parsed.length === 0) {
      setCsvError('有効な行がありません。1 列目を項目名、2 列目以降を内容にしてください。')
    }
    setCsvRows(parsed)
  }

  // CSV で取り込んだ情報から、項目分割せず最適な統合プロンプトを 1 本生成する
  const handleCsvGenerate = async () => {
    if (!accountId) return
    if (csvRows.length === 0) {
      setToast({ kind: 'error', text: 'CSV を取り込んでください' })
      return
    }
    const businessInfo = csvRows
      .map((r) => `■ ${r.field || '補足'}\n${r.content}`)
      .join('\n\n')

    setGeneratingUnified(true)
    try {
      const res = await aiApi.prompts.generateUnified(accountId, businessInfo)
      if (res.success) {
        setUnifiedPrompt(res.prompt)
        setToast({ kind: 'success', text: `最適プロンプトを生成しました（コスト ¥${res.costYen.toFixed(2)}）。内容を確認して保存してください。` })
      } else {
        setToast({ kind: 'error', text: `生成失敗: ${res.error ?? 'unknown'}` })
      }
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '生成に失敗' })
    } finally {
      setGeneratingUnified(false)
    }
  }

  const handleSaveUnified = async () => {
    if (!accountId) return
    if (!unifiedPrompt.trim()) {
      setToast({ kind: 'error', text: 'プロンプトを入力または生成してください' })
      return
    }
    setSavingUnified(true)
    try {
      const res = await aiApi.prompts.saveUnified(accountId, unifiedPrompt)
      const saved = res.prompt ?? ''
      setUnifiedPrompt(saved)
      setSavedUnifiedPrompt(saved)
      setToast({ kind: 'success', text: '統合プロンプトを保存しました。AI 応答はこの内容を使います。' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存に失敗' })
    } finally {
      setSavingUnified(false)
    }
  }

  // 統合プロンプトを解除し、個別モジュール合成モードに戻す
  const handleClearUnified = async () => {
    if (!accountId) return
    if (!confirm('統合プロンプトを解除して、①〜⑬ の個別項目を使うモードに戻します。よろしいですか？')) return
    setSavingUnified(true)
    try {
      await aiApi.prompts.saveUnified(accountId, '')
      setUnifiedPrompt('')
      setSavedUnifiedPrompt('')
      setToast({ kind: 'success', text: '統合プロンプトを解除しました。個別項目を使います。' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '解除に失敗' })
    } finally {
      setSavingUnified(false)
    }
  }

  const handleSave = async () => {
    if (!accountId) {
      setToast({ kind: 'error', text: 'アカウントを選択してください' })
      return
    }
    const type = PROMPT_MODULES[activeTab].type
    const content = drafts[type] ?? ''
    if (!content.trim()) {
      setToast({ kind: 'error', text: '内容を入力してください' })
      return
    }
    setSaving(true)
    try {
      const result = await aiApi.prompts.save(accountId, type, content)
      setSavedContent((prev) => ({ ...prev, [type]: content }))
      setVersions((prev) => ({ ...prev, [type]: result.version }))
      setToast({ kind: 'success', text: `v${result.version.version} を保存しました` })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存に失敗' })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveFallback = async () => {
    if (!accountId) {
      setToast({ kind: 'error', text: 'アカウントを選択してください' })
      return
    }
    setSavingFallback(true)
    try {
      const res = await aiApi.prompts.saveFallbackMessage(accountId, fallbackMessage)
      const saved = res.fallbackMessage ?? ''
      setFallbackMessage(saved)
      setSavedFallbackMessage(saved)
      setToast({ kind: 'success', text: '固定メッセージを保存しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存に失敗' })
    } finally {
      setSavingFallback(false)
    }
  }

  const fallbackModified = fallbackMessage !== savedFallbackMessage

  const current = PROMPT_MODULES[activeTab]
  const currentDraft = drafts[current.type] ?? ''
  const isModified = currentDraft !== (savedContent[current.type] ?? '')
  const currentVersion = versions[current.type]

  if (!accountId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="AI 配信設定" />
        <main className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-500">
            <div className="text-4xl mb-2">🏷</div>
            <p>左上から LINE アカウントを選択してください</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <Header title="AI 配信設定" />
      <main className="flex-1 overflow-auto bg-gray-50 relative">
        {/* Toast */}
        {toast && (
          <div
            className={`fixed top-20 right-6 z-50 px-4 py-2 rounded-lg shadow-lg ${
              toast.kind === 'success' ? 'bg-green-600' : 'bg-red-600'
            } text-white text-sm`}
          >
            {toast.text}
          </div>
        )}

        <div className="p-6 max-w-6xl mx-auto">
          {/* 入力方式の切り替え */}
          <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setInputMode('manual')}
              className={`text-left rounded-lg border p-3 transition-colors ${
                inputMode === 'manual'
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-semibold text-gray-900">① 項目を個別に入力</div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {PROMPT_MODULES.length} の項目を 1 つずつ編集・保存する従来方式。AI 下書きで一括たたき台生成も可能。
              </p>
            </button>
            <button
              onClick={() => setInputMode('csv')}
              className={`text-left rounded-lg border p-3 transition-colors ${
                inputMode === 'csv'
                  ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-300'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-semibold text-gray-900">② CSV / Excel から一括生成</div>
              <p className="text-[11px] text-gray-500 mt-0.5">
                事業情報を CSV・Excel で取り込み、項目に分けず最適な system prompt を 1 本にまとめて生成。
              </p>
            </button>
          </div>

          {/* 個別入力モードだが統合プロンプトが有効なときの注意 */}
          {inputMode === 'manual' && savedUnifiedPrompt.trim() && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start justify-between gap-3">
              <p className="text-xs text-amber-800">
                現在「② CSV から一括生成」で作った<strong>統合プロンプトが有効</strong>です。AI 応答はそちらを使うため、
                ここで個別項目を編集・保存しても反映されません。個別項目を使うには統合プロンプトを解除してください。
              </p>
              <button
                onClick={handleClearUnified}
                disabled={savingUnified}
                className="text-xs bg-white border border-amber-300 text-amber-800 px-3 py-1.5 rounded hover:bg-amber-100 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                統合プロンプトを解除
              </button>
            </div>
          )}

          {/* ① 一括 AI 下書き (テキスト / URL) */}
          {inputMode === 'manual' && (
            <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
              <div className="mb-2">
                <h2 className="text-sm font-semibold text-gray-900">事業内容から {PROMPT_MODULES.length} モジュール一括 AI 下書き</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  テキスト・URL のどちらか (or 両方) を入力。両方あれば AI が組み合わせて参照します。生成後は各タブで確認・保存してください。
                </p>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">📝 事業内容テキスト</label>
                  <input
                    type="text"
                    placeholder="例: 渋谷駅徒歩3分の隠れ家美容室、20-30代女性中心、髪質改善とトリートメント特化、土日は前日までの予約必須"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">🔗 公式ホームページ URL <span className="font-normal text-gray-400">(任意 — 入力するとサイト本文を自動取得して文脈に追加)</span></label>
                  <input
                    type="url"
                    placeholder="https://example.com/"
                    value={homepageUrl}
                    onChange={(e) => setHomepageUrl(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                  />
                </div>
                <div className="flex items-center justify-end pt-1">
                  <button
                    onClick={handleDraft}
                    disabled={drafting || extractingSite}
                    className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:bg-gray-300 whitespace-nowrap font-medium"
                  >
                    {extractingSite
                      ? '🌐 サイト読み込み中…'
                      : drafting && draftingProgress
                        ? `生成中… ${draftingProgress.done}/${draftingProgress.total}`
                        : '✨ AI に下書きを書かせる'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ② CSV 一括生成 → 統合プロンプト */}
          {inputMode === 'csv' && (
            <>
              <div className="mb-4 bg-white border border-purple-200 rounded-lg p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">CSV / Excel から最適なプロンプトを生成</h2>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      CSV・Excel（.xlsx / .xls）で事業情報を取り込みます。1 列目を項目名、2 列目以降を内容にすれば
                      3 列以上の表でも全列の情報を取り込みます。①〜⑬ の枠に分けず、取り込んだ情報から
                      この事業に最適な system prompt を 1 本だけ生成します。
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const blob = new Blob(['﻿' + buildCsvTemplate()], { type: 'text/csv;charset=utf-8' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = 'ai_prompt_template.csv'
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="text-xs text-purple-700 hover:text-purple-900 underline whitespace-nowrap shrink-0"
                  >
                    📥 テンプレ CSV をダウンロード
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void handleCsvFile(f)
                        e.target.value = ''
                      }}
                      className="text-xs text-gray-600 file:mr-2 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-purple-100 file:text-purple-700 file:text-xs file:cursor-pointer"
                    />
                    <span className="text-[11px] text-gray-400">または下に直接貼り付け</span>
                  </div>
                  <textarea
                    placeholder={'項目,内容\n業種・事業内容,渋谷の隠れ家美容室。髪質改善特化\nブランドの雰囲気・人格,親しみやすく頼れるお姉さん的存在\n...'}
                    onChange={(e) => applyCsvText(e.target.value)}
                    className="w-full h-28 p-3 border border-gray-300 rounded font-mono text-xs focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  {csvError && <p className="text-[11px] text-red-600">{csvError}</p>}

                  {csvRows.length > 0 && (
                    <div className="border border-gray-200 rounded overflow-hidden">
                      <div className="bg-gray-50 px-3 py-1.5 text-[11px] font-medium text-gray-600">
                        取り込みプレビュー（{csvRows.length} 項目）
                      </div>
                      <div className="max-h-40 overflow-auto divide-y divide-gray-100">
                        {csvRows.map((r, i) => (
                          <div key={i} className="px-3 py-1.5 text-[11px] flex gap-2">
                            <span className="font-medium text-gray-700 shrink-0 w-40 truncate">{r.field || '(項目なし)'}</span>
                            <span className="text-gray-500 truncate">{r.content || '(内容なし)'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-1">
                    {generatingUnified && (
                      <span className="text-[11px] text-gray-500">AI が生成中です。30〜60 秒ほどお待ちください…</span>
                    )}
                    <button
                      onClick={handleCsvGenerate}
                      disabled={generatingUnified || csvRows.length === 0}
                      className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:bg-gray-300 whitespace-nowrap font-medium"
                    >
                      {generatingUnified ? '🤖 最適プロンプトを生成中…' : '✨ CSV から最適なプロンプトを生成'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 生成された統合プロンプトの確認・編集・保存 */}
              <div className="mb-6 bg-white rounded-lg shadow p-6">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-gray-900">統合プロンプト（実際に AI が使う本文）</h3>
                    <p className="text-xs text-gray-600 mt-1">
                      保存すると、AI 接客・配信生成はこの 1 本の文章を使います（①〜⑬ の個別項目は無視されます）。生成後に自由に編集できます。
                    </p>
                  </div>
                  {savedUnifiedPrompt.trim() && (
                    <span className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-700 whitespace-nowrap shrink-0">
                      ✓ このプロンプトが有効
                    </span>
                  )}
                </div>
                <textarea
                  value={unifiedPrompt}
                  onChange={(e) => setUnifiedPrompt(e.target.value)}
                  placeholder="上の「CSV から最適なプロンプトを生成」を押すと、ここに事業専用の system prompt が入ります。手入力・編集も可能です。"
                  disabled={loading || generatingUnified}
                  className="w-full h-96 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:bg-gray-100"
                />
                <div className="flex justify-between items-center mt-2">
                  <span className="text-xs text-gray-500">{unifiedPrompt.length} 字</span>
                  {unifiedPrompt !== savedUnifiedPrompt && <span className="text-xs text-orange-600">（未保存）</span>}
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleSaveUnified}
                    disabled={savingUnified || generatingUnified || !unifiedPrompt.trim() || unifiedPrompt === savedUnifiedPrompt}
                    className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {savingUnified ? '保存中...' : 'このプロンプトを保存して有効化'}
                  </button>
                  {savedUnifiedPrompt.trim() && (
                    <button
                      onClick={handleClearUnified}
                      disabled={savingUnified}
                      className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      解除して個別項目モードに戻す
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* タブナビゲーション (個別入力モードのみ) */}
          {inputMode === 'manual' && (
          <div className="bg-white rounded-lg shadow mb-4">
            <div className="border-b overflow-x-auto">
              <div className="flex">
                {PROMPT_MODULES.map((m, i) => {
                  const hasContent = !!savedContent[m.type]
                  return (
                    <button
                      key={m.type}
                      onClick={() => setActiveTab(i)}
                      className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1 ${
                        activeTab === i
                          ? 'border-blue-600 text-blue-600 bg-blue-50'
                          : 'border-transparent text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {m.title}
                      {hasContent && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 選択中のモジュール編集エリア */}
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 mb-1">{current.title}</h2>
                  <p className="text-sm text-gray-600">{current.description}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {current.type !== 'hearing_sheet' && (
                    <button
                      onClick={handleShowMasterTemplate}
                      className="text-xs text-violet-700 hover:text-violet-900 underline whitespace-nowrap"
                      title="このモジュールの最強テンプレ (骨格) を表示"
                    >
                      📐 マスターテンプレを見る
                    </button>
                  )}
                  {currentVersion && (
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 whitespace-nowrap">
                      v{currentVersion.version} ・ {new Date(currentVersion.created_at).toLocaleString('ja-JP')}
                    </span>
                  )}
                </div>
              </div>

              <textarea
                value={currentDraft}
                onChange={(e) => handleChange(current.type, e.target.value)}
                placeholder={current.placeholder}
                disabled={loading || drafting}
                className="w-full h-72 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs text-gray-500">{current.recommendedLength}</span>
                <span className="text-xs text-gray-500">
                  {currentDraft.length} 字 {isModified && <span className="text-orange-600">（未保存）</span>}
                </span>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleSave}
                  disabled={saving || !isModified || loading}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {saving ? '保存中...' : '保存（新バージョン作成）'}
                </button>
                <button
                  onClick={() =>
                    setDrafts((prev) => ({ ...prev, [current.type]: savedContent[current.type] ?? '' }))
                  }
                  disabled={!isModified}
                  className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  変更を破棄
                </button>
              </div>
            </div>
          </div>
          )}

          {/* AI が回答できない時の固定メッセージ (両モード共通) */}
          <div className="bg-white rounded-lg shadow p-6 mb-4">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900">AI が回答できない時の固定メッセージ</h3>
                <p className="text-xs text-gray-600 mt-1">
                  AI が応答を生成できなかった場合（生成エラー・タイムアウト・回答できない内容）に、お客様へ自動で返す定型文です。空欄にするとシステム既定の文面を使います。
                </p>
              </div>
              {savedFallbackMessage && (
                <span className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 whitespace-nowrap shrink-0">
                  設定中
                </span>
              )}
            </div>
            <textarea
              value={fallbackMessage}
              onChange={(e) => setFallbackMessage(e.target.value)}
              placeholder="例：お問い合わせありがとうございます。担当者より改めてご連絡いたしますので、少々お待ちくださいませ。"
              disabled={loading || savingFallback}
              maxLength={1000}
              className="w-full h-28 p-4 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-gray-500">推奨 50〜150 字（最大 1,000 字）</span>
              <span className="text-xs text-gray-500">
                {fallbackMessage.length} 字 {fallbackModified && <span className="text-orange-600">（未保存）</span>}
              </span>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSaveFallback}
                disabled={savingFallback || !fallbackModified || loading}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {savingFallback ? '保存中...' : '保存'}
              </button>
              <button
                onClick={() => setFallbackMessage(savedFallbackMessage)}
                disabled={!fallbackModified}
                className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                変更を破棄
              </button>
            </div>
          </div>

          {/* 合成プレビュー (個別入力モードのみ) */}
          {inputMode === 'manual' && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-bold text-gray-900 mb-2">AI への最終指示文（プレビュー）</h3>
            <p className="text-xs text-gray-600 mb-3">
              上で設定した {PROMPT_MODULES.length} のモジュールを順番に結合した、実際に AI へ送られる指示文です。空のモジュールはスキップされます。
            </p>
            <div className="bg-gray-900 text-gray-100 rounded p-4 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto">
              {Object.values(savedContent).every((v) => !v?.trim())
                ? '// まだ保存されたモジュールがありません'
                : PROMPT_MODULES.filter((m) => savedContent[m.type]?.trim())
                    .map((m) => `${m.title}\n${savedContent[m.type]}`)
                    .join('\n\n')}
            </div>
          </div>
          )}
        </div>

        {templatePreview && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto" onClick={() => setTemplatePreview(null)}>
            <div className="min-h-screen p-4 md:p-8 flex items-start justify-center" onClick={(e) => e.stopPropagation()}>
              <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-800">📐 マスターテンプレ — {PROMPT_MODULES.find((m) => m.type === templatePreview.type)?.title}</h2>
                    <p className="text-[11px] text-slate-500 mt-1">
                      AI に下書きを書かせる時、この骨格を維持したまま [角括弧] と例文だけが事業内容で書き換えられます。
                    </p>
                  </div>
                  <button
                    onClick={() => setTemplatePreview(null)}
                    className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg"
                  >
                    ✕
                  </button>
                </div>
                <pre className="text-xs text-slate-800 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 border border-slate-100 rounded-lg p-4 max-h-[60vh] overflow-auto">
{templatePreview.template}
                </pre>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && navigator.clipboard) {
                        navigator.clipboard.writeText(templatePreview.template)
                        setToast({ kind: 'success', text: 'テンプレをコピーしました' })
                      }
                    }}
                    className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                  >
                    📋 コピー
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

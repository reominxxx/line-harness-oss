'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { fetchApi } from '@/lib/api'

interface BridgeSettings {
  enabled: boolean
  apiTokenMasked: string | null
  hasToken: boolean
  lastSyncedAt: string | null
}

interface SegmentTagRow {
  id: string
  name: string
  criteria: string
  color: string
  is_ai_managed: number
  last_run_at: string | null
  assigned_count: number
  lstep_tag_id?: string | null
}

export default function LstepBridgePage() {
  const { selectedAccountId } = useAccount()
  const [settings, setSettings] = useState<BridgeSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pinging, setPinging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [syncingTagId, setSyncingTagId] = useState<string | null>(null)
  const [tokenDraft, setTokenDraft] = useState('')
  const [enabledDraft, setEnabledDraft] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [segments, setSegments] = useState<SegmentTagRow[]>([])

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: BridgeSettings }>(`/api/lstep/settings`, {
        headers: { 'X-Line-Account-Id': selectedAccountId },
      })
      if (res.success) {
        setSettings(res.data)
        setEnabledDraft(res.data.enabled)
      }
      const segRes = await fetchApi<{ success: boolean; items: SegmentTagRow[] }>(`/api/segment-tags`, {
        headers: { 'X-Line-Account-Id': selectedAccountId },
      })
      if (segRes.success) setSegments(segRes.items)
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : '読み込み失敗' })
    }
    setLoading(false)
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const handleSave = async () => {
    if (!selectedAccountId) return
    setSaving(true)
    try {
      const payload: { enabled: boolean; apiToken?: string } = { enabled: enabledDraft }
      if (tokenDraft.trim()) payload.apiToken = tokenDraft.trim()
      const res = await fetchApi<{ success: boolean; error?: string }>(`/api/lstep/settings`, {
        method: 'POST',
        headers: { 'X-Line-Account-Id': selectedAccountId },
        body: JSON.stringify(payload),
      })
      if (!res.success) { setToast({ kind: 'err', text: res.error ?? '保存失敗' }); return }
      setTokenDraft('')
      setToast({ kind: 'ok', text: '設定を保存しました' })
      await load()
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : '保存失敗' })
    }
    setSaving(false)
  }

  const handlePing = async () => {
    if (!selectedAccountId) return
    setPinging(true)
    try {
      const res = await fetchApi<{ success: boolean; data?: { ok: boolean; reason?: string }; error?: string }>(`/api/lstep/ping`, {
        method: 'POST',
        headers: { 'X-Line-Account-Id': selectedAccountId },
        body: JSON.stringify({ apiToken: tokenDraft.trim() || undefined }),
      })
      if (!res.success) { setToast({ kind: 'err', text: res.error ?? '疎通確認失敗' }); return }
      if (res.data?.ok) setToast({ kind: 'ok', text: '✅ L ステップ API への疎通 OK' })
      else setToast({ kind: 'err', text: `❌ 疎通失敗: ${res.data?.reason ?? '不明'}` })
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : '疎通確認失敗' })
    }
    setPinging(false)
  }

  const handleImport = async () => {
    if (!selectedAccountId) return
    if (!confirm('L ステップから友だち情報を取込みます。\n(display_name による粗マッチングで lstep_friend_id を埋めます。完全な名寄せは LINE userId 必要)')) return
    setImporting(true)
    try {
      const res = await fetchApi<{ success: boolean; data?: { imported: number; matched: number }; error?: string }>(`/api/lstep/import-friends`, {
        method: 'POST',
        headers: { 'X-Line-Account-Id': selectedAccountId },
      })
      if (!res.success) { setToast({ kind: 'err', text: res.error ?? '取込失敗' }); return }
      setToast({
        kind: 'ok',
        text: `取込完了: ${res.data?.imported ?? 0} 件処理 / ${res.data?.matched ?? 0} 件名寄せ`,
      })
      await load()
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : '取込失敗' })
    }
    setImporting(false)
  }

  const handleSyncSegment = async (tag: SegmentTagRow) => {
    if (!selectedAccountId) return
    setSyncingTagId(tag.id)
    try {
      const res = await fetchApi<{ success: boolean; data?: { lstepTagId: string; syncedCount: number; totalFriends?: number; note?: string }; error?: string }>(`/api/lstep/sync-segment/${tag.id}`, {
        method: 'POST',
        headers: { 'X-Line-Account-Id': selectedAccountId },
      })
      if (!res.success) { setToast({ kind: 'err', text: res.error ?? '同期失敗' }); return }
      const note = res.data?.note ? ` (${res.data.note})` : ''
      setToast({
        kind: 'ok',
        text: `L ステップへ同期完了: ${res.data?.syncedCount ?? 0} 人${note}`,
      })
      await load()
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : '同期失敗' })
    }
    setSyncingTagId(null)
  }

  if (!selectedAccountId) {
    return (
      <div>
        <Header title="L ステップ Bridge" />
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-sm text-gray-500">
          アカウントを選択してください
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="L ステップ Bridge"
        description="L ステップを使い続けながら、L-port の AI 機能 (セグメント自動付与・配信生成) を追加できます"
      />

      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm max-w-md ${toast.kind === 'ok' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
      )}

      <div className="grid gap-5 max-w-4xl">
        {/* Step 1: 接続設定 */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">① L ステップ API 接続</h2>
          <p className="text-xs text-gray-500 mb-4">
            L ステップの「API オプション」(¥5,500〜11,000/月) を契約後、管理画面で発行された API トークンをこちらに登録してください。
          </p>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabledDraft}
                onChange={(e) => setEnabledDraft(e.target.checked)}
                className="accent-emerald-600 w-4 h-4"
              />
              <span>Bridge モードを有効化</span>
            </label>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">L ステップ API トークン</label>
              {settings?.hasToken && (
                <div className="mb-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  現在の保存値: <span className="font-mono">{settings.apiTokenMasked}</span>
                  {settings.lastSyncedAt && (
                    <span className="ml-2 text-gray-400">最終同期: {new Date(settings.lastSyncedAt).toLocaleString('ja-JP')}</span>
                  )}
                </div>
              )}
              <input
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder={settings?.hasToken ? '(変更しない場合は空欄)' : 'Bearer トークンを貼り付け'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                L ステップ 管理画面 → API 連携 → トークン発行 で取得。Bearer 形式 (例: eyJ0eXAi…)
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中…' : '保存'}
              </button>
              <button
                onClick={handlePing}
                disabled={pinging || (!tokenDraft.trim() && !settings?.hasToken)}
                className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
              >
                {pinging ? '確認中…' : '🔌 API 疎通確認'}
              </button>
            </div>
          </div>
        </section>

        {/* Step 2: 友だち取込 */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">② 友だち情報を取込み</h2>
          <p className="text-xs text-gray-500 mb-4">
            L ステップ側の友だちリストを L-port DB に取込み、display_name で名寄せします。
            その後 ③ のセグメント同期で「L-port の AI 判定 → L ステップタグ」が反映できるようになります。
          </p>
          <button
            onClick={handleImport}
            disabled={importing || !settings?.hasToken || !settings?.enabled}
            className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
          >
            {importing ? '取込中… (数十秒かかります)' : '📥 L ステップ友だちを取込'}
          </button>
        </section>

        {/* Step 3: セグメント同期 */}
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">③ セグメントタグを L ステップへ同期</h2>
          <p className="text-xs text-gray-500 mb-4">
            L-port 上で AI 判定済のカスタムセグメント (鼻悩み / 肌乾燥 等) を、L ステップ側でもタグとして反映します。
            L ステップの配信機能から、このタグでセグメント配信できるようになります。
          </p>

          {segments.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              セグメントがまだありません。<br />
              先に <a href="/broadcasts/segments" className="text-violet-600 underline">セグメント配信</a> で AI 判定基準を作成してください。
            </p>
          ) : (
            <div className="space-y-2">
              {segments.map((tag) => (
                <div key={tag.id} className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="font-medium text-sm truncate">{tag.name}</span>
                    <span className="text-xs text-gray-500 shrink-0">{tag.assigned_count} 名</span>
                    {tag.lstep_tag_id && (
                      <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded shrink-0">
                        L ステップ済 (#{tag.lstep_tag_id})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleSyncSegment(tag)}
                    disabled={syncingTagId === tag.id || !settings?.hasToken || !settings?.enabled || tag.assigned_count === 0}
                    className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    title={tag.assigned_count === 0 ? '先に AI 判定で対象友だちを抽出してください' : 'L ステップへタグ送信'}
                  >
                    {syncingTagId === tag.id ? '同期中…' : '↗ L ステップへ同期'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 説明・注意事項 */}
        <section className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-900 leading-relaxed">
          <p className="font-semibold mb-1">💡 Phase 1 (現在) で動く機能</p>
          <ul className="list-disc list-inside space-y-0.5 ml-2">
            <li>L ステップ友だちの L-port 側 DB への取込み (名寄せ)</li>
            <li>AI セグメント判定 → L ステップタグへの自動同期</li>
            <li>L ステップトーク履歴の閲覧 (今後の AI 接客強化用)</li>
          </ul>
          <p className="font-semibold mt-3 mb-1">📅 Phase 2 (顧客確定後)</p>
          <ul className="list-disc list-inside space-y-0.5 ml-2">
            <li>AI 配信文生成 → L ステップ Messages API へ自動投入</li>
            <li>Webhook 受信 → AI 接客 → L ステップ経由で応答</li>
            <li>配信開封率の取込み + 実例ライブラリ自動投入</li>
          </ul>
          <p className="text-[11px] text-blue-700 mt-3 italic">
            ※ メッセージ送信 / シナリオ操作 / Webhook の API 仕様は L ステップ管理画面のマニュアル参照後に実装します
          </p>
        </section>

        {loading && (
          <p className="text-xs text-gray-400 text-center py-2">読み込み中…</p>
        )}
      </div>
    </div>
  )
}

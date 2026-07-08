'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { Tag } from '@line-crm/shared'
import { api, fetchApi } from '@/lib/api'
import type { FriendListItem, SegmentTagDto } from '@/lib/api'
import Header from '@/components/layout/header'
import FriendListTable from '@/components/friends/friend-list-table'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'

const ccPrompts = [
  {
    title: '友だちのセグメント分析',
    prompt: `友だち一覧のデータを分析してください。
1. タグ別の友だち数を集計
2. アクティブ率の高いセグメントを特定
3. エンゲージメントが低い層への施策を提案
レポート形式で出力してください。`,
  },
  {
    title: 'タグ一括管理',
    prompt: `友だちのタグを一括管理してください。
1. 未タグの友だちを特定
2. 行動履歴に基づいたタグ付け提案
3. 不要タグの整理
作業手順を示してください。`,
  },
]

const PAGE_SIZE = 20

type SortMode = 'recent' | 'oldest' | 'engagement'
type ResponseFilter = 'all' | 'unhandled'
type EngagementFilter = 'all' | 'hot' | 'warm' | 'light' | 'dormant'

export default function FriendsPage() {
  const { selectedAccountId } = useAccount()
  const [friends, setFriends] = useState<FriendListItem[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [selectedTagId, setSelectedTagId] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [responseFilter, setResponseFilter] = useState<ResponseFilter>('all')
  const [selectedSegmentTagId, setSelectedSegmentTagId] = useState('')
  const [engagementFilter, setEngagementFilter] = useState<EngagementFilter>('all')
  const [segmentTags, setSegmentTags] = useState<SegmentTagDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tags.list()
      if (res.success) setAllTags(res.data)
    } catch {
      // Non-blocking — tags used for filter
    }
  }, [])

  // リサーチ回答などのカスタムセグメント (軸2) を絞り込みプルダウン用に取得。
  const loadSegmentTags = useCallback(async () => {
    if (!selectedAccountId) {
      setSegmentTags([])
      return
    }
    try {
      const res = await api.segmentTags.list(selectedAccountId)
      if (res.success) setSegmentTags(res.items)
    } catch {
      // Non-blocking — segment filter is optional
    }
  }, [selectedAccountId])

  const loadFriends = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.friends.list({
        offset: String((page - 1) * PAGE_SIZE),
        limit: PAGE_SIZE,
        tagId: selectedTagId || undefined,
        accountId: selectedAccountId || undefined,
        search: searchSubmitted || undefined,
        includeChatStatus: true,
        sort: sortMode,
        handled: responseFilter === 'unhandled' ? 'unhandled' : undefined,
        segmentTagId: selectedSegmentTagId || undefined,
        engagement: engagementFilter === 'all' ? undefined : engagementFilter,
      })
      if (res.success) {
        setFriends(res.data.items)
        setTotal(res.data.total)
        setHasNextPage(res.data.hasNextPage)
      } else {
        setError(res.error)
      }
    } catch {
      setError('友だちの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [page, selectedTagId, selectedAccountId, searchSubmitted, sortMode, responseFilter, selectedSegmentTagId, engagementFilter])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  useEffect(() => {
    loadSegmentTags()
  }, [loadSegmentTags])

  // Reset the URL-style account context to page 1 in a separate effect.
  // For user-driven filter changes (search/sort/handled/tag) we reset
  // page synchronously inside the handlers below — that avoids the
  // double-fetch race where the old `page` request resolves after the
  // new `page=1` request and overwrites the correct page-1 rows.
  useEffect(() => {
    setPage(1)
  }, [selectedAccountId])

  useEffect(() => {
    loadFriends()
  }, [loadFriends])

  // Fan-out helpers: changing a filter also resets pagination synchronously,
  // so React batches both state updates into one re-render and `loadFriends`
  // fires exactly once with the new filter + page=1.
  const updateAndResetPage = (cb: () => void) => {
    cb()
    setPage(1)
  }
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    updateAndResetPage(() => setSearchSubmitted(searchInput.trim()))
  }
  // Clearing the input clears the active search even if the user doesn't
  // press 検索 again. Without this, "search Alice → clear input → change
  // tag" would keep filtering by Alice while the input box looks empty —
  // see codex feedback. Keeping a non-empty input that doesn't match
  // searchSubmitted is fine: the user is mid-edit, hasn't applied yet.
  const handleSearchInputChange = (v: string) => {
    setSearchInput(v)
    if (v.trim() === '' && searchSubmitted !== '') {
      updateAndResetPage(() => setSearchSubmitted(''))
    }
  }
  const handleSortChange = (v: SortMode) => updateAndResetPage(() => setSortMode(v))
  const handleResponseFilterChange = (v: ResponseFilter) => updateAndResetPage(() => setResponseFilter(v))
  const handleTagFilterChange = (v: string) => updateAndResetPage(() => setSelectedTagId(v))
  const handleSegmentTagFilterChange = (v: string) => updateAndResetPage(() => setSelectedSegmentTagId(v))
  const handleEngagementFilterChange = (v: EngagementFilter) => updateAndResetPage(() => setEngagementFilter(v))

  const handleSyncFromLine = async () => {
    if (!selectedAccountId || syncing) return
    setSyncing(true)
    setToast(null)
    try {
      // fetchApi は !res.ok で throw する仕様なので、ここは生 fetch を使って
      // 400 / 403 の JSON ボディ (error / hint) もそのまま受け取れるようにする。
      const url = `${process.env.NEXT_PUBLIC_API_URL}/api/friends/sync-from-line?lineAccountId=${selectedAccountId}`
      const apiKey = typeof window !== 'undefined' ? localStorage.getItem('lh_api_key') || '' : ''
      const raw = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      })
      const res = (await raw.json().catch(() => ({}))) as {
        success?: boolean
        total_followers?: number
        added?: number
        unfollowed?: number
        already_present?: number
        error?: string
        hint?: string
      }
      if (res.success) {
        setToast({
          kind: 'success',
          text: `LINE と同期しました (新規 ${res.added ?? 0} 名 / ブロック反映 ${res.unfollowed ?? 0} 名 / 計 ${res.total_followers ?? 0} 名)`,
        })
        await loadFriends()
      } else {
        // hint があれば優先表示。LINE プラン制約のときは具体的な対処が出る。
        setToast({ kind: 'error', text: res.hint ?? res.error ?? '同期に失敗しました' })
      }
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '同期に失敗しました' })
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div>
      <Header
        title="友だちリスト"
        description="友だちの検索や、詳細情報の確認ができます。"
      />

      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>
          {toast.text}
        </div>
      )}

      {/* Search + sort bar — L-step style */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            placeholder="友だち名を検索"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-h-[44px]"
          />
          <div className="flex gap-2">
            <select
              value={sortMode}
              onChange={(e) => handleSortChange(e.target.value as SortMode)}
              className="flex-1 sm:flex-none border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500 min-h-[44px]"
            >
              <option value="recent">追加新しい順</option>
              <option value="oldest">追加古い順</option>
              <option value="engagement">反応が多い順（声かけ優先）</option>
            </select>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-white text-sm font-medium min-h-[44px] whitespace-nowrap"
              style={{ backgroundColor: '#06C755' }}
            >
              検索
            </button>
          </div>
        </form>

        {/* Secondary filters — 2軸セグメント (エンゲージメント + リサーチ回答) + タグ + 対応マーク */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">エンゲージ:</label>
            <select
              className="flex-1 sm:flex-none text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={engagementFilter}
              onChange={(e) => handleEngagementFilterChange(e.target.value as EngagementFilter)}
            >
              <option value="all">すべて</option>
              <option value="hot">🔥 かなりホット</option>
              <option value="warm">🟡 見込みあり</option>
              <option value="light">🌱 ライト</option>
              <option value="dormant">💤 休眠</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">リサーチ回答:</label>
            <select
              className="flex-1 sm:flex-none text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={selectedSegmentTagId}
              onChange={(e) => handleSegmentTagFilterChange(e.target.value)}
            >
              <option value="">すべて</option>
              {segmentTags.map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">タグ:</label>
            <select
              className="flex-1 sm:flex-none text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={selectedTagId}
              onChange={(e) => handleTagFilterChange(e.target.value)}
            >
              <option value="">すべて</option>
              {allTags.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600 font-medium whitespace-nowrap">対応マーク:</label>
            <select
              className="flex-1 sm:flex-none text-xs border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={responseFilter}
              onChange={(e) => handleResponseFilterChange(e.target.value as ResponseFilter)}
            >
              <option value="all">すべて</option>
              <option value="unhandled">未対応のみ</option>
            </select>
          </div>
          <div className="flex items-center gap-3 sm:ml-auto justify-between sm:justify-end">
            <Link
              href="/broadcasts/segments"
              className="text-[11px] text-violet-600 hover:text-violet-800 underline whitespace-nowrap"
              title="セグメント配信でカスタムタグを管理"
            >
              セグメント設定
            </Link>
            <button
              type="button"
              onClick={handleSyncFromLine}
              disabled={syncing}
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-wait inline-flex items-center gap-1 whitespace-nowrap"
              title="LINE 公式アカウントから現在の友だち一覧を取得して、未登録の友だちを取り込み・ブロックを反映"
            >
              {syncing ? '🔄 同期中…' : '🔄 LINE と同期'}
            </button>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {loading ? '...' : `${total.toLocaleString('ja-JP')} 件`}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 grid grid-cols-[80px_220px_120px_1fr_280px] gap-3 animate-pulse">
              <div className="h-5 bg-gray-100 rounded w-16" />
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="h-3 bg-gray-200 rounded w-24" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-20" />
              <div className="space-y-2">
                <div className="h-3 bg-gray-100 rounded w-3/4" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
              <div className="h-5 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : (
        <FriendListTable friends={friends} allTags={allTags} onRefresh={loadFriends} />
      )}

      {!loading && total > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mt-4">
          <p className="text-sm text-gray-500">
            {((page - 1) * PAGE_SIZE) + 1}〜{Math.min(page * PAGE_SIZE, total)} 件 / 全{total.toLocaleString('ja-JP')}件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 px-1">{page} ページ</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNextPage}
              className="px-3 py-2 min-h-[44px] text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              次へ
            </button>
          </div>
        </div>
      )}

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}

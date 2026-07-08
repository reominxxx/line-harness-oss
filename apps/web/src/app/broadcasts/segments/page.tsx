'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/header'
import { api, type SegmentTagDto } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { AiTextGenerateModal } from '@/components/ai/ai-text-generate-modal'
import { AiImageGenerateModal } from '@/components/rich-menus/ai-image-generate-modal'
import { ResearchCreatorModal } from '@/components/research/research-creator-modal'
import { MultiSegmentBroadcastModal } from '@/components/research/multi-segment-broadcast-modal'

const DEFAULT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#14B8A6', // teal
  '#6366F1', // indigo
]

interface FormState {
  name: string
  criteria: string
  color: string
}

const EMPTY_FORM: FormState = {
  name: '',
  criteria: '',
  color: DEFAULT_COLORS[0],
}

const CRITERIA_PLACEHOLDER = `例: 鼻に悩みがある顧客
  - チャットで鼻 (毛穴/にきび/鼻の形/小鼻) について言及した
  - 鼻の施術メニュー (毛穴洗浄など) に関する質問をしている
  - 過去の購入履歴に鼻関連メニューがある`

export default function SegmentBroadcastsPage() {
  const router = useRouter()
  const { selectedAccountId, selectedAccount } = useAccount()
  const [tags, setTags] = useState<SegmentTagDto[]>([])
  /** エンゲージメント仮想セグメント (休眠 / ライト / 見込み / ホット)。直近30日の反応回数から
   *  サーバがその場集計。休眠=反応0(絶対)、他はアクティブ層の相対3等分。
   *  DB 非保存なので編集・削除・AI 付与は無い。 */
  const [engagementSegments, setEngagementSegments] = useState<
    Array<{ id: string; level: 'hot' | 'warm' | 'light' | 'dormant'; name: string; color: string; description: string; count: number }>
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [runningAi, setRunningAi] = useState<string | null>(null)
  const [generatingCriteria, setGeneratingCriteria] = useState(false)
  const [draftModal, setDraftModal] = useState<{ tag: SegmentTagDto; draft: string } | null>(null)
  /** AiTextGenerateModal 表示中のセグメントタグ。null なら閉じている */
  const [aiGenForTag, setAiGenForTag] = useState<SegmentTagDto | null>(null)
  /** AiImageGenerateModal 表示中のセグメントタグ */
  const [aiImageGenForTag, setAiImageGenForTag] = useState<SegmentTagDto | null>(null)
  /** リサーチ作成モーダルの表示状態 */
  const [showResearchModal, setShowResearchModal] = useState(false)
  /** 複数セグメント組み合わせ配信モーダルの表示状態 */
  const [showMultiBroadcastModal, setShowMultiBroadcastModal] = useState(false)
  const [friendsModal, setFriendsModal] = useState<{
    tag: SegmentTagDto
    friends: Array<{
      friend_id: string
      display_name: string | null
      picture_url: string | null
      confidence: number | null
      reason: string | null
      assigned_by: 'ai' | 'manual'
      assigned_at: string
    }>
  } | null>(null)
  const [loadingFriends, setLoadingFriends] = useState(false)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setLoading(true)
    setError(null)
    try {
      const [res, engRes] = await Promise.all([
        api.segmentTags.list(selectedAccountId),
        api.segmentTags.engagementCounts(selectedAccountId),
      ])
      if (res.success) setTags(res.items)
      else setError(res.error ?? 'セグメントタグの取得に失敗しました')
      if (engRes.success) setEngagementSegments(engRes.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得失敗')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  // エンゲージメント仮想セグメントを SegmentTagDto 形に変換し、複数セグメント配信
  // モーダルの選択肢として実セグメントと並べて掛け合わせられるようにする。
  const engagementAsTags: SegmentTagDto[] = engagementSegments.map((e) => ({
    id: e.id,
    line_account_id: selectedAccountId ?? '',
    name: e.name,
    criteria: e.description,
    color: e.color,
    is_ai_managed: 0,
    last_run_at: null,
    assigned_count: e.count,
    created_at: '',
    updated_at: '',
  }))

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowCreate(true)
  }

  const openEdit = (tag: SegmentTagDto) => {
    setForm({ name: tag.name, criteria: tag.criteria, color: tag.color })
    setEditingId(tag.id)
    setShowCreate(true)
  }

  const handleSave = async () => {
    if (!selectedAccountId) return
    if (!form.name.trim()) { setToast({ kind: 'error', text: 'タグ名は必須です' }); return }
    if (!form.criteria.trim()) { setToast({ kind: 'error', text: '判定基準は必須です' }); return }
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), criteria: form.criteria.trim(), color: form.color }
      const res = editingId
        ? await api.segmentTags.update(editingId, payload)
        : await api.segmentTags.create(selectedAccountId, payload)
      if (!res.success) {
        setToast({ kind: 'error', text: res.error ?? '保存に失敗しました' })
        return
      }
      setShowCreate(false)
      setForm(EMPTY_FORM)
      setEditingId(null)
      await load()
      setToast({ kind: 'success', text: editingId ? '更新しました' : '作成しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '保存失敗' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tag: SegmentTagDto) => {
    if (!confirm(`セグメント「${tag.name}」を削除しますか？\n紐づく友だち付与も全て解除されます。`)) return
    try {
      const res = await api.segmentTags.delete(tag.id)
      if (!res.success) { setToast({ kind: 'error', text: res.error ?? '削除失敗' }); return }
      await load()
      setToast({ kind: 'success', text: '削除しました' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '削除失敗' })
    }
  }

  const handleRunAi = async (tag: SegmentTagDto) => {
    if (!selectedAccountId) return
    if (!confirm(`セグメント「${tag.name}」について、AI が直近のフォロー中友だちを判定します。\n\n（既存の AI 自動付与は上書きされます。手動付与は維持されます）\nコスト目安: 数円。実行しますか？`)) return
    setRunningAi(tag.id)
    try {
      const res = await api.segmentTags.runAi(selectedAccountId, tag.id, { limit: 80 })
      if (!res.success) { setToast({ kind: 'error', text: res.error ?? 'AI判定失敗' }); return }
      setToast({
        kind: 'success',
        text: `AI 判定完了: ${res.evaluatedCount} 名を評価 → ${res.assignedCount} 名に付与 (合計 ${res.totalAssigned} 名)`,
      })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : 'AI判定失敗' })
    } finally {
      setRunningAi(null)
    }
  }

  const handleGenerateBroadcast = (tag: SegmentTagDto) => {
    // 汎用 AI 文言生成モーダル (参考文章 + 参考画像入力可) を開く
    setAiGenForTag(tag)
  }

  const handleGenerateCriteria = async () => {
    if (!selectedAccountId) return
    if (!form.name.trim()) {
      setToast({ kind: 'error', text: 'まずセグメント名を入力してください' })
      return
    }
    setGeneratingCriteria(true)
    try {
      const res = await api.segmentTags.generateCriteria(selectedAccountId, form.name.trim())
      if (!res.success || !res.criteria) {
        setToast({ kind: 'error', text: res.error ?? '生成失敗' })
        return
      }
      setForm({ ...form, criteria: res.criteria })
      setToast({ kind: 'success', text: 'AI 判定基準を生成しました (内容は編集できます)' })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '生成失敗' })
    } finally {
      setGeneratingCriteria(false)
    }
  }

  const handleViewFriends = async (tag: SegmentTagDto) => {
    setLoadingFriends(true)
    try {
      const res = await api.segmentTags.friends(tag.id)
      if (!res.success) { setToast({ kind: 'error', text: '友だち取得失敗' }); return }
      setFriendsModal({ tag, friends: res.friends })
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '取得失敗' })
    } finally {
      setLoadingFriends(false)
    }
  }

  const handleRemoveFriendFromSegment = async (friendId: string) => {
    if (!friendsModal) return
    try {
      const res = await api.segmentTags.removeFriend(friendsModal.tag.id, friendId)
      if (!res.success) { setToast({ kind: 'error', text: res.error ?? '解除失敗' }); return }
      setFriendsModal({
        ...friendsModal,
        friends: friendsModal.friends.filter((f) => f.friend_id !== friendId),
      })
      await load()
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '解除失敗' })
    }
  }

  const handleCreateBroadcastFromDraft = async () => {
    if (!draftModal || !selectedAccountId) return
    try {
      const res = await api.broadcasts.create({
        title: `${draftModal.tag.name} 向け配信`,
        messageType: 'text',
        messageContent: draftModal.draft,
        targetType: 'segment',
        targetSegmentTagId: draftModal.tag.id,
        lineAccountId: selectedAccountId,
      })
      if (!res.success) { setToast({ kind: 'error', text: res.error ?? '配信作成失敗' }); return }
      setDraftModal(null)
      setToast({ kind: 'success', text: '配信下書きを作成しました' })
      router.push(`/broadcasts?id=${res.data.id}`)
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof Error ? e.message : '配信作成失敗' })
    }
  }

  if (!selectedAccountId) {
    return (
      <div>
        <Header title="セグメント配信" />
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-sm text-gray-500">
          アカウントを選択してください
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="セグメント配信"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setShowMultiBroadcastModal(true)}
              disabled={!selectedAccountId || (tags.length === 0 && engagementAsTags.length === 0)}
              className="px-4 py-2 text-sm font-medium border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50"
              title="複数セグメントを組み合わせて配信(AND 条件)"
            >
              🚀 複数セグメントで配信
            </button>
            <button
              onClick={() => setShowResearchModal(true)}
              disabled={!selectedAccountId}
              className="px-4 py-2 text-sm font-medium border border-emerald-600 text-emerald-700 rounded-lg hover:bg-emerald-50 disabled:opacity-50"
              title="質問への回答で自動的にタグ付与する仕組みを作ります"
            >
              📋 リサーチで作成
            </button>
            <button
              onClick={openCreate}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#06C755' }}
            >
              + 新規セグメント
            </button>
          </div>
        }
      />

      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-3 py-2 rounded shadow text-white text-sm max-w-md ${toast.kind === 'success' ? 'bg-gray-900' : 'bg-rose-600'}`}>{toast.text}</div>
      )}

      <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-900">
        <p className="font-semibold mb-1">💡 セグメント配信とは？</p>
        <p className="leading-relaxed">
          「ホット / ウォーム」のような汎用的な分け方ではなく、{selectedAccount?.displayName ?? 'あなたの店舗'} に特化した本質的な顧客セグメントを作れます。<br />
          例えば美容クリニックなら「鼻悩み」「肌乾燥」「医療脱毛に興味」、整体院なら「腰痛持続」「産後ケア」など。
          ヒアリングで決めた基準を criteria に書くと、AI が会話履歴や購入履歴から自動で該当者にタグを付与します。
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* エンゲージメント軸 — 直近30日の反応回数から自動判定される仮想セグメント。
          リサーチ回答セグメントと違い、設定も AI 付与も不要で常に最新。 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-gray-800">エンゲージメント（自動）</h2>
          <span className="text-[11px] text-gray-400">
            直近30日の反応（チャット・タップ・回答・CV）から自動分類。設定不要・常に最新。
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {engagementSegments.map((seg) => (
            <div
              key={seg.id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex items-start gap-3"
            >
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0 mt-1"
                style={{ backgroundColor: seg.color }}
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-semibold text-gray-900 text-sm">{seg.name}</h3>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {seg.count.toLocaleString('ja-JP')} 名
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed line-clamp-2">
                  {seg.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <h2 className="text-sm font-semibold text-gray-800 mb-2">リサーチ回答セグメント</h2>

      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">
            {editingId ? 'セグメントを編集' : '新規セグメントを作成'}
          </h2>
          <div className="space-y-4 max-w-2xl">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">セグメント名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 鼻悩み / 肌乾燥 / 産後ケア"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={50}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-600">
                  AI 判定基準 <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={handleGenerateCriteria}
                  disabled={generatingCriteria || !form.name.trim()}
                  className="text-[11px] bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={!form.name.trim() ? 'まずセグメント名を入力してください' : 'セグメント名から AI が判定基準を生成'}
                >
                  {generatingCriteria ? '🤖 生成中…' : '🤖 セグメント名から AI 生成'}
                </button>
              </div>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
                rows={8}
                placeholder={CRITERIA_PLACEHOLDER}
                value={form.criteria}
                onChange={(e) => setForm({ ...form, criteria: e.target.value })}
                maxLength={2000}
              />
              <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                どんな会話・行動・購入履歴を持つ友だちをこのセグメントに入れるか、自然文で具体的に書いてください。<br />
                AI はこの基準を元に、各友だちのチャット・要約・購入履歴を見て判定します。
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">表示色</label>
              <div className="flex gap-2">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm({ ...form, color: c })}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${form.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '保存中…' : editingId ? '更新' : '作成'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setEditingId(null); setForm(EMPTY_FORM) }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-sm text-gray-400">読み込み中...</div>
      ) : tags.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-sm text-gray-500 mb-3">セグメントタグがまだありません</p>
          <p className="text-xs text-gray-400 mb-5">
            まずはヒアリング内容に基づいて、3〜5 個ほど作成してみましょう
          </p>
          <button
            onClick={openCreate}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 最初のセグメントを作成
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {tags.map((tag) => (
            <div key={tag.id} className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-start gap-3 flex-1">
                  <span
                    className="inline-block w-3 h-3 rounded-full shrink-0 mt-1.5"
                    style={{ backgroundColor: tag.color }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold text-gray-900">{tag.name}</h3>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {tag.assigned_count.toLocaleString('ja-JP')} 名付与中
                      </span>
                      {tag.last_run_at && (
                        <span className="text-[11px] text-gray-400">
                          最終AI判定: {new Date(tag.last_run_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-3 leading-relaxed">
                      {tag.criteria}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(tag)}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(tag)}
                    className="text-xs text-red-500 hover:text-red-700 px-2 py-1"
                  >
                    削除
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                <button
                  onClick={() => handleRunAi(tag)}
                  disabled={runningAi === tag.id}
                  className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {runningAi === tag.id ? '🤖 AI 判定中…' : '🤖 AI で自動付与'}
                </button>
                <button
                  onClick={() => handleGenerateBroadcast(tag)}
                  className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded"
                  title="参考文章 / 参考画像を渡して、このセグメント向け配信案を AI 生成"
                >
                  ✍️ 配信案を生成
                </button>
                <button
                  onClick={() => setAiImageGenForTag(tag)}
                  className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded"
                  title="このセグメント向けの配信画像 (バナー / 告知画像) を AI 生成"
                >
                  🖼️ 画像生成
                </button>
                <button
                  onClick={() => handleViewFriends(tag)}
                  disabled={loadingFriends || tag.assigned_count === 0}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  対象友だち一覧 ({tag.assigned_count})
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 配信案ドラフトモーダル */}
      {draftModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: draftModal.tag.color }} />
              <h3 className="font-semibold text-gray-900">{draftModal.tag.name} 向け配信案</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              AI が生成した配信文の下書きです。編集してから「配信下書きを作成」を押すと、このセグメント向けの配信下書きが登録されます (現在の対象者: {draftModal.tag.assigned_count.toLocaleString('ja-JP')} 名)。
              {draftModal.tag.assigned_count === 0 && (
                <span className="block mt-1 text-amber-700">
                  ⚠️ まだ対象者がいません。送信前に「🤖 AI で自動付与」を実行するか、手動で友だちを追加してください。
                </span>
              )}
            </p>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              rows={10}
              value={draftModal.draft}
              onChange={(e) => setDraftModal({ ...draftModal, draft: e.target.value })}
              maxLength={1000}
            />
            <p className="text-[11px] text-gray-400 mt-1 text-right">{draftModal.draft.length} / 1000 文字</p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleCreateBroadcastFromDraft}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg"
                style={{ backgroundColor: '#06C755' }}
              >
                配信下書きを作成 →
              </button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(draftModal.draft)
                  setToast({ kind: 'success', text: 'クリップボードにコピーしました' })
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                テキストをコピー
              </button>
              <button
                onClick={() => setDraftModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 ml-auto"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 配信案生成モーダル (参考文章 + 参考画像対応) */}
      {aiGenForTag && (
        <AiTextGenerateModal
          open={true}
          onClose={() => setAiGenForTag(null)}
          kind="broadcast.text"
          context={{
            title: `${aiGenForTag.name} 向け配信`,
            targetSegment: `${aiGenForTag.name}（${aiGenForTag.criteria}）`,
          }}
          onSelect={(text) => {
            setDraftModal({ tag: aiGenForTag, draft: text })
            setAiGenForTag(null)
          }}
          title={`${aiGenForTag.name} 向け配信案を AI に作らせる`}
        />
      )}

      {/* AI 画像生成モーダル (参考画像 / バリエーション / 修正依頼) */}
      {aiImageGenForTag && (
        <AiImageGenerateModal
          open={true}
          onClose={() => setAiImageGenForTag(null)}
          size="square"
          purpose="broadcast"
          availableSizes={['square', 'landscape', 'banner_wide', 'portrait']}
          menuName={`${aiImageGenForTag.name} 向け配信画像`}
          onSelect={async (file) => {
            if (!selectedAccountId) return
            const tag = aiImageGenForTag
            // 生成画像を R2 にアップロードして公開 URL を取得
            const reader = new FileReader()
            const dataUrl = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string)
              reader.onerror = reject
              reader.readAsDataURL(file)
            })
            const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? ''
            const apiKey = typeof window !== 'undefined' ? window.localStorage.getItem('lh_api_key') ?? '' : ''
            const upRes = await fetch(`${apiUrl}/api/images`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({ data: dataUrl, mimeType: file.type, filename: file.name }),
            })
            const upJson = (await upRes.json()) as { success: boolean; data?: { url: string }; error?: string }
            if (!upRes.ok || !upJson.success || !upJson.data?.url) {
              setToast({ kind: 'error', text: upJson.error ?? '画像アップロード失敗' })
              return
            }
            const imageUrl = upJson.data.url
            try {
              const res = await api.broadcasts.create({
                title: `${tag.name} 向け配信 (画像)`,
                messageType: 'image',
                messageContent: JSON.stringify({ originalContentUrl: imageUrl, previewImageUrl: imageUrl }),
                targetType: 'segment',
                targetSegmentTagId: tag.id,
                lineAccountId: selectedAccountId,
              })
              if (!res.success) { setToast({ kind: 'error', text: res.error ?? '配信作成失敗' }); return }
              setToast({ kind: 'success', text: '画像配信の下書きを作成しました' })
              router.push(`/broadcasts?id=${res.data.id}`)
            } catch (e) {
              setToast({ kind: 'error', text: e instanceof Error ? e.message : '配信作成失敗' })
            } finally {
              setAiImageGenForTag(null)
            }
          }}
        />
      )}

      {/* 対象友だち一覧モーダル */}
      {friendsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: friendsModal.tag.color }} />
                <h3 className="font-semibold text-gray-900">{friendsModal.tag.name} の対象友だち ({friendsModal.friends.length})</h3>
              </div>
              <button onClick={() => setFriendsModal(null)} className="text-sm text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>
            {friendsModal.friends.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">対象友だちはまだいません</p>
            ) : (
              <div className="space-y-2">
                {friendsModal.friends.map((f) => (
                  <div key={f.friend_id} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg">
                    {f.picture_url ? (
                      <img src={f.picture_url} alt="" className="w-10 h-10 rounded-full shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gray-300 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {f.display_name ?? '(no name)'}
                        </p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          f.assigned_by === 'ai'
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {f.assigned_by === 'ai' ? `🤖 AI (${f.confidence ?? '-'}%)` : '✋ 手動'}
                        </span>
                      </div>
                      {f.reason && (
                        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{f.reason}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveFriendFromSegment(f.friend_id)}
                      className="text-xs text-red-500 hover:text-red-700 shrink-0"
                    >
                      解除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* リサーチ作成モーダル */}
      {selectedAccountId && (
        <ResearchCreatorModal
          open={showResearchModal}
          accountId={selectedAccountId}
          liffId={selectedAccount?.liffId ?? null}
          onClose={() => setShowResearchModal(false)}
          onCreated={() => {
            setToast({ kind: 'success', text: 'リサーチを作成しました。セグメントが追加されています。' })
            void load()
          }}
        />
      )}

      {/* 複数セグメント組み合わせ配信モーダル */}
      {selectedAccountId && (
        <MultiSegmentBroadcastModal
          open={showMultiBroadcastModal}
          accountId={selectedAccountId}
          tags={[...engagementAsTags, ...tags]}
          onClose={() => setShowMultiBroadcastModal(false)}
          onSent={() => {
            setToast({ kind: 'success', text: '配信を実行しました' })
          }}
        />
      )}
    </div>
  )
}

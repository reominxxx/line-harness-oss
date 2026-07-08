'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, type SegmentTagDto } from '@/lib/api'

interface SegmentRule {
  type:
    | 'tag_exists'
    | 'tag_not_exists'
    | 'segment_tag_exists'
    | 'segment_tag_not_exists'
    | 'metadata_equals'
    | 'metadata_not_equals'
    | 'is_following'
    | 'link_clicked_within'
  value: string | boolean | { key: string; value: string } | { days: number; trackedLinkId?: string | null }
}

interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

interface SegmentBuilderProps {
  tags: Tag[]
  segmentTags?: SegmentTagDto[]
  accountId: string | null
  initialConditions?: SegmentCondition | null
  onApply: (conditions: SegmentCondition) => void
  /** モーダル/カードとして閉じるためのキャンセル。embedded=true なら不要 */
  onCancel?: () => void
  /** フォーム内に直接埋め込むモード: 適用/キャンセルボタン無し、変更を自動 onApply。 */
  embedded?: boolean
}

// DB に無い仮想セグメント (engagement.ts と ID/名称を一致させること)。
// 直近30日の反応数で判定。休眠=反応0(絶対)、ホット/見込み/ライト=アクティブ層を
// 反応回数で相対3等分 (上位/中位/下位)。
const ENGAGEMENT_SEGMENT_OPTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'engagement:hot', name: '🔥 かなりホット' },
  { id: 'engagement:warm', name: '🟡 見込みあり' },
  { id: 'engagement:light', name: '🌱 ライト' },
  { id: 'engagement:dormant', name: '💤 休眠' },
]

const ruleTypeLabels: Record<SegmentRule['type'], string> = {
  tag_exists: 'タグあり',
  tag_not_exists: 'タグなし',
  segment_tag_exists: 'セグメント該当',
  segment_tag_not_exists: 'セグメント非該当',
  metadata_equals: 'メタデータ一致',
  metadata_not_equals: 'メタデータ不一致',
  is_following: 'フォロー中のみ',
  link_clicked_within: 'リンクをタップした (N 日以内)',
}

export default function SegmentBuilder({ tags, segmentTags, accountId, initialConditions, onApply, onCancel, embedded = false }: SegmentBuilderProps) {
  const [operator, setOperator] = useState<'AND' | 'OR'>(initialConditions?.operator ?? 'AND')
  const [rules, setRules] = useState<SegmentRule[]>(initialConditions?.rules ?? [{ type: 'tag_exists', value: '' }])
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)

  const fetchCount = useCallback(async () => {
    const validRules = rules.filter(r => {
      if (r.type === 'is_following') return true
      if (typeof r.value === 'string') return r.value !== ''
      if (typeof r.value === 'object' && r.value !== null) return (r.value as { key: string }).key !== ''
      return false
    })
    if (validRules.length === 0) { setCount(null); return }

    setCounting(true)
    try {
      const res = await api.segments.count({ operator, rules: validRules }, accountId ?? undefined)
      if (res.success) setCount(res.count ?? 0)
    } catch { /* ignore */ }
    finally { setCounting(false) }
  }, [operator, rules, accountId])

  useEffect(() => {
    const timer = setTimeout(fetchCount, 500)
    return () => clearTimeout(timer)
  }, [fetchCount])

  // embedded モードでは「適用」ボタンを出さず、ルール変更を都度 onApply で親に流す。
  // フォーム送信時に親が最新値を参照できるようにする。
  useEffect(() => {
    if (!embedded) return
    onApply({ operator, rules })
    // onApply は親で参照同等性が変わるが、毎レンダー反映で問題ない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operator, rules, embedded])

  const updateRule = (index: number, updates: Partial<SegmentRule>) => {
    setRules(prev => prev.map((r, i) => i === index ? { ...r, ...updates } as SegmentRule : r))
  }

  const removeRule = (index: number) => {
    setRules(prev => prev.filter((_, i) => i !== index))
  }

  const addRule = () => {
    setRules(prev => [...prev, { type: 'tag_exists', value: '' }])
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">配信対象を絞り込む</h3>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value as 'AND' | 'OR')}
          className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
        >
          <option value="AND">すべて満たす (AND)</option>
          <option value="OR">いずれか満たす (OR)</option>
        </select>
      </div>

      <div className="space-y-2 mb-3">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-2 bg-white rounded border border-gray-200 p-2">
            <select
              value={rule.type}
              onChange={(e) => {
                const type = e.target.value as SegmentRule['type']
                const defaultValue = type === 'is_following' ? true
                  : (type === 'metadata_equals' || type === 'metadata_not_equals') ? { key: '', value: '' }
                  : ''
                updateRule(i, { type, value: defaultValue })
              }}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white min-w-[120px]"
            >
              {Object.entries(ruleTypeLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>

            {(rule.type === 'tag_exists' || rule.type === 'tag_not_exists') && (
              <select
                value={typeof rule.value === 'string' ? rule.value : ''}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white flex-1"
              >
                <option value="">タグを選択...</option>
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}

            {(rule.type === 'segment_tag_exists' || rule.type === 'segment_tag_not_exists') && (
              <select
                value={typeof rule.value === 'string' ? rule.value : ''}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white flex-1"
              >
                <option value="">セグメントを選択...</option>
                <optgroup label="エンゲージメント (自動)">
                  {ENGAGEMENT_SEGMENT_OPTIONS.map(es => <option key={es.id} value={es.id}>{es.name}</option>)}
                </optgroup>
                {(segmentTags ?? []).length > 0 && (
                  <optgroup label="アンケート / リサーチ回答">
                    {(segmentTags ?? []).map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </optgroup>
                )}
              </select>
            )}

            {(rule.type === 'metadata_equals' || rule.type === 'metadata_not_equals') && (
              <>
                <input
                  type="text"
                  placeholder="key"
                  value={typeof rule.value === 'object' && rule.value !== null ? (rule.value as { key: string }).key : ''}
                  onChange={(e) => updateRule(i, { value: { key: e.target.value, value: typeof rule.value === 'object' && rule.value !== null ? (rule.value as { value: string }).value : '' } })}
                  className="text-xs border border-gray-300 rounded px-2 py-1 w-24"
                />
                <input
                  type="text"
                  placeholder="value"
                  value={typeof rule.value === 'object' && rule.value !== null ? (rule.value as { value: string }).value : ''}
                  onChange={(e) => updateRule(i, { value: { key: typeof rule.value === 'object' && rule.value !== null ? (rule.value as { key: string }).key : '', value: e.target.value } })}
                  className="text-xs border border-gray-300 rounded px-2 py-1 w-24"
                />
              </>
            )}

            {rule.type !== 'is_following' && (
              <button type="button" onClick={() => removeRule(i)} className="text-red-400 hover:text-red-600 text-xs px-1 shrink-0">×</button>
            )}
          </div>
        ))}
      </div>

      {tags.length === 0 && (segmentTags ?? []).length === 0 && (
        <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          タグ・セグメントがまだありません。
          <a href="/tags" className="underline mx-1">タグ管理</a>
          または
          <a href="/segment-tags" className="underline mx-1">セグメント管理</a>
          から作成してください。
        </div>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={addRule} className="text-xs text-blue-500 hover:text-blue-700">+ ルール追加</button>
        <span className="text-xs text-gray-500">
          {counting ? '計算中...' : count != null ? `該当: ${count.toLocaleString('ja-JP')}人` : ''}
        </span>
      </div>

      {!embedded && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200">
          <button
            type="button"
            onClick={() => onApply({ operator, rules })}
            className="px-3 py-1.5 min-h-[44px] text-xs font-medium text-white rounded-md"
            style={{ backgroundColor: '#06C755' }}
          >
            適用
          </button>
          <button type="button" onClick={onCancel} className="px-3 py-1.5 min-h-[44px] text-xs font-medium text-gray-600 bg-gray-200 rounded-md">
            キャンセル
          </button>
        </div>
      )}
    </div>
  )
}

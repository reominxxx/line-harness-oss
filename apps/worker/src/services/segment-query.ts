import { parseEngagementSegmentId, engagementCondition } from './engagement.js'

export interface SegmentRule {
  type:
    | 'tag_exists'
    | 'tag_not_exists'
    | 'segment_tag_exists'
    | 'segment_tag_not_exists'
    | 'metadata_equals'
    | 'metadata_not_equals'
    | 'ref_code'
    | 'is_following'
    | 'link_clicked_within'
  value: string | boolean | { key: string; value: string } | { days: number; trackedLinkId?: string | null }
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

export function buildSegmentQuery(condition: SegmentCondition): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = []
  const clauses: string[] = []

  for (const rule of condition.rules) {
    switch (rule.type) {
      case 'tag_exists': {
        if (typeof rule.value !== 'string') {
          throw new Error('tag_exists rule requires a string tag ID value')
        }
        clauses.push(
          `EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`,
        )
        bindings.push(rule.value)
        break
      }

      case 'tag_not_exists': {
        if (typeof rule.value !== 'string') {
          throw new Error('tag_not_exists rule requires a string tag ID value')
        }
        clauses.push(
          `NOT EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`,
        )
        bindings.push(rule.value)
        break
      }

      case 'segment_tag_exists': {
        if (typeof rule.value !== 'string') {
          throw new Error('segment_tag_exists rule requires a string segment tag ID value')
        }
        // `engagement:*` は DB に無い仮想セグメント (直近30日の反応数で判定)。
        // リサーチ回答セグメント (segment_tags の UUID) とは ID 接頭辞で振り分ける。
        const engLevel = parseEngagementSegmentId(rule.value)
        if (engLevel) {
          clauses.push(`(${engagementCondition(engLevel, 'f')})`)
        } else {
          clauses.push(
            `EXISTS (SELECT 1 FROM friend_segment_tags fst WHERE fst.friend_id = f.id AND fst.segment_tag_id = ?)`,
          )
          bindings.push(rule.value)
        }
        break
      }

      case 'segment_tag_not_exists': {
        if (typeof rule.value !== 'string') {
          throw new Error('segment_tag_not_exists rule requires a string segment tag ID value')
        }
        const engLevelNot = parseEngagementSegmentId(rule.value)
        if (engLevelNot) {
          clauses.push(`NOT (${engagementCondition(engLevelNot, 'f')})`)
        } else {
          clauses.push(
            `NOT EXISTS (SELECT 1 FROM friend_segment_tags fst WHERE fst.friend_id = f.id AND fst.segment_tag_id = ?)`,
          )
          bindings.push(rule.value)
        }
        break
      }

      case 'metadata_equals': {
        if (
          typeof rule.value !== 'object' ||
          rule.value === null ||
          typeof (rule.value as { key: string; value: string }).key !== 'string' ||
          typeof (rule.value as { key: string; value: string }).value !== 'string'
        ) {
          throw new Error('metadata_equals rule requires { key: string; value: string }')
        }
        const mv = rule.value as { key: string; value: string }
        clauses.push(`json_extract(f.metadata, ?) = ?`)
        bindings.push(`$.${mv.key}`, mv.value)
        break
      }

      case 'metadata_not_equals': {
        if (
          typeof rule.value !== 'object' ||
          rule.value === null ||
          typeof (rule.value as { key: string; value: string }).key !== 'string' ||
          typeof (rule.value as { key: string; value: string }).value !== 'string'
        ) {
          throw new Error('metadata_not_equals rule requires { key: string; value: string }')
        }
        const mv = rule.value as { key: string; value: string }
        clauses.push(`(json_extract(f.metadata, ?) IS NULL OR json_extract(f.metadata, ?) != ?)`)
        bindings.push(`$.${mv.key}`, `$.${mv.key}`, mv.value)
        break
      }

      case 'ref_code': {
        if (typeof rule.value !== 'string') {
          throw new Error('ref_code rule requires a string value')
        }
        clauses.push(`f.ref_code = ?`)
        bindings.push(rule.value)
        break
      }

      case 'is_following': {
        if (typeof rule.value !== 'boolean') {
          throw new Error('is_following rule requires a boolean value')
        }
        clauses.push(`f.is_following = ?`)
        bindings.push(rule.value ? 1 : 0)
        break
      }

      case 'link_clicked_within': {
        // 過去 N 日以内にリファラルリンク (link_clicks) をタップした友だち。
        // value: { days: number, trackedLinkId?: string | null }
        //   - trackedLinkId 指定なし → 全てのリンクで OR (どれか 1 つでもクリック)
        //   - trackedLinkId 指定あり → そのリンクに限定
        const v = rule.value as { days?: unknown; trackedLinkId?: unknown }
        if (typeof v !== 'object' || v === null || typeof v.days !== 'number' || v.days <= 0 || v.days > 365) {
          throw new Error('link_clicked_within rule requires { days: number 1-365, trackedLinkId?: string | null }')
        }
        const trackedLinkId = typeof v.trackedLinkId === 'string' && v.trackedLinkId.length > 0 ? v.trackedLinkId : null
        const hoursAgo = `-${Math.floor(v.days * 24)} hours`
        if (trackedLinkId) {
          clauses.push(
            `EXISTS (SELECT 1 FROM link_clicks lc WHERE lc.friend_id = f.id AND lc.tracked_link_id = ? AND lc.clicked_at >= datetime('now', ?))`,
          )
          bindings.push(trackedLinkId, hoursAgo)
        } else {
          clauses.push(
            `EXISTS (SELECT 1 FROM link_clicks lc WHERE lc.friend_id = f.id AND lc.clicked_at >= datetime('now', ?))`,
          )
          bindings.push(hoursAgo)
        }
        break
      }

      default: {
        const exhaustive: never = rule.type
        throw new Error(`Unknown segment rule type: ${exhaustive}`)
      }
    }
  }

  const separator = condition.operator === 'AND' ? ' AND ' : ' OR '
  // 必ず括弧で囲む。呼び出し側は `sql.replace('WHERE', 'WHERE f.line_account_id = ? AND')`
  // でテナント絞り込みを足すため、OR 結合だと括弧なしでは
  // `account=? AND clause1 OR clause2` = `(account=? AND clause1) OR clause2` となり
  // clause2 が全アカウントにマッチしてしまう (テナント越え配信事故)。
  const where = clauses.length > 0 ? `(${clauses.join(separator)})` : '1=1'
  const sql = `SELECT f.id, f.line_user_id FROM friends f WHERE ${where}`

  return { sql, bindings }
}

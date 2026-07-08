import { describe, it, expect } from 'vitest';
import { buildSegmentQuery, type SegmentCondition } from './segment-query.js';

describe('buildSegmentQuery: link_clicked_within', () => {
  it('builds SQL for "any link in past N days"', () => {
    const cond: SegmentCondition = {
      operator: 'AND',
      rules: [{ type: 'link_clicked_within', value: { days: 7 } }],
    };
    const { sql, bindings } = buildSegmentQuery(cond);
    expect(sql).toContain('EXISTS (SELECT 1 FROM link_clicks lc');
    expect(sql).toContain("lc.clicked_at >= datetime('now', ?)");
    expect(sql).not.toContain('tracked_link_id = ?');
    expect(bindings).toEqual(['-168 hours']);
  });

  it('builds SQL for "specific link in past N days"', () => {
    const cond: SegmentCondition = {
      operator: 'AND',
      rules: [{ type: 'link_clicked_within', value: { days: 3, trackedLinkId: 'link-abc' } }],
    };
    const { sql, bindings } = buildSegmentQuery(cond);
    expect(sql).toContain('lc.tracked_link_id = ?');
    expect(bindings).toEqual(['link-abc', '-72 hours']);
  });

  it('rejects invalid days (0)', () => {
    const cond: SegmentCondition = {
      operator: 'AND',
      rules: [{ type: 'link_clicked_within', value: { days: 0 } }],
    };
    expect(() => buildSegmentQuery(cond)).toThrow(/days: number 1-365/);
  });

  it('rejects invalid days (>365)', () => {
    const cond: SegmentCondition = {
      operator: 'AND',
      rules: [{ type: 'link_clicked_within', value: { days: 500 } }],
    };
    expect(() => buildSegmentQuery(cond)).toThrow();
  });

  it('combines with tag_exists via AND', () => {
    const cond: SegmentCondition = {
      operator: 'AND',
      rules: [
        { type: 'tag_exists', value: 'tag-xyz' },
        { type: 'link_clicked_within', value: { days: 14 } },
      ],
    };
    const { sql, bindings } = buildSegmentQuery(cond);
    expect(sql).toContain(' AND ');
    expect(bindings).toEqual(['tag-xyz', '-336 hours']);
  });
});

describe('buildSegmentQuery: テナント絞り込みの括弧', () => {
  // 呼び出し側は sql.replace('WHERE', 'WHERE f.line_account_id = ? AND') で
  // アカウント絞り込みを足す。OR 結合が括弧で囲まれていないと
  // `account=? AND a OR b` = `(account=? AND a) OR b` となり b が全アカウントに
  // 漏れる。WHERE 句全体が括弧で囲まれていることを保証する。
  it('OR 結合の WHERE 句を括弧で囲む', () => {
    const cond: SegmentCondition = {
      operator: 'OR',
      rules: [
        { type: 'tag_exists', value: 'tag-a' },
        { type: 'tag_exists', value: 'tag-b' },
      ],
    };
    const { sql } = buildSegmentQuery(cond);
    expect(sql).toMatch(/WHERE \(.* OR .*\)$/);

    // 呼び出し側の置換を再現してテナント越えしないことを確認
    const tenantSql = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
    expect(tenantSql).toContain('f.line_account_id = ? AND (');
    expect(tenantSql.trimEnd().endsWith(')')).toBe(true);
  });

  it('AND 結合の WHERE 句も括弧で囲む', () => {
    const cond: SegmentCondition = {
      operator: 'AND',
      rules: [
        { type: 'tag_exists', value: 'tag-a' },
        { type: 'is_following', value: true },
      ],
    };
    const { sql } = buildSegmentQuery(cond);
    expect(sql).toMatch(/WHERE \(.* AND .*\)$/);
  });
});

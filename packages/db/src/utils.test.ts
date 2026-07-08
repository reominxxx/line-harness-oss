import { describe, it, expect } from 'vitest';
import { ensureJstOffset } from './utils.js';

describe('ensureJstOffset', () => {
  it('offset 無しの datetime-local を JST として扱う', () => {
    expect(ensureJstOffset('2026-06-25T10:00')).toBe('2026-06-25T10:00+09:00');
    // UTC 解釈で 9h ズレないこと
    expect(new Date(ensureJstOffset('2026-06-25T10:00')).getTime()).toBe(
      new Date('2026-06-25T10:00+09:00').getTime(),
    );
  });

  it('秒付き offset 無しも JST 付与', () => {
    expect(ensureJstOffset('2026-06-25T10:00:30')).toBe('2026-06-25T10:00:30+09:00');
  });

  it('日付のみは JST 0時に固定', () => {
    expect(ensureJstOffset('2026-06-25')).toBe('2026-06-25T00:00:00+09:00');
  });

  it('既に +09:00 が付いていれば二重付与しない', () => {
    expect(ensureJstOffset('2026-06-25T10:00:00+09:00')).toBe('2026-06-25T10:00:00+09:00');
  });

  it('Z (UTC) はそのまま保持', () => {
    expect(ensureJstOffset('2026-06-25T01:00:00Z')).toBe('2026-06-25T01:00:00Z');
  });

  it('別オフセット (+05:00) も保持', () => {
    expect(ensureJstOffset('2026-06-25T10:00:00+05:00')).toBe('2026-06-25T10:00:00+05:00');
  });

  it('前後の空白を除去', () => {
    expect(ensureJstOffset('  2026-06-25T10:00  ')).toBe('2026-06-25T10:00+09:00');
  });
});

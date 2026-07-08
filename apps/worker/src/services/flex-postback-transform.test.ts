import { describe, it, expect } from 'vitest';
import { transformUriToPostback, transformFlexContentForPostback, b64UrlDecode } from './flex-postback-transform.js';

describe('transformUriToPostback', () => {
  it('converts uri action to postback with displayText', () => {
    const input = {
      type: 'button',
      action: { type: 'uri', label: '詳細を見る', uri: 'https://example.com/abc?id=1' },
    };
    const out = transformUriToPostback(input) as typeof input;
    expect(out.action.type).toBe('postback');
    expect(out.action.label).toBe('詳細を見る');
    expect((out.action as unknown as { displayText: string }).displayText).toBe('詳細を見る');
    const data = (out.action as unknown as { data: string }).data;
    expect(data.startsWith('open-link:')).toBe(true);
    expect(b64UrlDecode(data.slice('open-link:'.length))).toBe('https://example.com/abc?id=1');
  });

  it('preserves message and postback actions untouched', () => {
    const input = [
      { type: 'button', action: { type: 'message', label: 'A', text: 'A 押した' } },
      { type: 'button', action: { type: 'postback', label: 'B', data: 'b-data' } },
    ];
    const out = transformUriToPostback(input) as typeof input;
    expect(out[0].action.type).toBe('message');
    expect(out[1].action.type).toBe('postback');
    expect(out[1].action.data).toBe('b-data');
  });

  it('falls back to uri when URL is too long', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(400);
    const input = { type: 'button', action: { type: 'uri', label: 'X', uri: longUrl } };
    const out = transformUriToPostback(input) as typeof input;
    expect(out.action.type).toBe('uri');
    expect(out.action.uri).toBe(longUrl);
  });

  it('recurses into nested footer/body/hero structures', () => {
    const bubble = {
      type: 'bubble',
      hero: {
        type: 'image',
        action: { type: 'uri', label: 'クーポン', uri: 'https://example.com/c' },
      },
      footer: {
        type: 'box',
        contents: [
          { type: 'button', action: { type: 'uri', label: '今すぐ', uri: 'https://example.com/now' } },
        ],
      },
    };
    const out = transformUriToPostback(bubble) as unknown as {
      hero: { action: { type: string } };
      footer: { contents: Array<{ action: { type: string } }> };
    };
    expect(out.hero.action.type).toBe('postback');
    expect(out.footer.contents[0].action.type).toBe('postback');
  });

  it('leaves LIFF urls as uri (1-tap; LIFF SDK identifies the user)', () => {
    const input = {
      type: 'button',
      action: { type: 'uri', label: 'クーポンを見る', uri: 'https://liff.line.me/123-abc?page=coupon&id=xyz' },
    };
    const out = transformUriToPostback(input) as typeof input;
    expect(out.action.type).toBe('uri');
    expect(out.action.uri).toBe('https://liff.line.me/123-abc?page=coupon&id=xyz');
  });

  it('truncates label > 20 chars for postback label, 60 for displayText', () => {
    const longLabel = 'あいうえおかきくけこさしすせそたちつてとなにぬねの'; // 25 chars
    const input = { type: 'button', action: { type: 'uri', label: longLabel, uri: 'https://x.com' } };
    const out = transformUriToPostback(input) as { action: { label: string; displayText: string } };
    expect(out.action.label.length).toBeLessThanOrEqual(20);
    expect(out.action.displayText.length).toBeLessThanOrEqual(60);
  });
});

describe('transformFlexContentForPostback', () => {
  it('is a no-op for non-flex types', () => {
    expect(transformFlexContentForPostback('text', 'hello')).toBe('hello');
    expect(transformFlexContentForPostback('image', '{"foo":1}')).toBe('{"foo":1}');
  });

  it('parses + transforms + re-serializes flex JSON', () => {
    const content = JSON.stringify({
      type: 'bubble',
      footer: {
        type: 'box',
        contents: [{ type: 'button', action: { type: 'uri', label: 'X', uri: 'https://a.com' } }],
      },
    });
    const out = JSON.parse(transformFlexContentForPostback('flex', content));
    expect(out.footer.contents[0].action.type).toBe('postback');
  });

  it('returns original content unchanged when JSON parse fails', () => {
    const bad = '{not json';
    expect(transformFlexContentForPostback('flex', bad)).toBe(bad);
  });
});

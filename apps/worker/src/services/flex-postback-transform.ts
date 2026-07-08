/**
 * Flex メッセージ内の `action.type: "uri"` を `postback + displayText` に変換する。
 *
 * これにより、リッチメニュー / クーポン / カードメッセージ / 一斉配信 / シナリオ
 * など全ての配信で「ボタンをタップ → ラベル文言が友だち発言としてトーク表示」
 * という挙動になり、ensureFriendForUserId が webhook 経由で未登録ユーザーを
 * 自動 backfill できる (= 公式 LINE と同等の挙動)。
 *
 * 変換後のタップ動作:
 *   1. LINE が `displayText` (= ボタンラベル) を友だち発言として表示
 *   2. webhook が postback event を受信、`data = open-link:<base64url>` を持つ
 *   3. ensureFriendForUserId が必要なら友だちを backfill
 *   4. postback handler が data から URL を復元し、uri ボタン Flex で reply
 *      (1 タップで URL が開ける状態にする)
 *
 * 制約:
 *   - LINE の postback `data` は最大 300 byte (action.label は 20 文字)
 *   - URL が長すぎて base64 後に 280 byte 超になる場合は uri アクションのままにする
 *     (= 公式 LINE 互換のフォールバック)
 */

const DATA_PREFIX = 'open-link:';
const MAX_DATA_BYTES = 280; // 300 - "open-link:" 余裕分

/** base64url encode (URL-safe, padding 無し) */
function b64UrlEncode(s: string): string {
  // btoa は ASCII しか扱えないので UTF-8 を経由
  const utf8 = new TextEncoder().encode(s);
  let bin = '';
  for (const b of utf8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url decode (URL-safe, padding 復元) */
export function b64UrlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

interface FlexAction {
  type?: string;
  label?: string;
  uri?: string;
  data?: string;
  text?: string;
  displayText?: string;
}

interface FlexNode {
  type?: string;
  action?: FlexAction;
  [k: string]: unknown;
}

/**
 * Flex JSON の中の uri アクションを postback + displayText に再帰変換する。
 * 元の URL は data に base64 で埋め込み、postback handler で復元する。
 */
export function transformUriToPostback(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((n) => transformUriToPostback(n));
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const obj = node as FlexNode;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'action' && v && typeof v === 'object') {
      const action = v as FlexAction;
      if (action.type === 'uri' && typeof action.uri === 'string' && typeof action.label === 'string' && action.label.length > 0) {
        // LIFF URL は LIFF SDK 自身がユーザーを識別するため postback 化しない。
        // postback 化すると「タップ→文言発言→リンク返信→再タップ」の 2 段階になり、
        // LIFF が本来持つ 1 タップ動線 (= クーポン等) を壊してしまう。
        if (action.uri.includes('liff.line.me')) {
          out[k] = action;
          continue;
        }
        const encoded = b64UrlEncode(action.uri);
        const newData = `${DATA_PREFIX}${encoded}`;
        // data 長制限内ならば postback 化する。超える場合は uri のまま保持して
        // 公式 LINE 互換のフォールバックとする。
        if (new TextEncoder().encode(newData).byteLength <= MAX_DATA_BYTES) {
          out[k] = {
            type: 'postback',
            label: action.label.slice(0, 20),
            displayText: action.label.slice(0, 60),
            data: newData,
          } satisfies FlexAction;
          continue;
        }
      }
      // 既に message / postback / その他は触らない (uri 以外はそのまま透過)
      out[k] = transformUriToPostback(v);
      continue;
    }
    out[k] = transformUriToPostback(v);
  }
  return out;
}

/**
 * Flex メッセージ content (JSON 文字列 or 既にパース済みオブジェクト) に対して
 * 変換を適用して文字列で返す。messageType !== 'flex' のときは何もしない。
 */
export function transformFlexContentForPostback(messageType: string, content: string): string {
  if (messageType !== 'flex') return content;
  try {
    const parsed = JSON.parse(content);
    const transformed = transformUriToPostback(parsed);
    return JSON.stringify(transformed);
  } catch (err) {
    console.warn('[flex-postback-transform] parse failed, returning original', err);
    return content;
  }
}

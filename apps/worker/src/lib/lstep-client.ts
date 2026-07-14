/**
 * L ステップ Public API クライアント
 *
 * Base URL: https://api.lineml.jp/v2/api
 * Auth:     Authorization: Bearer {token}
 * Rate:     10 req/sec, monthly per-plan
 *
 * Bridge プラン用: L-port 側で AI 判定したセグメントタグや顧客分析結果を、
 * L ステップ側にも反映する (友だち情報・タグ・対応マークの双方向同期)。
 *
 * 公式ドキュメント: https://docs.lineml.jp/
 *   - 友だち取得 / タグ操作 / 対応マーク / トーク履歴 は公開仕様済み
 *   - メッセージ送信 / シナリオ操作 / Webhook は管理画面ログイン後のマニュアル参照
 *     → 顧客契約時に追加実装 (Phase 2)
 */

const DEFAULT_BASE_URL = 'https://api.lineml.jp/v2/api';

export interface LstepClientConfig {
  apiToken: string;
  baseUrl?: string;
  /** デバッグ時に fetch ログを残す */
  debug?: boolean;
}

export interface LstepFriend {
  id: number | string;
  display_name?: string | null;
  picture_url?: string | null;
  followed_at?: string | null;
  is_blocked?: boolean | number;
  tags?: Array<{ id: number | string; name: string }>;
  taiou_marks?: Array<{ id: number | string; name: string }>;
  friend_infos?: Array<{ id: number | string; name: string; value: unknown }>;
}

export interface LstepTag {
  id: number | string;
  name: string;
  folder_id?: number | string | null;
  created_at?: string;
}

export interface LstepListResponse<T> {
  data?: T[];
  next_cursor?: string | null;
  total?: number;
}

/** push 送信できるメッセージ (LINE Messaging API 互換。仕様確定後に要検証) */
export type LstepOutboundMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; originalContentUrl: string; previewImageUrl: string }
  | { type: 'flex'; altText: string; contents: unknown };

export class LstepApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'LstepApiError';
  }
}

export class LstepClient {
  constructor(private config: LstepClientConfig) {}

  private get baseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiToken}`,
      Accept: 'application/json',
    };
    let bodyStr: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(body);
    }

    if (this.config.debug) {
      console.log(`[lstep] ${method} ${url.toString()}${bodyStr ? ' body=' + bodyStr.slice(0, 200) : ''}`);
    }

    const res = await fetch(url.toString(), { method, headers, body: bodyStr });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }

    if (!res.ok) {
      const message = (json && typeof json === 'object' && 'message' in json)
        ? String((json as { message: string }).message)
        : `L ステップ API ${res.status}: ${text.slice(0, 200)}`;
      throw new LstepApiError(message, res.status, json);
    }
    return (json as T) ?? ({} as T);
  }

  // ---------------------------------------------------------------------------
  // 友だち
  // ---------------------------------------------------------------------------

  /** GET /v2/api/friends — 友だち一覧 (タグ・マーク・情報含む) */
  async listFriends(opts: { limit?: number; cursor?: string } = {}): Promise<LstepListResponse<LstepFriend>> {
    return this.request<LstepListResponse<LstepFriend>>('GET', '/friends', undefined, {
      limit: opts.limit,
      cursor: opts.cursor,
    });
  }

  /** GET /v2/api/friends/{id} */
  async getFriend(friendId: string | number): Promise<LstepFriend> {
    const res = await this.request<{ data?: LstepFriend } | LstepFriend>('GET', `/friends/${friendId}`);
    return ('data' in res && res.data ? res.data : res) as LstepFriend;
  }

  // ---------------------------------------------------------------------------
  // タグ
  // ---------------------------------------------------------------------------

  /** GET /v2/api/tags */
  async listTags(): Promise<LstepListResponse<LstepTag>> {
    return this.request<LstepListResponse<LstepTag>>('GET', '/tags');
  }

  /** POST /v2/api/tags — タグ作成 */
  async createTag(input: { name: string; folder_id?: number | string }): Promise<LstepTag> {
    const res = await this.request<{ data?: LstepTag } | LstepTag>('POST', '/tags', input);
    return ('data' in res && res.data ? res.data : res) as LstepTag;
  }

  /** POST /v2/api/friends/{friendId}/tags — 1 友だちに 1 〜 N タグ付与 */
  async addTagsToFriend(friendId: string | number, tagIds: Array<string | number>): Promise<void> {
    await this.request('POST', `/friends/${friendId}/tags`, { tag_ids: tagIds });
  }

  /** DELETE /v2/api/friends/{friendId}/tags — 1 友だちから 1 〜 N タグ解除 */
  async removeTagsFromFriend(friendId: string | number, tagIds: Array<string | number>): Promise<void> {
    await this.request('DELETE', `/friends/${friendId}/tags`, { tag_ids: tagIds });
  }

  /** POST /v2/api/tags/{tagId}/friends — 1 タグを複数友だちに一括付与 */
  async addTagToFriends(tagId: string | number, friendIds: Array<string | number>): Promise<void> {
    await this.request('POST', `/tags/${tagId}/friends`, { friend_ids: friendIds });
  }

  /** DELETE /v2/api/tags/{tagId}/friends — 1 タグを複数友だちから一括解除 */
  async removeTagFromFriends(tagId: string | number, friendIds: Array<string | number>): Promise<void> {
    await this.request('DELETE', `/tags/${tagId}/friends`, { friend_ids: friendIds });
  }

  // ---------------------------------------------------------------------------
  // 対応マーク
  // ---------------------------------------------------------------------------

  async listTaiouMarks(): Promise<LstepListResponse<{ id: number | string; name: string }>> {
    return this.request('GET', '/taiou-marks');
  }

  async setTaiouMark(friendId: string | number, markId: string | number | null): Promise<void> {
    await this.request('POST', `/friends/${friendId}/taiou-mark`, { mark_id: markId });
  }

  // ---------------------------------------------------------------------------
  // トーク履歴
  // ---------------------------------------------------------------------------

  /** GET /v2/api/messages — トーク履歴 */
  async listMessages(opts: { friend_id?: string | number; limit?: number; cursor?: string } = {}): Promise<LstepListResponse<{
    id: number | string;
    friend_id: number | string;
    direction: 'in' | 'out' | string;
    text?: string | null;
    created_at: string;
  }>> {
    return this.request('GET', '/messages', undefined, {
      friend_id: opts.friend_id,
      limit: opts.limit,
      cursor: opts.cursor,
    });
  }

  // ---------------------------------------------------------------------------
  // ヘルスチェック (テナント設定画面で API トークン疎通確認に使う)
  // ---------------------------------------------------------------------------

  /** API トークンが有効か簡易チェック (タグ一覧を 1 件だけ取って判定) */
  async ping(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.request('GET', '/tags', undefined, { limit: 1 });
      return { ok: true };
    } catch (e) {
      if (e instanceof LstepApiError) {
        return { ok: false, reason: `${e.status}: ${e.message}` };
      }
      return { ok: false, reason: e instanceof Error ? e.message : 'unknown' };
    }
  }

  // ---------------------------------------------------------------------------
  // メッセージ送信 (Phase 2: Webhook 転送共存モードの AI 応答返信用)
  // ---------------------------------------------------------------------------

  /**
   * POST /v2/api/friends/{friendId}/messages — 友だちにメッセージを push 送信。
   *
   * Webhook 転送で受けた受信イベントに対し AI 生成した応答を L ステップ経由で返す用。
   * reply token は使えないため必ず push 扱い (= L ステップ/LINE の月間通数を消費)。
   *
   * 注意: エンドポイントパス・body 形式は公式 API リファレンス (管理画面マニュアル)
   *       確定後に要検証。現状は LINE Messaging API 互換の messages 配列を仮置き。
   */
  async sendMessage(
    friendId: string | number,
    messages: LstepOutboundMessage[],
  ): Promise<void> {
    await this.request('POST', `/friends/${friendId}/messages`, { messages });
  }
}

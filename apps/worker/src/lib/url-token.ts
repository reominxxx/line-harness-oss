/**
 * SQL fragment that extracts the per-user portion of a LINE profile picture
 * URL — the middle 80 chars after the CDN host prefix. Same value across
 * channels for the same human, so this is the only signal that bridges
 * provider-disjoint user_id namespaces (e.g. L Harness ↔ X Harness).
 *
 * Returns NULL when picture_url is absent or hosted on an unrecognized CDN.
 *
 * Intended use: substitute into a SELECT clause as `(${URL_TOKEN_SQL}) AS url_token`.
 */
// 後方互換: alias なしで使ってる箇所向けに friends.picture_url を qualified。
// 旧コードで `picture_url` (qualified なし) だったが、line_accounts にも
// picture_url が後で追加され (migration 065_line_accounts_profile_cache.sql)、
// JOIN クエリで "ambiguous column name: picture_url" 発生した。
export const URL_TOKEN_SQL = urlTokenSql('friends');

/**
 * 任意のテーブルエイリアスを指定して URL_TOKEN_SQL を生成する。
 * `FROM friends f` のように alias を使うクエリでは urlTokenSql('f') を使う。
 */
export function urlTokenSql(alias: string): string {
  return `
    CASE
      WHEN ${alias}.picture_url LIKE 'https://sprofile.line-scdn.net/%' THEN SUBSTR(${alias}.picture_url, 42, 80)
      WHEN ${alias}.picture_url LIKE 'https://profile.line-scdn.net/%' THEN SUBSTR(${alias}.picture_url, 41, 80)
      ELSE NULL
    END
  `;
}

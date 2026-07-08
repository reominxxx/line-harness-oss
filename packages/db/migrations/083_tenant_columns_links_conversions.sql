-- 083: tracked_links / link_clicks / conversion_points / conversion_events に
-- line_account_id を追加してテナント分離する。
--
-- 背景: これら 4 テーブルは line_account_id を持たず、リンク/CV のレポート・一覧が
-- 全アカウント混在していた (1 DB に本番3・staging4 アカウント同居)。schema.sql の
-- 「全テーブルは line_account_id で完全テナント分離」方針に反する初期設計漏れ。
--
-- 既存行: 本番は 4 テーブルとも 0 行。staging はテスト行のみ (friend_id / scenario_id が
-- NULL で由来アカウントを特定できないため backfill せず NULL のまま放置)。よって additive
-- な ALTER のみ。NOT NULL は付けない (既存行と過去経路の互換のため nullable)。

ALTER TABLE tracked_links ADD COLUMN line_account_id TEXT REFERENCES line_accounts (id) ON DELETE CASCADE;
ALTER TABLE link_clicks ADD COLUMN line_account_id TEXT REFERENCES line_accounts (id) ON DELETE CASCADE;
ALTER TABLE conversion_points ADD COLUMN line_account_id TEXT REFERENCES line_accounts (id) ON DELETE CASCADE;
ALTER TABLE conversion_events ADD COLUMN line_account_id TEXT REFERENCES line_accounts (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tracked_links_account ON tracked_links (line_account_id);
CREATE INDEX IF NOT EXISTS idx_link_clicks_account ON link_clicks (line_account_id);
CREATE INDEX IF NOT EXISTS idx_conversion_points_account ON conversion_points (line_account_id);
CREATE INDEX IF NOT EXISTS idx_conversion_events_account ON conversion_events (line_account_id);

-- ============================================================
-- migration 065: cache LINE bot profile (display_name / picture_url / basic_id)
-- in line_accounts so the Lite endpoint can return them without
-- hitting the LINE Messaging API for every selector load.
--
-- Background:
--   migration "lite endpoint" (064 era) removed per-account LINE API
--   fetch from /api/line-accounts/lite for 1000+ account scalability.
--   Side-effect: the sidebar account switcher fell back to the raw
--   `name` column (admin-given label) instead of the LINE official
--   display name (e.g. "山岸怜央"). Persisting the profile here closes
--   the gap: full endpoint refreshes the cache, lite endpoint serves it.
-- ============================================================

ALTER TABLE line_accounts ADD COLUMN display_name TEXT;
ALTER TABLE line_accounts ADD COLUMN picture_url TEXT;
ALTER TABLE line_accounts ADD COLUMN basic_id TEXT;
ALTER TABLE line_accounts ADD COLUMN profile_refreshed_at TEXT;

-- Webhook イベントの冪等性テーブル。
-- LINE は障害時に同一イベントを再送する (deliveryContext.isRedelivery=true)。
-- webhookEventId を PRIMARY KEY にして INSERT OR IGNORE で重複を検知し、
-- 再送イベントの二重処理 (AI 課金メーター二重加算・広告 CV 二重ポストバック・
-- auto-reply 二重送信) を防ぐ。
CREATE TABLE IF NOT EXISTS webhook_events (
  webhook_event_id TEXT PRIMARY KEY,
  line_account_id TEXT,
  received_at TEXT NOT NULL
);

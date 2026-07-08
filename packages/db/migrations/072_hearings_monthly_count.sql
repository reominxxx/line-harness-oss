-- hearings.monthly_broadcast_count を永続化
-- POST /generate で受け取った値を保存し、cron worker が同じ値で生成できるようにする
ALTER TABLE hearings ADD COLUMN monthly_broadcast_count INTEGER NOT NULL DEFAULT 4;

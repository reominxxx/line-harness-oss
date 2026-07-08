# L-port スケーラビリティ設計（月1000万通 / マルチテナント前提）

作成: 2026-06-01 / 対象: 企業数増加に向けたコアパス強化（実装前の設計書）

## 0. 前提と結論

- 平均負荷は問題ない。月1000万通 ≒ **約3.9通/秒**。瞬間バーストとテナント間競合だけが課題。
- 現状アーキ: cron (`*/5`, `0 */6`) → `processQueuedBroadcasts` → `processQueuedBroadcastBatches` が
  1 invocation 内で `while (currentOffset < friends.length)` の全バッチを sleep 挟みつつ処理。
  Cloudflare Queues は未使用、D1 は環境ごとに1個を全テナント共有。
- 着手順（リスク低→高）: **① ログ保持パージ → ② 429/レート堅牢化 → ③ Queues 移行 → ④ Haiku 分類削減**。
  ①②は単独で安全に入る。③が本丸（コアパス書換）。④はコスト最適化。

---

## ① messages_log 保持期間パージ（最優先・低リスク）

### 問題
月1000万通 = `messages_log` に月1000万行 INSERT（broadcast.ts:384-390 で1通1行）。
D1 の容量上限(10GB/DB)と書込みスループットに直撃。全テナント共有DBなので
1社の大量配信が他社のチャットクエリと競合する。

### 設計
1. **保持期間カラム運用**: cron (`0 */6`) のついでに `DELETE FROM messages_log WHERE created_at < ?`
   （JST naive、例: 90日より古い行）。`source='broadcast'` の outgoing を優先的にパージ。
2. **インデックス確認**: `messages_log(created_at)` にインデックスが無ければ migration で追加。
   パージ DELETE と一覧クエリ両方が効く。
3. **段階削除**: 一括 DELETE は D1 でロック時間が伸びるため `LIMIT 5000` 程度で分割し、
   `changes>0` の間ループ（cron 1回あたり上限を設けてタイムアウト回避）。
4. **アーカイブ（任意）**: 法務・分析要件があるなら DELETE 前に R2 へ JSONL 追記。

### 影響
- 新規 migration 1本（インデックス）。`broadcast.ts` の cron handler に purge 関数1つ追加。
- 既存配信ロジックには触らない。ロールバック容易。

### 検討事項
- 保持期間を何日にするか（UI で配信実績を遡れる期間に合わせる。デフォルト90日提案）。
- success_count / insight は集計済みなので、生ログ削除でダッシュボード数値は壊れないことを確認。

---

## ② LINE API レート制限・429 バックオフ堅牢化（低〜中リスク）

### 問題
実際に最初に当たる天井はここの可能性が高い。現状 `processQueuedBroadcastBatches` は
multicast 失敗時に offset を保存して次 cron で再開するが（broadcast.ts:370-377）、
**429 とその他エラーを区別していない**。429 は待てば回復するが、永続エラー（無効トークン等）は
再試行しても無駄に cron を消費する。

### 設計
1. **エラー分類**: `LineClient.multicast` のエラーから HTTP status を取れるようにする。
   - 429 / 5xx → リトライ可（offset 保存して再開、`Retry-After` があれば尊重）。
   - 4xx（401/403/400）→ リトライ不可。broadcast を `failed` にして cron ループから除外。
2. **指数バックオフ**: 同一 broadcast の連続失敗回数を `broadcasts` に持たせ（新カラム `retry_count`）、
   `min(2^retry_count * base, cap)` で次回 cron までの実質待機を制御。上限超過で `failed`。
3. **per-account レート枠**: 送信元 `line_account_id` ごとに「直近1分の送信数」を D1 か
   Durable Object でカウントし、LINE のレート上限に近づいたら次 cron に回す。

### 影響
- `broadcasts` に `retry_count`（migration 1本）。`LineClient` のエラー型拡張。
- `processQueuedBroadcastBatches` の catch 分岐を分類対応に書換（局所的）。

### 検討事項
- LINE 公式アカウントごとの正確なレート上限値（multicast の req/sec とメッセージ枠）を確定。
- per-account カウンタを D1 でやるか Durable Object でやるか（③と合わせて判断）。

---

## ③ Cloudflare Queues 移行（本丸・高リスク）★着手前に再合意

### 問題
1 invocation で全バッチを sleep 挟み処理する設計（broadcast.ts:353 の while）は、
1テナントの数十万通配信で Worker の CPU/wall-clock 上限に当たる。cron 5分再開で救済は
されるが「再開頼み」。複数テナントが同時刻に配信を仕込むと cron 1発に集中する。

### 設計（producer / consumer 分離）
```
[cron or 即時配信API]
   └─ producer: 対象 friends を 500件バッチに分割し
                "1バッチ = 1メッセージ" として Queue に enqueue（送信はしない）
                        ↓  Cloudflare Queues
   └─ consumer (queue handler): 1メッセージ受信 = 1バッチ multicast + messages_log INSERT
                                失敗時は throw → Queues が自動リトライ（指数バックオフ内蔵）
                                max_retries 超過は dead letter queue へ
```

#### バインディング（wrangler.toml）
```toml
[[queues.producers]]
binding = "BROADCAST_QUEUE"
queue = "lport-broadcast"           # 本番

[[queues.consumers]]
queue = "lport-broadcast"
max_batch_size = 10                 # consumer 1起動で最大10バッチ＝5000通
max_batch_timeout = 5
max_retries = 5
dead_letter_queue = "lport-broadcast-dlq"
```
staging は `lport-broadcast-staging` / `-dlq-staging` を別途。env ごとに producers/consumers を定義。

#### メッセージ payload（1バッチ分）
```ts
type BroadcastBatchJob = {
  broadcastId: string;
  lineAccountId: string | null;
  batchIndex: number;
  totalBatches: number;
  lineUserIds: string[];     // 最大500
  messageType: string;
  messageContent: string;    // auto-track / liff_id / postback 変換済みの最終形
  altText?: string;
  unit: string;              // 既存の bcast_xxxx
};
```
**重要**: auto-track・`{{liff_id}}`置換・flex-postback 変換は **producer 側で1回だけ**やり、
変換後の最終 content を payload に焼き込む。consumer は送るだけ（現状 batchOffset===0 でのみ
変換する分岐を producer に移す）。

#### consumer 本体（疑似コード）
```ts
export default {
  async queue(batch: MessageBatch<BroadcastBatchJob>, env) {
    for (const msg of batch.messages) {
      const job = msg.body;
      try {
        const client = await resolveClient(env.DB, job.lineAccountId);
        const message = buildMessage(job.messageType, job.messageContent, job.altText);
        await client.multicast(job.lineUserIds, [message], [job.unit]);
        await insertMessagesLog(env.DB, job);            // 既存の batch INSERT を流用
        await bumpSuccessCount(env.DB, job.broadcastId, job.lineUserIds.length);
        msg.ack();
      } catch (err) {
        // 429/5xx → retry。4xx 永続 → ack して DLQ 行きにしない判断 or 明示 fail
        msg.retry();   // Queues が指数バックオフで再投入
      }
    }
  }
}
```

#### 完了判定
- batch ごとに `success_count` を加算し、`success_count + failed >= total_count` で
  `createBroadcastInsight` + status='sent'。consumer は順序保証がないため
  「全バッチ enqueue 済みフラグ + カウント到達」で完了を判定する（offset ベースを廃止）。

#### ステルス遅延の扱い
- 現状の `calculateStaggerDelay`（同一 invocation 内 sleep）は Queues では不要/有害。
- 人間らしい分散が要るなら `max_batch_size` を小さく + Queues の
  `delay_seconds`（enqueue 時に per-message 遅延）で実現。sleep でCPU時間を食わない。

### 影響（大）
- `wrangler.toml` 4環境分に queues 定義。`index.ts` に `queue()` ハンドラ追加。
- `broadcast.ts` の `processQueuedBroadcastBatches` を producer 化、while ループ撤去。
- `dedup-broadcast.ts`（multi-account-dedup 経路）も同様に producer 化が必要。
- 完了判定が offset → カウント方式に変わるため `broadcasts` のロック関連カラム
  （batch_offset, batch_lock_at）の役割を見直し。

### 移行戦略（安全に出す）
1. feature flag `USE_QUEUE_BROADCAST`（env var）で新旧経路を切替可能にする。
2. staging で Queues 経路を有効化 → 少人数タグ配信で検証（重複なし・取りこぼしなし・実績数一致）。
3. 本番は flag off のままデプロイ → 小規模テナントだけ flag on → 段階展開。
4. 旧 while ループ経路は flag で残し、問題時に即ロールバック。

### 検討事項
- Queues は有料（リクエスト課金）。月1000万通 / 500 = 2万バッチ/月 + リトライ分。コスト試算が要る。
- dedup 経路の重複排除ロジックを producer 側のどこで効かせるか。
- 順序非保証で「テキストバリエーション（addMessageVariation）」を batchIndex 依存のまま使えるか。

---

## ④ 受信メッセージの Haiku 分類削減（低優先・コスト最適化）

### 問題
`analyzeMessage`(Haiku) を全受信メッセージで呼ぶ。企業増で受信増 → コスト/レイテンシが線形増。

### 設計
1. **プレフィルタ**: スタンプ・定型（「ありがとう」「了解」等）・短文を正規表現/辞書で先に分類し、
   Haiku 呼び出しをスキップ。
2. **結果キャッシュ**: 同一友達の直近メッセージ intent を短時間キャッシュし連投を間引く。
3. 障害要因ではないので ①②③ 完了後に着手。

---

## 実装順とゲート

| 順 | 項目 | リスク | 単独デプロイ可 | ゲート |
|----|------|--------|----------------|--------|
| 1 | ①ログパージ | 低 | ✅ | 保持日数の合意 |
| 2 | ②429/バックオフ | 低〜中 | ✅ | LINEレート上限の確定 |
| 3 | ③Queues移行 | 高 | flag で段階 | staging検証 + コスト試算 + **再合意** |
| 4 | ④Haiku削減 | 低 | ✅ | ①②③後 |

memory ルール準拠: 各項目は **staging + 本番 両方デプロイ**。③のみ着手前に設計再合意。

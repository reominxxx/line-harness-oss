# line-harness バグ類型監査メモ

作成日: 2026-06-17
目的: セッション `c2285aa8` で修正した2バグを起点に、同じ「類型」のバグが他に無いか洗い出す。
方針: **コードは読むだけ・変更しない。** 実行は最低限。

---

## 1. 起点となった既知バグ2件（修正済み）

| # | ファイル | 症状 | 原因（類型） |
|---|---|---|---|
| 1 | `apps/worker/src/routes/broadcast.ts` | 配信予約の時刻がズレる | **TZ変換漏れ**：`scheduledAt`（ユーザー入力のローカル時刻）をUTCに変換せず保存／スケジュールしていた |
| 2 | `apps/worker/src/routes/segment.ts` | 友だち絞り込みの結果が想定より少ない | **OR/AND取り違え**：`tagIds` を「いずれか（OR）」で絞るべきところ「すべて（AND）」で処理していた |

### 横展開して探すべきパターン
- **類型1（TZ）**: ユーザー入力の日時文字列を `new Date(...)` してそのままDB保存／スケジュール／キュー投入する箇所で、`toISOString()` / `UTC` / オフセット補正を通していないもの。
- **類型2（OR/AND）**: tag・条件・フィルタの配列を絞り込むクエリで、AND と OR を取り違えている箇所（SQLの `AND`/`OR`、クエリビルダの `and()`/`or()`、JSの `every()`/`some()`、`&&`/`||`）。

---

## 2. 現時点のスキャン結果（worker/src 配下）

### 類型1（TZ変換漏れ）
- **要確認の本物候補：`apps/worker/src/scheduler.ts:88`**
  ```
  await scheduleDelivery(new Date(reservedAt), ...)
  ```
  - `reservedAt` を `new Date()` して渡しているが、近傍にUTC変換が見当たらない。broadcast.ts と同じ構造。
  - **未検証**：`reservedAt` が上流で既にUTC ISO文字列なら問題なし。**呼び出し元での `reservedAt` の出所確認が必要**（ここで判定が決まる）。
- 緩いフィルタでは11件ヒットしたが、大半は表示系・既にUTC化済みで誤検出。精密フィルタ後に残った実候補は上記1件。

### 類型2（OR/AND取り違え）
- 精密フィルタ（`every()` でtag/id/conditionを畳む形）では **0件**。
- ただしフィルタが厳しすぎた可能性大。元バグはSQL/クエリビルダの **`AND`結合** だったため、`every()` 以外の形（`and(...)` 連結、SQL文字列の ` AND `）で潜んでいる可能性が残る。**未完。要再スキャン。**

---

## 3. 次にやること（再開時・最低限の実行で）

1. `scheduler.ts:88` の `reservedAt` の出所を辿り、UTC化済みか判定（バグ確定 or シロ）。
2. 類型2を現実的な条件で再スキャン：
   - `routes/` 配下で tag/condition を `AND` 結合しているクエリを全部列挙し、OR想定のものを目視。
   - 対象は friends絞り込み・配信ターゲット・自動応答条件あたり（segmentと同系の機能）。
3. 確定したものだけをこの表に追記。

---

## 3.5 2026-07-03 全体監査（4類型を並列スキャン → 修正・両環境デプロイ済）

4類型（テナント越え / TZ変換漏れ / OR・AND取り違え / コア経路の正当性）を並列調査し、確定分を修正。

### 修正済み
| 重大度 | 箇所 | 内容 |
|---|---|---|
| Critical | `middleware/auth.ts` `enforceCustomerScope` | role='customer' を **デフォルト拒否ホワイトリスト＋GET限定** に刷新。friends/:id・chats/:id・coupons・tracked-links・conversions・forms 等のリソースID直引き(IDOR)と、一覧系の accountId 省略による全件越境を一括遮断。許可は staff/me・line-accounts(/lite)・friends/count・chats・broadcasts(+/:id/insight,/related-messages)・exports の GET のみ。 |
| Critical | `routes/webhook.ts` + migration `088_webhook_event_dedup.sql` | Webhook 冪等性を追加。`webhook_events(webhook_event_id PK)` に INSERT OR IGNORE し重複(再送)イベントをスキップ。二重AI課金・広告CV二重ポストバック・auto-reply二重送信を防止。初回配信は必ず新IDなので正当イベントは落とさない。両remote D1適用済。 |
| High | `packages/db/conversions.ts` CVレポート集計 | `SUM(cp.value)` を `SUM(CASE WHEN ce.id IS NOT NULL THEN cp.value END)` に修正。LEFT JOIN で CV0件のポイントに単価が計上され「件数0なのに売上>0」になる矛盾を解消。 |
| Medium | `services/ad-conversion.ts` | (a) 失敗ログの `clickIdType` を platform名→正しい clickId種別(fbclid/gclid等)に修正。(b) `eventValue` の truthy 判定を `!= null` に変更し ¥0 CV の value 欠落を解消(4箇所)。 |
| Medium | `packages/db/segment-tags.ts` `getFriendsBySegmentTag` | 任意で `lineAccountId` を受けて `AND f.line_account_id = ?` で絞る多重防御を追加。tag配信(getFriendsByTag)と挙動を統一。broadcast.ts 呼び出し側も sendAccountId を渡すよう更新。 |

### 意図的仕様と判断し変更しなかったもの
- `services/ai-cost-guard.ts` の cap 超過時 `auto_fallback_at_limit!==1` で allowed=true → **ソフト上限(超過課金許容)**の設計。フィールド名・overage_charge_yen・reason enum から意図的と判断。
- `/api/conversions/track` の冪等性欠如 → 同一友だちの正当なリピートCVがあり得るため自然キーUNIQUEは誤ブロック。明示idempotency-keyの導入は呼び出し元が未対応のため見送り。

### シロ（バグ無しと確認）
- **TZ変換漏れ**: broadcast/reminders/scenario-schedule/step-delivery/booking/event-booking/calendar/metering すべて書き込み側と読み取り側のTZ前提が一致。Critical/High無し。`scheduler.ts:88` の宿題は step-delivery/scenario-schedule に移動済でシロ確定。
- **OR/AND取り違え**: segment-query/broadcasts(HAVING COUNT=交差)/webhook auto-reply/event-bus/dedup すべて仕様通り。確定バグ無し。

## 4. 運用メモ
- 今後コードを読む／触る際は、この2類型（TZ変換漏れ・OR/AND取り違え）を常にチェックし、該当を見つけたら報告する（ユーザー依頼・2026-06-17）。
- 環境都合でツールの長い出力が要約される事象があり、調査は1件ずつ短く確認する必要があった。

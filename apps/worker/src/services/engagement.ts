// エンゲージメント軸 (休眠 / ライト / 見込み / ホット) の共通ロジック。
//
// これらは segment_tags / friend_segment_tags に保存される「リサーチ回答」軸とは
// 別物で、DB に保存されない「仮想セグメント」。直近30日の友だち側アクション数を
// その場で SQL 集計して判定する (AI 判定もバッチ付与も不要、常に最新)。
//
// 仮想セグメント ID は `engagement:<level>` という予約形式。リサーチ回答セグメントの
// UUID とは衝突しないので、配信対象解決時に ID 接頭辞で振り分けられる。
//
// 【相対評価】固定しきい値 (旧: 3回以上=ホット) ではなく、アカウントごとの母集団に
// 対する相対ランクで判定する:
//   - dormant … 直近30日で反応0回 (絶対評価。これだけは固定)
//   - hot / warm / light … 反応1回以上の「アクティブ層」を反応回数の多い順に並べ、
//     人数で均等3等分 (NTILE(3))。上位1/3=hot, 中位1/3=warm, 下位1/3=light。
// 母集団は「その友だち自身のアカウント (line_account_id) 内のアクティブ層」。
// 相関サブクエリで f.line_account_id に紐付けるため、呼び出し側でアカウント絞り込み
// 済みのクエリにそのまま AND で足せる (追加バインド不要)。

export type EngagementLevel = 'hot' | 'warm' | 'light' | 'dormant';

export const ENGAGEMENT_SEGMENTS: ReadonlyArray<{
  id: string;
  level: EngagementLevel;
  name: string;
  color: string;
  description: string;
}> = [
  {
    id: 'engagement:hot',
    level: 'hot',
    name: '🔥 かなりホット',
    color: '#f43f5e',
    description: '直近30日で反応 (タップ / チャット / 回答 / CV) した友だちのうち、反応回数が上位1/3。最も熱い層。',
  },
  {
    id: 'engagement:warm',
    level: 'warm',
    name: '🟡 見込みあり',
    color: '#f59e0b',
    description: '直近30日で反応した友だちのうち、反応回数が中位1/3。見込みあり。',
  },
  {
    id: 'engagement:light',
    level: 'light',
    name: '🌱 ライト',
    color: '#10b981',
    description: '直近30日で反応した友だちのうち、反応回数が下位1/3。反応はあるが弱め。',
  },
  {
    id: 'engagement:dormant',
    level: 'dormant',
    name: '💤 休眠',
    color: '#94a3b8',
    description: '直近30日で反応ゼロの友だち。掘り起こし対象 (絶対評価)。',
  },
];

// `engagement:hot` のような予約 ID なら level を返す。そうでなければ null。
export function parseEngagementSegmentId(id: string): EngagementLevel | null {
  switch (id) {
    case 'engagement:hot':
      return 'hot';
    case 'engagement:warm':
      return 'warm';
    case 'engagement:light':
      return 'light';
    case 'engagement:dormant':
      return 'dormant';
    default:
      return null;
  }
}

// 直近30日の「反応回数」を数える SQL 式。friend テーブルのエイリアスを受け取り、
// その友だちの行に相関する scalar subquery 群の合計を返す。
// 含めるもの:
//   - link_clicks:              トラッキングリンク (/t/) クリック
//                               (カードメッセージの uri ボタンもここ経由)
//   - messages_log(in):         チャット返信 / スタンプ・画像 / postback タップ
//                               (リッチメニュー・Flex・カルーセル・カードメッセージの
//                                message/postback ボタン・open-link 変換 URL・
//                                クーポン open-coupon postback)
//   - form_submissions:         フォーム / リサーチ回答 (アンケート)
//   - conversion_events:        コンバージョン (最も強い反応)
//   - coupon_redemptions:       クーポン利用
//   - coupon_lottery_attempts:  クーポン抽選への参加
// タイムスタンプ書式が table 間で異なる (UTC datetime / JST ISO) ため、各列を
// それぞれの書式の閾値と比較する。
export function recentActivityExpr(friendAlias = 'f'): string {
  const a = friendAlias;
  const utc = `datetime('now','-30 days')`;
  const jst = `strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours','-30 days')`;
  return (
    `((SELECT COUNT(*) FROM link_clicks lc WHERE lc.friend_id = ${a}.id ` +
    `AND lc.clicked_at >= ${utc}) + ` +
    `(SELECT COUNT(*) FROM messages_log ml WHERE ml.friend_id = ${a}.id ` +
    `AND ml.direction = 'incoming' AND ml.created_at >= ${jst}) + ` +
    `(SELECT COUNT(*) FROM form_submissions fsub WHERE fsub.friend_id = ${a}.id ` +
    `AND fsub.created_at >= ${utc}) + ` +
    `(SELECT COUNT(*) FROM conversion_events ce WHERE ce.friend_id = ${a}.id ` +
    `AND ce.created_at >= ${jst}) + ` +
    `(SELECT COUNT(*) FROM coupon_redemptions cr WHERE cr.friend_id = ${a}.id ` +
    `AND cr.used_at >= ${jst}) + ` +
    `(SELECT COUNT(*) FROM coupon_lottery_attempts cla WHERE cla.friend_id = ${a}.id ` +
    `AND cla.attempted_at >= ${jst}))`
  );
}

// level → NTILE のグループ番号 (1=上位/hot, 2=中位/warm, 3=下位/light)。
const TIER_BY_LEVEL: Record<'hot' | 'warm' | 'light', 1 | 2 | 3> = {
  hot: 1,
  warm: 2,
  light: 3,
};

// 指定アカウントのアクティブ層 (反応1回以上) を反応回数の多い順に NTILE(3) で
// 3等分し、(id, tier) を返すサブクエリ本体を組み立てる。
// 母集団は friendAlias.line_account_id に相関する (= その友だち自身のアカウント)。
// 同数の場合は created_at ASC, id ASC で安定ソート。
function tercileSubquery(friendAlias: string): string {
  const expr = recentActivityExpr('g');
  return (
    `SELECT g.id AS fid, ` +
    `NTILE(3) OVER (ORDER BY ${expr} DESC, g.created_at ASC, g.id ASC) AS tier ` +
    `FROM friends g ` +
    `WHERE g.line_account_id = ${friendAlias}.line_account_id ` +
    `AND g.is_following = 1 AND ${expr} >= 1`
  );
}

// 各友だちの相対 tier (1/2/3) を返す相関サブクエリ式。アクティブでない (反応0) 友だちは
// サブクエリに含まれないので NULL。リスト表示のバッジ算出に使う (SELECT 句に埋める)。
export function engagementTierExpr(friendAlias = 'f'): string {
  return `(SELECT t.tier FROM (${tercileSubquery(friendAlias)}) t WHERE t.fid = ${friendAlias}.id)`;
}

// SQL から取れた tier (1/2/3 or NULL) と反応回数から表示 level を決める。
// 反応0 (= 非アクティブ) は tier NULL → dormant。
export function tierToLevel(tier: number | null | undefined, count: number): EngagementLevel {
  if (count <= 0 || tier == null) return 'dormant';
  if (tier === 1) return 'hot';
  if (tier === 2) return 'warm';
  return 'light';
}

// 指定 level に一致する友だちを絞る SQL 真偽条件。WHERE に AND で足せる (追加バインド不要)。
// dormant のみ絶対評価 (反応0)、それ以外はアカウント内アクティブ層の NTILE(3) 相対ランク。
export function engagementCondition(level: EngagementLevel, friendAlias = 'f'): string {
  if (level === 'dormant') return `${recentActivityExpr(friendAlias)} = 0`;
  const tier = TIER_BY_LEVEL[level];
  return (
    `${friendAlias}.id IN (` +
    `SELECT fid FROM (${tercileSubquery(friendAlias)}) WHERE tier = ${tier})`
  );
}

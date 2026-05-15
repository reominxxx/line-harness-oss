/**
 * 月次 AI レポート生成のプロンプト集約
 *
 * 旧 ccPrompts の「ダッシュボードのKPI分析」「コンバージョン分析」
 * 「友だちのセグメント分析」「シナリオの効果分析」を統合した骨格。
 *
 * 入力データを受けて、「日本人らしい運用代行レポート」の Markdown を生成する。
 */

export interface MonthlyReportInput {
  brandName: string;
  yearMonth: string;
  industry?: string;
  metrics: {
    friendsAtStart: number;
    friendsAtEnd: number;
    friendsAdded: number;
    friendsBlocked: number;
    broadcastsSent: number;
    broadcastOpenRate: number | null;
    broadcastClickRate: number | null;
    cvCount: number;
    hotLeadsCount: number;
    dormantWokeCount: number;
  };
  topBroadcasts: Array<{
    title: string;
    openRate: number | null;
    ctr: number | null;
  }>;
  kpiGoals: Array<{
    metric: string;
    target: number;
    current: number;
  }>;
}

const SYSTEM_PROMPT = `あなたは LINE 公式アカウントの運用代行のコンサルタントです。
クライアント企業の事業者様に、月次の運用レポートを Markdown 形式で提出します。

【書き方ルール】
- 日本人の事業者向けの自然な日本語で書く
- 翻訳調・直訳調を避ける
- 数字の解釈と、来月の改善提案を必ず含める
- 良かった点 / 課題 / 来月のアクションの 3 段構造を意識
- 具体的な配信例や施策案を提示する（抽象論で終わらせない）
- ですます調、温かみのあるトーン
- 過度な絵文字は使わない（セクションタイトルに 1 個程度）
- 箇条書きと表を効果的に使う（読みやすさ優先）
- 1500 〜 3000 字を目安`;

export function buildMonthlyReportPrompt(input: MonthlyReportInput): {
  system: string;
  user: string;
} {
  const m = input.metrics;
  const friendChange = m.friendsAtEnd - m.friendsAtStart;
  const blockRate =
    m.friendsBlocked > 0 && m.friendsAtStart > 0
      ? ((m.friendsBlocked / m.friendsAtStart) * 100).toFixed(1)
      : '0.0';

  const kpiTable = input.kpiGoals
    .map((g) => {
      const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
      return `| ${g.metric} | ${g.current} / ${g.target} | ${pct}% |`;
    })
    .join('\n');

  const topBroadcastsTable = input.topBroadcasts
    .map(
      (b, i) =>
        `| ${i + 1} | ${b.title} | ${b.openRate?.toFixed(1) ?? '—'}% | ${b.ctr?.toFixed(1) ?? '—'}% |`,
    )
    .join('\n');

  const user = `${input.brandName} 様の ${input.yearMonth} 月次レポートを作成してください。
${input.industry ? `業界: ${input.industry}` : ''}

【今月の主要データ】
- 友だち数: 月初 ${m.friendsAtStart} 人 → 月末 ${m.friendsAtEnd} 人（${friendChange >= 0 ? '+' : ''}${friendChange} 人）
- 友だち追加: ${m.friendsAdded} 人
- ブロック: ${m.friendsBlocked} 人（ブロック率 ${blockRate}%）
- 配信本数: ${m.broadcastsSent} 本
- 平均開封率: ${m.broadcastOpenRate?.toFixed(1) ?? '—'}%
- 平均クリック率: ${m.broadcastClickRate?.toFixed(1) ?? '—'}%
- コンバージョン: ${m.cvCount} 件
- ホットリード: ${m.hotLeadsCount} 名
- 休眠掘り起こし反応: ${m.dormantWokeCount} 件

【KPI 目標達成状況】
| 指標 | 達成 / 目標 | 達成率 |
|---|---|---|
${kpiTable || '| （未設定） | — | — |'}

【配信パフォーマンス TOP 5】
| 順位 | タイトル | 開封率 | CTR |
|---|---|---|---|
${topBroadcastsTable || '| — | （配信なし） | — | — |'}

以下の構成で、Markdown レポートを作成してください：

# ${input.yearMonth} 月次運用レポート

## 📊 今月のハイライト
（数字を踏まえた要約 3 行）

## ✨ 良かった点
（具体的な配信や数字を引用しながら）

## 📌 課題と改善ポイント
（数字から見える課題、原因の仮説）

## 🚀 来月のアクション提案
（具体的な配信ネタ案、シナリオ改善案、KPI 修正案）

## 📅 来月の運用カレンダー（提案）
（月内の配信スケジュール案）

最後に、事業者様への一言メッセージで締めてください。`;

  return { system: SYSTEM_PROMPT, user };
}

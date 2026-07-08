/**
 * 月次 AI レポート生成のプロンプト集約
 *
 * 旧 ccPrompts の「ダッシュボードのKPI分析」「コンバージョン分析」
 * 「友だちのセグメント分析」「シナリオの効果分析」を統合した骨格。
 *
 * 入力データを受けて、「日本人らしい運用代行レポート」の Markdown を生成する。
 */

export interface MonthlyAnalysis {
  overallScore: number;
  verdict: 'good' | 'warn' | 'bad';
  headline: string;
  strengths: Array<{ title: string; detail: string; metric?: string }>;
  issues: Array<{ title: string; detail: string; severity: 'high' | 'medium' | 'low'; metric?: string }>;
  strategies: Array<{ priority: number; title: string; why: string; how: string[]; expected: string }>;
  plan: Array<{ week: string; theme: string; type: string; segment: string; goal: string }>;
  actions: Array<{ category: string; task: string; owner: string; due: string; status: 'todo' | 'doing' }>;
}

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
クライアント企業の事業者様の月次運用を分析し、運用チーム向けの「改善・戦略・次月アクション」を構造化データ(JSON)で出力します。

【分析ルール】
- 与えられた数字(実データ)を根拠に、具体的に分析する。数字に基づかない断定はしない
- 良かった点(strengths) / 課題(issues) / 来月の戦略(strategies) / 配信プラン(plan) / アクション(actions) を必ず埋める
- 具体的な配信例・施策案を提示する(抽象論で終わらせない)
- 日本人の事業者向けの自然な日本語。翻訳調・直訳調を避ける。ですます調は不要、簡潔な体言止め/言い切りで良い
- データが乏しい月でも、取得できた数字の範囲で誠実に評価し、無理に高評価にしない

【出力形式】
必ず次の JSON オブジェクトのみを出力する(前後に説明文やコードフェンスを付けない):
{
  "overallScore": <0-100 の整数。今月の運用総合評価>,
  "verdict": "good" | "warn" | "bad",
  "headline": "<今月の総括を 2〜3 文で>",
  "strengths": [{ "title": "<強みの見出し>", "detail": "<根拠と数字を含む説明>", "metric": "<代表数値(任意)>" }],
  "issues": [{ "title": "<課題の見出し>", "detail": "<原因仮説を含む説明>", "severity": "high"|"medium"|"low", "metric": "<代表数値(任意)>" }],
  "strategies": [{ "priority": <1からの整数>, "title": "<施策名>", "why": "<なぜやるか>", "how": ["<具体手順1>", "<具体手順2>"], "expected": "<期待効果>" }],
  "plan": [{ "week": "<例: 6月 第1週>", "theme": "<配信テーマ>", "type": "<クーポン/キャンペーン/予約案内/通常投稿/お役立ち/アンケート>", "segment": "<対象セグメント>", "goal": "<目標>" }],
  "actions": [{ "category": "<カテゴリ>", "task": "<タスク>", "owner": "<担当>", "due": "<期日 例: 6/5>", "status": "todo"|"doing" }]
}
- strengths/issues は各 2〜4 件、strategies は 2〜3 件、plan は 3〜4 件、actions は 4〜7 件を目安`;

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

上記の実データを根拠に、システムプロンプトで指定した JSON オブジェクトのみを出力してください。`;

  return { system: SYSTEM_PROMPT, user };
}

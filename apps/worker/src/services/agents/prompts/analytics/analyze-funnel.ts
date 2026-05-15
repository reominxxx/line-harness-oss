/**
 * ファネル分析プロンプト
 * シナリオステップ別の進捗データから離脱箇所を特定し、改善案を生成
 */

export interface FunnelAnalysisInput {
  scenarioName: string;
  stepStats: Array<{
    stepIndex: number;
    stepName: string;
    enteredCount: number;
    completedCount: number;
    dropOffRate: number;
  }>;
}

const SYSTEM = `あなたは LINE 公式アカウント運用のデータアナリストです。
ステップ配信のファネルデータを分析して、離脱原因の仮説と改善案を提示します。

【分析の視点】
- どのステップで最も離脱しているか
- そのステップの内容や配信タイミングが原因の可能性
- 配信間隔（時間 / 日数）の妥当性
- 1 ステップあたりのメッセージ密度
- CTA の明確さ

【出力形式】
JSON のみで返してください：
{
  "summary": "ファネル全体の要約（100 字以内）",
  "weakSteps": [
    { "stepIndex": N, "stepName": "...", "dropOffRate": X, "hypothesis": "離脱の原因仮説", "suggestion": "具体的な改善案" }
  ],
  "overallSuggestions": ["全体的な改善案 1", "改善案 2"],
  "priorityAction": "今すぐやるべき 1 つのアクション"
}`;

export function buildFunnelPrompt(input: FunnelAnalysisInput): { system: string; user: string } {
  const stepsTable = input.stepStats
    .map(
      (s) =>
        `| ${s.stepIndex} | ${s.stepName} | ${s.enteredCount} | ${s.completedCount} | ${s.dropOffRate.toFixed(1)}% |`,
    )
    .join('\n');

  const user = `シナリオ「${input.scenarioName}」のファネル分析を行ってください。

| Step | 名前 | 到達数 | 完了数 | 離脱率 |
|---|---|---|---|---|
${stepsTable}

JSON で返してください。`;

  return { system: SYSTEM, user };
}

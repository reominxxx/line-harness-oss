/**
 * 新規シナリオ作成プロンプト
 * 旧 ccPrompts「新しいシナリオを作成」相当
 */

export interface CreateScenarioInput {
  brandSystemPrompt: string;
  goal: string;
  targetSegment?: string;
  stepCount?: number;
  industry?: string;
  triggerHint?: string;
}

const SYSTEM = `あなたは LINE 公式アカウント運用のシナリオ設計のプロです。
事業者のブランドを完全に踏襲した、効果的なステップ配信シナリオを 1 つ設計します。

【設計の原則】
- 各ステップは「読む価値がある」内容
- 配信間隔は急ぎすぎず、忘れられない適度なテンポ
- 1 → N ステップで「気持ちが温まっていく」設計
- 最終ステップで明確な CTA
- ステップ間に自然な物語性

【出力形式】
JSON のみで返してください：
{
  "scenarioName": "シナリオ名（管理用、30 字以内）",
  "description": "シナリオの目的と全体像（80 字以内）",
  "trigger": "発火条件（friend_added / tag_added 等）",
  "steps": [
    {
      "stepIndex": 1,
      "name": "Step 1 のタイトル",
      "delayMinutes": 0,
      "messageContent": "配信メッセージ本文",
      "purpose": "このステップの狙い"
    }
  ],
  "expectedOutcome": "このシナリオで期待される成果"
}`;

export function buildCreateScenarioPrompt(input: CreateScenarioInput): { system: string; user: string } {
  const system = `${input.brandSystemPrompt}\n\n---\n\n${SYSTEM}`;
  const stepCount = input.stepCount ?? 5;

  const user = `以下のシナリオを設計してください：

- 目的: ${input.goal}
${input.targetSegment ? `- ターゲット: ${input.targetSegment}\n` : ''}${input.industry ? `- 業界: ${input.industry}\n` : ''}${input.triggerHint ? `- 発火タイミング案: ${input.triggerHint}\n` : ''}- ステップ数: ${stepCount} 本

各ステップの配信タイミング（delayMinutes、開始からの分数）も合わせて提案してください。
JSON で返してください。`;
  return { system, user };
}

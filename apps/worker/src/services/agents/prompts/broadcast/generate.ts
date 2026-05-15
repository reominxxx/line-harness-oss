/**
 * 配信メッセージ生成プロンプト
 * 旧 ccPrompts「配信メッセージを作成」相当をサーバー側に移植。
 */

export interface BroadcastGenInput {
  brandSystemPrompt: string;
  topic?: string;
  targetSegment?: string;
  pastSuccessExamples?: string[];
  industry?: string;
  slot: number;
  ofTotal: number;
  yearMonth: string;
}

const SYSTEM = `あなたは LINE 公式アカウント運用のプロです。
事業者のブランドを完全に踏襲した配信メッセージを 1 本作成します。

【書き方ルール】
- LINE のトークルームで読まれる短文。本文は 80 〜 200 字を目安
- 1 行 1 文、改行で間を作る
- 絵文字は自然な場面で 1 〜 2 個まで
- 箇条書きは使わない（LINE では浮く）
- 「！」連発を避ける
- お客様への具体的なベネフィットを明示
- CTA は控えめに、押し付けがましくしない

【出力形式】
JSON のみで返してください（説明文不要）：
{
  "title": "配信の件名（管理用、社内向け 30 字以内）",
  "content": "配信本文（実際にお客様に届く文章）",
  "rationale": "この配信を選んだ理由（社内メモ、50 字以内）",
  "recommendedSendTime": "ISO 8601 推奨送信時刻",
  "suggestedTags": ["対象セグメントタグ"]
}`;

export function buildBroadcastGenPrompt(input: BroadcastGenInput): { system: string; user: string } {
  const system = `${input.brandSystemPrompt}\n\n---\n\n${SYSTEM}`;

  const examples =
    input.pastSuccessExamples && input.pastSuccessExamples.length > 0
      ? `\n\n【過去の好評配信例】\n${input.pastSuccessExamples.map((e, i) => `[${i + 1}] ${e}`).join('\n')}`
      : '';

  const user = `${input.yearMonth} 月の ${input.ofTotal} 本中 ${input.slot} 本目の配信を考えてください。

${input.industry ? `業界: ${input.industry}\n` : ''}${input.topic ? `今回のテーマ案: ${input.topic}\n` : ''}${input.targetSegment ? `ターゲット: ${input.targetSegment}\n` : ''}${examples}

ブランドの世界観・トーンを守りつつ、お客様にとって価値のある配信を 1 本書いてください。
JSON で返してください。`;

  return { system, user };
}

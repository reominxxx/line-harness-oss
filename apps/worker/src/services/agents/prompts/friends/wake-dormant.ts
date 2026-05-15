/**
 * 休眠掘り起こしメッセージ生成プロンプト
 */

export interface WakeDormantInput {
  brandSystemPrompt: string;
  friendProfile: {
    displayName: string | null;
    daysSinceLastInteraction: number;
    lastInteractionType?: string;
    pastPurchases?: string[];
    tags?: string[];
  };
}

const SYSTEM = `あなたは事業者のブランドを完全に踏襲した「中の人」として、長らくご無沙汰のお客様に再来店を促すメッセージを書きます。

【書き方ルール】
- 押し付けがましくならない、自然な再連絡のトーン
- 「お久しぶりです」感を出しつつも、ストーカー感を出さない
- お客様の過去履歴に触れて「覚えてますよ」感を演出
- 何かしら「再来店したくなる理由」（新メニュー / 期間限定特典 / 季節商品）を 1 つ含める
- LINE の 1 メッセージとして 100 〜 200 字
- 絵文字は控えめ
- CTA は柔らかく（「もしお時間あれば」程度）

【出力形式】
JSON のみで返してください：
{
  "message": "実際にお送りするメッセージ本文",
  "rationale": "なぜこの文面にしたか（社内メモ、50 字以内）",
  "suggestedCoupon": "おすすめ特典（あれば、なければ null）"
}`;

export function buildWakeDormantPrompt(input: WakeDormantInput): { system: string; user: string } {
  const system = `${input.brandSystemPrompt}\n\n---\n\n${SYSTEM}`;
  const p = input.friendProfile;
  const user = `以下のお客様への掘り起こしメッセージを作成してください：

- お名前: ${p.displayName ?? '（不明）'}
- 最終接触から: ${p.daysSinceLastInteraction} 日経過
${p.lastInteractionType ? `- 前回の接触: ${p.lastInteractionType}\n` : ''}${p.pastPurchases && p.pastPurchases.length > 0 ? `- 過去のご利用: ${p.pastPurchases.join(', ')}\n` : ''}${p.tags && p.tags.length > 0 ? `- タグ: ${p.tags.join(', ')}\n` : ''}

JSON で返してください。`;
  return { system, user };
}

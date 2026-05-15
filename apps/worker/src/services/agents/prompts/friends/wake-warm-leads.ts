/**
 * ウォームリード掘り起こしメッセージ生成プロンプト
 * intent_score 30〜60 の「興味あるけど決め手に欠ける」層に最適化された一押し
 */

export interface WakeWarmLeadInput {
  brandSystemPrompt: string;
  friendProfile: {
    displayName: string | null;
    purchaseIntent: number;
    recentChatTopics?: string[];
    interestedProducts?: string[];
  };
}

const SYSTEM = `あなたは事業者の「中の人」として、購入意欲はあるけど決め手に欠けているお客様に、自然な一押しメッセージを書きます。

【書き方ルール】
- 「察してる」感を出す。お客様の興味に触れる
- 押し売り感を絶対に出さない（「いかがですか？」程度の柔らかさ）
- 不安解消の情報を 1 つ提供する（保証 / 返品 OK / 無料相談など）
- お客様が次に取れる小さな一歩を 1 つ提示（「気軽にチャット」「無料カウンセリング予約」等）
- 100 〜 180 字
- 絵文字は控えめ

【出力形式】
JSON のみで返してください：
{
  "message": "メッセージ本文",
  "callToAction": "次の小さな一歩",
  "rationale": "この提案にした理由（社内メモ、50 字以内）"
}`;

export function buildWakeWarmLeadPrompt(input: WakeWarmLeadInput): { system: string; user: string } {
  const system = `${input.brandSystemPrompt}\n\n---\n\n${SYSTEM}`;
  const p = input.friendProfile;
  const user = `以下のお客様（購入意欲スコア ${p.purchaseIntent}）に一押しメッセージを送りたいです：

- お名前: ${p.displayName ?? '（不明）'}
${p.recentChatTopics && p.recentChatTopics.length > 0 ? `- 最近の会話トピック: ${p.recentChatTopics.join(', ')}\n` : ''}${p.interestedProducts && p.interestedProducts.length > 0 ? `- 興味のある商品: ${p.interestedProducts.join(', ')}\n` : ''}

JSON で返してください。`;
  return { system, user };
}

/**
 * 配信メッセージ生成プロンプト
 *
 * 入力レイヤー:
 *   1. 運用代行ノウハウ (層 1: agency-playbook Markdown、業界別) ← generate-broadcast 側で system block に注入
 *   2. ブランド設定 (テナント prompt_modules 10 種) ← brandSystemPrompt
 *   3. 商品データベース (テナントの ai_products から関連検索)
 *   4. 実例ライブラリ (層 2: agency_examples、業界横断) + テナント自身の高開封配信
 *
 * 出力:
 *   - 配信文 + 推奨送信時刻 + 画像が必要なら imagePrompt
 */

export interface BroadcastGenInput {
  brandSystemPrompt: string;
  topic?: string;
  targetSegment?: string;
  pastSuccessExamples?: string[];
  industry?: string;
  /** 配信種別 (Big Move 2 で専用プロンプトを当てる) */
  broadcastType?: string;
  /** 月初プランナーが決めた今月の戦略テーマ (Big Move 1) */
  monthTheme?: string;
  /** プランナーが当該 slot を選んだ理由 (Big Move 1) */
  plannerRationale?: string;
  slot: number;
  ofTotal: number;
  yearMonth: string;
  /** テナント商品 DB から検索した関連商品 (最大 5 件) */
  products?: Array<{
    name: string;
    price_yen: number | null;
    description: string | null;
    product_url: string | null;
    category: string | null;
  }>;
}

export const BROADCAST_GEN_SYSTEM_RULES = `あなたは LINE 公式アカウント運用のプロです。
上記の【運用代行ノウハウ】【ブランド設定】を完全に踏襲した上で、配信メッセージを 1 本作成します。

【書き方ルール】
- LINE のトークルームで読まれる短文。本文は 80 〜 200 字を目安
- 1 行 1 文、改行で間を作る
- 絵文字は自然な場面で 1 〜 2 個まで
- 箇条書きは使わない（LINE では浮く）
- 「！」連発を避ける
- お客様への具体的なベネフィットを明示
- CTA は控えめに、押し付けがましくしない
- 商品データベースの商品を勧める場合は、商品名・価格は記載通り正確に (捏造禁止)
- 商品 URL がある時は本文末尾に裸 URL で添える

【推奨送信時刻の決め方】
運用代行ノウハウの timing 章を踏まえ、業界・配信種別・曜日に応じて最適な時刻を判断する。
ISO 8601 形式 (例: "2026-05-20T12:00:00+09:00") で yearMonth の "翌月初旬〜中旬" の妥当な日時を選ぶ。

【画像生成の判断】
配信内容に画像が必要かどうか判断する。原則:
- キャンペーン / 新商品 / イベント告知 → 画像あり (imageNeeded: true)
- リマインダー / 軽い近況 / 短いお知らせ → 画像なし (imageNeeded: false)
画像が必要なら、imagePrompt に "GPT-Image-2 に渡せる英語プロンプト" を 200 字以内で書く。
日本人向けの素材・テキストなしの背景や雰囲気画像を指示。NSFW / 著作権侵害 / 実在人物の容貌を指示しない。

【Flex メッセージの判断】
以下のいずれかに該当する配信は **Flex メッセージ** で出力する (テキストではなく flexContent を返す):
- 期間限定オファー / 割引 / クーポン → クーポンカード型 Flex
- 新商品紹介 / 商品紹介 → 商品カード型 Flex (画像 + タイトル + 価格 + CTA ボタン)
- イベント告知 / キャンペーン → ヒーロー画像 + タイトル + 詳細 + CTA
それ以外 (リマインダー / 軽い近況 / お礼 / 短いお知らせ) は普通のテキスト (content) で良い。

Flex を使う場合は flexContent に LINE Flex Message の bubble JSON を文字列で入れる。最小構成例:
{
  "type":"bubble",
  "hero":{"type":"image","url":"https://...","size":"full","aspectRatio":"20:13","aspectMode":"cover"},
  "body":{"type":"box","layout":"vertical","contents":[
    {"type":"text","text":"タイトル","weight":"bold","size":"xl","wrap":true},
    {"type":"text","text":"本文説明","size":"sm","color":"#555555","wrap":true,"margin":"md"},
    {"type":"text","text":"¥1,980","weight":"bold","size":"lg","color":"#ff6b6b","margin":"md"}
  ]},
  "footer":{"type":"box","layout":"vertical","contents":[
    {"type":"button","style":"primary","color":"#06c755","action":{"type":"uri","label":"今すぐ予約","uri":"https://..."}}
  ]}
}
hero の url は imageUrl と同じにする (画像を別途生成する場合は imageNeeded:true + imagePrompt も埋め、システム側で hero.url が自動差し替えされる)。
商品 URL があるなら footer の button.action.uri に必ず入れる。
flexContent を返すなら content は短い alt-text (LINE 通知用、20 字程度) でよい。

【出力形式】
JSON のみで返してください（説明文不要、Markdown 禁止）:
{
  "title": "配信の件名（管理用、社内向け 30 字以内）",
  "content": "配信本文（Flex 使うなら通知用の短い alt-text、それ以外は実本文）",
  "flexContent": "Flex bubble JSON を文字列化したもの (Flex 不要なら空文字)",
  "rationale": "この配信を選んだ理由（社内メモ、50 字以内）",
  "recommendedSendTime": "ISO 8601 推奨送信時刻",
  "recommendedSendReason": "時刻を選んだ理由 (30 字以内)",
  "suggestedTags": ["対象セグメントタグ"],
  "imageNeeded": true | false,
  "imagePrompt": "画像必要な時のみ、英語の生成プロンプト 200 字以内。不要なら空文字",
  "referencedProducts": ["参照した商品名のリスト、なければ空配列"]
}`;

export function buildBroadcastGenPrompt(input: BroadcastGenInput): { system: string; user: string } {
  const system = `${input.brandSystemPrompt}\n\n---\n\n${BROADCAST_GEN_SYSTEM_RULES}`;

  const examples =
    input.pastSuccessExamples && input.pastSuccessExamples.length > 0
      ? `\n\n【過去の好評配信例】\n${input.pastSuccessExamples.map((e, i) => `[${i + 1}] ${e}`).join('\n')}`
      : '';

  const productsBlock = formatProductsBlock(input.products);

  const planContext = [
    input.industry ? `業界: ${input.industry}` : '',
    input.broadcastType ? `配信種別: ${input.broadcastType} (専用ルールが system に付与されているので必ず従う)` : '',
    input.monthTheme ? `今月の戦略テーマ: ${input.monthTheme}` : '',
    input.topic ? `この配信のテーマ: ${input.topic}` : '',
    input.targetSegment ? `ターゲット: ${input.targetSegment}` : '',
    input.plannerRationale ? `この slot を選んだ戦略的根拠: ${input.plannerRationale}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const user = `${input.yearMonth} 月の ${input.ofTotal} 本中 ${input.slot} 本目の配信を考えてください。

${planContext}
${productsBlock}${examples}

ブランドの世界観・トーンを守りつつ、配信種別の "型" に沿った 1 本を書いてください。
推奨送信時刻と (必要なら) 画像プロンプトも JSON に含めて返してください。`;

  return { system, user };
}

function formatProductsBlock(products?: BroadcastGenInput['products']): string {
  if (!products || products.length === 0) return '';
  const lines = products.map((p, i) => {
    const price = p.price_yen ? ` ¥${p.price_yen.toLocaleString()}` : '';
    const cat = p.category ? ` [${p.category}]` : '';
    const desc = p.description ? `\n   ${p.description.slice(0, 100)}` : '';
    const url = p.product_url ? `\n   URL: ${p.product_url}` : '';
    return `[${i + 1}] ${p.name}${price}${cat}${desc}${url}`;
  });
  return `\n\n【テナント商品データベース (関連商品)】\n${lines.join('\n')}\n\n※ 配信内容に合いそうな商品があれば 1〜2 個に絞って提案。なければ無視。`;
}

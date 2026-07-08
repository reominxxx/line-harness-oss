/**
 * 配信 (broadcast) 文言を生成するための kind 別プロンプト。
 *
 * 入力 context:
 *   - title?: 配信タイトル / テーマ (ユーザーが既に入力していれば)
 *   - hint?: ユーザーが追加で渡したヒント
 *   - targetSegment?: 配信対象セグメント (ある場合)
 *   - brandPrompt: assembleSystemPrompt で組み立てたブランド prompt
 *   - playbookText: buildAgencyPlaybookText の結果 (業界別ノウハウ)
 */

export interface BroadcastGenContext {
  title?: string;
  hint?: string;
  targetSegment?: string;
  brandPrompt: string;
  playbookText: string;
}

export function buildBroadcastSystem(): string {
  return `あなたは LINE 公式アカウント運用代行のコピーライターです。
配信メッセージの本文を 1 案だけ生成してください。

【守るべきこと】
- LINE で読みやすい長さ (200〜350 文字)
- 改行を適切に入れて読みやすく
- 売り込みすぎず、相手の状況に寄り添う書き出し
- 最後に行動喚起 (CTA) を 1 つ
- 件名や前置きは出力しない。本文だけ

【絶対やらないこと】
- 「シンプルなご質問ですね」など AI らしいメタ発言
- 「そうすると」など不自然な接続詞
- 価格を本文中に書く (商品カードで表示される前提)
- 連続した質問返し`;
}

export function buildBroadcastUser(ctx: BroadcastGenContext): string {
  return `【ブランド設定】
${ctx.brandPrompt}

【業界ノウハウ】
${ctx.playbookText}

【今回の配信】
- タイトル / テーマ: ${ctx.title || '(未指定)'}
- 配信対象: ${ctx.targetSegment || '全友だち'}
- 追加ヒント: ${ctx.hint || '(なし)'}

このブランドの世界観で、配信本文を 1 案だけ生成してください。本文のみ。`;
}

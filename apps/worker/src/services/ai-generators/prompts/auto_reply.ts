/**
 * 自動返信 (auto-reply) のレスポンス文を生成するプロンプト。
 *
 * 入力 context:
 *   - keyword: ユーザーが入力したトリガーキーワード (例: "予約", "営業時間")
 *   - hint?: ユーザー追加ヒント
 *   - brandPrompt
 *   - playbookText
 */

export interface AutoReplyGenContext {
  keyword: string;
  hint?: string;
  brandPrompt: string;
  playbookText: string;
}

export function buildAutoReplySystem(): string {
  return `あなたは LINE 公式アカウントの自動返信文を書くコピーライターです。
特定のキーワードが届いたときに即座に返す自動応答を 1 案だけ生成します。

【守るべきこと】
- 80〜180 文字。短く要点を絞る
- 「○○に関するご質問ありがとうございます」みたいな前置きは入れない
- 即座に必要な情報を返す (営業時間・予約導線・FAQ 等)
- 最後に必要なら「詳しくはこちら」みたいな 1 行 CTA
- 改行は 1〜2 箇所まで

【絶対やらないこと】
- 「シンプルなご質問」「いいご質問」みたいな評論
- 値段を本文に書く (キャンペーン外)
- 長すぎる説明`;
}

export function buildAutoReplyUser(ctx: AutoReplyGenContext): string {
  return `【ブランド設定】
${ctx.brandPrompt}

【業界ノウハウ】
${ctx.playbookText}

【トリガーキーワード】
${ctx.keyword}

【追加ヒント】
${ctx.hint || '(なし)'}

このキーワードを送ってきたユーザーに、即座に返す自動応答文を 1 案だけ生成してください。本文のみ。`;
}

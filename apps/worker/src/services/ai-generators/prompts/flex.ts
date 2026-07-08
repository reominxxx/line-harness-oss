/**
 * LINE Flex Message の JSON を生成するプロンプト。
 *
 * テキスト系と異なり、ここでは LINE Messaging API の Flex Message 仕様に
 * 沿った 1 つの bubble の JSON を出力させる。複雑な carousel は避け、
 * シンプルな縦積み (hero画像 + body見出し+本文 + footer ボタン) に限定する。
 *
 * 入力 context:
 *   - title?: 配信タイトル (ヒント)
 *   - topic?: メイン訴求テーマ
 *   - targetSegment?: 配信対象
 *   - hint?: 追加要望 (色味、文言、CTA テキスト等)
 *   - brandPrompt
 *   - playbookText
 */

export interface FlexGenContext {
  title?: string;
  topic?: string;
  targetSegment?: string;
  hint?: string;
  brandPrompt: string;
  playbookText: string;
}

export function buildFlexSystem(): string {
  return `あなたは LINE 公式アカウント運用代行のクリエイティブディレクターです。
LINE Messaging API の Flex Message (1 bubble) を JSON で生成します。

【出力ルール】
- 必ず単一の bubble (carousel は使わない)
- JSON のみ出力 (Markdown コードフェンス・コメント・前置きなし)
- type: "bubble" がトップレベル
- 構造の基本: header (任意) / hero (任意) / body (必須) / footer (任意)
- 文字数の目安:
  - 見出し: 15-25 字
  - 本文: 40-100 字
  - ボタン文言: 6-12 字
- 色は brand に合った 1〜2 色に絞る (派手すぎない)
- ボタンの action は postback or uri (action.type)
- action.label は 6-12 字以内
- 画像 URL は https://placehold.co/{w}x{h}/EFEFEF/AAAAAA?text=... のプレースホルダで OK
- フォントサイズ: heading=lg or xl, body=sm or md, footer=sm

【絶対 NG】
- 過度に長い本文 (200 字超は読まれない)
- 4 つ以上のボタン (LINE 上で押しにくい)
- 視認性の低い背景色 + 文字色の組合せ

【参考最小スケルトン】
{
  "type": "bubble",
  "hero": {
    "type": "image",
    "url": "https://placehold.co/1040x520/E8F4FD/0066CC?text=Hero",
    "size": "full",
    "aspectRatio": "20:10",
    "aspectMode": "cover"
  },
  "body": {
    "type": "box",
    "layout": "vertical",
    "spacing": "md",
    "contents": [
      { "type": "text", "text": "見出し", "weight": "bold", "size": "xl", "wrap": true },
      { "type": "text", "text": "本文 (60〜100 字)", "size": "sm", "color": "#666666", "wrap": true }
    ]
  },
  "footer": {
    "type": "box",
    "layout": "vertical",
    "spacing": "sm",
    "contents": [
      {
        "type": "button",
        "style": "primary",
        "color": "#06C755",
        "action": { "type": "uri", "label": "予約する", "uri": "https://example.com" }
      }
    ]
  }
}`;
}

export function buildFlexUser(ctx: FlexGenContext): string {
  return `【ブランド設定】
${ctx.brandPrompt}

【業界ノウハウ】
${ctx.playbookText}

【この配信について】
- タイトル / テーマ: ${ctx.title || ctx.topic || '(指定なし)'}
- 配信対象: ${ctx.targetSegment || '(全友だち)'}
- 追加要望: ${ctx.hint || '(なし)'}

このテーマと配信対象に最適な Flex Message JSON を 1 つ生成してください。
JSON のみ出力 (前後の説明文・コードフェンスは一切不要)。`;
}

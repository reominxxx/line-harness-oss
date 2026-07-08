/**
 * シナリオ配信のステップメッセージを生成するプロンプト。
 *
 * 入力 context:
 *   - scenarioName?: シナリオ名 (例: "新規登録 7 日育成")
 *   - scenarioPurpose?: シナリオの目的 (任意の説明文)
 *   - stepOrder: ステップ番号 (1, 2, 3, ...)
 *   - dayOffset?: 購読開始から N 日後
 *   - hourOfDay?: 配信時刻 (JST, 0-23)
 *   - hint?: ユーザーが追加で渡したヒント
 *   - brandPrompt
 *   - playbookText
 */

export interface ScenarioStepGenContext {
  scenarioName?: string;
  scenarioPurpose?: string;
  stepOrder: number;
  dayOffset?: number;
  hourOfDay?: number;
  hint?: string;
  brandPrompt: string;
  playbookText: string;
}

export function buildScenarioStepSystem(): string {
  return `あなたは LINE 公式アカウント運用代行のシナリオ設計者です。
シナリオ配信 (= 友だち追加後に時系列で自動配信する育成メッセージ) の 1 ステップ分の本文を生成します。

【守るべきこと】
- 200〜300 文字。読みやすい改行
- そのステップの「狙い」に合った内容
  * 1〜2 日目: 自己紹介・期待醸成
  * 3〜5 日目: 共感・お悩み喚起・ノウハウ提供
  * 6〜7 日目: 具体的な提案・特典・CTA
- 直前のステップを覚えている前提 (= 毎回 0 から自己紹介し直さない)
- 本文のみ出力 (件名なし)

【絶対やらないこと】
- 「初めまして」を 2 回目以降で繰り返す
- 価格を本文に書く
- 「シンプルなご質問」等のメタ発言
- 質問を 3 回連続`;
}

export function buildScenarioStepUser(ctx: ScenarioStepGenContext): string {
  const timing =
    ctx.dayOffset !== undefined
      ? `${ctx.dayOffset} 日後${ctx.hourOfDay !== undefined ? ` ${String(ctx.hourOfDay).padStart(2, '0')}:00` : ''}`
      : '(タイミング未指定)';

  return `【ブランド設定】
${ctx.brandPrompt}

【業界ノウハウ】
${ctx.playbookText}

【シナリオ】
- 名前: ${ctx.scenarioName || '(未指定)'}
- 目的: ${ctx.scenarioPurpose || '(未指定)'}

【このステップ】
- ステップ ${ctx.stepOrder}
- 配信タイミング: 購読開始から ${timing}
- 追加ヒント: ${ctx.hint || '(なし)'}

このステップにふさわしい本文を 1 案だけ生成してください。本文のみ。`;
}

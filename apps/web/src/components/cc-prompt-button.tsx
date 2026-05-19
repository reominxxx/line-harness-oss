'use client'

import type { PromptTemplate } from '@/components/prompt-modal'

interface CcPromptButtonProps {
  prompts: PromptTemplate[]
}

/**
 * @deprecated
 * 「CC に依頼」ボタンは AI アシスタント (💬 サイドチャット + ✨ AI ボタン) に置き換えられ廃止しました。
 * このコンポーネントは何も描画しません。既存ページの import を保ったまま機能だけ無効化しています。
 * 後日 import 自体を削除する予定。
 */
export default function CcPromptButton(_props: CcPromptButtonProps) {
  return null
}

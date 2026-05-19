/**
 * AI 自動化エンジンの共通型定義
 */

import type { AgentJobRow } from '@line-crm/db';

export interface JobContext {
  job: AgentJobRow;
  db: D1Database;
  /** ANTHROPIC_API_KEY (Claude 文章生成用) */
  apiKey: string;
  /** OPENAI_API_KEY (GPT-Image-2 画像生成用、未設定なら画像生成スキップ) */
  openaiApiKey?: string;
  lineAccountId: string;
  /** R2 などのリソース用（指定なしでも基本動作は可）*/
  bucket?: R2Bucket;
  workerUrl?: string;
}

export interface JobResult {
  /** ジョブの最終出力（output_json に保存される） */
  output: Record<string, unknown>;
  /** AI 呼び出し総コスト */
  costYenX100: number;
  /** ジョブの最終 status を強制したい場合（指定なければ executor 側で policy 判断） */
  forceStatus?: 'review' | 'completed';
  /** 完了時に実行する後処理（例: broadcasts に予約挿入） */
  postAction?: () => Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

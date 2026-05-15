/**
 * Post Actions
 *
 * agent_jobs が status='approved' になったときに呼ばれるハンドラ。
 * AI が生成した output_json を、実際のテーブル（broadcasts / scenarios / 等）に
 * 反映する役割を担う。
 *
 * 各 post-action は失敗しても agent_jobs.status='approved' のまま残るので、
 * 後で手動リトライ可能。成功時は status='completed' に進める。
 */

import type { AgentJobRow } from '@line-crm/db';
import { handleBroadcastPost } from './broadcast-post.js';
import { handleScenarioPost } from './scenario-post.js';
import { handleWakeMessagesPost } from './wake-messages-post.js';

export interface PostActionContext {
  job: AgentJobRow;
  db: D1Database;
  lineAccountId: string;
}

export interface PostActionResult {
  ok: boolean;
  createdResource?: string;       // 作成したリソース ID
  createdResourceType?: string;   // 'broadcast' | 'scenario' | 'tag_assignment'
  error?: string;
  notes?: string;
}

export type PostAction = (ctx: PostActionContext) => Promise<PostActionResult>;

export const POST_ACTIONS: Record<string, PostAction> = {
  generate_broadcast: handleBroadcastPost,
  create_scenario: handleScenarioPost,
  wake_dormant: handleWakeMessagesPost,
  wake_warm_leads: handleWakeMessagesPost,
};

export function getPostAction(jobType: string): PostAction | null {
  return POST_ACTIONS[jobType] ?? null;
}

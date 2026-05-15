/**
 * 新シナリオ案 → scenarios + scenario_steps への挿入
 *
 * create_scenario の output_json が以下の形であることを期待:
 *   {
 *     scenarioName: "..."
 *     description: "..."
 *     trigger: "friend_add" | "tag_added" | "manual"
 *     steps: [
 *       { stepIndex: 1, name: "...", delayMinutes: N, messageContent: "..." }
 *     ]
 *   }
 *
 * is_active = 0 で作成する（事業者が手動で有効化する想定）。
 */

import { jstNow } from '@line-crm/db';
import type { PostActionContext, PostActionResult } from './index.js';

export async function handleScenarioPost(ctx: PostActionContext): Promise<PostActionResult> {
  const { job, db } = ctx;

  if (!job.output_json) return { ok: false, error: 'no output_json' };

  let parsed: {
    scenarioName?: string;
    description?: string;
    trigger?: string;
    steps?: Array<{
      stepIndex?: number;
      name?: string;
      delayMinutes?: number;
      messageContent?: string;
    }>;
  };
  try {
    parsed = JSON.parse(job.output_json);
  } catch {
    return { ok: false, error: 'output_json parse failed' };
  }

  const name = parsed.scenarioName || `自動生成シナリオ ${new Date().toLocaleDateString('ja-JP')}`;
  const description = parsed.description ?? null;
  const triggerType = ['friend_add', 'tag_added', 'manual'].includes(parsed.trigger ?? '')
    ? parsed.trigger!
    : 'manual';

  if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    return { ok: false, error: 'output.steps is empty' };
  }

  const scenarioId = crypto.randomUUID();
  const now = jstNow();

  try {
    await db
      .prepare(
        `INSERT INTO scenarios (id, name, description, trigger_type, is_active, delivery_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 'relative', ?, ?)`,
      )
      .bind(scenarioId, name.slice(0, 200), description, triggerType, now, now)
      .run();

    let inserted = 0;
    for (const [i, s] of parsed.steps.entries()) {
      const order = s.stepIndex ?? i + 1;
      const delay = Math.max(s.delayMinutes ?? 0, 0);
      const content = s.messageContent;
      if (!content) continue;
      await db
        .prepare(
          `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, created_at)
           VALUES (?, ?, ?, ?, 'text', ?, ?)`,
        )
        .bind(crypto.randomUUID(), scenarioId, order, delay, content, now)
        .run();
      inserted++;
    }

    if (inserted === 0) {
      return { ok: false, error: 'no valid steps inserted' };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'scenario insert failed' };
  }

  return {
    ok: true,
    createdResource: scenarioId,
    createdResourceType: 'scenario',
    notes: `シナリオを作成しました（無効状態。/scenarios で有効化してください）`,
  };
}

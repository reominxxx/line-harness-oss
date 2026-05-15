/**
 * プレイブック適用ロジック
 *
 * 1 つのテナントに対して、業界プレイブックを一括投入：
 *  - プロンプトモジュール 8 種を upsert + 新バージョン作成
 *  - KPI 目標 を upsert（指定月）
 *  - シナリオ 3〜5 本を新規作成（is_active=0 で安全に）
 *
 * 既存データがある場合の挙動:
 *  - プロンプトモジュール: 新バージョンとして追加（過去版は履歴で残る）
 *  - KPI: 上書き（target_value のみ）
 *  - シナリオ: 同名が既にあればスキップ
 */

import {
  upsertPromptModule,
  createPromptModuleVersion,
  upsertKpiGoal,
  jstNow,
} from '@line-crm/db';
import type { IndustryPlaybook } from './types.js';

export interface ApplyResult {
  promptsApplied: number;
  kpisApplied: number;
  scenariosApplied: number;
  scenariosSkipped: number;
  errors: string[];
}

export async function applyPlaybook(
  db: D1Database,
  lineAccountId: string,
  playbook: IndustryPlaybook,
  options: {
    yearMonth?: string;
    overwriteKpi?: boolean;
  } = {},
): Promise<ApplyResult> {
  const result: ApplyResult = {
    promptsApplied: 0,
    kpisApplied: 0,
    scenariosApplied: 0,
    scenariosSkipped: 0,
    errors: [],
  };

  const yearMonth = options.yearMonth ?? new Date().toISOString().slice(0, 7);

  // 1. プロンプトモジュール
  for (const m of playbook.promptModules) {
    try {
      const module = await upsertPromptModule(db, lineAccountId, m.type);
      await createPromptModuleVersion(db, {
        moduleId: module.id,
        lineAccountId,
        content: m.content,
        note: `${playbook.label} プレイブック適用`,
      });
      result.promptsApplied++;
    } catch (e) {
      result.errors.push(`prompt[${m.type}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. KPI 目標
  for (const k of playbook.kpis) {
    try {
      await upsertKpiGoal(db, {
        lineAccountId,
        yearMonth,
        metric: k.metric,
        targetValue: k.recommendedTarget,
        notes: k.notes,
      });
      result.kpisApplied++;
    } catch (e) {
      result.errors.push(`kpi[${k.metric}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. シナリオ（同名チェックしてスキップ）
  for (const s of playbook.scenarios) {
    try {
      const existing = await db
        .prepare(`SELECT id FROM scenarios WHERE name = ? LIMIT 1`)
        .bind(s.name)
        .first<{ id: string }>();
      if (existing) {
        result.scenariosSkipped++;
        continue;
      }

      const scenarioId = crypto.randomUUID();
      const now = jstNow();
      await db
        .prepare(
          `INSERT INTO scenarios (id, name, description, trigger_type, is_active, delivery_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 'relative', ?, ?)`,
        )
        .bind(scenarioId, s.name, s.description, s.triggerType, now, now)
        .run();

      for (const step of s.steps) {
        await db
          .prepare(
            `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, created_at)
             VALUES (?, ?, ?, ?, 'text', ?, ?)`,
          )
          .bind(crypto.randomUUID(), scenarioId, step.stepIndex, step.delayMinutes, step.messageContent, now)
          .run();
      }
      result.scenariosApplied++;
    } catch (e) {
      result.errors.push(`scenario[${s.name}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

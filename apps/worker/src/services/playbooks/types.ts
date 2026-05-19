/**
 * 業界別プレイブックの共通型
 *
 * 業界ごとに「中の人らしさ」を一式パッケージ化したもの。
 * 適用するとテナントに対して以下が一括投入される:
 *   - プロンプトモジュール最大 10 種（業界別の中核は ①〜⑧、⑨ 社内マニュアル / ⑩ 商品提案ルールは個別運用で追加）
 *   - KPI 目標プリセット（推奨値）
 *   - シナリオテンプレ（3〜5 本）
 */

import type { PromptModuleType } from '@line-crm/db';
import type { KpiMetric } from '@line-crm/db';

export interface PlaybookPromptModule {
  type: PromptModuleType;
  content: string;
}

export interface PlaybookKpi {
  metric: KpiMetric;
  recommendedTarget: number;
  notes: string;
}

export interface PlaybookScenarioStep {
  stepIndex: number;
  name: string;
  delayMinutes: number;
  messageContent: string;
}

export interface PlaybookScenario {
  name: string;
  description: string;
  triggerType: 'friend_add' | 'tag_added' | 'manual';
  steps: PlaybookScenarioStep[];
}

export interface IndustryPlaybook {
  key: string;             // 'beauty' | 'chiropractic' | ...
  label: string;           // '美容（美容室・ネイル・エステ）'
  emoji: string;
  description: string;     // 業界の特性
  promptModules: PlaybookPromptModule[];
  kpis: PlaybookKpi[];
  scenarios: PlaybookScenario[];
}

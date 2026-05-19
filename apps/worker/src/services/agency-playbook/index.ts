/**
 * 運用代行ノウハウ (コード内蔵 Markdown ベースライン)
 *
 * 全テナント共有・全業界共通の LINE 配信運用ノウハウを TypeScript 文字列として
 * 内蔵する。Anthropic Prompt Caching の cache_control: ephemeral を付けて
 * 配信生成 (generate-broadcast) に注入する。
 *
 * このファイルは "層 1" (静的ベースライン)。実例ライブラリ DB (agency_examples) が
 * "層 2" (動的蓄積)。両者を組み合わせて AI 配信品質を底上げする。
 *
 * Markdown の更新フロー:
 * - ネット上のノウハウ・YouTube 解説を見つけたら要約してここに追記
 * - 業界別の特性は industry/<業界>.ts に追加
 * - Git でレビュー → commit → deploy で全テナントに即反映
 */

import { COMMON_PLAYBOOK } from './common.js';
import { TIMING_PLAYBOOK } from './timing.js';
import { BEAUTY_PLAYBOOK_DOC } from './industry/beauty.js';
import { CHIROPRACTIC_PLAYBOOK_DOC } from './industry/chiropractic.js';
import { ECOMMERCE_PLAYBOOK_DOC } from './industry/ecommerce.js';
import { SCHOOL_PLAYBOOK_DOC } from './industry/school.js';
import { LEGAL_PLAYBOOK_DOC } from './industry/legal.js';

const INDUSTRY_PLAYBOOKS: Record<string, string> = {
  beauty: BEAUTY_PLAYBOOK_DOC,
  chiropractic: CHIROPRACTIC_PLAYBOOK_DOC,
  ecommerce: ECOMMERCE_PLAYBOOK_DOC,
  school: SCHOOL_PLAYBOOK_DOC,
  legal: LEGAL_PLAYBOOK_DOC,
};

/**
 * 業界に応じて該当の Markdown を組み立てて返す。
 * 業界指定なし or 不明な業界の場合は common + timing のみ。
 */
export function buildAgencyPlaybookText(industry?: string | null): string {
  const blocks: string[] = [COMMON_PLAYBOOK, TIMING_PLAYBOOK];
  if (industry && INDUSTRY_PLAYBOOKS[industry]) {
    blocks.push(INDUSTRY_PLAYBOOKS[industry]);
  }
  return blocks.join('\n\n---\n\n');
}

export { COMMON_PLAYBOOK, TIMING_PLAYBOOK, INDUSTRY_PLAYBOOKS };

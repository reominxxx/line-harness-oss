/**
 * プレイブックのレジストリ
 */

import { BEAUTY_PLAYBOOK } from './beauty.js';
import { CHIROPRACTIC_PLAYBOOK } from './chiropractic.js';
import { ECOMMERCE_PLAYBOOK } from './ecommerce.js';
import { SCHOOL_PLAYBOOK } from './school.js';
import { LEGAL_PLAYBOOK } from './legal.js';
import type { IndustryPlaybook } from './types.js';

export const PLAYBOOKS: Record<string, IndustryPlaybook> = {
  beauty: BEAUTY_PLAYBOOK,
  chiropractic: CHIROPRACTIC_PLAYBOOK,
  ecommerce: ECOMMERCE_PLAYBOOK,
  school: SCHOOL_PLAYBOOK,
  legal: LEGAL_PLAYBOOK,
};

export function getPlaybook(key: string): IndustryPlaybook | null {
  return PLAYBOOKS[key] ?? null;
}

export function listPlaybooks(): IndustryPlaybook[] {
  return Object.values(PLAYBOOKS);
}

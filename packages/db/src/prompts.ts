/**
 * プロンプトモジュール（prompt_modules, prompt_module_versions）の
 * クエリヘルパー。
 *
 * 事業者が AI チャットの「人格・トーン・知識・禁止事項」を 8 種類の
 * 独立したモジュールとして管理できるようにする。各モジュールは
 * バージョン履歴を持ち、いつでも過去版に戻せる。
 */

import { jstNow } from './utils.js';

export type PromptModuleType =
  | 'personality'
  | 'voice_tone'
  | 'business_kb'
  | 'faq'
  | 'restrictions'
  | 'scenario'
  | 'escalation'
  | 'industry_preset'
  | 'internal_manual'
  | 'product_recommend';

export const PROMPT_MODULE_TYPES: PromptModuleType[] = [
  'personality',
  'voice_tone',
  'business_kb',
  'faq',
  'restrictions',
  'scenario',
  'escalation',
  'industry_preset',
  'internal_manual',
  'product_recommend',
];

export interface PromptModuleRow {
  id: string;
  line_account_id: string;
  module_type: PromptModuleType;
  current_version_id: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface PromptModuleVersionRow {
  id: string;
  module_id: string;
  version: number;
  content: string;
  author_id: string | null;
  note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export async function listPromptModules(
  db: D1Database,
  lineAccountId: string,
): Promise<PromptModuleRow[]> {
  const result = await db
    .prepare(`SELECT * FROM prompt_modules WHERE line_account_id = ? ORDER BY module_type ASC`)
    .bind(lineAccountId)
    .all<PromptModuleRow>();
  return result.results;
}

export async function getPromptModule(
  db: D1Database,
  lineAccountId: string,
  moduleType: PromptModuleType,
): Promise<PromptModuleRow | null> {
  return db
    .prepare(
      `SELECT * FROM prompt_modules WHERE line_account_id = ? AND module_type = ?`,
    )
    .bind(lineAccountId, moduleType)
    .first<PromptModuleRow>();
}

/**
 * モジュールを upsert する。新規ならレコード作成、既存なら active を更新。
 * バージョン作成は別関数 (createPromptModuleVersion) に分離。
 */
export async function upsertPromptModule(
  db: D1Database,
  lineAccountId: string,
  moduleType: PromptModuleType,
): Promise<PromptModuleRow> {
  const existing = await getPromptModule(db, lineAccountId, moduleType);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO prompt_modules (id, line_account_id, module_type, current_version_id, active, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 1, ?, ?)`,
    )
    .bind(id, lineAccountId, moduleType, now, now)
    .run();
  return (await getPromptModule(db, lineAccountId, moduleType))!;
}

export async function setPromptModuleActive(
  db: D1Database,
  moduleId: string,
  lineAccountId: string,
  active: boolean,
): Promise<void> {
  await db
    .prepare(
      `UPDATE prompt_modules SET active = ?, updated_at = ? WHERE id = ? AND line_account_id = ?`,
    )
    .bind(active ? 1 : 0, jstNow(), moduleId, lineAccountId)
    .run();
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** モジュールに新バージョンを追加し、current_version_id を更新 */
export async function createPromptModuleVersion(
  db: D1Database,
  input: {
    moduleId: string;
    lineAccountId: string;
    content: string;
    authorId?: string;
    note?: string;
  },
): Promise<PromptModuleVersionRow> {
  // 既存の最新バージョン番号を取得
  const latest = await db
    .prepare(
      `SELECT MAX(version) as max_version FROM prompt_module_versions WHERE module_id = ?`,
    )
    .bind(input.moduleId)
    .first<{ max_version: number | null }>();
  const nextVersion = (latest?.max_version ?? 0) + 1;

  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO prompt_module_versions (id, module_id, version, content, author_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.moduleId, nextVersion, input.content, input.authorId ?? null, input.note ?? null, now)
    .run();

  // モジュールの current_version_id を更新
  await db
    .prepare(
      `UPDATE prompt_modules SET current_version_id = ?, updated_at = ? WHERE id = ? AND line_account_id = ?`,
    )
    .bind(id, now, input.moduleId, input.lineAccountId)
    .run();

  return {
    id,
    module_id: input.moduleId,
    version: nextVersion,
    content: input.content,
    author_id: input.authorId ?? null,
    note: input.note ?? null,
    created_at: now,
  };
}

export async function getPromptModuleVersion(
  db: D1Database,
  versionId: string,
): Promise<PromptModuleVersionRow | null> {
  return db
    .prepare(`SELECT * FROM prompt_module_versions WHERE id = ?`)
    .bind(versionId)
    .first<PromptModuleVersionRow>();
}

export async function listPromptModuleVersions(
  db: D1Database,
  moduleId: string,
  limit = 50,
): Promise<PromptModuleVersionRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM prompt_module_versions WHERE module_id = ? ORDER BY version DESC LIMIT ?`,
    )
    .bind(moduleId, limit)
    .all<PromptModuleVersionRow>();
  return result.results;
}

/** 過去バージョンを current に戻す */
export async function revertToVersion(
  db: D1Database,
  moduleId: string,
  lineAccountId: string,
  versionId: string,
): Promise<void> {
  const v = await getPromptModuleVersion(db, versionId);
  if (!v || v.module_id !== moduleId) {
    throw new Error('Version not found or does not belong to module');
  }
  await db
    .prepare(
      `UPDATE prompt_modules SET current_version_id = ?, updated_at = ? WHERE id = ? AND line_account_id = ?`,
    )
    .bind(versionId, jstNow(), moduleId, lineAccountId)
    .run();
}

// ---------------------------------------------------------------------------
// 8 モジュールを合成して system prompt を生成
// ---------------------------------------------------------------------------

export interface AssembledPrompt {
  systemPrompt: string;
  usedVersions: Array<{ moduleType: PromptModuleType; versionId: string | null; version: number | null }>;
}

/** 現在の active モジュールから system prompt を組み立てる */
export async function assembleSystemPrompt(
  db: D1Database,
  lineAccountId: string,
): Promise<AssembledPrompt> {
  const sql = `
    SELECT m.module_type, m.current_version_id, v.version, v.content
    FROM prompt_modules m
    LEFT JOIN prompt_module_versions v ON m.current_version_id = v.id
    WHERE m.line_account_id = ? AND m.active = 1
    ORDER BY
      CASE m.module_type
        WHEN 'industry_preset' THEN 1
        WHEN 'personality' THEN 2
        WHEN 'voice_tone' THEN 3
        WHEN 'business_kb' THEN 4
        WHEN 'faq' THEN 5
        WHEN 'scenario' THEN 6
        WHEN 'restrictions' THEN 7
        WHEN 'escalation' THEN 8
        WHEN 'internal_manual' THEN 9
        WHEN 'product_recommend' THEN 10
        ELSE 11
      END
  `;
  type Row = {
    module_type: PromptModuleType;
    current_version_id: string | null;
    version: number | null;
    content: string | null;
  };
  const result = await db.prepare(sql).bind(lineAccountId).all<Row>();

  const labelByType: Record<PromptModuleType, string> = {
    industry_preset: '【業界デフォルト】',
    personality: '【ブランド人格】',
    voice_tone: '【しゃべり方・トーン】',
    business_kb: '【事業・商品情報】',
    faq: '【よくある質問】',
    scenario: '【シーン別対応指示】',
    restrictions: '【禁止事項・NG】',
    escalation: '【人にエスカレする条件】',
    internal_manual: '【社内マニュアル】',
    product_recommend: '【商品提案ルール】',
  };

  const parts: string[] = [];
  const usedVersions: AssembledPrompt['usedVersions'] = [];

  for (const row of result.results) {
    if (row.content && row.content.trim()) {
      parts.push(`${labelByType[row.module_type]}\n${row.content.trim()}`);
    }
    usedVersions.push({
      moduleType: row.module_type,
      versionId: row.current_version_id,
      version: row.version,
    });
  }

  return {
    systemPrompt: parts.join('\n\n'),
    usedVersions,
  };
}

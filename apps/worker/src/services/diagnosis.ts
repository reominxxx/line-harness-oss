/**
 * 無料診断 (form_kind = 'diagnosis') 専用の submit 後処理。
 *
 * - 回答 (q1..q9) から採点 (packages/db の純関数を流用)
 * - 結果 Flex の生成 (スコア / レベル総評 / ボトルネック / L-port解決策 / ヒアリング予約ボタン)
 * - 業種 / レベル / ボトルネックの segment_tag 付与 (account 内で get-or-create)
 *
 * 設計の正は docs/sales/free-diagnosis-design.md。
 */
import {
  scoreDiagnosis,
  type DiagnosisResult,
  type DiagnosisLevel,
  DIAGNOSIS_AXES,
  LEVEL_SUMMARY,
  BOTTLENECK_COPY,
  COMMON_CLOSING,
  INDUSTRY_LABELS,
  jstNow,
  assignFriendSegmentTag,
  listSegmentTags,
  createSegmentTag,
  recountSegmentTagAssignments,
  markSegmentTagRun,
} from '@line-crm/db';

/** 無料ヒアリング予約の遷移先。env LP_BOOKING_URL (TimeRex 等) で上書き可。 */
const DEFAULT_BOOKING_URL = 'https://line-port.com/consultation';

interface DiagnosisField {
  name?: string;
  options?: Array<{ value?: string; label?: string; score?: number }>;
}

/**
 * submissionData から Q1..Q6 の配点 (0-3) を抽出する。
 * 各 field の options[].score を優先し、無ければ値を数値化してフォールバック。
 */
export function extractDiagnosisAnswers(
  fields: DiagnosisField[],
  submissionData: Record<string, unknown>,
): number[] | null {
  const answers: number[] = [];
  for (const axis of DIAGNOSIS_AXES) {
    const key = axis.toLowerCase(); // 'q1'..'q9'
    const field = fields.find((f) => (f.name ?? '').toLowerCase() === key);
    const raw = submissionData[key] ?? submissionData[axis];
    if (raw === undefined || raw === null || raw === '') return null;
    const sv = typeof raw === 'string' ? raw : String(raw);

    let score: number | undefined;
    const matched = field?.options?.find((o) => o?.value === sv);
    if (matched && typeof matched.score === 'number') {
      score = matched.score;
    } else {
      const n = parseInt(sv, 10);
      if (Number.isFinite(n)) score = n;
    }
    if (score === undefined || score < 0 || score > 3) return null;
    answers.push(score);
  }
  return answers.length === DIAGNOSIS_AXES.length ? answers : null;
}

/** 業種コード (salon 等) または日本語ラベルを受け取り、表示ラベルへ正規化。 */
export function resolveIndustryLabel(industry: unknown): string | null {
  if (typeof industry !== 'string' || industry.trim() === '') return null;
  const v = industry.trim();
  if (INDUSTRY_LABELS[v]) return INDUSTRY_LABELS[v];
  // 既に日本語ラベルで来ている場合はそのまま
  const known = Object.values(INDUSTRY_LABELS);
  if (known.includes(v)) return v;
  return v;
}

/** 結果 Flex (bubble) を生成。テキストリンクではなくボタンで予約導線を出す。 */
export function buildDiagnosisResultFlex(
  result: DiagnosisResult,
  opts: { displayName?: string | null; industryLabel?: string | null; bookingUrl?: string },
): Record<string, unknown> {
  const bottleneck = BOTTLENECK_COPY[result.bottleneckAxis];
  const bookingUrl = opts.bookingUrl ?? DEFAULT_BOOKING_URL;
  const levelColor: Record<string, string> = {
    A: '#16a34a',
    B: '#0ea5e9',
    C: '#f59e0b',
    D: '#ef4444',
  };
  const headerBg = levelColor[result.level] ?? '#16a34a';

  const subtitleParts: string[] = [];
  if (opts.industryLabel) subtitleParts.push(opts.industryLabel);
  if (opts.displayName) subtitleParts.push(`${opts.displayName}さん`);

  return {
    type: 'bubble',
    size: 'giga',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: 'LINE運用度診断 結果', size: 'sm', color: '#ffffff', weight: 'bold' },
        {
          type: 'box',
          layout: 'baseline',
          margin: 'md',
          contents: [
            { type: 'text', text: `${result.score100}`, size: '4xl', color: '#ffffff', weight: 'bold', flex: 0 },
            { type: 'text', text: '点', size: 'md', color: '#ffffff', margin: 'sm', gravity: 'bottom', flex: 0 },
            { type: 'text', text: `レベル ${result.level}`, size: 'lg', color: '#ffffff', weight: 'bold', align: 'end', gravity: 'bottom' },
          ],
        },
        ...(subtitleParts.length > 0
          ? [{ type: 'text', text: subtitleParts.join(' / '), size: 'xs', color: '#ffffff', margin: 'sm' }]
          : []),
      ],
      paddingAll: '20px',
      backgroundColor: headerBg,
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: LEVEL_SUMMARY[result.level], size: 'sm', color: '#1e293b', weight: 'bold', wrap: true },
        { type: 'separator', margin: 'md' },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          spacing: 'xs',
          contents: [
            { type: 'text', text: `最大のボトルネック：${bottleneck.label}`, size: 'sm', color: '#ef4444', weight: 'bold', wrap: true },
            { type: 'text', text: bottleneck.diagnosis, size: 'xs', color: '#475569', wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          spacing: 'xs',
          backgroundColor: '#f0fdf4',
          cornerRadius: 'md',
          paddingAll: '12px',
          contents: [
            { type: 'text', text: 'L-port での解決策', size: 'xxs', color: '#16a34a', weight: 'bold' },
            { type: 'text', text: bottleneck.solution, size: 'xs', color: '#1e293b', wrap: true },
          ],
        },
        { type: 'text', text: COMMON_CLOSING, size: 'xs', color: '#475569', margin: 'md', wrap: true },
      ],
      paddingAll: '20px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#16a34a',
          action: { type: 'uri', label: '無料ヒアリング(30分)を予約', uri: bookingUrl },
        },
      ],
      paddingAll: '16px',
    },
  };
}

/**
 * 業種 / レベル / ボトルネックの segment_tag を account 内で get-or-create し、友だちに付与する。
 * 戻り値は付与したタグ名の配列 (ログ用)。
 */
export async function assignDiagnosisSegmentTags(
  db: D1Database,
  input: {
    friendId: string;
    lineAccountId: string;
    result: DiagnosisResult;
    industryLabel: string | null;
  },
): Promise<string[]> {
  const bottleneck = BOTTLENECK_COPY[input.result.bottleneckAxis];
  const names: string[] = [`診断/レベル${input.result.level}`, `診断/課題:${bottleneck.label}`];
  if (input.industryLabel) names.unshift(`診断/業種:${input.industryLabel}`);

  // account 内の既存タグを一括取得 (毎回 get-or-create でクエリしないよう)
  const existing = await listSegmentTags(db, input.lineAccountId);
  const byName = new Map(existing.map((t) => [t.name, t]));

  const assigned: string[] = [];
  for (const name of names) {
    let tag = byName.get(name);
    if (!tag) {
      tag = await createSegmentTag(db, {
        lineAccountId: input.lineAccountId,
        name,
        criteria: JSON.stringify({ source: 'free_diagnosis', auto: true }),
        isAiManaged: true,
      });
    }
    await assignFriendSegmentTag(db, {
      friendId: input.friendId,
      segmentTagId: tag.id,
      lineAccountId: input.lineAccountId,
      assignedBy: 'ai',
      reason: '無料診断の結果による自動付与',
    });
    const count = await recountSegmentTagAssignments(db, tag.id);
    await markSegmentTagRun(db, tag.id, count);
    assigned.push(name);
  }
  return assigned;
}

/**
 * Web診断ページ (LP) が描画するための結果ペイロードを生成する。
 * Flex (LINE) ではなく素の JSON。submit のレスポンスに載せて静的LPがそのまま描画する。
 */
export function buildDiagnosisResultPayload(
  diag: { result: DiagnosisResult; industryLabel: string | null },
  opts?: { bookingUrl?: string },
): {
  score100: number;
  level: DiagnosisLevel;
  levelSummary: string;
  bottleneck: { axis: string; label: string; diagnosis: string; solution: string };
  industryLabel: string | null;
  closing: string;
  bookingUrl: string;
} {
  const bottleneck = BOTTLENECK_COPY[diag.result.bottleneckAxis];
  return {
    score100: diag.result.score100,
    level: diag.result.level,
    levelSummary: LEVEL_SUMMARY[diag.result.level],
    bottleneck: {
      axis: diag.result.bottleneckAxis,
      label: bottleneck.label,
      diagnosis: bottleneck.diagnosis,
      solution: bottleneck.solution,
    },
    industryLabel: diag.industryLabel,
    closing: COMMON_CLOSING,
    bookingUrl: opts?.bookingUrl ?? DEFAULT_BOOKING_URL,
  };
}

/** 採点 + metadata 用の付加情報をまとめて返す。 */
export function computeDiagnosis(
  fields: DiagnosisField[],
  submissionData: Record<string, unknown>,
): { result: DiagnosisResult; industryLabel: string | null; metadataPatch: Record<string, unknown> } | null {
  const answers = extractDiagnosisAnswers(fields, submissionData);
  if (!answers) return null;
  const result = scoreDiagnosis(answers);
  const industryLabel = resolveIndustryLabel(submissionData['industry']);
  const bottleneck = BOTTLENECK_COPY[result.bottleneckAxis];
  const metadataPatch: Record<string, unknown> = {
    diagnosis_score: result.score100,
    diagnosis_level: result.level,
    diagnosis_bottleneck: bottleneck.label,
    diagnosis_bottleneck_axis: result.bottleneckAxis,
    diagnosis_at: jstNow(),
  };
  if (industryLabel) metadataPatch['diagnosis_industry'] = industryLabel;
  return { result, industryLabel, metadataPatch };
}

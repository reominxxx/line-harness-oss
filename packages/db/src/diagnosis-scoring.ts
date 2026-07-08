/**
 * L-port 無料診断「LINE運用度診断」採点ロジック
 *
 * 設計の正は docs/sales/free-diagnosis-design.md (§3 採点 / §4 ボトルネック / §5 結果文言)。
 * Web (l-port-lp の診断ページ) と worker (forms submit) の両方から import される純関数。
 */

/** 診断の9軸。配列順 = Q1..Q9。 */
export const DIAGNOSIS_AXES = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as const;
export type DiagnosisAxis = (typeof DIAGNOSIS_AXES)[number];

export type DiagnosisLevel = 'A' | 'B' | 'C' | 'D';

export interface DiagnosisResult {
  /** Q1..Q9 の生スコア合計 (0..27) */
  raw: number;
  /** 100点換算 = round(raw / 27 * 100) */
  score100: number;
  /** レベル A>=80 / B 60-79 / C 40-59 / D<40 */
  level: DiagnosisLevel;
  /** 最低スコア軸 (同点は売上インパクト順で決定) */
  bottleneckAxis: DiagnosisAxis;
}

/** 軸数 (Q1..Q9) と満点。 */
export const DIAGNOSIS_QUESTION_COUNT = DIAGNOSIS_AXES.length;
const MAX_RAW = DIAGNOSIS_QUESTION_COUNT * 3;

/**
 * 同点時のボトルネック優先順位 (設計書 §3)。
 * 売上インパクト順: 効果測定 > 友だち獲得 > 配信内容の質 > リピート > 運用体制 >
 * 初動 > パーソナライズ > 配信コスト管理 > リッチメニュー。
 * 配列の先頭ほど「ボトルネックとして選ばれやすい」。
 */
const BOTTLENECK_PRIORITY: DiagnosisAxis[] = ['Q6', 'Q1', 'Q8', 'Q5', 'Q9', 'Q2', 'Q4', 'Q7', 'Q3'];

function toLevel(score100: number): DiagnosisLevel {
  if (score100 >= 80) return 'A';
  if (score100 >= 60) return 'B';
  if (score100 >= 40) return 'C';
  return 'D';
}

/**
 * 回答配列 (Q1..Q9 の各0-3点、長さ9) から診断結果を算出する。
 * @param answers 各設問の配点 (0-3)。順序は Q1..Q9。
 */
export function scoreDiagnosis(answers: number[]): DiagnosisResult {
  if (answers.length !== DIAGNOSIS_QUESTION_COUNT) {
    throw new Error(
      `scoreDiagnosis expects exactly ${DIAGNOSIS_QUESTION_COUNT} answers, got ${answers.length}`,
    );
  }
  const scores = answers.map((a) => {
    const n = Math.trunc(Number(a));
    if (!Number.isFinite(n) || n < 0 || n > 3) {
      throw new Error(`invalid answer value: ${a} (expected 0-3)`);
    }
    return n;
  });

  const raw = scores.reduce((sum, s) => sum + s, 0);
  const score100 = Math.round((raw / MAX_RAW) * 100);
  const level = toLevel(score100);

  // 最低スコアを探す。同点は BOTTLENECK_PRIORITY の先頭を優先。
  let bottleneckAxis: DiagnosisAxis = BOTTLENECK_PRIORITY[0];
  let minScore = Infinity;
  for (const axis of BOTTLENECK_PRIORITY) {
    const idx = DIAGNOSIS_AXES.indexOf(axis);
    const s = scores[idx];
    if (s < minScore) {
      minScore = s;
      bottleneckAxis = axis;
    }
  }

  return { raw, score100, level, bottleneckAxis };
}

/** レベル総評 (設計書 §5・確定文言)。 */
export const LEVEL_SUMMARY: Record<DiagnosisLevel, string> = {
  A: '運用レベルはかなり高いです。あとは“手離れ”と更なる最適化が次の一手。',
  B: '基礎はできています。弱点を1つ潰すだけで成果が大きく変わる段階です。',
  C: '仕組みが部分的で、取りこぼしが多い状態。優先順位をつければ伸びます。',
  D: 'LINEがほぼ未活用。逆に言えば伸びしろが最大。今が始めどきです。',
};

export interface BottleneckCopy {
  /** ボトルネック軸のラベル (UI/タグ表示用) */
  label: string;
  /** 一言診断 (設計書 §4) */
  diagnosis: string;
  /** L-port での解決策 (機能) */
  solution: string;
}

/** ボトルネック軸ごとの結果文言＋L-port解決策 (設計書 §4・確定文言)。 */
export const BOTTLENECK_COPY: Record<DiagnosisAxis, BottleneckCopy> = {
  Q1: {
    label: '友だち獲得導線',
    diagnosis: '入口が細く、母数が増えていない',
    solution: 'トラッキングリンク/流入経路計測、トラフィックプール（複数アカ自動振り分け）、QR動線設計',
  },
  Q2: {
    label: '初動フォロー',
    diagnosis: '追加直後の熱が冷めて離脱している',
    solution: 'friend_add トリガーのステップ配信、あいさつ＋初回クーポンの自動化',
  },
  Q3: {
    label: 'リッチメニュー',
    diagnosis: '一番見られる場所が活かせていない',
    solution: 'タグ別/ユーザー別リッチメニュー自動切替',
  },
  Q4: {
    label: 'パーソナライズ配信',
    diagnosis: '全員に同じ配信でブロックを招いている',
    solution: 'タグ/セグメント配信、AI接客（個別レコメンド）',
  },
  Q5: {
    label: 'リピート施策',
    diagnosis: '新規は来るが再来の仕組みがない',
    solution: 'クーポン/回数券、Web予約、リマインダー配信',
  },
  Q6: {
    label: '効果測定',
    diagnosis: '改善の根拠がなく勘で運用している',
    solution: 'CV計測、分析ダッシュボード（結果が見える管理画面）',
  },
  Q7: {
    label: '配信コスト・通数管理',
    diagnosis: '通数や追加費用が見えず、配信を抑えがちになっている',
    solution: '料金プラン/通数の可視化、セグメント配信でムダ打ちを削減し費用対効果を最適化',
  },
  Q8: {
    label: '配信内容の質',
    diagnosis: '何を送るか定まらず、配信が不定期になっている',
    solution: '悩み・興味・状況に合わせたシナリオ設計とテンプレート、AI接客で反応の取れる配信を仕組み化',
  },
  Q9: {
    label: '運用体制・継続性',
    diagnosis: '運用が属人的・後回しになり、継続が難しくなっている',
    solution: '配信カレンダー＋改善フロー整備、専属チーム＋AIによる運用代行（DfY）で継続運用を実現',
  },
};

/** 全レベル共通の締め (型1→本体価値への接続、設計書 §4)。 */
export const COMMON_CLOSING =
  'これらを“自分で運用する”のは本業を圧迫します。L-port なら専属チーム＋AIが月¥19,800〜で全部代行。まずは無料ヒアリング(30分)で、あなたの店に合う改善プランをお出しします。';

/** 業種コード → 表示ラベル (LP の業種選択と一致させる)。 */
export const INDUSTRY_LABELS: Record<string, string> = {
  salon: '美容室',
  seitai: '整体・治療院',
  ec: 'EC・D2C',
  school: 'スクール・教室',
  shigyo: '士業',
  restaurant: '飲食店',
  other: 'その他',
};

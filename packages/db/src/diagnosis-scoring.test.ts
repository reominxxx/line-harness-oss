import { describe, it, expect } from 'vitest';
import { scoreDiagnosis } from './diagnosis-scoring.js';

// 9軸 (Q1..Q9)、各0-3点、満点27。score100 = round(raw/27*100)。
describe('scoreDiagnosis', () => {
  it('全0点 → raw0 / 0点 / レベルD / ボトルネックは優先順位先頭(Q6)', () => {
    const r = scoreDiagnosis([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.raw).toBe(0);
    expect(r.score100).toBe(0);
    expect(r.level).toBe('D');
    expect(r.bottleneckAxis).toBe('Q6');
  });

  it('全3点 → raw27 / 100点 / レベルA', () => {
    const r = scoreDiagnosis([3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(r.raw).toBe(27);
    expect(r.score100).toBe(100);
    expect(r.level).toBe('A');
  });

  it('レベル境界: 80点以上=A (raw22→81)', () => {
    // 22/27*100 = 81.48 → 81
    const r = scoreDiagnosis([3, 3, 3, 3, 3, 3, 3, 1, 0]);
    expect(r.raw).toBe(22);
    expect(r.score100).toBe(81);
    expect(r.level).toBe('A');
  });

  it('レベル境界: 60-79=B (raw17→63)', () => {
    // 17/27*100 = 62.96 → 63
    const r = scoreDiagnosis([3, 2, 2, 2, 2, 2, 2, 1, 1]);
    expect(r.raw).toBe(17);
    expect(r.score100).toBe(63);
    expect(r.level).toBe('B');
  });

  it('レベル境界: 40-59=C (raw12→44)', () => {
    // 12/27*100 = 44.44 → 44
    const r = scoreDiagnosis([2, 2, 2, 1, 1, 1, 1, 1, 1]);
    expect(r.raw).toBe(12);
    expect(r.score100).toBe(44);
    expect(r.level).toBe('C');
  });

  it('レベル境界: 40点未満=D (raw10→37)', () => {
    // 10/27*100 = 37.03 → 37 → D
    const r = scoreDiagnosis([2, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(r.raw).toBe(10);
    expect(r.score100).toBe(37);
    expect(r.level).toBe('D');
  });

  it('ボトルネックは最低スコア軸を選ぶ (Q3が単独最低)', () => {
    const r = scoreDiagnosis([3, 3, 0, 3, 3, 3, 3, 3, 3]);
    expect(r.bottleneckAxis).toBe('Q3');
  });

  it('新軸 Q7 が単独最低ならボトルネックは Q7', () => {
    const r = scoreDiagnosis([3, 3, 3, 3, 3, 3, 0, 3, 3]);
    expect(r.bottleneckAxis).toBe('Q7');
  });

  it('同点時の優先順位: Q1とQ3が同点最低 → Q1が優先 (Q1>Q3)', () => {
    const r = scoreDiagnosis([0, 3, 0, 3, 3, 3, 3, 3, 3]);
    expect(r.bottleneckAxis).toBe('Q1');
  });

  it('同点時の優先順位: Q8とQ3が同点最低 → Q8が優先 (Q8>Q3)', () => {
    const r = scoreDiagnosis([3, 3, 0, 3, 3, 3, 3, 0, 3]);
    expect(r.bottleneckAxis).toBe('Q8');
  });

  it('同点時の優先順位: Q7とQ3が同点最低 → Q7が優先 (Q7>Q3)', () => {
    const r = scoreDiagnosis([3, 3, 0, 3, 3, 3, 0, 3, 3]);
    expect(r.bottleneckAxis).toBe('Q7');
  });

  it('同点時の優先順位: 全軸同点 → Q6 (最優先)', () => {
    const r = scoreDiagnosis([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(r.bottleneckAxis).toBe('Q6');
  });

  it('不正な長さは throw (旧6問はもう無効)', () => {
    expect(() => scoreDiagnosis([0, 0, 0, 0, 0, 0])).toThrow();
    expect(() => scoreDiagnosis([0, 0, 0])).toThrow();
  });

  it('範囲外の値は throw', () => {
    expect(() => scoreDiagnosis([0, 0, 0, 0, 0, 0, 0, 0, 4])).toThrow();
  });
});

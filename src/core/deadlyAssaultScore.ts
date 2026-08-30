/**
 * 危局强袭 · 伤害分 ↔ 伤害血量% 分段线性换算（单一事实源，普通 + 困难两套曲线）。
 *
 * 用户口径（2026-08，隔壁对话「观察这个表，给出分数与血量」梳理，困难曲线从
 * data/raw/bosses/zh/*.json 的 boss_adjust 抽出）：
 * 分数 0→60000 单调对应伤害血量 0%→100%（打死），中间分段线性。
 * - 普通（defense）：29 管、血量总量 87.4（= 8.74 管 × 10）。
 * - 困难（critical_assault）：24 管、血量总量 158（= 15.8 管 × 10），是普通的 1.81 倍，
 *   故「每点血换的分」整体更低（平均效率 60000/158≈380 vs 普通 686）。
 *
 * 段边界用「伤害血量比例」表达（0~1，1 = 击杀），与 Boss 绝对值无关，越界钳制。
 * 归档分数口径：单房 65000 = 伤害分 60000（击杀打满）+ 操作分 5000（附加分，本模块不算）。
 */

export const DEADLY_ASSAULT_SCORE_CAP = 60000

/** 危局模式：defense = 普通（8.74 管）；critical_assault = 困难/逆境（15.8 管）。 */
export type DeadlyAssaultMode = 'defense' | 'critical_assault'

/** 段边界 [伤害血量比例(0~1), 累计伤害分]，比例升序。 */
const SCORE_CURVES: Record<DeadlyAssaultMode, ReadonlyArray<readonly [ratio: number, score: number]>> = {
  defense: [
    [0, 0],
    [4.8 / 87.4, 4000], // ≈ 5.49%
    [11.6 / 87.4, 8800], // ≈ 13.27%
    [20.4 / 87.4, 16000], // ≈ 23.34%
    [30.4 / 87.4, 25600], // ≈ 34.78%
    [42.4 / 87.4, 36000], // ≈ 48.51%
    [57.4 / 87.4, 43800], // ≈ 65.68%
    [1, DEADLY_ASSAULT_SCORE_CAP],
  ],
  critical_assault: [
    [0, 0],
    [14.4 / 158, 3000], // ≈ 9.11%
    [28.8 / 158, 7000], // ≈ 18.23%
    [36.0 / 158, 10000], // ≈ 22.78%
    [60.0 / 158, 24000], // ≈ 37.97%
    [68.0 / 158, 27500], // ≈ 43.04%
    [138.0 / 158, 52000], // ≈ 87.34%
    [1, DEADLY_ASSAULT_SCORE_CAP],
  ],
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * 伤害/血量（0~1，1 = 击杀）→ 伤害分（0~60000）。分段线性插值，越界钳制。
 * 非线性：各段「分/血」不同（普通 17-14 管最划算 960、9-7 管最亏 520；
 * 困难 14-11 管最划算 583.33、24-21 管最亏 208.33）。
 */
export function scoreForDamageRatio(ratio: number, mode: DeadlyAssaultMode = 'defense'): number {
  const curve = SCORE_CURVES[mode]
  const r = clamp01(ratio)
  for (let i = 0; i < curve.length - 1; i++) {
    const [r0, s0] = curve[i]
    const [r1, s1] = curve[i + 1]
    if (r <= r1) {
      const t = (r - r0) / (r1 - r0)
      return s0 + t * (s1 - s0)
    }
  }
  return DEADLY_ASSAULT_SCORE_CAP
}

/**
 * 伤害分（0~60000）→ 伤害/血量（0~1）。分段线性插值（逆函数），越界钳制。
 */
export function damageRatioForScore(score: number, mode: DeadlyAssaultMode = 'defense'): number {
  const curve = SCORE_CURVES[mode]
  const s = Math.min(DEADLY_ASSAULT_SCORE_CAP, Math.max(0, score))
  for (let i = 0; i < curve.length - 1; i++) {
    const [r0, s0] = curve[i]
    const [r1, s1] = curve[i + 1]
    if (s <= s1) {
      const t = (s - s0) / (s1 - s0)
      return r0 + t * (r1 - r0)
    }
  }
  return 1
}

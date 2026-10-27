/**
 * 危局强袭 · 伤害分 ↔ 伤害血量% 分段线性换算（单一事实源，普通 + 困难两套曲线）。
 *
 * ⚠ 本文件是**定义落点**（2026-09-13 展示层越层棘轮下沉：`src/views/RunArchivePage.vue` 不得 import
 * `@/core`，见 ARCHITECTURE §0 依赖方向），引擎与展示层都从这里导入——**改数值只改这里**。
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

/**
 * 分数模式的中文标签（UI 唯一口径）。**游戏内叫「绝境」，代码字段叫 `critical_assault`（归档模式串里是
 * `Adversity`）**——三者同义，展示层一律用本表，别再手写「困难 / 逆境 / Adversity」。
 *
 * @fact ui:词条/难度模式标签 口径: 玩家看到的两个难度名 = 普通（defense）/ 绝境（critical_assault = 归档 mode 串里的 Adversity），血量曲线分别是 87.4 管 / 158 管；展示层标签只从 SCORE_MODE_LABEL 取 | 据 用户@2026-10-27（「填写普通还是绝境（血量曲线不同）」） | 验 src/core/__tests__/deadlyAssaultScore.test.ts | 锚 src/data/deadlyAssaultScore.ts#SCORE_MODE_LABEL | 信 确认
 * ⟳复核: 游戏内改名或新增第三档难度时，核对 SCORE_MODE_LABEL 与 SCORE_CURVES 是否同时需要扩档 | 到期 2027-02-28
 */
export const SCORE_MODE_LABEL: Readonly<Record<DeadlyAssaultMode, string>> = {
  defense: '普通',
  critical_assault: '绝境',
}

/** 难度下拉 / 单选的选项表（标签同源 SCORE_MODE_LABEL，顺序 = 普通 → 绝境） */
export const SCORE_MODE_OPTIONS: ReadonlyArray<{ label: string; value: DeadlyAssaultMode }> =
  (['defense', 'critical_assault'] as const).map(value => ({ label: SCORE_MODE_LABEL[value], value }))

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
 * 伤害分 → 伤害/血量比例（0~1，1 = 击杀）。`scoreForDamageRatio` 的**严格反解**。
 *
 * 用途（用户 2026-10-27）：「如果你是 A 配置打了 x 分，换成 B 配置的伤害、其他都不变，会打多少分」。
 * 分数曲线是**分段线性且非线性**（同样 +1% 血在不同段换的分不一样），所以不能拿「分数 × 伤害比」直接乘：
 * 必须先反解出 A 的血量比例 → 乘伤害之比 → 再正算回分数（见 `scoreForDamageRatioOfRatio`）。
 *
 * 越界钳制：< 0 → 0；> 伤害分上限 → 1（击杀）。
 */
export function damageRatioForScore(score: number, mode: DeadlyAssaultMode = 'defense'): number {
  const curve = SCORE_CURVES[mode]
  const s = Number.isFinite(score) ? Math.min(DEADLY_ASSAULT_SCORE_CAP, Math.max(0, score)) : 0
  for (let i = 0; i < curve.length - 1; i++) {
    const [r0, s0] = curve[i]
    const [r1, s1] = curve[i + 1]
    if (s <= s1) {
      if (s1 === s0) return r1
      return r0 + ((s - s0) / (s1 - s0)) * (r1 - r0)
    }
  }
  return 1
}

/**
 * 已知 A 配置的分数 `scoreA` 与「B 伤害 / A 伤害」的比值 `damageRatio`，求 B 配置的分数。
 *
 * 口径（用户 2026-10-27）：「如果你是 A 配置打了 x 分，换成 B 配置的伤害，其他都不变，你会打多少分」
 * ——「其他都不变」= 同一个 Boss、同一套操作，故 **血量比例随伤害同比缩放**，其余一切照旧。
 * 非线性曲线必须走「反解 → 缩放 → 正算」，直接乘分数是错的（判据里钉了反例）。
 *
 * `clamped` = true 表示结果被曲线端点钳住（打死了 / 分数为 0），比例不再可信。
 */
export function scoreForDamageRatioOfRatio(
  scoreA: number,
  damageRatio: number,
  mode: DeadlyAssaultMode = 'defense',
): { score: number; ratioB: number; clamped: boolean } {
  const ratioA = damageRatioForScore(scoreA, mode)
  const ratioBRaw = ratioA * (Number.isFinite(damageRatio) ? damageRatio : 1)
  const ratioB = clamp01(ratioBRaw)
  return {
    score: scoreForDamageRatio(ratioB, mode),
    ratioB,
    clamped: ratioBRaw > 1 || ratioBRaw < 0,
  }
}

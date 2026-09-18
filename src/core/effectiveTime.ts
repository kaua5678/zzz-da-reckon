// @fact engine:time/无敌≠秽盾 口径: `invincibleTime` 只表示 boss **真无敌**（转阶段动画等完全不可攻击的秒数），**不含秽盾**——秽盾期间 boss 照常可被攻击（代理人能攻击削减[秽盾]），只是获得高额防御/减伤/抗打断且不失衡，故它是**伤害乘区与失衡通道**问题、不是**时间扣除**问题 | 据 用户@2026-09-13（纠正 2026-08-30 旧口径「boss 无敌（秽盾/转阶段动画）」）+ nanoka noun_3.2.3.json #2000002 原文 | 验 src/core/__tests__/effectiveTime.test.ts | 锚 src/core/effectiveTime.ts#effectiveBattleTime | 信 确认
// ⟳复核: 秽盾若被正式纳入建模（破盾回能/削盾量/防御减伤乘区落地）时，确认本口径与「无敌时间」字段语义仍只需表示真无敌，并把秽盾相关通道指向新实现而非 invincibleTime | 到期 2026-12-31
/**
 * 无敌时间口径：boss **真无敌**（转阶段动画等）期间不可被攻击——dot 与后台/CD 自动伤害
 * （追加攻击、后台自动招式、周期 dot tick）都不应打到 boss。
 *
 * **2026-09-13 用户口径纠正**：`invincibleTime` **不含秽盾**。旧头注释（2026-08-30）把它写成
 * 「boss 无敌（秽盾/转阶段动画）」，与原文相悖——[秽盾] 期间 boss **可被攻击**
 * （nanoka noun_3.2.3.json #2000002：「代理人能通过攻击削减[秽盾]」），其效果是「获得高额的
 * 防御力、减伤加成和抗打断能力提升且不会失衡」；被打破时才结算「秽盾净除」伤害 +
 * 为代理人回复能量或闪能。即：秽盾属**伤害乘区/失衡通道**语义，**不是时间扣除**语义——
 * 把秽盾秒数填进 `invincibleTime` 会凭空砍掉可打时间（低估伤害通道次数）。
 *
 * - 有效战斗时间 = battleTime − invincibleTime：按秒/CD 折算次数的伤害通道统一基准。
 * - 有效后台时间 = backstageTime − invincibleTime：后台时间 = 总时间 − 前台时间，无敌秒
 *   不属于任何人的前台（平A池已扣），因此落在每个角色的后台时间里，需逐角色扣除。
 * - 能量/喧响类通道**不扣**（口径见 core/resource/helpers.ts 平A池注释「无敌时间不扣能量/喧响回能」）。
 *
 * **未建模（已挂账）**：秽盾的防御/减伤乘区、削盾量、破盾回能/净除伤害全仓无消费锚点——
 * `shieldCount` 只承载「破盾奖励次数」折能量，不是盾本体（见 `src/core/resource/helpers.ts`）。
 * 秽盾机制（2026-09-18 用户裁决结案销号）：按用户口径，秽盾仅为破盾后代理人获得额外能量与闪能，
 * 该通道已在 `src/core/resource/helpers.ts`（`shieldBreakGift` / `energyShieldBreakGift`）实现；
 * 削盾量/防御减伤乘区/净除伤害等三通道按用户口径明确不做。**不许复用 `invincibleTime` 承载秽盾**（语义不同）。
 */
import { isFrontlineExecution } from '@/types/resource'

interface TimeBasisCfg {
  battleTime?: number
  invincibleTime?: number
}

/** 有效战斗时间（秒）= 战斗时间 − boss 无敌时间（下限 0）。按 CD/每秒折算次数的伤害通道用这个。 */
export function effectiveBattleTime(cfg: TimeBasisCfg): number {
  return Math.max(0, (cfg.battleTime ?? 180) - (cfg.invincibleTime ?? 0))
}

// @fact engine:stun/时间守恒 口径: 失衡窗口内的招式吃易伤但不攒条 ⇒ 非轴模式按窗口时间占比折算攒条量，形成「次数↑→占比↑→攒条↓」的负反馈，由不动点自行收敛，不设硬上限 | 据 用户@2026-09-01 | 验 src/core/__tests__/stunPool.test.ts | 锚 src/core/effectiveTime.ts#stunWindowFraction | 信 确认

/** 单次失衡窗口时长（秒）= boss 失衡时间 + 4 秒基础延长 + 全队失衡延时加成 */
export function stunWindowDuration(stunTime: number | undefined, teamStunDurationBonus = 0): number {
  return Math.max(0, (stunTime ?? 12) + 4 + Math.max(0, teamStunDurationBonus))
}

/**
 * 失衡窗口占有效战斗时间的比例（0-1）。
 * 它同时是易伤覆盖率与「攒条无效时间」的占比——同一段时间只能算一次：
 * 窗口里打的招式吃易伤（覆盖率），但打出的失衡值不进下一条（攒条折算）。
 */
export function stunWindowFraction(stunCount: number, windowDuration: number, effectiveTime: number): number {
  if (effectiveTime <= 0 || stunCount <= 0 || windowDuration <= 0) return 0
  return Math.max(0, Math.min(1, (stunCount * windowDuration) / effectiveTime))
}

/** 有效后台时间（秒）= 后台时间 − boss 无敌时间（下限 0）。后台自动招式按 CD 折算用这个。 */
export function effectiveBackstageTime(backstageTime: number | undefined, cfg: TimeBasisCfg): number {
  return minusInvincibleTime(backstageTime, cfg)
}

/** 从任意秒数扣掉 boss 无敌时间（下限 0）。前台+后台求和等自定义时间基准的通道用这个。 */
export function minusInvincibleTime(seconds: number | undefined, cfg: TimeBasisCfg): number {
  return Math.max(0, (seconds ?? 0) - (cfg.invincibleTime ?? 0))
}

/**
 * 后台自动招式的相位延后等效 CD（2026-08-30，用户口径）：
 * 拥有者本人被换上前台做必要动作（连携/强特/终结/交互）的时间，插在他自己后台自动招式的
 * CD 循环任意相位——前台期间 CD 照转但打不出来（触发要求处于后台），触发被延后。
 *
 * 延后期望取决于**前台块长 t**（极限：无限细分 → 延后 → 0；一次切上做完 → 块长巨大）：
 * 相位均匀假设下，CD 转好的时刻落在前台块内的概率 = 前台占比 p = F/W，落点在块内均匀
 * → 平均延后 D = p·t/2 → **等效使用 CD c' = c + p·t/2**。次数 = 有效后台时间 / c'。
 *
 * 前台块长由「切上前台频率」滑块决定（见 frontBlockSeconds）。
 * 约束：合轴时间计入 F（合轴时他仍在做动作，做完才轮到自动攻击）；合轴率只改变动作重叠的
 * 记账、不改变 F 总量 → 调合轴率不影响自动招式次数。
 */
export function phaseDelayedCooldown(
  cd: number,
  frontlineTime: number | undefined,
  effectiveTotalTime: number | undefined,
  blockSeconds?: number,
): number {
  const c = Math.max(0, cd)
  const w = Math.max(0, effectiveTotalTime ?? 0)
  if (c <= 0 || w <= 0) return c
  const f = Math.min(Math.max(0, frontlineTime ?? 0), w)
  const p = f / w
  if (p <= 0) return c
  // 块长缺省 = c（旧隐式口径 c' = c·(1+p/2)）；调用方算得出动作次数时传 frontBlockSeconds 的结果
  const t = Math.max(0, blockSeconds ?? c)
  return c + p * (t / 2)
}

/** 切上前台频率滑块（用户口径 2026-08-31）：无下限——后台有大量纯跑 CD 的时间，
 * 滑块拉到 0 = 一次切上做完全部前台动作（块长最大、延后最大），不会出现「一次后台攻击都出不来」
 * （分母后台时间恒在，次数 = 后台时间/等效CD 只随延后项收缩）。 */
export const FRONT_SWITCH_MIN_RATIO = 0

/**
 * 后台自动招式的前台块长（秒）：t = 前台时间 / 切上前台次数。
 * 切上次数 = frontSwitchRatio（百分比，clamp [0, 1]）× 前台动作次数；
 * 100% = 每次切上前台只做一个动作（t = 平均动作时长），0 = 一次切上做完全部前台。
 * frontActionCount 不可得时回退 fallbackBlockSeconds（≈ CD 的旧隐式口径）。
 */
export function frontBlockSeconds(
  frontlineTime: number | undefined,
  frontActionCount: number | undefined,
  frontSwitchRatio: number | undefined,
  fallbackBlockSeconds: number,
): number {
  const f = Math.max(0, frontlineTime ?? 0)
  const count = Math.max(0, Math.floor(frontActionCount ?? 0))
  if (count <= 0) return Math.max(0, fallbackBlockSeconds)
  const ratio = Math.min(1, Math.max(FRONT_SWITCH_MIN_RATIO, frontSwitchRatio ?? 1))
  const switches = Math.max(1, count * ratio)
  return Math.max(0, f) / switches
}

/**
 * 前台动作次数口径（动作融合，2026-08-31）：非平A 的前台执行行 count 之和，**接续动作**
 * 融合进前一个动作块、不单独计数：
 * - 支援突击必须接在弹刀（招架支援）后面连着 → 融合进弹刀块：调用方传 `fusedMoveIds =
 *   [cfg.assistFollowUpMoveId]` 排除该行（弹刀本体行照常计数，它是块的头部）；
 * - 奥菲丝长按强特自动接的燥焰迸射、与火共舞 #2 合一行，引擎里已标 timeBucket='backstage'
 *   （追攻行），天然不在前台计数内，无需特判。
 * 切上前台的理由是离散招式块；平A 是上台后的连续输出流，不计（category 'basic'）。
 */
export function countFrontActions(
  executions: Array<{ category?: string; count?: number; timeBucket?: string; moveId?: string }>,
  opts: { fusedMoveIds?: Array<string | undefined | null> } = {},
): number {
  const fused = new Set(opts.fusedMoveIds?.filter((id): id is string => Boolean(id)) ?? [])
  return executions
    .filter(e => isFrontlineExecution(e as { timeBucket?: 'necessary' | 'basic' | 'backstage' })
      && e.category !== 'basic'
      && !fused.has(e.moveId ?? ''))
    .reduce((sum, e) => sum + Math.max(0, Math.floor(e.count ?? 0)), 0)
}

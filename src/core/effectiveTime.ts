/**
 * 无敌时间口径（2026-08-30，用户口径）：boss 无敌（秽盾/转阶段动画）期间不可被攻击——
 * dot 与后台/CD 自动伤害（追加攻击、后台自动招式、周期 dot tick）都不应打到 boss。
 *
 * - 有效战斗时间 = battleTime − invincibleTime：按秒/CD 折算次数的伤害通道统一基准。
 * - 有效后台时间 = backstageTime − invincibleTime：后台时间 = 总时间 − 前台时间，无敌秒
 *   不属于任何人的前台（平A池已扣），因此落在每个角色的后台时间里，需逐角色扣除。
 * - 能量/喧响类通道**不扣**（口径见 core/resource/helpers.ts 平A池注释「无敌时间不扣能量/喧响回能」）。
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

/**
 * 逐金贪婪加金的唯一实现（r733）。队伍对比 `computeOptimalGoldAllocations`（候选 = 预设 goldSteps 各条线的下一级）
 * 与时间线 `computeOptimalTeamAllocation`（候选 = 按 catalog 推出的下一级）共用这里的试算 / 还原 / 提交，
 * 两处只各写「这一档有哪些候选」和「一次试算怎么读伤害」。
 *
 * 候选与预设加金步同形（`GoldStep`）：cinema = 影画升到 value；wengine 不带 wEngineId = 精炼升到 value；
 * wengine 带 wEngineId = 换装该音擎本体，精炼回 1（旧音擎的精炼不带到新音擎）。
 *
 * 试算是「临时写 store → 读伤害 → 还原」，全程同步：中途让出事件循环会让 store 的队伍监听在改动未还原时重入。
 */
import type { ConfigModel } from '@/stores/config'
import type { GoldStep } from '@/types/teamPreset'
import type { TeamGoldState } from '@/composables/teamTimeline'

/** 一次试算：候选步、试算伤害、提交该步后的配装态 */
interface GoldTrial {
  step: GoldStep
  damage: number
  state: TeamGoldState
}

/** 走一步后的配装态（新对象，不改入参） */
function stateAfter(state: TeamGoldState, step: GoldStep): TeamGoldState {
  const next: TeamGoldState = { cinemas: [...state.cinemas], wengineMods: [...state.wengineMods], wEngines: [...state.wEngines] }
  if (step.kind === 'cinema') {
    next.cinemas[step.slot] = step.value
  } else if (step.wEngineId) {
    next.wEngines[step.slot] = step.wEngineId
    next.wengineMods[step.slot] = 1
  } else {
    next.wengineMods[step.slot] = step.value
  }
  return next
}

/** 把一个槽位从 from 写成 to：只写变了的字段，顺序 影画 → 音擎 → 精炼 */
function writeSlot(configStore: ConfigModel, from: TeamGoldState, to: TeamGoldState, slot: number): void {
  if (to.cinemas[slot] !== from.cinemas[slot]) configStore.setCinemaLevel(slot, to.cinemas[slot])
  if (to.wEngines[slot] !== from.wEngines[slot]) configStore.setWEngine(slot, to.wEngines[slot])
  if (to.wengineMods[slot] !== from.wengineMods[slot]) configStore.setWEngineModLevel(slot, to.wengineMods[slot])
}

/**
 * 逐金贪婪的一档：逐个试算候选，把伤害最高的那步写进 store。
 * 读数不是有限值的候选不选；伤害并列（差 ≤ 1e-9）取先出现的，所以候选顺序由调用方定。
 * 返回本档全部试算与选中的那个；没有可选的候选时 best = null，store 不变。
 * 调用方提交后改用 best.state 作为当前配装态。
 */
export function takeBestGoldStep(
  configStore: ConfigModel,
  state: TeamGoldState,
  candidates: readonly GoldStep[],
  readDamage: () => number,
): { trials: GoldTrial[]; best: GoldTrial | null } {
  const trials: GoldTrial[] = []
  let best: GoldTrial | null = null
  for (const step of candidates) {
    const next = stateAfter(state, step)
    writeSlot(configStore, state, next, step.slot)
    const trial: GoldTrial = { step, damage: readDamage(), state: next }
    writeSlot(configStore, next, state, step.slot)
    trials.push(trial)
    if (Number.isFinite(trial.damage) && (best == null || trial.damage > best.damage + 1e-9)) best = trial
  }
  if (best) writeSlot(configStore, state, best.state, best.step.slot)
  return { trials, best }
}

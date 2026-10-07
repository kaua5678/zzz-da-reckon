/**
 * 下位音擎（没穿专武 / 没抽到时穿什么）的唯一实现（r735，CC-517）：候选怎么穿（精炼档 + 展示名）与怎么挑（逐件试穿、读全队伤害、留最高）。
 * 两处调用，候选从哪来各自定，本文件不管：
 *  - 队伍对比自动下位 `teamCompare.computeAutoEnginePicks`：页面装填框 / 预设 `autoEngine` 声明的池（可含限定，按本体 R1 计金）；
 *  - 自由对比「无专武」档 `freeCompare/engine.ts#downgradeCandidates`：同职业、非专属、非限定。
 * 此前两处各写一遍试穿循环与精炼口径，靠注释「同思路 / 同口径」维持，判据已经分叉（队伍对比不查读数是否有限）。
 */
import type { ConfigModel } from '@/stores/config'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import type { WEngine } from '@/types/catalog'
import { isLimitedSWengineId } from '@/composables/limitedGold'
import { localized } from '@/utils/format'

/** 下位精炼档缺省：A 级 5、常驻 S 3（队伍对比页的两个输入框与预设 `autoEngine.mods` 可覆盖） */
export const DOWNGRADE_MODS = { aRank: 5, standard: 3 }

/** 一件下位候选（也是择优结果） */
export interface DowngradeCandidate {
  /** 音擎 id（目录主 id） */
  id: string
  /** 穿戴精炼档（限定按本体精炼 1） */
  mod: number
  /** 如「燃狱齿轮 R3」；限定为「焰心桂冠 R1（限定）」（悬停 / 明细表 / 系列注记展示用） */
  label: string
  /** 是否限定音擎（队伍对比按本体如实计入总限定金） */
  limited: boolean
}

/** 目录音擎 → 下位候选：限定按本体 R1（下位拿限定 = 只买本体 1 金，不预设精炼投入），A 级 / 常驻 S 按 `mods` */
export function downgradeCandidateOf(w: WEngine, mods: typeof DOWNGRADE_MODS = DOWNGRADE_MODS): DowngradeCandidate {
  const limited = isLimitedSWengineId(w.id)
  const mod = limited ? 1 : w.rarity === 'A' ? mods.aRank : mods.standard
  return { id: w.id, mod, label: `${localized(w.name, w.id)} R${mod}${limited ? '（限定）' : ''}`, limited }
}

/**
 * 槽位试穿择优：逐件穿上候选、读全队伤害，把最高的那件留在 store（下一槽的试算与之后的读数都基于它）。
 * 读数非有限不选，并列取先出现的；只有一件时直接穿上、不试算。没有可选的 ⇒ 槽位还原成试穿前的音擎与精炼，`pick` 为 null。
 * `evaluations` = 实际试算（读全队伤害）次数，自由对比据此报「下位择优」次数。
 * 调用方须已写好队伍、Boss 与 buff（读的是全队伤害）。
 */
export function wearBestWEngine(
  calc: Pick<ResourceCalc, 'teamTotalDamage'>,
  configStore: ConfigModel,
  slot: number,
  candidates: readonly DowngradeCandidate[],
): { pick: DowngradeCandidate | null; evaluations: number } {
  const wear = (id: string, mod: number) => {
    configStore.setWEngine(slot, id)
    configStore.setWEngineModLevel(slot, mod)
  }
  if (candidates.length === 0) return { pick: null, evaluations: 0 }
  if (candidates.length === 1) {
    wear(candidates[0].id, candidates[0].mod)
    return { pick: candidates[0], evaluations: 0 }
  }
  const { wEngineId, wEngineModLevel } = configStore.team[slot]
  let pick: DowngradeCandidate | null = null
  let bestDmg = -Infinity
  for (const c of candidates) {
    wear(c.id, c.mod)
    const dmg = calc.teamTotalDamage.value
    if (Number.isFinite(dmg) && dmg > bestDmg) { bestDmg = dmg; pick = c }
  }
  if (pick) wear(pick.id, pick.mod)
  else wear(wEngineId, wEngineModLevel)
  return { pick, evaluations: candidates.length }
}

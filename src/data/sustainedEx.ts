/**
 * 「单次释放必打招 + 可持续招」强特注册表（单一事实源）。
 *
 * 一类强特的通用结构（用户 2026-09 口径）：
 *   - 直接耗能 = 必打段（起手/收尾），倍率全额；
 *   - 持续耗能（点/秒）= 决定持续段的实际时长。
 * 持续段倍率的**基准秒数 = 倍率表该 move 的 actionTime（= ether_purify/100）**，
 * 不是 1 秒：持续段倍率 = 倍率表值 × (实际持续秒数 / actionTime)。
 * 例：妮可蓄力 1031103 的 430.6% 对应 actionTime 0.7418s，蓄 1 秒 = 430.6%×(1/0.7418)。
 *
 * 引擎接线：resourceCalc/helpers.ts buildCharConfig（skipGenericExSpecial + 能量 + 预存缩放倍率）
 * 与 core/resource/helpers.ts buildExecutions（发 opener/sustain/finisher 行）。
 * 参照实现：柏妮思 burnice.ts（skipGenericExSpecial + 持续段按秒缩放）。
 */
import type { SkillMove } from '@/types/catalog'

export interface SustainedExTerm {
  moveId: string
}

export interface SustainedExSpec {
  agentId: string
  label: string
  /** 必打起手段（直接耗能，倍率全额） */
  opener: SustainedExTerm[]
  /** 持续段：倍率 × (持续秒数/actionTime)；耗能 = 每秒 × 持续秒数 */
  sustain: {
    moveId: string
    /** 持续耗能 点/秒 */
    energyPerSecond: number
    /** 理论理想持续秒数（默认满） */
    maxSeconds: number
  }
  /** 必打收尾段（直接耗能，倍率全额） */
  finisher: SustainedExTerm[]
  /** 起手+收尾直接耗能总和（点） */
  fixedEnergy: number
}

/** 理论理想持续倍率 = 倍率表值 × (maxSeconds / actionTime) */
export function sustainedDamageScale(spec: SustainedExSpec, sustainMove: SkillMove | null): number {
  const at = sustainMove?.actionTime ?? 0
  if (at <= 0) return 1
  return spec.sustain.maxSeconds / at
}

// @fact engine:sustainedEx/基准秒 口径: 持续段倍率行的基准秒=actionTime(=ether_purify/100)，缩放=sustain倍率×(实际秒/actionTime)，不是按1秒 | 据 用户@2026-09·nanoka full/1031.json | 验 src/composables/__tests__/sustainedEx.test.ts | 锚 src/data/sustainedEx.ts#sustainedDamageScale | 信 确认

export const SUSTAINED_EX_SPECS: Record<string, SustainedExSpec> = {
  // 可琳·小心裙角：回旋(20) + 持续斩击(40最大,2.79s) + 爆炸(20)。持续倍率行 2071.4% 即对应满 2.79s。
  '1061': {
    agentId: '1061',
    label: '可琳·强化特殊技·小心裙角',
    opener: [{ moveId: '1061011' }],
    sustain: { moveId: '1061012', energyPerSecond: 40 / 2.79, maxSeconds: 2.79 },
    finisher: [{ moveId: '1061013' }],
    fixedEnergy: 40,
  },
  // 派派·引擎转→非常重：非常重(20)必打收尾；引擎转 20点/秒，最多3秒，每圈倍率=1281010/2。
  '1281': {
    agentId: '1281',
    label: '派派·强化特殊技·引擎转→非常重',
    opener: [],
    sustain: { moveId: '1281010', energyPerSecond: 20, maxSeconds: 3 },
    finisher: [{ moveId: '1281009' }],
    fixedEnergy: 20,
  },
  // 妮可·夹心糖衣炮弹：炮击(60)+能量场(必放随炮击)；蓄力 20点/秒（默认1段=0.7418s）。
  '1031': {
    agentId: '1031',
    label: '妮可·强化特殊技·夹心糖衣炮弹',
    opener: [],
    sustain: { moveId: '1031103', energyPerSecond: 20, maxSeconds: 0.7418 },
    finisher: [{ moveId: '1031104' }, { moveId: '1031105' }, { moveId: '1031106' }],
    fixedEnergy: 60,
  },
}

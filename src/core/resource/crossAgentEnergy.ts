/**
 * 跨角色联动回能（R43 结构熵切面：自 `core/resource/helpers.ts` 纯搬运，零逻辑改动）。
 *
 * 为什么这一族是内聚切面：`calcCrossAgentEnergy` 是「队友联动回能」的**单一事实源**
 * （见其头注释），`emptyCrossAgentEnergy` 是它的零值占位（供 `calcEnergySource` 单角色
 * 阶段用）。二者只依赖槽位数组与注册表查询，对 helpers.ts 其它符号**零内部依赖**
 * （R43 闸门实测：剥注释后依赖图出度为 0）。
 */
import type { CharacterOperationConfig, CrossAgentEnergy, IterationState } from '@/types/resource'
import { neighborUltEnergyByProvider, perTargetEnergyByProvider, runOwnSlotCrossAgentEnergyHooks } from './crossAgentSupply'

// ============ 单角色能量计算 ============

/**
 * 队友联动回能（跨角色能量来源的单一事实源）。
 *
 * 全部来源都依赖「其他槽位的次数」，因此必须同时被两处消费：
 * ① `iterate` —— 参与强特次数推导（收敛项）；
 * ② `calcTeamResources` 最终装配 —— 写进 `energySource.crossAgent` 与 `total`，让界面总览
 *    与真正驱动次数的能量同口径。
 *
 * 历史事故：两处各写一份，最终装配只补回 supportUltimateRegen，其余 5 项（仪玄队友终结闪能/
 * 丽娜/苍角/露西/莱特C4）在界面上不可见 —— 仪玄实测 energySource.total 720 而实际驱动 840，
 * 导致测试注释里的手算账本无法与界面对账、并在 f20b2d5 失衡提取语义修正后静默漂移。
 * 新增跨角色回能来源请只改本函数（并在 CrossAgentEnergy 上加字段）。
 */
export function calcCrossAgentEnergy(
  slotIndex: number,
  configs: CharacterOperationConfig[],
  states: IterationState[],
): CrossAgentEnergy {
  const cfg = configs[slotIndex]
  const num = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }

  let supportUltimateRegen = 0
  let teamUltimateFlash = 0
  for (let j = 0; j < configs.length; j++) {
    if (j === slotIndex) continue
    const other = configs[j]
    if (other.supportUltimateEnergyRegen > 0) {
      supportUltimateRegen += states[j].ultimateCount * other.supportUltimateEnergyRegen
    }
    // 模块声明：队友终结技每次回闪能（如仪玄额外能力·队友释放终结技回 2/s×10s=20）
    if ((cfg.teamUltimateFlashBonus ?? 0) > 0) {
      teamUltimateFlash += states[j].ultimateCount * (cfg.teamUltimateFlashBonus ?? 0)
    }
  }

  // 支援角色终结技**邻位回能**（丽娜/苍角/露西；次数使用传入状态参与收敛）。
  // 2026-09-15 core 棘轮批次3：原为三段各自 `findIndex(c => c.agentId === '<id>')` 的角色专属数学
  // （丽娜/苍角的 calcXxxUltEnergy + 露西的内联块），现引擎只按**能力类别**查询：
  // 各模块用 `crossAgentSupply.kind = 'neighbor-ult-energy'` 声明自己、用 `perTargetAmounts()`
  // 报「送给每个落点多少能量」（邻位 30/10 分配、影画1 回旋回能、乘自己终结技次数都在模块内）。
  // 新角色接邻位回能不必再改引擎（规则 6）。
  //
  // ⚠ 明细字段（rina/soukaku/lucy 三个来源）由 `byProvider` 按**提供者槽位**拆分，
  // 供 `ResourceResultCard.vue` 逐条展示；`total` 用合计值（同一落点可同时被多名提供者回能，
  // 明细相加 = total，不会漏也不会重）。
  const neighborUlt = neighborUltEnergyByProvider(configs, states, slotIndex, {
    totalTime: 180, stunCount: 0,
  })
  const byKey = neighborUlt.byDisplayKey
  const rinaUltEnergy = byKey.rinaUltEnergy ?? 0
  const soukakuUltEnergy = byKey.soukakuUltEnergy ?? 0
  const lucyEnergy = byKey.lucyEnergy ?? 0

  // 莱特影画4：进士气喷发时后场角色 +4 能量（18s CD，总额预写入 cfg.lighterC4BurstEnergy）
  const lighterC4Raw = num((cfg as any).lighterC4BurstEnergy)
  const lighterC4Energy = lighterC4Raw > 0 ? lighterC4Raw : 0

  // 正兵回能（CC-32a 2026-09-27，census §5.25）：原为席德（1461）专属内联块（按 cfg 字段找席德槽、
  // 算正兵回能 + 算席德自己那槽时回写正兵实际耗能）。现按能力类别 `crossAgentSupply.kind = 'vanguard-energy'`
  // 派发：落点量走 `perTargetAmounts`（与邻位回能同一派发器，按模块自报 displayKey 聚合），
  // 回写走 `onOwnSlotCrossAgentEnergy`（同一时机：算提供者自己那槽时）。引擎侧零角色逻辑。
  const vanguard = perTargetEnergyByProvider(configs, states, slotIndex, { totalTime: 180, stunCount: 0 }, 'vanguard-energy')
  runOwnSlotCrossAgentEnergyHooks(configs, states, slotIndex, 'vanguard-energy')

  return {
    supportUltimateRegen,
    teamUltimateFlash,
    rinaUltEnergy,
    soukakuUltEnergy,
    lucyEnergy,
    lighterC4Energy,
    xideVanguardEnergy: vanguard.byDisplayKey.xideVanguardEnergy ?? 0,
    total: supportUltimateRegen + teamUltimateFlash + neighborUlt.total
      + lighterC4Energy + vanguard.total,
  }
}

/** 空的队友联动明细（calcEnergySource 单角色阶段用，由调用方按 calcCrossAgentEnergy 回填）。 */
export function emptyCrossAgentEnergy(): CrossAgentEnergy {
  return {
    supportUltimateRegen: 0,
    teamUltimateFlash: 0,
    rinaUltEnergy: 0,
    soukakuUltEnergy: 0,
    lucyEnergy: 0,
    lighterC4Energy: 0,
    xideVanguardEnergy: 0,
    total: 0,
  }
}

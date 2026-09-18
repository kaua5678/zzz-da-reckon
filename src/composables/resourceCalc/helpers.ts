/**
 * 资源池计算 composable
 *
 * 从 config store 获取队伍配置 → 计算面板 → 构建资源池计算配置 → 调用计算引擎
 *
 * 数据流：
 *   configStore.team (3角色配置)
 *     → calcPanel (面板计算，复用 TeamConfigPage 同逻辑)
 *     → findExSpecial / findUltimate / findChainAttack / calcBasicAttackRegenPerSec (技能数据提取)
 *     → CharacterOperationConfig[] (资源池配置)
 *     → calcTeamResources (迭代计算)
 *     → TeamResourceResult (结果)
 *     → calcStunPool / calcAnomalyPool (失衡池 + 积蓄池)
 */
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { inferSkillDamageTarget } from '@/core/damage'
import type { StunSkillExecution } from '@/core/stunPool'
import {
  findExSpecial,
  findUltimate,
  findChainAttack,
  findDefensiveAssist,
  findAssistFollowUp,
  findCounterAssist,
  findDodgeCounter,
  calcBasicAttackRegenPerSec,
  findRemielleRainbowEnd,
  findRemielleRadiantTurn,
  ULTIMATE_COST_DEFAULT,
} from '@/core/resource'
import { counterAssistOf } from '@/data/counterAssists'

import type { AnomalySkillExecution } from '@/core/anomalyPool'
import { getAgentMechanic } from '@/mechanics'
// 蕾米埃尔身份谓词 `isRemielleAgent` 的 import 已随 D 簇（异常面板）迁去 `./anomalyPanels.ts`
// （R22 熵批 2 刀 C）——本文件不再用它；D 簇那边仍只 import 谓词、不 import 整个模块的其它数学
// （规则 6 的语义面）。
import type {
  CharacterOperationConfig,
  TeamResourceResult,
  SkillExecution,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import type { PanelValues, AgentSkills, SkillMove } from '@/types/catalog'
import { getSkillLevelCoef } from '@/core/skillLevel'
// `getAgentSpec`（@/specs/registry）/ `evalAdditionalAbility`（@/specs/teamCondition）/ `fmt`
// （@/utils/format）的 import 已随 D 簇（异常面板）迁去 `./anomalyPanels.ts`——本文件不再用它们。
// `getRowFusionMultiplier`（@/logicEditor/fusion）与 `moveFusionByMoveId`（@/data/moveFusions）
// 的 import 已随 C 簇（招式行取值）迁去 `./skillRows.ts`（R22 熵批 2 刀 B）——本文件不再用它们。
import { SUSTAINED_EX_SPECS, sustainedDamageScale } from '@/data/sustainedEx'
import { EXTRA_EX_PLANS } from '@/data/exSpecialPlans'

// ============================================================================
// 面板 + 机制编排簇（B 簇）已整段迁至 `./panelPhases.ts`（R22 熵批 1 / T67-a1 刀 A，纯搬迁）。
// 本块是 **re-export 壳**：51 个 `computePanelPhases` 消费者与既有测试的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './panelPhases'` **不建本地绑定**，
//   而本文件下游（`buildCharConfig` → `computePanel`；异常/执行计划簇 → `buildMechanicTeamMembers`）
//   需要本地绑定，实测会 `ReferenceError`。
// ⚠ 私有 helper（`teamDiscs` / `mergeTeamDiscEffectCoverages` / `agentHasCinemaSkillLevelBuff`）
//   **不 re-export**——它们迁移前就不是本文件的导出面，不借搬迁顺手放宽 API。
// ⚠ 改面板/机制编排请改 `./panelPhases.ts`，**不要在本文件重建同形函数**（那会分裂单一事实源）。
// ============================================================================
import {
  buildMechanicTeamMembers,
  computePanel,
  computePanelPhases,
  computeRemielleEntryPanel,
  resolveMechanicSettings,
  applyTeamMechanics,
  collectNextRoundFeedback,
  collectAxisWindowOverlays,
  ADDITIONAL_GATE_BUFFS,
  evalAdditionalAbilityBuffGates,
} from './panelPhases'
export {
  buildMechanicTeamMembers,
  computePanel,
  computePanelPhases,
  computeRemielleEntryPanel,
  resolveMechanicSettings,
  applyTeamMechanics,
  collectNextRoundFeedback,
  collectAxisWindowOverlays,
  ADDITIONAL_GATE_BUFFS,
  evalAdditionalAbilityBuffGates,
}

/** 判断字符串是否为百分比型属性（决定 applyStat 用 pct 还是 flat） */


export type DamagePoolRow = {
  id: string
  slot: number
  agentId: string
  agentName: string
  type: '直伤' | '异放' | '乱流' | '耀变' | '特殊虚耀' | '灼烧' | '感电' | '侵蚀' | '风化' | '强击' | '极性紊乱' | '极性强击' | '碎冰' | '简6命附伤' | '紊乱' | '爱丽丝6命附伤' | '畏缩 DOT'
  name: string
  element: string
  source: string
  count: number
  perDamage: number
  totalDamage: number
  note: string
  /** 来源招式 moveId（直伤行有值，异常行 undefined） */
  moveId?: string
  /** 来源标签：gift=队友赠送（诺姆转连携/琉音转大等）、stun=失衡送连携、self=自身攒 */
  sourceTag?: 'gift' | 'stun' | 'self'
  /** 失衡易伤乘数（轴启用时按轴内位置分配，默认 1） */
  stunMult?: number
  /** 单次倍率（%，直伤=招式倍率、异放=releaseMultiplier、紊乱=disorderMultiplier、
   *  DoT=perTick×tick数 等；秒均行 count 已折算成总秒数 → count×multiplier = 该行总倍率）。
   *  供「伤害来源分解」诊断：总倍率 = Σ(count×multiplier)，属性区 = 总伤害/(总倍率/100)。 */
  multiplier?: number
}

export function parseReleaseMultiplier(event: { formula?: string; fields?: string[] }): number {
  const text = `${event.formula ?? ''} ${(event.fields ?? []).join(' ')}`
  const match = text.match(/releaseMultiplier\s*=\s*(\d+(?:\.\d+)?)/i)
  return match ? Number(match[1]) : 0
}

/** 伤害来源分解：某角色一类伤害（直伤/异常）的总伤害、总倍率与属性区（诊断用）。
 *  总倍率 = Σ(count × multiplier)（%，有 multiplier 的行；无 multiplier 的固定/附伤行不计倍率）
 *  属性区 = 有倍率行的伤害 / (总倍率/100) —— 每 100% 倍率对应的「属性区伤害」（atk×增伤×防御×
 *  抗性×易伤×失衡×暴击×等级 等非倍率乘区乘积的加权期望）。总伤害 = 属性区 × 总倍率/100 + 无倍率行伤害。
 *  用途：检查总伤害异常时，看是倍率（招式/事件次数×倍率）错还是属性区（面板/乘区）错。 */
export interface DamageSourceFamily {
  /** 总伤害（含无倍率行） */
  damage: number
  /** 总倍率 Σ(count × multiplier)（%） */
  multiplier: number
  /** 属性区 = 有倍率行伤害 / (总倍率/100)（0 表示无倍率行或倍率为 0） */
  attrRegion: number
  /** 无倍率行（固定/附伤）伤害合计 */
  flatDamage: number
  /** 有倍率行的行数 */
  multiplierRows: number
  /** 有倍率行的伤害合计（属性区反推的分子） */
  multiplierDamage: number
}
export interface DamageSourceBreakdown {
  slot: number
  agentId: string
  agentName: string
  direct: DamageSourceFamily
  anomaly: DamageSourceFamily
}

/** 直伤族类型（其余全归异常族） */
const DIRECT_FAMILY_TYPES = new Set<string>(['直伤'])

export function computeDamageSourceBreakdown(rows: DamagePoolRow[]): DamageSourceBreakdown[] {
  const bySlot = new Map<number, DamageSourceBreakdown>()
  const emptyFamily = (): DamageSourceFamily => ({ damage: 0, multiplier: 0, attrRegion: 0, flatDamage: 0, multiplierRows: 0, multiplierDamage: 0 })
  const add = (fam: DamageSourceFamily, row: DamagePoolRow) => {
    fam.damage += row.totalDamage
    if (row.multiplier && row.multiplier > 0 && row.count > 0) {
      fam.multiplier += row.count * row.multiplier
      fam.multiplierRows += 1
      fam.multiplierDamage += row.totalDamage
    } else {
      fam.flatDamage += row.totalDamage
    }
  }
  for (const row of rows) {
    let b = bySlot.get(row.slot)
    if (!b) {
      b = { slot: row.slot, agentId: row.agentId, agentName: row.agentName, direct: emptyFamily(), anomaly: emptyFamily() }
      bySlot.set(row.slot, b)
    }
    add(DIRECT_FAMILY_TYPES.has(row.type) ? b.direct : b.anomaly, row)
  }
  const finish = (fam: DamageSourceFamily) => {
    fam.attrRegion = fam.multiplier > 0 ? fam.multiplierDamage / (fam.multiplier / 100) : 0
  }
  const out: DamageSourceBreakdown[] = []
  for (const b of bySlot.values()) {
    finish(b.direct)
    finish(b.anomaly)
    out.push(b)
  }
  out.sort((a, b) => a.slot - b.slot)
  return out
}

export function safeElement(element?: string): any {
  return (element || 'physical') as any
}


export const DAMAGE_ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
  lumiflux: '辉光',
  physical_polar_assault: '极性强击',  // 爱丽丝物理变种
  ether_ink: '玄墨',                  // 仪玄以太变种（独立积蓄槽）
  frostfire: '烈霜',                     // 雅独立元素
}

export function elementLabel(element: string): string {
  return DAMAGE_ELEMENT_LABELS[element] ?? element
}

// `isPctStat` 的第三份副本已于 2026-09-18 round 27 删除（规则 11 单一事实源）：
// 它是 `utils/statMeta.ts#isPctStat` 的**逐字漂移副本**（缺 `Reduction`/`Ignore` 两个后缀、
// 且不剥 `__` 限定段），且当时**全仓零引用**（唯一读者 `panelPhases.ts` 要的是**结算**口径，
// 已改读 `statSettlementMode`）。留着它就是下一颗「改一处忘一处」的地雷。
// 展示口径用 `@/utils/statMeta#isPctStat`；结算口径用 `@/utils/statMeta#statSettlementMode`。

// ============================================================================
// 招式行取值簇（C 簇，14 个符号）已整段迁至 `./skillRows.ts`（R22 熵批 2 / R22-S2 刀 B，纯搬迁）。
// 本块是 **re-export 壳**：目录外既有消费者（`mechanics/agents/*` / `components` / `views` / 测试）
// 的 import 路径零改动。⚠ 必须写成「import + export」两行——`export { … } from './skillRows'`
// **不建本地绑定**，而本文件下游（`buildCharConfig` / `extractSkillExecutions`）需要本地绑定。
// ⚠ 改招式行取值请改 `./skillRows.ts`，**不要在本文件重建同形函数**。
// ============================================================================
import {
  getRowValue,
  fusedRowValue,
  ELEMENT_DMG_KEYS,
  ELEMENT_DEF_REDUCTION_KEYS,
  ELEMENT_RES_REDUCTION_KEYS,
  findMoveById,
  findMoveByEnglishName,
  isHealingRow,
  getHealingAmount,
  getSpecialResourceRecovery,
  BASIC_BENCHMARK_OVERRIDE,
  pickThirdNamedBasicSegment,
  getBasicComboMoves,
  averageBasicRows,
} from './skillRows'
export {
  getRowValue,
  fusedRowValue,
  ELEMENT_DMG_KEYS,
  ELEMENT_DEF_REDUCTION_KEYS,
  ELEMENT_RES_REDUCTION_KEYS,
  findMoveById,
  findMoveByEnglishName,
  isHealingRow,
  getHealingAmount,
  getSpecialResourceRecovery,
  BASIC_BENCHMARK_OVERRIDE,
  pickThirdNamedBasicSegment,
  getBasicComboMoves,
  averageBasicRows,
}

// ============================================================================
// 异常面板簇（D 簇，15 个符号）已整段迁至 `./anomalyPanels.ts`（R22 熵批 2 / R22-S2 刀 C，纯搬迁）。
// 本块是 **re-export 壳**：目录外既有消费者（`damagePool.ts` 取其中 7 个 / `cinemaUplift.ts` /
// `difficultyLadder.ts` / `views` / 既有测试）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './anomalyPanels'` **不建本地绑定**。
// ⚠ 改异常面板/结算口径请改 `./anomalyPanels.ts`，**不要在本文件重建同形函数**。
// ============================================================================
import {
  teamHasAgent,
  getTeamAnomalyDurationBonus,
  findSlotByIdentity,
  getWindInfectionTargetSlot,
  getWindInfectionElement,
  getWindInfectionCoverage,
  buildAnomalyVirtualPanel,
  buildAnomalySettlementEntries,
  getRemielleLevelValue,
  remielleSpecialVoidflareCount,
  calcVoidflareDamage,
} from './anomalyPanels'
import type {
  AnomalyVirtualPanelRow,
  AnomalyVirtualPanelBuild,
  AnomalySettlementEntry,
  VoidflareDamageInput,
} from './anomalyPanels'
export {
  teamHasAgent,
  getTeamAnomalyDurationBonus,
  findSlotByIdentity,
  getWindInfectionTargetSlot,
  getWindInfectionElement,
  getWindInfectionCoverage,
  buildAnomalyVirtualPanel,
  buildAnomalySettlementEntries,
  getRemielleLevelValue,
  remielleSpecialVoidflareCount,
  calcVoidflareDamage,
}
export type {
  AnomalyVirtualPanelRow,
  AnomalyVirtualPanelBuild,
  AnomalySettlementEntry,
  VoidflareDamageInput,
}

/**
 * 展示口径归一（2026-09-08 用户实测「诺姆入队后主C时间 = 180s + 诺姆连携秒数」后收口）：
 * 资源卡的「时间分配」按**最终执行行**计算——前台 = Σ前台行 `totalTime`（含装配后追加的赠送行：
 * 诺姆赠链 `normaGiftChain` / 琉音赠大 `source==='gift'`），后台 = 战斗时间 − 前台。
 *
 * 为什么必须在这里统一：赠送行由 `applyNormaHatChain` / `applyLiuyinPromote` 在引擎返回**之后**追加，
 * 引擎的 `timeAllocation` 看不到它们；而赠送时间的**预留**分散在 iterate 必要时间 / 折叠环行测量 /
 * 截断上限三处，各自口径略不同（轴模式琉音赠大走的是 post-hoc carve、预留为 0）——于是展示层
 * 若也各自回扣就会再次漂移（实测轴模式资源卡总计 = 180 + 赠送秒数）。此处以**最终行**为唯一口径重算，
 * 新增赠送机制无需再改展示逻辑。
 */
export function normalizeDisplayTime(rr: TeamResourceResult): TeamResourceResult {
  return {
    ...rr,
    characters: rr.characters.map(c => {
      const front = (c.executions ?? []).reduce(
        (s, e) => s + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
      return {
        ...c,
        timeAllocation: {
          ...c.timeAllocation,
          frontlineTime: front,
          backstageTime: Math.max(0, rr.totalTime - front),
        },
      }
    }),
  }
}

export function enrichExecutionPlan(result: TeamResourceResult, catalogStore: ReturnType<typeof useCatalogStore>): TeamResourceResult {
  return {
    ...result,
    characters: result.characters.map(char => {
      const skills = catalogStore.getAgentSkills(char.agentId)
      const executions = char.executions.map(exec => {
        // 赠行由引擎物化、倍率由编排层在 enrich 之后补：enrich 必须跳过，否则会补上生产侧
        // 刻意留空的字段（实测：琉音赠行凭空多 daze、诺姆赠行凭空多 skillDamageTarget）。
        if (exec.source === 'gift' || exec.normaGiftChain) return exec
        let patch: Partial<SkillExecution> = {}
        if (exec.moveId === 'basic_attack') {
          if (exec.damageMultiplierOverride || exec.dazeMultiplierOverride) {
            // 机制模块已覆盖秒均倍率（如青衣「一煞#4→醉花」循环），保留自定义值
            const bu = exec.anomalyBuildUp ?? 0
            patch = {
              actionCode: exec.moveId,
              skillTableResolved: true,
              skillDamageTarget: 'basic',
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.totalTime),
            }
          } else {
            const rows = averageBasicRows(skills, char.agentId, catalogStore)
            const bu = rows.anomalyBuildUp ?? 0
            patch = {
              actionCode: exec.moveId,
              ...rows,
              skillDamageTarget: 'basic',
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.totalTime),
            }
          }
        } else {
          const move = findMoveById(skills, exec.moveId)
          if (move) {
            // 招式类型定向（伤害路径按此读 X__<target> 定向键，如驱动盘/音擎的普攻/冲刺限定增伤）
            const foundCategory = skills?.categories?.find(cat => (cat.moves ?? []).some(m => String(m.id) === String(exec.moveId)))
            const skillDamageTarget = foundCategory ? inferSkillDamageTarget(foundCategory, move) : undefined
            const specialResourceRecovery = getSpecialResourceRecovery(move)
            const healingAmount = getHealingAmount(move)
            // exec.anomalyBuildUp 显式为 0 = 模块显式禁用异常积蓄（如莱卡恩围猎后台招式"仅伤害+失衡值"）；
            // anomalyBuildUpOverride = 模块显式给定缩放后积蓄（持续段按时长等比），跳过回填。
            const bu = exec.anomalyBuildUpOverride
              ? (exec.anomalyBuildUp ?? 0)
              : exec.anomalyBuildUp === 0
                ? 0
                : (fusedRowValue(skills, exec.moveId, 'anomaly_buildup') ?? getRowValue(move, 'anomaly_buildup'))
            // 同上：decibel/energy 显式 0 = 模块显式禁用回填（围猎后台闪反无喧响/能量）；
            // 未提供（undefined）= 交倍率表回填——能量与喧响同构三态（2026-09-09 能量债务审计）。
            // decibelRecoveryOverride = 模块显式给定口径换算后的行值（如洛克茜自旋：表值为每秒，
            // 行值 = 每秒 × spinSeconds），跳过表值覆盖——与 damage/anomaly override 同构。
            // 登记融合组的主段行：喧响/能量取「一次动作」的整段和（与 damage/daze/anomaly 同一函数
            // 同一口径）；只回头段会把雅一次连携的 230.15 记成 69.05（坑 31）。
            const tableDecibel = fusedRowValue(skills, exec.moveId, 'decibel_recovery')
              ?? getRowValue(move, 'decibel_recovery')
            const decibelValue = exec.decibelRecoveryOverride
              ? (exec.decibelRecovery ?? 0)
              : exec.decibelRecovery === 0 ? 0 : (tableDecibel || (exec.decibelRecovery ?? 0))
            const tableEnergy = fusedRowValue(skills, exec.moveId, 'energy_recovery')
              ?? getRowValue(move, 'energy_recovery')
            const energyValue = exec.energyRecovery === 0 ? 0 : (tableEnergy || (exec.energyRecovery ?? 0))
            patch = {
              actionCode: move.id,
              moveName: move.name?.zhCN || move.name?.en || exec.moveName,
              damageMultiplier: exec.damageMultiplierOverride
                ? exec.damageMultiplier
                : (fusedRowValue(skills, exec.moveId, 'damage') ?? getRowValue(move, 'damage')),
              dazeMultiplier: exec.dazeMultiplierOverride
                ? exec.dazeMultiplier
                : (fusedRowValue(skills, exec.moveId, 'daze') ?? getRowValue(move, 'daze')),
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.count),
              energyRecovery: energyValue,
              totalEnergyRecovery: energyValue * Math.max(0, exec.count),
              decibelRecovery: decibelValue,
              totalDecibelRecovery: decibelValue * Math.max(0, exec.count),
              specialResourceRecovery,
              totalSpecialResourceRecovery: specialResourceRecovery * Math.max(0, exec.count),
              healingAmount,
              totalHealingAmount: healingAmount * Math.max(0, exec.count),
              skillTableResolved: true,
              skillDamageTarget,
              skillTableNote: '已从倍率表 rows 回填 damage/daze/energy_recovery/decibel_recovery/anomaly_buildup。',
            }
          } else {
            patch = {
              skillTableResolved: false,
              skillTableNote: '未在倍率表中找到对应 moveId；可能是资源池合成行或待补数据。',
            }
          }
        }
        return { ...exec, ...patch }
      })
      return { ...char, executions }
    }),
  }
}

/** 从技能数据提取资源池所需的招式信息，构建单个角色的操作配置 */


export function normalizeResourceSkillType(move: SkillMove | null, execMoveId: string): string {
  if (execMoveId === 'basic_attack') return 'basic'
  // 优先按招式自身信号分类（与伤害路径 inferSkillDamageTarget 同口径——@fact 招式类型/两路径同源 |
  // 据 用户 2026-09-05「字段对应，招式限定要注意」 | 验 discSetEffects.test.ts | 锚 helpers.ts#normalizeResourceSkillType | 信 高）：
  // 实测冲刺招式 catalog skillType 可能误标 'dodge'（如苍角 1131016），名称/tags 先判可纠正。
  if (move?.timeType === 'dodgeCounter') return 'dodgeCounter'
  if (move?.skillTags?.includes('dashAttack')) return 'dashAttack'
  if (move?.skillTags?.includes('additionalAttack')) return 'additionalAttack'
  const name = `${move?.name?.en ?? ''} ${move?.name?.zhCN ?? ''}`.toLowerCase()
  if (name.includes('dash attack') || name.includes('冲刺攻击')) return 'dashAttack'
  const raw = move?.skillType ?? ''
  if (raw === 'dodge') return 'dodgeCounter'
  if (raw === 'special') return move?.energyCost ? 'exSpecial' : 'special'
  if (raw === 'basic' || raw === 'ultimate' || raw === 'chain' || raw === 'assist'
    || raw === 'dashAttack' || raw === 'additionalAttack') return raw
  return 'all'
}

export function buildCharConfig(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): CharacterOperationConfig | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null

  const agent = catalogStore.getAgent(char.agentId)
  const skills = catalogStore.getAgentSkills(char.agentId)
  if (!agent || !skills) return null

  const panel = computePanel(slot, configStore, catalogStore)
  if (!panel) return null

  // 「本槽是不是蕾米埃尔」+ 面板盖章 + cfg 三字段（`remielleEnabled` / `remielleRadiantTurnDazeBonusPct`
  // / 面板同名字段）**已整块迁进** `remielle.ts#buildRemielleCharConfig`（2026-09-17 round 21 夜间批 C，
  // 规则 6）。原实现是 `:1661` 的 `agent.id === '1581' || agent.teammateBuffId === 'remielle'` 判据
  // 加 `:1662-1634` 的**双出口**（panel + cfg 各写一次）；现在**唯一写者 = 该角色模块**，钩子在下文
  // `charModule?.buildCharConfig?.({ … cfg })` 处被派发（它写的就是本函数刚建好的同一个 cfg 对象）。
  // ⇒ cfg 字面量里**不再**出现 `remielleEnabled` / `remielleRadiantTurnDazeBonusPct`（未命中时保持
  // `undefined`，与迁移前 `false`/`0` 在消费端 `if (cfg.remielleEnabled && …)` 下等价）。

  // 判断命破角色
  const isFlash = !!(agent.level60.flashEnergyRegen && agent.level60.flashEnergyRegen > 0)

  // 提取技能数据
  const exSpecial = findExSpecial(skills as AgentSkills)
  const ultimate = findUltimate(skills as AgentSkills)
  const chainAttack = findChainAttack(skills as AgentSkills)
  const defensiveAssist = findDefensiveAssist(skills as AgentSkills)
  const assistFollowUp = findAssistFollowUp(skills as AgentSkills)
  // 反制支援（Counter Assist）：按登记表取行（克拉蕾 = 1611028 寸铁不让 + 1611030 琢形，
  // 融合成「一次动作」），有登记 ≠ 一定发动——次数由 boss 控制技组与替换开关决定。
  const counterAssistDecl = counterAssistOf(char.agentId)
  const counterAssist = counterAssistDecl ? findCounterAssist(skills as AgentSkills, counterAssistDecl.moveId) : null
  const counterAssistCount = counterAssist && configStore.counterAssistSlot === slot
    ? (configStore.appliedBoss?.counterAssistGroups?.length ?? 0)
    : 0
  const dodgeCounter = findDodgeCounter(skills as AgentSkills)
  const basicRegen = calcBasicAttackRegenPerSec(skills as AgentSkills)
  const remielleRainbowEnd = findRemielleRainbowEnd(skills as AgentSkills)
  const remielleRadiantTurn = findRemielleRadiantTurn(skills as AgentSkills)

  // 倍率表 decibel_recovery / energy_recovery 全量预存（喧响+能量收入行级化 Σ 切换的前置）：
  // 核心层 calcRawDecibelParts / calcEnergySource 无 catalog 访问权，按此表复刻 enrichExecutionPlan
  // 回填语义（getRowValue 含行级融合乘子，与展示层同一函数同一时刻取值，杜绝记账/展示两套表值）。
  const decibelRecoveryByMoveId: Record<string, number> = {}
  const energyRecoveryByMoveId: Record<string, number> = {}
  for (const cat of (skills as AgentSkills | undefined)?.categories ?? []) {
    for (const m of cat.moves ?? []) {
      // 登记融合组的主段：喧响取「一次动作」的整段和（一次连携把各段的 fever_recovery 全打了，
      // 只回头段会把雅 230.15 记成 69.05）。兄弟段不单独成行（moveFusions 入表前提），无六计风险。
      decibelRecoveryByMoveId[String(m.id)]
        = fusedRowValue(skills as AgentSkills, String(m.id), 'decibel_recovery') ?? getRowValue(m, 'decibel_recovery')
      energyRecoveryByMoveId[String(m.id)]
        = fusedRowValue(skills as AgentSkills, String(m.id), 'energy_recovery') ?? getRowValue(m, 'energy_recovery')
    }
  }

  // 合轴率覆盖：优先使用用户在结果页设置的值，否则用倍率表默认值
  const ov = (moveId: string, defaultRatio: number) =>
    configStore.getComboAlignOverride(slot, moveId, defaultRatio)

  // 角色类型
  const isSupport = agent.specialty === 'support'

  // 加农转子（14001）：攻击命中并暴击时触发 200% 攻击力直伤事件，按精修 CD 计算本局上限。
  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : null
  const wEngineMatchesSpecialty = !!wEngine && wEngine.specialty === agent.specialty
  const cannonRotorCooldowns = [8, 7.5, 7, 6.5, 6]
  const cannonRotorModIndex = Math.max(0, Math.min(4, (char.wEngineModLevel ?? 1) - 1))
  // 音擎 id 已统一为数字（旧 zzz_wiki_XXXX 存于 legacyIds，兼容旧 localStorage 配置）
  const hasCannonRotorEvent = wEngineMatchesSpecialty && !!wEngine
    && (wEngine.id === '14001' || (wEngine.legacyIds ?? []).includes('14001'))

  // 平A时间分配权重：优先读取用户配置；旧配置缺字段时按当前默认规则兜底
  const timeWeight = char.basicAttackTimeWeight ?? configStore.getDefaultBasicAttackTimeWeight(agent)

  // 开局赠送能量：普通角色40点
  const initialEnergyGift = 40

  const resourceUtilizationPrefix = `${slot}:`
  const resourceUtilization = Object.fromEntries(
    Object.entries(configStore.resourceUtilization ?? {})
      .filter(([key]) => key.startsWith(resourceUtilizationPrefix))
      .map(([key, value]) => [key.slice(resourceUtilizationPrefix.length), value]),
  )

  const cfg: CharacterOperationConfig = {
    slot,
    agentId: char.agentId,
    isFlashUser: isFlash,
    panel,
    basicAttackRegenPerSec: basicRegen.energyPerSec,
    basicAttackDecibelPerSec: basicRegen.decibelPerSec,
    remielleRainbowEndMoveId: remielleRainbowEnd?.moveId ?? '',
    remielleRainbowEndActionTime: remielleRainbowEnd?.actionTime ?? 0,
    remielleRainbowEndDecibelRecovery: remielleRainbowEnd?.decibelRecovery ?? 0,
    remielleRainbowEndComboAlignRatio: remielleRainbowEnd?.comboAlignRatio ?? 0,
    // `remielleEnabled` / `remielleRadiantTurnDazeBonusPct` 由下方
    // `charModule?.buildCharConfig?.()`（= `remielle.ts#buildRemielleCharConfig`）写入，
    // 不再在此处按身份判定（2026-09-17 round 21 夜间批 C）。
    remielleRadiantTurnMoveId: remielleRadiantTurn?.moveId ?? '',
    remielleRadiantTurnActionTime: remielleRadiantTurn?.actionTime ?? 0,
    remielleRadiantTurnDecibelRecovery: remielleRadiantTurn?.decibelRecovery ?? 0,
    exSpecialMoveId: exSpecial?.moveId ?? '',
    exSpecialEnergyConsume: exSpecial?.energyConsume ?? 0,
    exSpecialCostType: exSpecial?.costType ?? (exSpecial?.energyConsume ? 'energy' : 'free'),
    exSpecialCostAmount: exSpecial?.costAmount ?? 0,
    exSpecialResourceId: exSpecial?.resourceId,
    exSpecialActionTime: exSpecial?.actionTime ?? 0,
    exSpecialDecibelRecovery: exSpecial?.decibelRecovery ?? 0,
    decibelRecoveryByMoveId,
    energyRecoveryByMoveId,
    exSpecialComboAlignRatio: ov(exSpecial?.moveId ?? '', exSpecial?.comboAlignRatio ?? 0),
    ultimateMoveId: ultimate?.moveId ?? '',
    ultimateCost: ULTIMATE_COST_DEFAULT,
    ultimateActionTime: ultimate?.actionTime ?? 0,
    ultimateDecibelRecovery: 0,
    ultimateComboAlignRatio: ov(ultimate?.moveId ?? '', ultimate?.comboAlignRatio ?? 0),
    chainMoveId: chainAttack?.moveId ?? '',
    chainActionTime: chainAttack?.actionTime ?? 0,
    chainDecibelRecovery: chainAttack?.decibelRecovery ?? 0,
    chainComboAlignRatio: ov(chainAttack?.moveId ?? '', chainAttack?.comboAlignRatio ?? 0),
    chainCountPerStun: char.chainCountPerStun ?? (isSupport ? 0 : 1),
    parryCount: char.parryCount ?? 0,
    parryNoFollowUpCount: (char as { parryNoFollowUpCount?: number }).parryNoFollowUpCount ?? 0,
    parryDecibelOnlyCount: (char as { parryDecibelOnlyCount?: number }).parryDecibelOnlyCount ?? 0,
    perfectBlockCount: (char as { perfectBlockCount?: number }).perfectBlockCount ?? 0,
    assaultOrderCount: (char as { assaultOrderCount?: number }).assaultOrderCount ?? 0,
    dodgeCounterCount: char.dodgeCounterCount ?? 0,
    blockCount: char.blockCount ?? 0,
    dualCounterCount: char.dualCounterCount ?? 0,
    tauntCancelCount: char.tauntCancelCount ?? 0,
    quickAssistCount: char.quickAssistCount ?? 0,
    yixuanInk2Count: char.yixuanInk2Count ?? 0,
    promiaNiyingCount: char.promiaNiyingCount ?? 0,
    yixuanInk3Count: char.yixuanInk3Count ?? 0,
    yixuanPerfectBlockCount: char.yixuanPerfectBlockCount ?? 0,
    yixuanExtremeAssistCount: char.yixuanExtremeAssistCount ?? -1,
    yixuanBackstageComboCount: char.yixuanBackstageComboCount ?? 0,
    dodgeCounterMoveId: dodgeCounter?.moveId ?? '',
    dodgeCounterActionTime: dodgeCounter?.actionTime ?? 0,
    dodgeCounterDecibelRecovery: dodgeCounter?.decibelRecovery ?? 0,
    dodgeCounterComboAlignRatio: ov(dodgeCounter?.moveId ?? '', dodgeCounter?.comboAlignRatio ?? 0),
    defensiveAssistMoveId: defensiveAssist?.moveId ?? '',
    defensiveAssistActionTime: defensiveAssist?.actionTime ?? 0,
    defensiveAssistDecibelRecovery: defensiveAssist?.decibelRecovery ?? 0,
    defensiveAssistComboAlignRatio: ov(defensiveAssist?.moveId ?? '', defensiveAssist?.comboAlignRatio ?? 0),
    assistFollowUpMoveId: assistFollowUp?.moveId ?? '',
    assistFollowUpActionTime: assistFollowUp?.actionTime ?? 0,
    assistFollowUpDecibelRecovery: assistFollowUp?.decibelRecovery ?? 0,
    assistFollowUpComboAlignRatio: ov(assistFollowUp?.moveId ?? '', assistFollowUp?.comboAlignRatio ?? 0),
    // 反制支援（控制技整组化解）：时间/喧响 = 融合后「一次动作」的整段量（本体 + 琢形）；
    // 次数 = 该槽位承接的控制技组数（store 折算，非用户手填）。
    counterAssistMoveId: counterAssist?.moveId ?? '',
    counterAssistActionTime: counterAssist?.actionTime ?? 0,
    counterAssistDecibelRecovery: counterAssist?.decibelRecovery ?? 0,
    counterAssistComboAlignRatio: ov(counterAssist?.moveId ?? '', counterAssist?.comboAlignRatio ?? 0),
    counterAssistCount,
    backstageRegenBonus: 0,
    comboAlignRegenBonus: 0,
    zhenyuanTriggerCount: 0,
    cannonRotorDamageMultiplier: hasCannonRotorEvent ? 200 : 0,
    cannonRotorCooldownSeconds: hasCannonRotorEvent ? cannonRotorCooldowns[cannonRotorModIndex] : 0,
    initialEnergyGift,
    initialDecibelGift: 1000 + (configStore.appliedBoss?.decibelGift?.slot === slot ? (configStore.appliedBoss?.decibelGift?.amount ?? 0) : 0),
    battleTime: configStore.enemy.battleTime ?? 180,
    invincibleTime: configStore.enemy.invincibleTime ?? 0,
    bodySize: configStore.enemy.bodySize ?? 'large',
    extraSelfDecibelReward: (panel.remielleFlowerFeatherDanceDecibelPerUse ?? 0) * (panel.remielleFlowerFeatherDanceCount ?? 0),
    decibelShareRatio: 0.5,
    supportUltimateEnergyRegen: 0,
    isSupport,
    timeWeight,
    resourceUtilization,
  }

  // 先把机制模块声明的可调设置写入 cfg，模块的 buildCharConfig 随后才能读到。
  const charModule = getAgentMechanic(agent.id)
  for (const setting of charModule?.settings ?? []) {
    const record = cfg as unknown as Record<string, unknown>
    record[`setting:${setting.id}`] = configStore.getMechanicSetting(setting.id, setting.default)
  }

  charModule?.buildCharConfig?.({
    slot,
    agent,
    skills: skills as AgentSkills,
    cinemaLevel: char.cinemaLevel ?? 0,
    potentialLevel: char.potentialLevel ?? 6,
    wEngineId: char.wEngineId ?? '',
    wEngineModLevel: char.wEngineModLevel ?? 1,
    team: buildMechanicTeamMembers(configStore, catalogStore),
    panel,
    cfg,
    getRowValue,
  })

  // 通用「单次释放必打招 + 可持续招」强特（src/data/sustainedEx.ts）：
  // 模块已接管强特（skipGenericExSpecial）时不重复施加。
  const sustainedSpec = SUSTAINED_EX_SPECS[agent.id]
  if (sustainedSpec && !cfg.skipGenericExSpecial) {
    cfg.skipGenericExSpecial = true
    const susMove = findMoveById(skills as AgentSkills, sustainedSpec.sustain.moveId)
    const scale = sustainedDamageScale(sustainedSpec, susMove)
    const secs = sustainedSpec.sustain.maxSeconds
    cfg.exSpecialEnergyConsume = sustainedSpec.fixedEnergy + sustainedSpec.sustain.energyPerSecond * secs
    // 自动攻击/能力场段（countsTime:false）行时长记 0：倍率照发、角色不站场。
    const segSeconds = (t: { moveId: string; countsTime?: boolean }) =>
      t.countsTime === false ? 0 : findMoveById(skills as AgentSkills, t.moveId)?.actionTime ?? 0
    const opener = sustainedSpec.opener.map((t) => ({ moveId: t.moveId, actionTime: segSeconds(t) }))
    const finisher = sustainedSpec.finisher.map((t) => ({ moveId: t.moveId, actionTime: segSeconds(t) }))
    // 动作总时间（供 estimateExSpecialTime 时间预算）：起手 + 持续满蓄 + 收尾
    cfg.exSpecialActionTime = opener.reduce((s, o) => s + o.actionTime, 0) + secs + finisher.reduce((s, f) => s + f.actionTime, 0)
    ;(cfg as unknown as Record<string, unknown>).sustainedEx = {
      opener,
      sustain: {
        moveId: sustainedSpec.sustain.moveId,
        actionTime: secs,
        damageMultiplier: getRowValue(susMove, 'damage') * scale,
        dazeMultiplier: getRowValue(susMove, 'daze') * scale,
        anomalyBuildUp: getRowValue(susMove, 'anomaly_buildup') * scale,
      },
      finisher,
    }
  }

  // 额外强特计划（免费/窗口门控的次要强特，2026-09 用户裁决「引擎别太窄」）：
  // 注册表 src/data/exSpecialPlans.ts；模块已接管强特（skipGenericExSpecial）时不叠加。
  // 预存执行行数据（actionTime/喧响），次数由 core buildExecutions 按窗口与主强特次数发行。
  const extraPlans = EXTRA_EX_PLANS[agent.id]
  if (extraPlans && !cfg.skipGenericExSpecial) {
    cfg.extraExPlans = extraPlans.map((e) => {
      const move = findMoveById(skills as AgentSkills, e.moveId)
      return {
        moveId: e.moveId,
        label: e.label,
        count: e.count,
        energyCost: e.energyCost ?? 0,
        actionTime: move?.actionTime ?? 0,
        decibelRecovery: getRowValue(move, 'decibel_recovery'),
        note: e.note,
      }
    })
  }

  return cfg
}

/** 从倍率表提取招式的 daze 和 anomaly_buildup 数据
 *  返回用于失衡池和积蓄池计算的招式执行记录
 */
export function extractSkillExecutions(
  slot: number,
  agentId: string,
  skills: AgentSkills | undefined,
  resourceResult: TeamResourceResult | null,
  catalogStore: ReturnType<typeof useCatalogStore>,
  panel: PanelValues | null,
  configStore: ReturnType<typeof useConfigStore>,
  opts?: { skipGift?: boolean },
): { stunExecs: StunSkillExecution[]; anomalyExecs: AnomalySkillExecution[] } {
  if (!skills || !resourceResult) return { stunExecs: [], anomalyExecs: [] }

  const charResult = resourceResult.characters.find(c => c.slot === slot)
  if (!charResult) return { stunExecs: [], anomalyExecs: [] }

  // 命座技能等级系数（3命+2级，5命+4级）
  const skillLevelBonus = panel?.skillLevelBonus ?? 0
  const dazeCoef = skillLevelBonus > 0 ? getSkillLevelCoef(skillLevelBonus).dazeCoef : 1

  const agent = catalogStore.getAgent(agentId)
  const fallbackElement = agent?.damageElement
  const charCfg = configStore.team[slot]
  const mechanic = getAgentMechanic(agentId)
  const usesModuleTransform = !!mechanic?.transformSkillExecutions
  const replacesSkillExecutionExtraction = mechanic?.replaceSkillExecutionExtraction === true
  const team = buildMechanicTeamMembers(configStore, catalogStore)
  const anomalyUtilizationRate = configStore.getAnomalyUtilizationRate(slot)

  const stunExecs: StunSkillExecution[] = []
  const anomalyExecs: AnomalySkillExecution[] = []

  // 从 resourceResult.executions 获取执行次数
  // 然后从倍率表查找对应的 move，提取 daze 和 anomaly_buildup
  for (const exec of charResult.executions) {
    if (exec.count <= 0 && exec.totalTime <= 0) continue
    // 赠行自 2026-09-10 起由引擎物化 → 会出现在 rr 里；池侧的赠送口径仍单独结算
    // （adjustStunExecs 加 count+promote、连携经 chainCountTotal），故读「装配前 rr」时跳过赠行。
    if (opts?.skipGift && (exec.source === 'gift' || exec.normaGiftChain)) continue

    // 在倍率表中查找对应的 move
    let foundMove: SkillMove | null = null
    let foundElement: string | undefined
    for (const cat of skills.categories) {
      for (const move of cat.moves) {
        if (move.id === exec.moveId) {
          foundMove = move
          foundElement = exec.element ?? move.damageElement ?? fallbackElement
          break
        }
      }
      if (foundMove) break
    }

    // 平A汇总行（moveId = 'basic_attack'）：用基准段（第3段）秒均数据 × 时间
    if (exec.moveId === 'basic_attack' && exec.totalTime > 0) {
      let dazePerSec = 0
      let anomalyPerSec = 0
      let basicElement: string | undefined = fallbackElement
      if (exec.dazeMultiplierOverride || exec.damageMultiplierOverride) {
        // 机制模块已覆盖秒均倍率（如青衣「一煞#4→醉花月云转」循环），保留自定义值
        dazePerSec = exec.dazeMultiplier ?? 0
        anomalyPerSec = exec.anomalyBuildUp ?? 0
      } else {
        const move = getBasicComboMoves(skills, agentId, catalogStore)
        if (move && move.actionTime && move.actionTime > 0) {
          const at = move.actionTime
          basicElement = move.damageElement ?? fallbackElement
          dazePerSec = getRowValue(move, 'daze') / at
          anomalyPerSec = getRowValue(move, 'anomaly_buildup') / at
        }
      }

      if (dazePerSec > 0) {
        stunExecs.push({
          moveId: 'basic_attack',
          moveName: '普通攻击',
          slot,
          count: 1,
          baseDaze: dazePerSec * exec.totalTime * dazeCoef,
          element: basicElement,
          skillType: 'basic',
        })
      }
      if (anomalyPerSec > 0 && basicElement) {
        anomalyExecs.push({
          moveId: 'basic_attack',
          moveName: '普通攻击',
          slot,
          count: 1,
          baseBuildUp: anomalyPerSec * exec.totalTime * anomalyUtilizationRate,
          element: basicElement,
          dmgBonus: exec.dmgBonus,
        })
      }
      continue
    }

    // 仅显式声明接管的模块负责处理全部非普攻倍率行；面板后处理钩子仍保留通用提取。
    if (replacesSkillExecutionExtraction) continue

    // 其他招式（强特、终结技、连携等）
    if (foundMove) {
      const count = exec.count
      // 模块可用 dazeMultiplierOverride 覆盖失衡倍率（如诺姆影画6 破甲弹头失衡值+30%），与 damageMultiplierOverride 同机制
      const tableDaze = fusedRowValue(skills, exec.moveId, 'daze') ?? getRowValue(foundMove, 'daze')
      const daze = exec.dazeMultiplierOverride && (exec.dazeMultiplier ?? 0) > 0
        ? exec.dazeMultiplier!
        : tableDaze
      // 假 id/合成执行支持执行级异常积蓄覆盖（如仪玄符法千重-破 226.7，倍率行被隐藏）
      const anomaly = exec.anomalyBuildUp ?? (fusedRowValue(skills, exec.moveId, 'anomaly_buildup') ?? getRowValue(foundMove, 'anomaly_buildup'))
      const moveName = exec.moveName.replace(/（.*）/g, '').trim()
      const radiantTurnDazeMult = foundMove.id === '1581010'
        ? 1 + ((panel?.remielleRadiantTurnDazeBonusPct ?? 0) / 100)
        : 1

      if (daze > 0 && count > 0) {
        stunExecs.push({
          moveId: exec.moveId,
          moveName,
          slot,
          count,
          baseDaze: daze * dazeCoef * radiantTurnDazeMult,
          element: foundElement,
          skillType: normalizeResourceSkillType(foundMove, exec.moveId),
          stunBuildUpBonus: exec.stunBuildUpBonus,
        })
      }
      if (anomaly > 0 && count > 0 && foundElement) {
        anomalyExecs.push({
          moveId: exec.moveId,
          moveName,
          slot,
          count,
          baseBuildUp: anomaly * anomalyUtilizationRate,
          element: foundElement,
          skillType: normalizeResourceSkillType(foundMove, exec.moveId),
          dmgBonus: exec.dmgBonus,
        })
      }
    }
  }

  if (usesModuleTransform) {
    mechanic!.transformSkillExecutions!({
      slot,
      agent: agent ?? null,
      skills,
      charResult,
      panel,
      cinemaLevel: charCfg?.cinemaLevel ?? 0,
      potentialLevel: charCfg?.potentialLevel ?? 6,
      team,
      dazeCoef,
      stunExecs,
      anomalyExecs,
      getRowValue,
      normalizeResourceSkillType,
    })
  }

  return { stunExecs, anomalyExecs }
}


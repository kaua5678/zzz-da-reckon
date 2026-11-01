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
import { damageElementLabel } from '@/utils/agentLabelMaps'
import { effectivePotentialLevelOf } from '@/data/potentialLevel'
import { writeMechanicSettingCfg } from '@/specs/cfgField'
// CC-245：只在类型位置使用（store 实例由调用方注入）⇒ type-only，resourceCalc/ 运行时不依赖 stores/config、stores/catalog
// （锁：resourceCalcStoreDeps.test；ARCHITECTURE.md §0「管线后半段并入 core」前提）
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { inferSkillDamageTarget, moveSignalDamageTarget } from '@/core/damage'
import { resolveRecoveryPerCount } from '@/core/resource/rowAccounting'
import type { StunSkillExecution } from '@/core/stunPool'
import { findExSpecial, findUltimate, findChainAttack, findDefensiveAssist, findAssistFollowUp, findCounterAssist, findDodgeCounter, calcBasicAttackRegenPerSec } from '@/core/resource/moveLookup'
import { ULTIMATE_COST_DEFAULT } from '@/data/resourceDefaults'
// CC-243：find* 族 / 平A回能的行取值注入（吃逻辑编辑器行规则；core 默认原始读取）
import { fusedRowReader, segmentSwapped, moveActionTimesOf, getRowValue, fusedRowValue, findMoveById } from '@/data/moveTableQueries'
import { teammateSegmentResolver } from '@/data/moveVariants'
import { counterAssistOf } from '@/data/counterAssists'
import { findWEnginePeriodicDirect } from '@/data/wEnginePeriodicDirect'

import type { AnomalySkillExecution } from '@/core/anomalyPool/helpers'
import { getAgentMechanic } from '@/mechanics'
// 蕾米埃尔身份谓词 `isRemielleAgent` 的 import 已随 D 簇（异常面板）迁去 `./anomalyPanels.ts`
// （R22 熵批 2 刀 C）——本文件不再用它；D 簇那边仍只 import 谓词、不 import 整个模块的其它数学
// （规则 6 的语义面）。
import type {
  CharacterOperationConfig,
  TeamResourceResult,
  SkillExecution,
} from '@/types/resource'
import { frontlineRowSeconds } from '@/types/resource'
import type { DamageElement, PanelValues, AgentSkills, SkillMove } from '@/types/catalog'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { SUSTAINED_EX_SPECS, sustainedDamageScale } from '@/data/sustainedEx'
import { EXTRA_EX_PLANS } from '@/data/exSpecialPlans'

import {
  buildMechanicTeamMembers,
  computePanelPhases,
} from './panelPhases'

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
  /** 失衡易伤乘数（轴启用时按轴内位置分配，默认 1；仅 Boss 失衡易伤分量，不含面板加成） */
  stunMult?: number
  /** 直伤行：引擎本行实际用的失衡覆盖率（= damagePool 的 stunForThis，0..1）。CC-226：展示层直接用它，不再由 stunMult 反推 */
  stunCoverage?: number
  /** 直伤行：引擎本行实际用的失衡易伤基数（Boss stunVuln；叶瞬光帷幕行 = veilStunVulnBase）。CC-226 */
  stunVulnBase?: number
  /** 展示用：本行伤害落在失衡窗内的占比（直伤=行级 stunCoverage；异常/异放=建池时的全局或分段覆盖）。不参与结算 */
  stunWindowCoverage?: number
  /** 展示用：本行实际生效的失衡易伤乘数（含面板失衡增伤 + Always 通道；建池后盖章） */
  stunAppliedMult?: number
  /** 展示用：覆盖率 0 时仍生效的 Always 通道乘数（扳机 35% 等常驻易伤） */
  stunAlwaysMult?: number
  /** 单次倍率（%，直伤=招式倍率、异放=releaseMultiplier、紊乱=disorderMultiplier、
   *  DoT=perTick×tick数 等；秒均行 count 已折算成总秒数 → count×multiplier = 该行总倍率）。
   *  供「伤害来源分解」诊断：总倍率 = Σ(count×multiplier)，属性区 = 总伤害/(总倍率/100)。 */
  multiplier?: number
  /**
   * **本行实际吃到的乘区链**（结果页·伤害池「说明」列第二行；2026-10-31）：
   * 由引擎 `calcDirectDamage / calcAnomalyDamage` 的 breakdown 经 `utils/damageFormulaText` 拼成，
   * 按**单次**口径、与引擎乘区顺序一致。缺省 = 该行不是引擎标准管线产出（模块自建行 / 旧数据）。
   * ⚠ 展示字段，不参与结算；不得由展示层重算（规则 11）。
   */
  formula?: string
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
  /** 有倍率行的**反事实（无失衡）**伤害合计（attrRegionNoStun 的分子） */
  multiplierDamageNoStun: number
  /**
   * **无失衡属性区**：把 Boss 失衡系统整条抹掉（每行的失衡窗倍率还原成 1）后，同一批倍率的属性区。
   * ⚠ 只抹「失衡窗内才有的那部分」——Always 常驻易伤（扳机 1361 的 35%/55%）**保留**，
   * 因为它在非失衡期也在生效，抹掉等于篡改该角色的拐力（用户口径 2026-10-28）。
   */
  attrRegionNoStun: number
  /** **失衡期贡献率** = 1 − attrRegionNoStun / attrRegion（0..1；0 = 该族与 Boss 失衡系统无关） */
  stunContributionRate: number
  /**
   * **失衡爆发效率** = Σ(行伤害 × 行窗内占比) / Σ行伤害（0..1）。
   * 回答「这个角色的伤害有多大比例是在失衡窗里打出来的」——捏轴越集中、越贴窗，数越大。
   */
  burstEfficiency: number
  /** 失衡窗内的伤害合计（burstEfficiency 的分子，展示用） */
  windowDamage: number
  /** 反事实（无失衡）伤害合计（展示用；= Σ 行伤害 × Always/实生效） */
  damageNoStun: number
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
  const emptyFamily = (): DamageSourceFamily => ({
    damage: 0, multiplier: 0, attrRegion: 0, flatDamage: 0, multiplierRows: 0, multiplierDamage: 0, multiplierDamageNoStun: 0,
    attrRegionNoStun: 0, stunContributionRate: 0, burstEfficiency: 0, windowDamage: 0, damageNoStun: 0,
  })
  /**
   * 反事实（无失衡）行伤害 = 行伤害 × alwaysMult / appliedMult。
   * 两个乘数都由建池侧盖章（`core/stunVulnRow` 同一套算式）；行没带 `stunAppliedMult`
   * （测试夹具 / 旧数据）⇒ 视为「与失衡无关」，反事实 = 原值。
   */
  const noStunDamageOf = (row: DamagePoolRow): number => {
    const applied = row.stunAppliedMult
    const always = row.stunAlwaysMult
    if (applied === undefined || always === undefined || applied <= 0) return row.totalDamage
    // 比值 ≤ 1 恒成立（applied 是 always 按覆盖率线性插值到满额的结果）；钳一下只为防浮点噪声
    return row.totalDamage * Math.min(1, always / applied)
  }
  const add = (fam: DamageSourceFamily, row: DamagePoolRow) => {
    const noStunDmg = noStunDamageOf(row)
    fam.damage += row.totalDamage
    fam.damageNoStun += noStunDmg
    const cov = row.stunWindowCoverage ?? row.stunCoverage
    if (cov !== undefined && cov > 0) fam.windowDamage += row.totalDamage * Math.max(0, Math.min(1, cov))
    // 反事实口径的属性区分子：同样只计「有倍率行」，倍率是行属性、不随易伤变
    if (row.multiplier && row.multiplier > 0 && row.count > 0) {
      fam.multiplier += row.count * row.multiplier
      fam.multiplierRows += 1
      fam.multiplierDamage += row.totalDamage
      fam.multiplierDamageNoStun += noStunDmg
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
    fam.attrRegionNoStun = fam.multiplier > 0 ? fam.multiplierDamageNoStun / (fam.multiplier / 100) : 0
    fam.stunContributionRate = fam.attrRegion > 0
      ? Math.max(0, Math.min(1, 1 - fam.attrRegionNoStun / fam.attrRegion))
      : 0
    fam.burstEfficiency = fam.damage > 0 ? fam.windowDamage / fam.damage : 0
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

/**
 * 队伍级合计（用户口径 2026-10-28：「显示属性区总和和倍率区总和的地方」要能看出 Boss 失衡系统的
 * 影响大小与各角色的失衡爆发效率）。倍率与属性区都按**伤害族**合并后再算，不做「两个属性区相加」——
 * 属性区的分母是倍率，直接相加两族的值没有意义（族间倍率不同）。
 */
export interface DamageSourceTotals {
  /** 总倍率 Σ(count × multiplier)（%） */
  multiplier: number
  /** 有失衡属性区 = Σ(有倍率行伤害) / (总倍率/100) */
  attrRegion: number
  /** 无失衡属性区（只抹 Boss 失衡窗，Always 常驻易伤保留） */
  attrRegionNoStun: number
  /** 失衡期贡献率 = 1 − attrRegionNoStun / attrRegion */
  stunContributionRate: number
  /** 失衡爆发效率 = 窗内伤害 / 总伤害 */
  burstEfficiency: number
  /** 全队伤害合计（含无倍率行） */
  damage: number
  /** 全队无失衡反事实伤害合计 */
  damageNoStun: number
  /** 窗内伤害合计 */
  windowDamage: number
  /** 无倍率行伤害合计 */
  flatDamage: number
}

export function computeDamageSourceTotals(breakdown: DamageSourceBreakdown[]): DamageSourceTotals {
  let multiplierDamage = 0
  let multiplierDamageNoStun = 0
  let multiplier = 0
  let damage = 0
  let damageNoStun = 0
  let windowDamage = 0
  let flatDamage = 0
  for (const b of breakdown) {
    for (const fam of [b.direct, b.anomaly]) {
      multiplier += fam.multiplier
      multiplierDamage += fam.multiplierDamage
      multiplierDamageNoStun += fam.multiplierDamageNoStun
      damage += fam.damage
      damageNoStun += fam.damageNoStun
      windowDamage += fam.windowDamage
      flatDamage += fam.flatDamage
    }
  }
  const attrRegion = multiplier > 0 ? multiplierDamage / (multiplier / 100) : 0
  const attrRegionNoStun = multiplier > 0 ? multiplierDamageNoStun / (multiplier / 100) : 0
  return {
    multiplier,
    attrRegion,
    attrRegionNoStun,
    stunContributionRate: attrRegion > 0 ? Math.max(0, Math.min(1, 1 - attrRegionNoStun / attrRegion)) : 0,
    burstEfficiency: damage > 0 ? windowDamage / damage : 0,
    damage,
    damageNoStun,
    windowDamage,
    flatDamage,
  }
}

export function safeElement(element?: string): DamageElement {
  return (element || 'physical') as DamageElement
}


// 伤害元素中文名单一来源：`@/utils/agentLabelMaps#damageElementLabel`（CC-214）。保留 elementLabel 名字，现有消费者不改。
export const elementLabel = damageElementLabel

// `isPctStat` 的第三份副本已于 2026-09-18 round 27 删除（规则 11 单一事实源）：
// 它是 `utils/statMeta.ts#isPctStat` 的**逐字漂移副本**（缺 `Reduction`/`Ignore` 两个后缀、
// 且不剥 `__` 限定段），且当时**全仓零引用**（唯一读者 `panelPhases.ts` 要的是**结算**口径，
// 已改读 `statSettlementMode`）。留着它就是下一颗「改一处忘一处」的地雷。
// 展示口径用 `@/utils/statMeta#isPctStat`；结算口径用 `@/utils/statMeta#statSettlementMode`。

import {
  getHealingAmount,
  getSpecialResourceRecovery,
  getBasicComboMoves,
  averageBasicRows,
} from './skillRows'

/**
 * 展示口径归一（2026-09-08 用户实测「诺姆入队后主C时间 = 180s + 诺姆连携秒数」后收口）：
 * 资源卡的「时间分配」按**最终执行行**计算——前台 = Σ前台行 `totalTime`（含装配后追加的赠送行：
 * 诺姆赠链 `chainGift` / 琉音赠大 `source==='gift'`），后台 = 战斗时间 − 前台。
 *
 * 为什么必须在这里统一：赠送行由 `applyChainGift` / `applyUltimatePromote` 在引擎返回**之后**追加，
 * 引擎的 `timeAllocation` 看不到它们；而赠送时间的**预留**分散在 iterate 必要时间 / 折叠环行测量 /
 * 截断上限三处，各自口径略不同（轴模式琉音赠大走的是 post-hoc carve、预留为 0）——于是展示层
 * 若也各自回扣就会再次漂移（实测轴模式资源卡总计 = 180 + 赠送秒数）。此处以**最终行**为唯一口径重算，
 * 新增赠送机制无需再改展示逻辑。
 */
export function normalizeDisplayTime(rr: TeamResourceResult): TeamResourceResult {
  return {
    ...rr,
    characters: rr.characters.map(c => {
      const front = frontlineRowSeconds(c.executions)
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
  const teamAgentIds = result.characters.map(c => c.agentId)
  return {
    ...result,
    characters: result.characters.map(char => {
      const skills = catalogStore.agentSkillsByAgentMap.get(char.agentId)
      // CC-405：队友在队招式变体（`data/moveVariants.ts`）——本处是唯一有全队上下文的倍率回填点。
      // 替换只作用于倍率行（damage/daze/anomaly/energy/decibel），actionCode/moveName/actionTime 仍是原段。
      const segmentOf = teammateSegmentResolver(char.agentId, teamAgentIds)
      // 模块声明的伤害定向覆盖（`AgentMechanicModule.skillDamageTargetOverrides`，唯一入口）：
      // 推断值之后应用，赠行也应用（赠的是本角色自己的招，定向口径随招走）。
      const targetOverrides = getAgentMechanic(char.agentId)?.skillDamageTargetOverrides
      const executions = char.executions.map(exec => {
        const targetOverride = targetOverrides?.[exec.moveId]
        // 赠行由引擎物化、倍率由编排层在 enrich 之后补：enrich 必须跳过，否则会补上生产侧
        // 刻意留空的字段（实测：琉音赠行凭空多 daze、诺姆赠行凭空多 skillDamageTarget）。
        if (exec.source === 'gift' || exec.chainGift) {
          return targetOverride ? { ...exec, skillDamageTarget: targetOverride } : exec
        }
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
            const foundCategory = skills?.categories.find(cat => cat.moves.some(m => String(m.id) === String(exec.moveId)))
            const skillDamageTarget = foundCategory ? inferSkillDamageTarget(foundCategory, move) : undefined
            const variantMove = segmentOf ? (findMoveById(skills, segmentOf(exec.moveId)) ?? move) : move
            const coopSwapped = !!segmentOf && segmentSwapped(exec.moveId, segmentOf)
            const fusedOf = (rowId: string) => fusedRowValue(skills, exec.moveId, rowId, segmentOf) ?? getRowValue(variantMove, rowId)
            const specialResourceRecovery = getSpecialResourceRecovery(move)
            const healingAmount = getHealingAmount(move)
            // exec.anomalyBuildUp 显式为 0 = 模块显式禁用异常积蓄（如莱卡恩围猎后台招式"仅伤害+失衡值"）；
            // anomalyBuildUpOverride = 模块显式给定缩放后积蓄（持续段按时长等比），跳过回填。
            const bu = exec.anomalyBuildUpOverride
              ? (exec.anomalyBuildUp ?? 0)
              : exec.anomalyBuildUp === 0
                ? 0
                : fusedOf('anomaly_buildup')
            // 同上：decibel/energy 显式 0 = 模块显式禁用回填（围猎后台闪反无喧响/能量）；
            // 未提供（undefined）= 交倍率表回填——能量与喧响同构三态（2026-09-09 能量债务审计）。
            // decibelRecoveryOverride = 模块显式给定口径换算后的行值（如洛克茜自旋：表值为每秒，
            // 行值 = 每秒 × spinSeconds），跳过表值覆盖——与 damage/anomaly override 同构。
            // 登记融合组的主段行：喧响/能量取「一次动作」的整段和（与 damage/daze/anomaly 同一函数
            // 同一口径）；只回头段会把雅一次连携的 230.15 记成 69.05（坑 31）。
            // 三态解析与记账层 rowDecibelTotal / rowEnergyTotal 同一函数（CC-466）——记账层 == 展示层由结构保证。
            const decibelValue = resolveRecoveryPerCount(exec.decibelRecovery, exec.decibelRecoveryOverride, fusedOf('decibel_recovery'))
            // 同 `energyRecoveryByMoveId` 构造处：命破角色的招式回能长在 `flash_energy_recovery` 上，
            // 只读 energy_recovery 会让执行行显示 0（记账层 == 展示层由同一判据保证）。
            const energyValue = resolveRecoveryPerCount(exec.energyRecovery, undefined, fusedOf('flash_energy_recovery') || fusedOf('energy_recovery'))
            patch = {
              actionCode: move.id,
              moveName: move.name.zhCN || move.name.en || exec.moveName,
              damageMultiplier: exec.damageMultiplierOverride
                ? exec.damageMultiplier
                : fusedOf('damage'),
              dazeMultiplier: exec.dazeMultiplierOverride
                ? exec.dazeMultiplier
                : fusedOf('daze'),
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
              skillTableNote: coopSwapped
                ? '已从倍率表 rows 回填（队友在队协同段替换，CC-405）damage/daze/energy_recovery/decibel_recovery/anomaly_buildup。'
                : '已从倍率表 rows 回填 damage/daze/energy_recovery/decibel_recovery/anomaly_buildup。',
            }
          } else {
            patch = {
              skillTableResolved: false,
              skillTableNote: '未在倍率表中找到对应 moveId；可能是资源池合成行或待补数据。',
            }
          }
        }
        if (targetOverride && exec.moveId !== 'basic_attack') patch.skillDamageTarget = targetOverride
        return { ...exec, ...patch }
      })
      return { ...char, executions }
    }),
  }
}

/** 从技能数据提取资源池所需的招式信息，构建单个角色的操作配置 */


export function normalizeResourceSkillType(move: SkillMove | null, execMoveId: string): string {
  if (execMoveId === 'basic_attack') return 'basic'
  // 优先按招式自身信号分类（与伤害路径 inferSkillDamageTarget 同一段代码 `moveSignalDamageTarget`，CC-500——@fact 招式类型/两路径同源 |
  // 据 用户 2026-09-05「字段对应，招式限定要注意」 | 验 discSetEffects.test.ts | 锚 helpers.ts#normalizeResourceSkillType | 信 高）：
  const bySignal = moveSignalDamageTarget(move)
  if (bySignal) return bySignal
  const raw = move?.skillType ?? ''
  if (raw === 'dodge') return 'dodgeCounter'
  if (raw === 'special') return move?.energyCost ? 'exSpecial' : 'special'
  if (raw === 'basic' || raw === 'ultimate' || raw === 'chain' || raw === 'assist'
    || raw === 'dashAttack' || raw === 'additionalAttack') return raw
  return 'all'
}

export function buildCharConfig(
  slot: number,
  configStore: ConfigModel,
  catalogStore: ReturnType<typeof useCatalogStore>,
): CharacterOperationConfig | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null

  const agent = catalogStore.agentsMap.get(char.agentId)
  const skills = catalogStore.agentSkillsByAgentMap.get(char.agentId)
  if (!agent || !skills) return null

  // 同一次 computePanelPhases 同时取局内（= 原 computePanel）与局外面板；局外面板只读转给模块（CC-123：「初始」类展示值）
  const panelPhases = computePanelPhases(slot, configStore, catalogStore)
  const panel = panelPhases?.inCombat ?? null
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
  const exSpecial = findExSpecial(skills, fusedRowReader)
  const ultimate = findUltimate(skills, fusedRowReader)
  const chainAttack = findChainAttack(skills, fusedRowReader)
  const defensiveAssist = findDefensiveAssist(skills, fusedRowReader)
  const assistFollowUp = findAssistFollowUp(skills, fusedRowReader)
  // 反制支援（Counter Assist）：按登记表取行（克拉蕾 = 1611028 寸铁不让 + 1611030 琢形，
  // 融合成「一次动作」），有登记 ≠ 一定发动——次数由 boss 控制技组与替换开关决定。
  const counterAssistDecl = counterAssistOf(char.agentId)
  const counterAssist = counterAssistDecl ? findCounterAssist(skills, counterAssistDecl.moveId, fusedRowReader) : null
  const counterAssistCount = counterAssist && configStore.counterAssistSlot === slot
    ? (configStore.appliedBoss?.counterAssistGroups?.length ?? 0)
    : 0
  const dodgeCounter = findDodgeCounter(skills, fusedRowReader)
  // CC-320：基准段只解析一次，平A伤害基准与秒均回复兜底共用（无 #N 段的角色回复按基准段算）
  const basicBenchmarkMoveId = getBasicComboMoves(skills, char.agentId, catalogStore)?.id
  const basicRegen = calcBasicAttackRegenPerSec(skills, fusedRowReader, { fallbackMoveId: basicBenchmarkMoveId })

  // 倍率表 decibel_recovery / energy_recovery 全量预存（喧响+能量收入行级化 Σ 切换的前置）：
  // 核心层 calcRawDecibelParts / calcEnergySource 无 catalog 访问权，按此表复刻 enrichExecutionPlan
  // 回填语义（getRowValue 含行级融合乘子，与展示层同一函数同一时刻取值，杜绝记账/展示两套表值）。
  const decibelRecoveryByMoveId: Record<string, number> = {}
  const energyRecoveryByMoveId: Record<string, number> = {}
  for (const cat of skills.categories) {
    for (const m of cat.moves) {
      // 登记融合组的主段：喧响取「一次动作」的整段和（一次连携把各段的 fever_recovery 全打了，
      // 只回头段会把雅 230.15 记成 69.05）。兄弟段不单独成行（moveFusions 入表前提），无六计风险。
      decibelRecoveryByMoveId[String(m.id)]
        = fusedRowValue(skills, String(m.id), 'decibel_recovery') ?? getRowValue(m, 'decibel_recovery')
      // @fact engine:energy/闪能招式回复 口径: 招式回能按**行存在性**取——同一 moveId 有 `flash_energy_recovery` 行就用它、否则用 `energy_recovery`（全库互斥：0 例同时有两行）；**判据不是角色**（`cfg.isFlashUser` 是 `flashEnergyRegen>0` 的代理量，真斗 1441 命破但该值为 0 ⇒ 会整只漏掉） | 据 实测@2026-10-11 | 验 flashEnergyRecoveryChannel.test.ts | 锚 src/composables/resourceCalc/helpers.ts#energyRecoveryByMoveId + src/core/resource/moveLookup.ts#calcBasicAttackRegenPerSec | 信 确认
      // ⟳复核: catalog 是否新出现「同一 moveId 同时有 flash 与 energy 两行」或第 6 个 flash 角色（互斥前提破了就要改取法，不是改 `||` 顺序）| 到期 2027-04-11
      // 回能通道**互斥且按行存在性取**（2026-10-11 修：此前只读 energy_recovery ⇒ 命破 61 条 flash 行全静默归零）。
      // catalog 全库实测：同一 moveId 绝不同时有两行（0 例），命破 5 人（1051/1371/1441/1471/1531）只有
      // `flash_energy_recovery`、其余 56 人只有 `energy_recovery` ⇒ 「有 flash 行就用 flash，否则用 energy」是数据驱动判据。
      // ⚠ 判据**不是** `cfg.isFlashUser`：那是 `flashEnergyRegen > 0` 的代理量，真斗 1441 是命破（flashEnergyMax=120、
      // 17 条 flash 行）但 flashEnergyRegen=0 ⇒ 代理量会整只漏掉它。与 `core/resource/moveLookup.ts` 平A通道同款口径
      // （那里也是逐行取、不判角色）。`||` 而非 `??`：两侧都是 number（fusedRowValue 未登记组 → getRowValue 兜底），
      // flash 行缺失/为 0 时落回 energy 行是正确语义（互斥保证不会双计）。
      energyRecoveryByMoveId[String(m.id)]
        = (fusedRowValue(skills, String(m.id), 'flash_energy_recovery') ?? getRowValue(m, 'flash_energy_recovery'))
        || (fusedRowValue(skills, String(m.id), 'energy_recovery') ?? getRowValue(m, 'energy_recovery'))
    }
  }

  // 合轴率覆盖：优先使用用户在结果页设置的值，否则用倍率表默认值
  const ov = (moveId: string, defaultRatio: number) =>
    configStore.getComboAlignOverride(slot, moveId, defaultRatio)

  // 音擎周期直伤事件（现仅加农转子）：数据表 src/data/wEnginePeriodicDirect.ts 按 id / legacyIds 查（CC-82）。
  const wEngine = char.wEngineId ? catalogStore.wEnginesMap.get(char.wEngineId) : null
  const wEngineMatchesSpecialty = !!wEngine && wEngine.specialty === agent.specialty
  const periodicDirect = findWEnginePeriodicDirect(wEngine)
  const hasCannonRotorEvent = !!periodicDirect && (!periodicDirect.requiresSpecialtyMatch || wEngineMatchesSpecialty)
  const cannonRotorModIndex = Math.max(0, Math.min(4, char.wEngineModLevel - 1))

  // 开局赠送能量：普通角色40点
  const initialEnergyGift = 40

  // CC-386：键随角色（store 内唯一键构造点 ownerKeyOf），引擎不自己拼键
  const resourceUtilization = configStore.resourceUtilizationOf(slot)

  const cfg: CharacterOperationConfig = {
    slot,
    agentId: char.agentId,
    isFlashUser: isFlash,
    panel,
    outOfCombatPanel: panelPhases?.outOfCombat,
    basicAttackRegenPerSec: basicRegen.energyPerSec,
    basicAttackDecibelPerSec: basicRegen.decibelPerSec,
    basicBenchmarkMoveId,
    // 蕾米埃尔 cfg 字段（垂虹 4 项 / Radiant Turn 3 项 / `remielleEnabled` / `remielleRadiantTurnDazeBonusPct`）
    // 全部由下方 `charModule?.buildCharConfig?.()`（= `remielle.ts#buildRemielleCharConfig`）写入
    // （CC-34b 2026-09-27 迁走垂虹 / Radiant Turn 7 项与两个招式查找函数；前序 2026-09-17 round 21 夜间批 C）。
    exSpecialMoveId: exSpecial?.moveId ?? '',
    exSpecialEnergyConsume: exSpecial?.energyConsume ?? 0,
    exSpecialCostType: exSpecial?.costType ?? (exSpecial?.energyConsume ? 'energy' : 'free'),
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
    // CC-264：字段恒为 number（setAgent 预填 ASSIST_ACTION_BASELINE）；旧兜底「支援 0 / 其余 1」从未生效且与部署口径冲突，删去
    chainCountPerStun: char.chainCountPerStun,
    parryCount: char.parryCount,
    // 这两项不是用户输入：store 的 CharacterConfig 没有这两个字段，本轮值由 convergence 的弹刀拆分写进 merged cfg。
    // r728 前写成 `(char as { … }).x ?? 0`，读的是 store 上不存在的字段，恒为 0。
    parryNoFollowUpCount: 0,
    parryDecibelOnlyCount: 0,
    perfectBlockCount: char.perfectBlockCount ?? 0,
    assaultOrderCount: char.assaultOrderCount ?? 0,
    dodgeCounterCount: char.dodgeCounterCount,
    blockCount: char.blockCount,
    dualCounterCount: char.dualCounterCount ?? 0,
    tauntCancelCount: char.tauntCancelCount ?? 0,
    autoEvadeCount: char.autoEvadeCount ?? 0,
    // 仪玄 5 项 / 普罗米娅 1 项交互栏次数：CC-35b（2026-09-27）改由各自模块 buildCharConfig 从 `char` 读入
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
    cannonRotorDamageMultiplier: hasCannonRotorEvent ? periodicDirect!.damageMultiplier : 0,
    cannonRotorCooldownSeconds: hasCannonRotorEvent ? periodicDirect!.cooldownByModLevel[cannonRotorModIndex] : 0,
    moveActionTimes: moveActionTimesOf(skills), // CC-409
    initialEnergyGift,
    initialDecibelGift: 1000 + (configStore.appliedBoss?.decibelGift?.slot === slot ? configStore.appliedBoss.decibelGift.amount : 0),
    battleTime: configStore.enemy.battleTime,
    invincibleTime: configStore.enemy.invincibleTime,
    bodySize: configStore.enemy.bodySize,
    // 跨角色 `+=` 累加通道：蕾米埃尔花羽轮舞项由 remielle.ts#buildRemielleCharConfig 累加（CC-34c 2026-09-27）
    extraSelfDecibelReward: 0,
    decibelShareRatio: 0.5,
    supportUltimateEnergyRegen: 0,
    timeWeight: char.basicAttackTimeWeight, // 平A时间分配权重（store 必填；setAgent 按 defaultBasicAttackTimeWeight 预填）
    resourceUtilization,
  }

  // 先把机制模块声明的可调设置写入 cfg，模块的 buildCharConfig 随后才能读到。
  const charModule = getAgentMechanic(agent.id)
  for (const setting of charModule?.settings ?? []) {
    writeMechanicSettingCfg(cfg, setting.id, configStore.getMechanicSetting(setting.id, setting.default))
  }

  charModule?.buildCharConfig?.({
    slot,
    agent,
    skills,
    cinemaLevel: char.cinemaLevel,
    potentialLevel: effectivePotentialLevelOf(char.potentialLevel, char.potentialEnabled),
    wEngineId: char.wEngineId,
    wEngineModLevel: char.wEngineModLevel,
    team: buildMechanicTeamMembers(configStore, catalogStore),
    panel,
    outOfCombatPanel: panelPhases?.outOfCombat,
    cfg,
    getRowValue,
    char,
  })

  // 通用「单次释放必打招 + 可持续招」强特（src/data/sustainedEx.ts）：
  // 模块已接管强特（skipGenericExSpecial）时不重复施加。
  const sustainedSpec = SUSTAINED_EX_SPECS[agent.id]
  if (sustainedSpec && !cfg.skipGenericExSpecial) {
    cfg.skipGenericExSpecial = true
    cfg.exSpecialCountFractional = true // 持续段按满蓄秒数计耗能 ⇒ 次数取期望值（CC-324 前由 skip 隐式给出）
    const susMove = findMoveById(skills, sustainedSpec.sustain.moveId)
    const scale = sustainedDamageScale(sustainedSpec, susMove)
    const secs = sustainedSpec.sustain.maxSeconds
    cfg.exSpecialEnergyConsume = sustainedSpec.fixedEnergy + sustainedSpec.sustain.energyPerSecond * secs
    // 自动攻击/能力场段（countsTime:false）行时长记 0：倍率照发、角色不站场。
    const segSeconds = (t: { moveId: string; countsTime?: boolean }) =>
      t.countsTime === false ? 0 : findMoveById(skills, t.moveId)?.actionTime ?? 0
    const opener = sustainedSpec.opener.map((t) => ({ moveId: t.moveId, actionTime: segSeconds(t) }))
    const finisher = sustainedSpec.finisher.map((t) => ({ moveId: t.moveId, actionTime: segSeconds(t) }))
    // 动作总时间（供 estimateExSpecialTime 时间预算）：起手 + 持续满蓄 + 收尾
    cfg.exSpecialActionTime = opener.reduce((s, o) => s + o.actionTime, 0) + secs + finisher.reduce((s, f) => s + f.actionTime, 0)
    cfg.sustainedEx = {
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
      const move = findMoveById(skills, e.moveId)
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
  configStore: ConfigModel,
  opts?: { skipGift?: boolean },
): { stunExecs: StunSkillExecution[]; anomalyExecs: AnomalySkillExecution[] } {
  if (!skills || !resourceResult) return { stunExecs: [], anomalyExecs: [] }

  const charResult = resourceResult.characters.find(c => c.slot === slot)
  if (!charResult) return { stunExecs: [], anomalyExecs: [] }

  // 命座技能等级系数（3命+2级，5命+4级）
  const skillLevelBonus = panel?.skillLevelBonus ?? 0
  const dazeCoef = skillLevelBonus > 0 ? getSkillLevelCoef(skillLevelBonus).dazeCoef : 1

  const agent = catalogStore.agentsMap.get(agentId)
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
    if (opts?.skipGift && (exec.source === 'gift' || exec.chainGift)) continue

    // 在倍率表中查找对应的 move
    const foundMove = findMoveById(skills, exec.moveId)
    const foundElement = foundMove ? (exec.element ?? foundMove.damageElement ?? fallbackElement) : undefined

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
      const fusedOf = (rowId: string) => fusedRowValue(skills, exec.moveId, rowId) ?? getRowValue(foundMove, rowId)
      // 模块可用 dazeMultiplierOverride 覆盖失衡倍率（如诺姆影画6 破甲弹头失衡值+30%），与 damageMultiplierOverride 同机制
      const tableDaze = fusedOf('daze')
      const daze = exec.dazeMultiplierOverride && (exec.dazeMultiplier ?? 0) > 0
        ? exec.dazeMultiplier!
        : tableDaze
      // 假 id/合成执行支持执行级异常积蓄覆盖（如仪玄符法千重-破 226.7，倍率行被隐藏）
      const anomaly = exec.anomalyBuildUp ?? fusedOf('anomaly_buildup')
      const moveName = exec.moveName.replace(/（.*）/g, '').trim()
      // 模块能力 `skillDazeMultiplier`：招式级失衡独立乘区，缺省 1（CC-34c② 2026-09-27，原蕾米埃尔 Radiant Turn 内联分支）
      const skillDazeMult = mechanic?.skillDazeMultiplier?.({ moveId: foundMove.id, panel }) ?? 1

      if (daze > 0 && count > 0) {
        stunExecs.push({
          moveId: exec.moveId,
          moveName,
          slot,
          count,
          baseDaze: daze * dazeCoef * skillDazeMult,
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
      potentialLevel: effectivePotentialLevelOf(charCfg?.potentialLevel, charCfg?.potentialEnabled),
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

/**
 * CC-39b（2026-09-27，设计稿 `docs/mcp-cc39b-stun-window-end.md`）：轴块「是否结束失衡窗口」
 * 按**本槽角色**派发模块能力 `endsStunWindow`。convergence 的决算截断与 roundInputs 的
 * `endsStunWindow` 标记**必须同源**，一律经此函数；空槽 / 无此能力 ⇒ false。
 */
export function axisMoveEndsStunWindow(agentId: string | undefined, moveId: string, cinemaLevel: number): boolean {
  return !!(agentId && getAgentMechanic(agentId)?.endsStunWindow?.(moveId, cinemaLevel))
}

/**
 * **决算块施放时的窗口延长秒数**（佩洛伊斯·永陷幽囚 3s，2026-10-20）：按本槽角色派发模块能力
 * `stunWindowExtendOnEnd`。无该能力 / 返回 ≤ 0 ⇒ 0（不延长，其余角色逐位不变）。
 *
 * 与 `axisMoveEndsStunWindow` 的分工：那个回答「这一招结束窗口吗」，本函数回答
 * 「结束时把窗口放宽多少秒让这一招打得完」。佩洛伊斯两者都有。
 */
export function axisMoveExtendOnEndOf(agentId: string | undefined, moveId: string, cinemaLevel: number): number {
  const fn = agentId ? getAgentMechanic(agentId)?.stunWindowExtendOnEnd : undefined
  const v = fn ? fn(moveId, cinemaLevel) : 0
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** CC-39b：轴块动作时长兜底，按本槽角色派发模块能力 `axisMoveActionTime`；无此能力 ⇒ 原值。 */
export function axisMoveActionTimeOf(agentId: string | undefined, moveId: string, actionTime: number): number {
  const fn = agentId ? getAgentMechanic(agentId)?.axisMoveActionTime : undefined
  return fn ? fn(moveId, actionTime) : actionTime
}

/**
 * **本招的「伤害段」时长**（秒）：按本槽角色派发模块能力 `axisMoveDamageSeconds`（口径与用户原文
 * 见 `mechanics/types.ts` 该钩子）。返回 `undefined` = 不声明（分母回落动作全长）。
 *
 * 两个消费方**必须同源**（本仓反复踩的「同一物理量两把尺」）：
 * · 轴栈 `core/stunAxisStack.ts`（真正算伤害的那份，roundInputs 建块时填 `damageSeconds`）；
 * · 展示侧 `core/stunAxis.ts#calcStunAxis`（失衡轴页的 `perActionDamageSeconds`）。
 * 合法区间 = `(0, actionTime)`：≤0 或 ≥动作全长 ⇒ 视作未声明（返回 undefined），避免
 * 「声明 0 秒 ⇒ 除零」与「声明 ≥ 全长 ⇒ 假装声明了其实没变」两种退化。
 */
export function axisMoveDamageSecondsOf(agentId: string | undefined, moveId: string, actionTime: number): number | undefined {
  const fn = agentId ? getAgentMechanic(agentId)?.axisMoveDamageSeconds : undefined
  const v = fn ? fn(moveId, actionTime) : undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined
  return v < actionTime ? v : undefined
}

/**
 * T171：**本角色的轴块是否不扣喧响**（按本槽角色派发模块能力 `axisMoveFreeOfDecibel`）。
 * 无此能力 / 空槽 ⇒ false（= 照旧按 `chainMoveKind === 'ultimate'` 收费）。
 *
 * 用户口径 2026-10-15：「很多角色都有多个大招，虽然有大招标签，但其实**不是喧响大**……
 * **术法大自己消耗术法值，不消耗喧响**。还有什么**叶瞬光斩妄开天是收尾，不消耗喧响**。」
 * ⇒ 名字带 `Ultimate:` ≠ 由喧响购买，收费判据必须能按角色覆盖。
 */
export function axisMoveFreeOfDecibelOf(agentId: string | undefined, moveId: string): boolean {
  return !!(agentId && getAgentMechanic(agentId)?.axisMoveFreeOfDecibel?.(moveId))
}

/**
 * 轴块的**专属资源流向**（2026-10-31）：按本槽角色派发模块能力 `axisSwayFlow`。
 * 消费方 = `roundInputs#buildStackAxes`（非连段块填 `swayCost` / `producesSway`）。
 * 未声明 / 空槽 / 非有限数 ⇒ `undefined`（不参与专属资源账，逐位不变）。
 */
export function axisSwayFlowOf(
  agentId: string | undefined,
  moveId: string,
): { cost?: number; produce?: number } | undefined {
  const flow = agentId ? getAgentMechanic(agentId)?.axisSwayFlow?.(moveId) : undefined
  if (!flow) return undefined
  const cost = Number.isFinite(flow.cost) && (flow.cost ?? 0) > 0 ? flow.cost : undefined
  const produce = Number.isFinite(flow.produce) && (flow.produce ?? 0) > 0 ? flow.produce : undefined
  if (cost === undefined && produce === undefined) return undefined
  return { ...(cost !== undefined ? { cost } : {}), ...(produce !== undefined ? { produce } : {}) }
}

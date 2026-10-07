import type {
  AgentAnomalyTransformInput,
  AgentCharConfigInput,
  AgentDamageResolutionInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
  ReadonlyTeam,
  ReleaseModifierInput,
} from '../types'
import type { PanelValues } from '@/types/catalog'
import type {
  CharacterOperationConfig,
  IterationState,
  SpecialResourceSection,
  CorrosionSource,
  AnomalyEventRecord,
} from '@/types/resource'
import { emptyPanel } from '@/core/panel'
import { CORROSION_CYCLONE_RELEASE_ID_PREFIX } from '@/core/anomalyPool/helpers'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { specAdditionalAbilityActive } from '@/mechanics/additionalAbilityGates'
import { buildSpecAnomalyEvents } from '@/specs/mechanics'
import { computeSpecResources } from '@/specs/resources'
import { applyAgentAttributeConversions } from '@/specs/runtime'
import { simulateCounterStateMachine } from '@/specs/stateMachine'
import { findMoveById } from '@/data/moveTableQueries'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { mechanicSettingPanelReader } from '@/utils/mechanicSettingCfg'

const settingOf = mechanicSettingPanelReader(() => velinaMechanic.settings)
const VELINA_AGENT_ID = '1561'
/**
 * CC-273：招式按 catalog moveId 认（主键），不再按英文名。修前 3 处 `findMoveByEnglishName` + 2 处 `name.en ===`，
 * 而同文件 resultCardCorrosion 早已按 id 写 1561007——同一招式两种认法；名字又会被 enrich / 数据更新改写（已知坑）。
 */
const VELINA_EYE_MOVE_ID = '1561006' // EX Special Attack: Wind Shear - Eye of the Storm
const VELINA_SWEEPING_CYCLONE_1_MOVE_ID = '1561007' // Sweeping Cyclone #1（广域气旋）
const VELINA_SWEEPING_CYCLONE_2_MOVE_ID = '1561020' // Sweeping Cyclone #2

function velinaColorElement(team: ReadonlyTeam, _slot: number): string {
  return team
    .map(member => member.agent?.damageElement ?? '')
    .find(element => element && element !== 'wind') || 'wind'
}

/** 风华：开局45点，每消耗1点能量获得1点；90点触发一次广域气旋。 */
function velinaBroadCycloneCountFromFloria(
  cfg: CharacterOperationConfig,
  state: IterationState,
): number {
  return buildVelinaFloriaSource(cfg, state)?.broadCycloneCount ?? 0
}

function buildVelinaFloriaSource(
  cfg: CharacterOperationConfig,
  state: IterationState,
): VelinaFloriaSource | undefined {
  if (!cfg.velinaEnabled) return undefined
  const spec = getAgentSpec(VELINA_AGENT_ID)
  if (!spec) return undefined
  const floria = computeSpecResources(
    spec,
    cfg,
    state,
  ).get('velina_floria')
  if (!floria) return undefined
  const broadCycloneCount = floria.spendCounts['floria_broad_cyclone'] ?? 0
  const broadCycloneCost = floria.spendCosts['floria_broad_cyclone'] ?? 0
  return {
    initial: floria.initialValue,
    energySpentGain: floria.totalGain,
    totalAvailable: floria.total,
    broadCycloneCount,
    broadCycloneCost,
    remaining: floria.remaining,
  }
}

/**
 * 风蚀归属（**唯一归属者 = 维琳娜本人**）。
 *
 * 判据 = 派发方给的 `self`（r399 CC-373：异常池只对**在队**模块派发 `transformAnomalyPool` /
 * `anomalyCorrosion`，按模块 `agentIds` 定位槽位，见 `mechanics/registry.ts#teamMechanicSlots`）。
 * 原判据是本模块往自己面板盖的 `velinaEnabled` 标记 + `findVelinaPanel` 扫面板认人——契约缺身份时的补丁，已删。
 *
 * ⚠ **为什么不能按「风属性」找**（CC-D3 裁决 2026-09-25）：风蚀是维琳娜专属资源
 * （`docs/GAME_TERM_TO_CODE_FIELD.md` §8.2「风蚀（维琳娜专属资源）」、spec `velina_corrosion`
 * 与 `character-mechanics.json` 1561 的 `corrosion` 条目），与般岳嗔火、仪玄术法值同类。
 * 但旧判据是 `windCharSlot`（队里**第一个风属性角色**）⇒ 洛克茜(1621) / 赛维里安(1631)
 * 这类别的风属性角色在队时也会跑维琳娜的风蚀状态机，并把「维琳娜微域/广域气旋」的异放行
 * 挂在**他们**名下。实测（2026-09-25）：1621/1141/1031 队产生
 * `{turbulence:3, micro:2, broad:1, boosted:1}` 与两条「维琳娜…气旋」行共 15 702 伤害，
 * 归到洛克茜身上；1631 队 5 936 归赛维里安 ⇒ 数值缺陷，已按「专属资源不给人」修。
 *
 * ⟳复核: 若未来有**第二个**角色也用「风蚀」，`anomalyCorrosion` 的「同一队至多一个模块认领」前提要重审
 * （引擎按注册顺序取首个）；不要退回按 `damageElement === 'wind'` 找槽 | 到期 2027-06-30
 *
 * 风蚀状态机的**归属安全**入口（transform 与 anomalyCorrosion 两处共用，单一事实源）。
 * 与直接调 `simulateVelinaCorrosionState` 的区别：**没有维琳娜面板 ⇒ 返回 `undefined`**（不是全零对象）——
 * 调用方据此「整套不结算」，而不是「结算出 0 次」；后者仍会把 `corrosionSource`/事件行推给别的风角色。
 *
 * @param panel 维琳娜自己的面板（= 派发方给的 `self.panel`；不在队 ⇒ 根本不派发）
 */
export function resolveVelinaCorrosion(
  panel: PanelValues | undefined,
  turbulenceCount: number,
  windTriggerCount: number,
): CorrosionSource | undefined {
  if (!panel) return undefined
  return simulateVelinaCorrosionState(
    turbulenceCount,
    windTriggerCount,
    (panel.velinaCinema2 ?? 0) > 0,
    (panel.velinaCinema6 ?? 0) > 0,
    panel.velinaCinema2CorrosionRate ?? VELINA_C2_CORROSION_RATE_DEFAULT,
  )
}

/** 风蚀状态机：乱流前已有2点则消耗并替换微域为广域，否则获得1点并触发微域。 */
export function simulateVelinaCorrosionState(
  turbulenceCount: number,
  windTriggerCount: number,
  hasCinema2: boolean,
  hasCinema6: boolean,
  cinema2CorrosionRate = 2 / 3,
): CorrosionSource {
  const safeTurbulenceCount = Math.max(0, Math.floor(turbulenceCount))
  const safeCinema2Rate = Math.max(0, Math.min(1, Number.isFinite(cinema2CorrosionRate) ? cinema2CorrosionRate : 2 / 3))
  const c2WindGainExpected = hasCinema2 ? Math.max(0, windTriggerCount) * safeCinema2Rate : 0
  const machine = getAgentSpec(VELINA_AGENT_ID)?.stateMachines?.find(item => item.id === 'velina_corrosion_state_machine')
  const simulated = machine
    ? simulateCounterStateMachine(machine, {
        eventCount: safeTurbulenceCount,
        initialBudget: c2WindGainExpected,
        refundEnabled: hasCinema6,
      })
    : { finalValue: 0, counts: {} as Record<string, number> }

  return {
    turbulenceCount: safeTurbulenceCount,
    microCycloneCount: simulated.counts.microCycloneCount ?? 0,
    broadCycloneCount: simulated.counts.broadCycloneCount ?? 0,
    boostedTurbulenceCount: simulated.counts.boostedTurbulenceCount ?? 0,
    c2WindGainExpected,
    cinema6RefundCount: simulated.counts.cinema6RefundCount ?? 0,
    finalCorrosion: simulated.finalValue,
    note: '风蚀状态机：每次乱流先检查乱流前是否已有2点风蚀；若已有2点，则本次乱流消耗2点，倍率区+150%，且本次微域替换为广域；否则本次乱流获得1点风蚀并触发微域。非6命基准循环为先攒到2点、下一次乱流消耗；6命在消耗后返还1点，返还会参与后续循环。2命风化获得按风化次数×2/3期望摊入。',
  }
}

/** 2 命风化获得风蚀的期望利用率缺省值（与 settings `velina.cinema2CorrosionRate` 的 default 同值） */
export const VELINA_C2_CORROSION_RATE_DEFAULT = 2 / 3

function applyVelinaPanel({ slot, agent, cinemaLevel, team, panel, settings }: AgentPanelInput): void {
  const additionalAbilityActive = specAdditionalAbilityActive(team, slot, agent)
  // 乱流抗性无视（通用面板字段，core/anomalyPool/helpers.ts#calcTurbulenceSettlement 读；CC-36b）
  panel.turbulenceResIgnore = cinemaLevel >= 1 ? 20 : 0
  panel.velinaCinema2 = cinemaLevel >= 2 ? 1 : 0
  panel.velinaCinema6 = cinemaLevel >= 6 ? 1 : 0
  // CC-27（2026-09-28）：2 命风蚀利用率由本模块在面板阶段读自己的滑块盖章，风蚀状态机（本模块
  // `resolveVelinaCorrosion`）读回——写读同属本模块。此前该字段零写入、恒回落到编排层穿线传入的
  // `cinema2CorrosionRate`（roundInputs → AnomalyPoolInput → core/corrosion → 能力入参），那条穿线已删。
  panel.velinaCinema2CorrosionRate = settingOf(settings, 'velina.cinema2CorrosionRate')
  panel.velinaAdditionalAbilityActive = additionalAbilityActive ? 1 : 0

  // 一命：风属性异常伤害无视20%风抗；异放继承风底性质，一并吃到
  if (cinemaLevel >= 1) {
    panel.enemyWindResReduction = panel.enemyWindResReduction + 20
  }

  // 回能转模：原文「初始能量自动回复」⇒ spec sourceValue = energyRegenOutOfCombat（局外总回能 = 基础 × (1 + 局外%) + 局外固定，
  // panelPhases 在 applyPanel 前写入）；不是 energyRegen（恒为基础值）也不是含局内 buff 的 energyRegenTotal。
  applyAgentAttributeConversions(panel, VELINA_AGENT_ID)

  if (additionalAbilityActive) {
    const bonus = 10 + (cinemaLevel >= 2 ? 15 : 0)
    panel.windAnomalyDmgBonus += bonus
    panel.turbulenceDamageBonus += bonus
  }

  if (cinemaLevel >= 4) {
    panel.atk *= 1.15
  }
}

function buildVelinaCharConfig({
  slot,
  agent,
  skills,
  cinemaLevel,
  team,
  cfg,
  getRowValue,
}: AgentCharConfigInput): void {
  const velinaEye = findMoveById(skills, VELINA_EYE_MOVE_ID)
  const velinaSweeping1 = findMoveById(skills, VELINA_SWEEPING_CYCLONE_1_MOVE_ID)
  const velinaSweeping2 = findMoveById(skills, VELINA_SWEEPING_CYCLONE_2_MOVE_ID)
  const additionalAbilityActive = specAdditionalAbilityActive(team, slot, agent)

  cfg.velinaEnabled = true
  cfg.velinaAdditionalAbilityActive = additionalAbilityActive
  cfg.velinaCinema2 = cinemaLevel >= 2
  cfg.velinaEyeMoveId = velinaEye?.id ?? ''
  cfg.velinaEyeActionTime = velinaEye?.actionTime ?? 0
  cfg.velinaEyeDecibelRecovery = getRowValue(velinaEye, 'decibel_recovery') || 0
  cfg.velinaSweepingCyclone1MoveId = velinaSweeping1?.id ?? ''
  cfg.velinaSweepingCyclone2MoveId = velinaSweeping2?.id ?? ''
}

function buildVelinaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const velinaBroadCount = velinaBroadCycloneCountFromFloria(cfg, state)
  if (velinaBroadCount <= 0) return

  if (cfg.velinaEyeMoveId) {
    executions.push(moduleExecRow({
      moveId: cfg.velinaEyeMoveId,
      moveName: 'EX Special Attack: Wind Shear - Eye of the Storm（风华）',
      category: 'special',
      count: velinaBroadCount,
      actionTime: cfg.velinaEyeActionTime ?? 0,
      totalTime: velinaBroadCount * (cfg.velinaEyeActionTime ?? 0),
      decibelRecovery: cfg.velinaEyeDecibelRecovery ?? 0,
      totalDecibelRecovery: velinaBroadCount * (cfg.velinaEyeDecibelRecovery ?? 0),
      ...ENERGY_RECOVERY_OFF,
    }))
  }
  if (cfg.velinaSweepingCyclone1MoveId) {
    executions.push(moduleExecRow({
      moveId: cfg.velinaSweepingCyclone1MoveId,
      moveName: 'Sweeping Cyclone #1（广域气旋10段）',
      category: 'special',
      count: velinaBroadCount * 10,
      ...RECOVERY_OFF,
    }))
  }
  if (cfg.velinaSweepingCyclone2MoveId) {
    executions.push(moduleExecRow({
      moveId: cfg.velinaSweepingCyclone2MoveId,
      moveName: 'Sweeping Cyclone #2（赋彩属性广域气旋×2）',
      category: 'special',
      count: velinaBroadCount * 2,
      ...RECOVERY_OFF,
    }))
  }
}

function buildVelinaAnomalyEvents({ cfg, state, events }: AgentEventInput): void {
  const spec = getAgentSpec(VELINA_AGENT_ID)
  if (!spec) return
  const velinaBroadCount = velinaBroadCycloneCountFromFloria(cfg, state)
  events.push(...buildSpecAnomalyEvents(spec, cfg, state, { broadCycloneCount: velinaBroadCount }))
}

/**
 * 异常池预构建钩子：风蚀状态机 → 风蚀替换广域积蓄注入。
 * 引擎在 perElement 汇总前调用（elementMap 已构建、turbulenceCount 已预算）。
 * 机制内聚在本模块，引擎不再含维琳娜特判。
 */
function transformVelinaAnomalyPool(input: AgentAnomalyTransformInput): void {
  if (!input.hasWindChar) return
  // 风蚀是维琳娜专属资源 ⇒ 按派发方给的 `self` 认人（r399 CC-373），不按「队里第一个风属性角色」
  // （CC-D3 2026-09-25：1621/1631 队原本也会跑本状态机，见 `resolveVelinaCorrosion` 头注释）。
  // 队里没有维琳娜 ⇒ 整套不结算。
  // CC-D4（2026-09-25）：原先这里还把 corrosion 写进 `input.store.corrosionSource`——全仓无读
  // （引擎在 `anomalyPool.ts` 经能力 `anomalyCorrosion` 按最终乱流次数**重新结算**同一份结果），
  // 已随 `AgentAnomalyTransformInput.store` 字段一并删除。
  const corrosion = resolveVelinaCorrosion(
    input.self.panel,
    input.preTurbulenceCount,
    input.preWindTriggerCount,
  )
  if (!corrosion) return

  const bcCount = corrosion.broadCycloneCount
  if (bcCount <= 0) return
  // 每次风蚀替换广域 = Sweeping Cyclone #1(1561007) ×10 段，单次积蓄 45
  // 积蓄归属维琳娜自己的槽位（`self.slot`），不是 windCharSlot：
  // 旧写法把广域积蓄记到「第一个风角色」名下，非维琳娜风队会凭空多出风积蓄。
  const velinaSlot = input.self.slot
  const velinaPanel = input.self.panel ?? emptyPanel()
  const windRes = input.enemyAnomalyResistances['wind'] ?? 0
  const perHit = input.calcPerHitBuildUp(45, velinaPanel, windRes, 'wind')
  const totalCount = bcCount * 10
  const contrib = {
    moveId: 'velina_corrosion_broad',
    moveName: '广域气旋（风蚀替换，Sweeping Cyclone #1×10）',
    slot: velinaSlot,
    element: 'wind',
    count: totalCount,
    baseBuildUp: 45,
    perHitBuildUp: perHit,
    totalBuildUp: perHit * totalCount,
  }
  if (!input.elementMap.has('wind')) input.elementMap.set('wind', [])
  input.elementMap.get('wind')!.push(contrib)
}

function buildVelinaResourceResult({ cfg, state }: AgentResourceResultInput): Partial<import('@/types/resource').CharacterResourceResult> {
  return {
    velinaFloriaSource: buildVelinaFloriaSource(cfg, state),
  }
}

function transformVelinaSkillExecutions(input: AgentSkillTransformInput): void {
  const {
    slot,
    agent,
    skills,
    charResult,
    cinemaLevel,
    team,
    dazeCoef,
    stunExecs,
    anomalyExecs,
    getRowValue,
    normalizeResourceSkillType,
  } = input
  const fallbackElement = agent?.damageElement
  const additionalAbilityActive = specAdditionalAbilityActive(team, slot, agent)
  const velinaCinema2 = cinemaLevel >= 2
  const velinaColorElementValue = velinaColorElement(team, slot)

  for (const exec of charResult.executions) {
    if (exec.moveId === 'basic_attack') continue
    if (exec.count <= 0 && exec.totalTime <= 0) continue

    const foundMove = findMoveById(skills, exec.moveId)
    if (!foundMove) continue
    const foundElement = foundMove.damageElement ?? fallbackElement
    const count = exec.count
    const daze = getRowValue(foundMove, 'daze')
    const anomaly = getRowValue(foundMove, 'anomaly_buildup')
    const moveName = exec.moveName.replace(/（.*）/g, '').trim()
    const isVelinaBroadCyclone = foundMove.id === VELINA_SWEEPING_CYCLONE_1_MOVE_ID || foundMove.id === VELINA_SWEEPING_CYCLONE_2_MOVE_ID
    const velinaResReductionMult = 1 + (additionalAbilityActive ? 14 : 7) / 100
    const velinaCinema1 = cinemaLevel >= 1
    const velinaCinema6 = cinemaLevel >= 6
    const velinaBuildUpMult = velinaResReductionMult
      * (isVelinaBroadCyclone && additionalAbilityActive ? 1.15 : 1)
      * (velinaCinema6 && foundElement === 'wind' ? 1.2 : 1)
    const velinaDazeMult = isVelinaBroadCyclone
      ? (additionalAbilityActive ? 1.3 : 1) * (velinaCinema1 ? 1.2 : 1)
      : 1

    if (daze > 0 && count > 0) {
      stunExecs.push({
        moveId: exec.moveId,
        moveName,
        slot,
        count,
        baseDaze: daze * dazeCoef * velinaDazeMult,
        element: foundElement,
        skillType: normalizeResourceSkillType(foundMove, exec.moveId),
      })
    }

    if (anomaly > 0 && count > 0 && foundElement) {
      const isSweepingCyclone2 = foundMove.id === VELINA_SWEEPING_CYCLONE_2_MOVE_ID
      if (isSweepingCyclone2) {
        if (velinaCinema2 && velinaColorElementValue) {
          const baseBuildUp = anomaly * velinaBuildUpMult
          anomalyExecs.push({
            moveId: `${exec.moveId}_velina_colored_buildup`,
            moveName: `${moveName}（赋彩积蓄）`,
            slot,
            count,
            baseBuildUp,
            element: velinaColorElementValue,
          })
        }
      } else {
        const baseBuildUp = anomaly * velinaBuildUpMult
        anomalyExecs.push({
          moveId: exec.moveId,
          moveName,
          slot,
          count,
          baseBuildUp,
          element: foundElement,
        })
        if (isVelinaBroadCyclone && velinaCinema2 && velinaColorElementValue && velinaColorElementValue !== foundElement) {
          anomalyExecs.push({
            moveId: `${exec.moveId}_velina_colored_buildup`,
            moveName: `${moveName}（维琳娜赠送积蓄）`,
            slot,
            count,
            baseBuildUp,
            element: velinaColorElementValue,
          })
        }
      }
    }
  }
}

function resolveVelinaExecutionDamage(input: AgentDamageResolutionInput): { element: string; source?: string; note?: string } | null {
  const { slot, move, exec, team } = input
  if (move?.id !== VELINA_SWEEPING_CYCLONE_2_MOVE_ID && move?.name?.en !== 'Sweeping Cyclone #2') return null
  const coloredElement = velinaColorElement(team, slot)
  return {
    element: coloredElement,
    source: 'Sweeping Cyclone #2 ×2（赋彩属性广域气旋）',
    note: `${exec.skillTableNote ?? ''}；赋彩属性广域气旋使用 Sweeping Cyclone #2 的伤害倍率，0/1命仅有伤害，2命才解锁该倍率行的异常积蓄。`,
  }
}

function velinaReleaseModifier({ self }: ReleaseModifierInput): { enemyResReduction: number; note: string } {
  const hasCinema1 = self.cinemaLevel >= 1 // 与 applyVelinaPanel 的 velinaCinema1 同式（cinemaLevel >= 1）
  return hasCinema1
    ? { enemyResReduction: 0, note: '；维琳娜1命：风属性异常伤害无视20%风抗（已写入面板，异放继承风底）' }
    : { enemyResReduction: 0, note: '' }
}

function buildVelinaResourceSections({ result, anomalyPoolResult }: AgentResourceSectionsInput): SpecialResourceSection[] {
  const sections: SpecialResourceSection[] = []
  const floria = result.velinaFloriaSource
  if (floria) {
    sections.push({
      id: 'velina-floria',
      title: '维琳娜风华',
      summary: `剩余 ${fmt(floria.remaining)}`,
      rows: [
        { label: '风华初始', value: `+${fmt(floria.initial)}`, detail: '开局获得' },
        { label: '风华回复', value: `+${fmt(floria.energySpentGain)}`, detail: '消耗能量获得风华' },
        { label: '风华消耗', value: `-${fmt(floria.broadCycloneCost)}`, detail: `90风华/次 → 广域气旋 ${floria.broadCycloneCount} 次` },
      ],
    })
  }

  const corrosion = anomalyPoolResult?.corrosionSource
  if (corrosion) {
    sections.push({
      id: 'velina-corrosion',
      title: '维琳娜风蚀',
      summary: `剩余 ${fmt(corrosion.finalCorrosion, 2)}`,
      rows: [
        {
          label: '风蚀回复',
          value: `+${fmt(corrosion.microCycloneCount + corrosion.c2WindGainExpected + corrosion.cinema6RefundCount, 2)}`,
          detail: `乱流 ${corrosion.microCycloneCount} 次 + 2命风化期望 ${fmt(corrosion.c2WindGainExpected, 2)}`,
        },
        {
          label: '风蚀消耗',
          value: `-${fmt(corrosion.broadCycloneCount * 2)}`,
          detail: `乱流前已有2风蚀才消耗 → 本次微域替换广域 ${corrosion.broadCycloneCount} 次`,
        },
      ],
      footer: `微域 ${corrosion.microCycloneCount} 次 · 风蚀替换广域 ${corrosion.broadCycloneCount} 次 · 强化乱流 ${corrosion.boostedTurbulenceCount} 次${corrosion.cinema6RefundCount > 0 ? '；6命返还已参与后续循环' : ''}`,
    })
  }
  return sections
}
/**
 * CC-71：风蚀气旋异放事件记录（原 `core/anomalyPool.ts` 写死，id / label / source / formula / fields / note 逐字搬入）。
 * 引擎在 anomalyPool 同一位置追加（`core/anomalyPool/corrosion.ts#resolveAnomalyCorrosionEvents`），末尾 count>0 过滤不变。
 * id 前缀取 core 单一事实源（进入伤害池行 id，值不可改，见 CC-69）。
 */
function buildVelinaCorrosionEvents(source: CorrosionSource): AnomalyEventRecord[] {
  return [
    {
      id: `${CORROSION_CYCLONE_RELEASE_ID_PREFIX}-condensed-cyclone`,
      type: 'release',
      label: '维琳娜微域气旋风异放',
      source: '0或1个风蚀时，触发乱流获得1点风蚀并触发 Condensed Cyclone',
      count: source.microCycloneCount,
      formula: 'microCount = 风蚀状态机中“0或1风蚀触发乱流”的次数；每次微域气旋触发一次145%倍率风属性异放',
      fields: ['corrosion<2', 'turbulenceCount', 'Condensed Cyclone', 'releaseMultiplier=145%'],
      note: '0或1个风蚀时，再次触发乱流会获得1点风蚀，并伴随触发微域气旋；微域气旋触发一次145%倍率风属性异放。',
    },
    {
      id: `${CORROSION_CYCLONE_RELEASE_ID_PREFIX}-broad-cyclone`,
      type: 'release',
      label: '维琳娜风蚀替换广域气旋',
      source: '2个风蚀时，再次触发乱流清空风蚀，微域气旋替换为广域气旋',
      count: source.broadCycloneCount,
      formula: 'broadCount = 风蚀状态机中“2风蚀触发乱流”的次数；本次微域气旋替换为广域气旋，触发255%风异放，并使本次乱流倍率区 += 150%',
      fields: ['corrosion=2', 'Sweeping Cyclone #1×10 + #2×2', 'releaseMultiplier=255', 'turbulenceMultiplier+150%'],
      note: '2个风蚀时，再次触发乱流会清空风蚀；本该触发的微域气旋替换为广域气旋，同时把这次触发的乱流倍率提高150%。强化次数会继续分配到各个非风属性乱流伤害事件。',
    },
  ]
}

export const velinaMechanic: AgentMechanicModule = {
  id: 'agent:velina',
  agentIds: [VELINA_AGENT_ID],
  name: '维琳娜',
  // ⚠ 平A权重**不设** defaultBasicAttackTimeWeight（用户裁决 2026-10-01）：维琳娜是**前台打法**的
  // 辅助向异常，非后台玩法（区别于蕾米埃尔/薇薇安的角色固有 0）⇒ 默认 weight=1（通用兜底），
  // 交给边际均衡按队型压 0（有真主C时）或顶上（没主C时）。写死 0 会让「没主C队」平A池蒸发留白。
  // CC-66：ResourceResultCard 腐蚀状态机展示（原组件写死本角色 id / Sweeping Cyclone #1 moveId）
  resultCardCorrosion: { poolReleaseEventMarker: CORROSION_CYCLONE_RELEASE_ID_PREFIX, broadCycloneMoveId: VELINA_SWEEPING_CYCLONE_1_MOVE_ID },
  description: '风华/风蚀专属资源、广域/微域气旋、赋彩属性与风化乱流命座机制。',
  applyPanel: applyVelinaPanel,
  buildCharConfig: buildVelinaCharConfig,
  buildExecutions: buildVelinaExecutions,
  buildAnomalyEvents: buildVelinaAnomalyEvents,
  buildResourceResult: buildVelinaResourceResult,
  replaceSkillExecutionExtraction: true,
  transformSkillExecutions: transformVelinaSkillExecutions,
  transformAnomalyPool: transformVelinaAnomalyPool,
  // 6 命风化事件加成（CC-36b 2026-09-27，原 damagePoolAnomaly.ts 内联）：对风化状态敌人再次施加风化，
  // 按平均剩余时长给风化事件增伤（每 1s +2.5%，上限 40%）。公式与说明文案逐字迁入。
  windAnomalyBonus: ({ panel, triggerCount }) => {
    if (!((panel?.velinaCinema6 ?? 0) > 0) || triggerCount <= 1) return null
    const avgRemaining = (30 * (triggerCount - 1) / triggerCount) / 2
    const c6BonusPct = Math.min(40, 2.5 * avgRemaining)
    return { pct: c6BonusPct, note: ` · 6命风化期望+${c6BonusPct.toFixed(1)}%（平均剩余${avgRemaining.toFixed(1)}s）` }
  },
  // 风蚀状态机的**引擎期求值**入口（规则 6 引擎落点，2026-09-25 CC-6d）：
  // 引擎遍历 `AnomalyPoolInput.teamMechanics`（在队模块 + 槽位，r399）调 `anomalyCorrosion`（`core/anomalyPool/corrosion.ts#resolveAnomalyCorrosion`），不再值导入本模块
  // （`core/anomalyPool.ts` 终局重结算 + `helpers.ts#calcTurbulenceDamage`）。
  // 2 命利用率读本模块 applyPanel 盖章的 `panel.velinaCinema2CorrosionRate`（CC-27）。
  anomalyCorrosion: ({ self, turbulenceCount, windTriggerCount }) =>
    resolveVelinaCorrosion(self.panel, turbulenceCount, windTriggerCount),
  // CC-71：风蚀气旋异放事件记录（原写死在 core/anomalyPool.ts）
  anomalyCorrosionEvents: buildVelinaCorrosionEvents,
  resolveExecutionDamage: resolveVelinaExecutionDamage,
  releaseModifier: velinaReleaseModifier,
  resourceSections: buildVelinaResourceSections,
  settings: [
    {
      id: 'velina.cinema2CorrosionRate',
      label: '维琳娜 2 命风蚀利用率',
      description: '风化获得风蚀的期望利用率。默认 66.67%。如果轴更好、能规避浪费，可以调高；如果风化触发时经常溢出，可以调低。',
      default: VELINA_C2_CORROSION_RATE_DEFAULT,
      min: 0,
      max: 1,
      step: 0.01,
      suffix: '%',
    },
  ],
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 维琳娜额外能力是否触发：队伍中存在其他异常角色或同属性角色 */
    velinaAdditionalAbilityActive?: boolean
    /** 维琳娜2命：赋彩属性获得同等积蓄 */
    velinaCinema2?: boolean
    /** 风华广域：Eye of the Storm move id */
    velinaEyeMoveId?: string
    /** 风华广域：Eye of the Storm actionTime */
    velinaEyeActionTime?: number
    /** 风华广域：Eye of the Storm 喧响回复 */
    velinaEyeDecibelRecovery?: number
    /** 风华广域：Sweeping Cyclone #1 move id */
    velinaSweepingCyclone1MoveId?: string
    /** 风华广域：Sweeping Cyclone #2 move id */
    velinaSweepingCyclone2MoveId?: string
    /** 是否为维琳娜，用于风华/风蚀专属资源 */
    velinaEnabled?: boolean
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 维琳娜风华资源明细 */
    velinaFloriaSource?: VelinaFloriaSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 维琳娜风华资源明细 */
export interface VelinaFloriaSource {
  /** 初始风华，默认45 */
  initial: number
  /** 消耗能量获得的风华（当前按强特耗能折算） */
  energySpentGain: number
  /** 总可用风华 = 初始 + 能量消耗获得 */
  totalAvailable: number
  /** 90风华消耗触发广域气旋的次数 */
  broadCycloneCount: number
  /** 广域气旋消耗风华 = broadCycloneCount × 90 */
  broadCycloneCost: number
  /** 结余风华 */
  remaining: number
}

/**
 * D2（r402 CC-376，`docs/mcp-panel-fields.md` §4 S2+S4）：本模块私有的面板字段——只有本文件读写（测试读不算引用者），声明随模块走。
 * 仍是 `PanelValues` 的成员（模块扩充，纯类型、零运行时）；出现第二个**生产**引用者时迁回 `types/catalog.ts`。
 */
declare module '@/types/catalog' {
  interface PanelValues {
    /** 2 命标记（0/1）：本文件读 */
    velinaCinema2?: number
    /** 6 命标记（0/1）：本文件读 */
    velinaCinema6?: number
    /** 2 命风蚀利用率（CC-27）：applyPanel 读滑块写入，`resolveVelinaCorrosion` 读回 */
    velinaCinema2CorrosionRate?: number
    /** 额外能力是否触发（0/1）：spec 1561.json 的 `enabledField` 按名读 */
    velinaAdditionalAbilityActive?: number
  }
}

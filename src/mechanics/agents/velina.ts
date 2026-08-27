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
  MechanicTeamMember,
  ReleaseModifierInput,
} from '../types'
import type { Agent, AgentSkills, SkillMove } from '@/types/catalog'
import type {
  CharacterOperationConfig,
  IterationState,
  SpecialResourceSection,
  VelinaCorrosionSource,
  VelinaFloriaSource,
} from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecAnomalyEvents } from '@/specs/mechanics'
import { computeSpecResources } from '@/specs/resources'
import { applySpecAttributeConversions } from '@/specs/runtime'
import { simulateCounterStateMachine } from '@/specs/stateMachine'

const VELINA_AGENT_ID = '1561'

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.id === moveId)
    if (move) return move
  }
  return null
}

function findMoveByEnglishName(skills: AgentSkills | undefined, englishName: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.name?.en === englishName || m.name?.zhCN === englishName)
    if (move) return move
  }
  return null
}

function isAdditionalAbilityActive(team: MechanicTeamMember[], slot: number, agent: Agent): boolean {
  return team.some(member => {
    if (member.slot === slot || !member.agent) return false
    return member.agent.specialty === 'anomaly' || member.agent.damageElement === agent.damageElement
  })
}

function velinaColorElement(team: MechanicTeamMember[], _slot: number): string {
  return team
    .map(member => member.agent?.damageElement ?? '')
    .find(element => element && element !== 'wind') || 'wind'
}

/** 风华：开局45点，每消耗1点能量获得1点；90点触发一次广域气旋。 */
export function velinaBroadCycloneCountFromFloria(
  cfg: { velinaEnabled?: boolean; exSpecialEnergyConsume?: number },
  state: { exSpecialCount: number },
): number {
  if (!cfg.velinaEnabled) return 0
  const spec = getAgentSpec(VELINA_AGENT_ID)
  if (!spec) return 0
  const floria = computeSpecResources(
    spec,
    cfg as unknown as CharacterOperationConfig,
    state as unknown as IterationState,
  ).get('velina_floria')
  return floria?.spendCounts['floria_broad_cyclone'] ?? 0
}

export function buildVelinaFloriaSource(
  cfg: { velinaEnabled?: boolean; exSpecialEnergyConsume?: number },
  state: { exSpecialCount: number },
): VelinaFloriaSource | undefined {
  if (!cfg.velinaEnabled) return undefined
  const spec = getAgentSpec(VELINA_AGENT_ID)
  if (!spec) return undefined
  const floria = computeSpecResources(
    spec,
    cfg as unknown as CharacterOperationConfig,
    state as unknown as IterationState,
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

/** 风蚀状态机：乱流前已有2点则消耗并替换微域为广域，否则获得1点并触发微域。 */
export function simulateVelinaCorrosionState(
  turbulenceCount: number,
  windTriggerCount: number,
  hasCinema2: boolean,
  hasCinema6: boolean,
  cinema2CorrosionRate = 2 / 3,
): VelinaCorrosionSource {
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

function applyVelinaPanel({ slot, agent, cinemaLevel, team, panel }: AgentPanelInput): void {
  const additionalAbilityActive = isAdditionalAbilityActive(team, slot, agent)
  panel.velinaEnabled = 1
  panel.velinaCinema1 = cinemaLevel >= 1 ? 1 : 0
  panel.velinaCinema2 = cinemaLevel >= 2 ? 1 : 0
  panel.velinaCinema4 = cinemaLevel >= 4 ? 1 : 0
  panel.velinaCinema6 = cinemaLevel >= 6 ? 1 : 0
  panel.velinaAdditionalAbilityActive = additionalAbilityActive ? 1 : 0

  // 一命：风属性异常伤害无视20%风抗；异放继承风底性质，一并吃到
  if (cinemaLevel >= 1) {
    panel.enemyWindResReduction = (panel.enemyWindResReduction ?? 0) + 20
  }

  // 回能转模：真实回能 = energyRegen × (1 + bonusPct/100) + flat（加成只体现在 energyRegenTotal，未写回 energyRegen 字段）
  applySpecAttributeConversions(
    panel,
    getAgentSpec(VELINA_AGENT_ID)?.attributeConversions ?? [],
  )

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
  const velinaEye = findMoveByEnglishName(skills, 'EX Special Attack: Wind Shear - Eye of the Storm')
  const velinaSweeping1 = findMoveByEnglishName(skills, 'Sweeping Cyclone #1')
  const velinaSweeping2 = findMoveByEnglishName(skills, 'Sweeping Cyclone #2')
  const velinaCondensed = findMoveByEnglishName(skills, 'Condensed Cyclone')
  const additionalAbilityActive = isAdditionalAbilityActive(team, slot, agent)

  cfg.velinaEnabled = true
  cfg.velinaAdditionalAbilityActive = additionalAbilityActive
  cfg.velinaCinema2 = cinemaLevel >= 2
  cfg.velinaColorElement = velinaColorElement(team, slot)
  cfg.velinaEyeMoveId = velinaEye?.id ?? ''
  cfg.velinaEyeActionTime = velinaEye?.actionTime ?? 0
  cfg.velinaEyeDecibelRecovery = getRowValue(velinaEye, 'decibel_recovery') || 0
  cfg.velinaSweepingCyclone1MoveId = velinaSweeping1?.id ?? ''
  cfg.velinaSweepingCyclone2MoveId = velinaSweeping2?.id ?? ''
  cfg.velinaCondensedCycloneMoveId = velinaCondensed?.id ?? ''
}

function buildVelinaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const velinaBroadCount = velinaBroadCycloneCountFromFloria(cfg, state)
  if (velinaBroadCount <= 0) return

  if (cfg.velinaEyeMoveId) {
    executions.push({
      moveId: cfg.velinaEyeMoveId,
      moveName: 'EX Special Attack: Wind Shear - Eye of the Storm（风华）',
      category: 'special',
      count: velinaBroadCount,
      actionTime: cfg.velinaEyeActionTime ?? 0,
      comboAlignRatio: 0,
      totalTime: velinaBroadCount * (cfg.velinaEyeActionTime ?? 0),
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.velinaEyeDecibelRecovery ?? 0,
      totalDecibelRecovery: velinaBroadCount * (cfg.velinaEyeDecibelRecovery ?? 0),
      energyRecovery: 0,
      totalEnergyRecovery: 0,
    })
  }
  if (cfg.velinaSweepingCyclone1MoveId) {
    executions.push({
      moveId: cfg.velinaSweepingCyclone1MoveId,
      moveName: 'Sweeping Cyclone #1（广域气旋10段）',
      category: 'special',
      count: velinaBroadCount * 10,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
    })
  }
  if (cfg.velinaSweepingCyclone2MoveId) {
    executions.push({
      moveId: cfg.velinaSweepingCyclone2MoveId,
      moveName: 'Sweeping Cyclone #2（赋彩属性广域气旋×2）',
      category: 'special',
      count: velinaBroadCount * 2,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
    })
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
  const windPanel = input.panels[input.windCharSlot] ?? input.panels[0]
  const corrosion = simulateVelinaCorrosionState(
    input.preTurbulenceCount,
    input.preWindTriggerCount,
    (windPanel.velinaCinema2 ?? 0) > 0,
    (windPanel.velinaCinema6 ?? 0) > 0,
    (windPanel.velinaCinema2CorrosionRate as number) ?? 2 / 3,
  )
  input.store.velinaCorrosionSource = corrosion

  const bcCount = corrosion.broadCycloneCount
  if (bcCount <= 0) return
  // 每次风蚀替换广域 = Sweeping Cyclone #1(1561007) ×10 段，单次积蓄 45
  const windRes = input.enemyAnomalyResistances['wind'] ?? 0
  const perHit = input.calcPerHitBuildUp(45, windPanel, windRes, 'wind')
  const totalCount = bcCount * 10
  const contrib = {
    moveId: 'velina_corrosion_broad',
    moveName: '广域气旋（风蚀替换，Sweeping Cyclone #1×10）',
    slot: input.windCharSlot,
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
  const additionalAbilityActive = agent ? isAdditionalAbilityActive(team, slot, agent) : false
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
    const isVelinaBroadCyclone = foundMove.name?.en === 'Sweeping Cyclone #1' || foundMove.name?.en === 'Sweeping Cyclone #2'
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
      const isSweepingCyclone2 = foundMove.name?.en === 'Sweeping Cyclone #2'
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
  if (move?.name?.en !== 'Sweeping Cyclone #2') return null
  const coloredElement = velinaColorElement(team, slot)
  return {
    element: coloredElement,
    source: 'Sweeping Cyclone #2 ×2（赋彩属性广域气旋）',
    note: `${exec.skillTableNote ?? ''}；赋彩属性广域气旋使用 Sweeping Cyclone #2 的伤害倍率，0/1命仅有伤害，2命才解锁该倍率行的异常积蓄。`,
  }
}

function velinaReleaseModifier({ panels }: ReleaseModifierInput): { enemyResReduction: number; note: string } {
  const hasCinema1 = panels.some(panel => (panel.velinaCinema1 ?? 0) > 0)
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

  const corrosion = anomalyPoolResult?.velinaCorrosionSource
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

export const velinaMechanic: AgentMechanicModule = {
  id: 'agent:velina',
  agentIds: [VELINA_AGENT_ID],
  name: '维琳娜',
  description: '风华/风蚀专属资源、广域/微域气旋、赋彩属性与风化乱流命座机制。',
  applyPanel: applyVelinaPanel,
  buildCharConfig: buildVelinaCharConfig,
  buildExecutions: buildVelinaExecutions,
  buildAnomalyEvents: buildVelinaAnomalyEvents,
  buildResourceResult: buildVelinaResourceResult,
  replaceSkillExecutionExtraction: true,
  transformSkillExecutions: transformVelinaSkillExecutions,
  transformAnomalyPool: transformVelinaAnomalyPool,
  resolveExecutionDamage: resolveVelinaExecutionDamage,
  releaseModifier: velinaReleaseModifier,
  resourceSections: buildVelinaResourceSections,
  settings: [
    {
      id: 'velina.cinema2CorrosionRate',
      label: '维琳娜 2 命风蚀利用率',
      description: '风化获得风蚀的期望利用率。默认 66.67%。如果轴更好、能规避浪费，可以调高；如果风化触发时经常溢出，可以调低。',
      default: 2 / 3,
      min: 0,
      max: 1,
      step: 0.01,
      suffix: '%',
    },
  ],
}

import type { PanelValues } from '@/types/catalog'
import type {
  AnomalyPoolResult, AnomalyProgress, AnomalyContribution,
  AnomalyCoverageResult, AnomalyEventRecord,
  DisorderDamageResult, DisorderDamageDetail,
  TurbulenceDamageResult, TurbulenceDamageDetail,
  DisorderFormula, TurbulenceFormula, VelinaCorrosionSource,
  StandardDotDamageResult,
  AliceCoweringDotResult,
} from '@/types/resource'
import { fmt } from '@/utils/format'
import { enemyDebuffElementStatId } from '@/utils/enemyDebuffStats'
import { simulateVelinaCorrosionState } from '@/mechanics/agents/velina'

// ============ 喧响奖励常量 ============

import * as AnomalyPoolHelpers from './anomalyPool/helpers'
import type { AnomalyPoolInput, DamageCalcConfig } from './anomalyPool/helpers'
export type { AnomalySkillExecution, AnomalyPoolInput, AliceCoweringConfig } from './anomalyPool/helpers'
const { ANOMALY_DECIBEL_BONUS, DISORDER_DECIBEL_BONUS, TURBULENCE_DECIBEL_BONUS, TURBULENCE_CD_SECONDS, getBaseElement, BUILDUP_CAP_TABLE, ANOMALY_DURATION, DISORDER_FORMULAS, TURBULENCE_FORMULAS, STANDARD_DOT_CONFIG, distributeIntegerByWeight, calcPerSlotAnomalyTriggers, calcPerSlotDisorderTriggers, calcPerSlotAnomalyDecibelBonus, calcPerHitBuildUp, simulateTriggerCount, round, getAnomalyDuration, getMainApplierSlot, calcCoverage, calcDisorderDamage, calcTurbulenceDamage, calcStandardDotDamage, calcAliceCoweringDot } = AnomalyPoolHelpers
export function calcAnomalyPool(input: AnomalyPoolInput): AnomalyPoolResult {
  const {
    executions,
    panels,
    bossCoeff = 1,
    anomalyCoeff = 1.1,
    enemyAnomalyResistances = {},
    // 新增参数
    totalTime = 180,
    invincibleTime = 0,
    enemyDefense = 953,
    enemyDefReduction = 0,
    enemyResistances = {},
    enemyResReduction = 0,
    stunned = false,
    stunMultiplier = 1.5,
    hasWindChar = false,
    windCharSlot = 0,
    velinaCinema2CorrosionRate = 2 / 3,
    globalAnomalyMultiplier = 1,
  } = input

  // ---- 1. 按元素分组累积 ----
  const elementMap = new Map<string, AnomalyContribution[]>()

  for (const exec of executions) {
    if (exec.count <= 0 || exec.baseBuildUp <= 0) continue
    if (!exec.element) continue

    const panel = panels[exec.slot] ?? panels[0]
    // 按基础元素取抗性（变种元素与基础元素共享抗性）
    const elementRes = enemyAnomalyResistances[getBaseElement(exec.element)] ?? 0
    const perHit = calcPerHitBuildUp(exec.baseBuildUp, panel, elementRes, exec.element, exec.buildUpEfficiencyBonusPct ?? 0)
    const total = perHit * exec.count

    const contrib: AnomalyContribution = {
      moveId: exec.moveId,
      moveName: exec.moveName,
      slot: exec.slot,
      element: exec.element,
      count: exec.count,
      baseBuildUp: exec.baseBuildUp,
      perHitBuildUp: perHit,
      totalBuildUp: total,
    }

    if (!elementMap.has(exec.element)) {
      elementMap.set(exec.element, [])
    }
    elementMap.get(exec.element)!.push(contrib)
  }

  // ---- 1b. 预构建钩子（transformAnomalyPool）：预算 turbulenceCount + wind 触发后，调用各角色模块注入积蓄 ----
  // 必须在 perElement 之前，使展示/note/触发次数用注入后值
  const preWindTriggerCount = (() => {
    const windContribs = elementMap.get('wind') ?? []
    const windBu = windContribs.reduce((s, c) => s + c.totalBuildUp, 0)
    return simulateTriggerCount(windBu, 'wind', bossCoeff, anomalyCoeff).triggerCount
  })()
  const effectiveTime = Math.max(0, totalTime - invincibleTime)
  const preWindTime = Math.min(preWindTriggerCount * (ANOMALY_DURATION.wind ?? 30), effectiveTime)
  const preWindRate = effectiveTime > 0 ? preWindTime / effectiveTime : 0
  const preTurbulenceCount = (() => {
    if (!hasWindChar || preWindRate <= 0) return 0
    let nonWindPreTrigSum = 0
    for (const [elem, contribs] of elementMap) {
      if (elem === 'wind') continue
      const bu = contribs.reduce((s, c) => s + c.totalBuildUp, 0)
      const { triggerCount: tc } = simulateTriggerCount(bu, elem, bossCoeff, anomalyCoeff)
      nonWindPreTrigSum += tc
    }
    const preCap = Math.floor(preWindTime / TURBULENCE_CD_SECONDS)
    return Math.min(nonWindPreTrigSum * preWindRate, preCap)
  })()
  const transformStore: Record<string, unknown> = {}
  for (const mech of input.agentMechanics ?? []) {
    mech.transformAnomalyPool?.({
      elementMap,
      panels,
      bossCoeff,
      anomalyCoeff,
      enemyAnomalyResistances,
      hasWindChar,
      windCharSlot,
      preTurbulenceCount,
      preWindTriggerCount,
      calcPerHitBuildUp,
      store: transformStore,
    })
  }

  // ---- 2. 计算各元素积蓄进度（累积阈值比较） ----
  const perElement: AnomalyProgress[] = []
  const anomalyEvents: AnomalyEventRecord[] = []
  let totalTriggerCount = 0
  const elementTriggerCounts: Record<string, number> = {}

  for (const [element, contribs] of elementMap) {
    const totalBuildUp = contribs.reduce((sum, c) => sum + c.totalBuildUp, 0)

    // 累积阈值比较触发次数
    const { triggerCount, lastCap } = simulateTriggerCount(
      totalBuildUp, element, bossCoeff, anomalyCoeff,
    )

    const decibelBonus = triggerCount * ANOMALY_DECIBEL_BONUS
    const slotCountForElement = Math.max(3, panels.length)
    const elementWeights = Array(slotCountForElement).fill(0)
    for (const contrib of contribs) {
      elementWeights[contrib.slot] = (elementWeights[contrib.slot] ?? 0) + contrib.totalBuildUp
    }
    const perSlotTriggerCounts = distributeIntegerByWeight(triggerCount, elementWeights)

    perElement.push({
      element,
      totalBuildUp,
      buildUpCap: lastCap,
      triggerCount,
      decibelBonus,
      perSlotTriggerCounts,
      contributions: contribs,
    })

    anomalyEvents.push({
      id: `anomaly-trigger-${element}`,
      type: 'anomaly_trigger',
      label: `${element} 异常触发`,
      source: '异常积蓄条达到当前管上限',
      count: triggerCount,
      formula: 'triggerCount = compare(Σ[count × baseBuildUp × floor(anomalyMastery)/100 × (1 + anomalyBuildUpEfficiency/100) × (1 - effectiveAnomalyRes/100)], cumulativeCap × bossCoeff × anomalyCoeff)',
      fields: [
        'executions.count',
        'executions.baseBuildUp',
        'PanelValues.anomalyMastery',
        'PanelValues.anomalyBuildUpEfficiency',
        'enemyAnomalyResistances[element]',
        'PanelValues.enemyAnomalyResReduction',
        'PanelValues.enemy{Element}AnomalyResReduction',
        'bossCoeff',
        'anomalyCoeff',
        'BUILDUP_CAP_TABLE',
      ],
      note: `本元素总积蓄 ${round(totalBuildUp, 1)}，下一管上限 ${round(lastCap, 1)}；触发归属按各槽位积蓄贡献加权分配。`,
    })

    totalTriggerCount += triggerCount
    elementTriggerCounts[element] = triggerCount
  }

  // ---- 2b. 注入赠送触发（不消耗异常条但参与紊乱序列） ----
  if (input.giftedTriggerCounts) {
    const slotCount = Math.max(3, panels.length)
    for (const [element, count] of Object.entries(input.giftedTriggerCounts)) {
      if (count <= 0) continue
      const perSlot = Array(slotCount).fill(0)
      // 赠送触发全部归入指定槽位
      const giftSlot = input.giftedTriggerSlot ?? 0
      if (giftSlot >= 0 && giftSlot < slotCount) perSlot[giftSlot] = count

      perElement.push({
        element,
        totalBuildUp: 0,
        buildUpCap: 0,
        triggerCount: count,
        decibelBonus: count * ANOMALY_DECIBEL_BONUS,
        perSlotTriggerCounts: perSlot,
        contributions: [],  // 赠送触发无积蓄贡献
      })

      anomalyEvents.push({
        id: `anomaly-trigger-gifted-${element}`,
        type: 'anomaly_trigger',
        label: `${element} 赠送触发`,
        source: '不消耗异常积蓄条，由角色机制直接赠送（如爱丽丝三蓄赠送极性强击）',
        count,
        formula: `count = giftedTriggerCounts['${element}']（调用方传入）`,
        fields: ['giftedTriggerCounts', 'sparkCount'],
        note: '赠送触发不消耗异常条，不产生积蓄贡献，但参与紊乱序列、异常伤害计算和喧响奖励。',
      })

      totalTriggerCount += count
      elementTriggerCounts[element] = (elementTriggerCounts[element] ?? 0) + count
    }
  }

  // ---- 3. 计算紊乱次数 ----
  // 紊乱次数 = min(sum - 1, 2 × (sum - max))
  //   sum = 所有元素触发次数之和
  //   max = 最大元素的触发次数
  //   sum-1 = 序列最大覆盖次数（最后一个异常不被覆盖）
  //   2×(sum-max) = 非多数元素能分隔的多数元素次数
  // 验证：6火10电 → sum=16, max=10 → min(15, 12)=12 ✓
  //       4火4电 → sum=8, max=4 → min(7, 8)=7 ✓
  //
  // 紊乱需要不同属性异常交替覆盖（同属性不触发紊乱）
  // 有风属性时按风化覆盖率切分：非风窗口正常紊乱，风化窗口非风触发改走乱流
  const activeElements = perElement
    .filter(ep => ep.triggerCount > 0)
    .map(ep => ({
      element: ep.element,
      triggerCount: ep.triggerCount,
      // 赠送触发（空贡献）用 input.giftedTriggerSlot，否则从贡献推算
      applierSlot: (ep.contributions.length === 0 && input.giftedTriggerSlot !== undefined)
        ? input.giftedTriggerSlot
        : getMainApplierSlot(ep.contributions),
    }))

  const activeNonWindElements = activeElements.filter(e => e.element !== 'wind')

  // 按风化实际覆盖率把非风异常时间窗拆成两段：
  //   (1 - windCoverageRate) 为非风窗口：正常异常/紊乱
  //   windCoverageRate 为风化窗口：非风触发改走乱流
  const windTriggerCount = elementTriggerCounts['wind'] ?? 0
  const windTime = Math.min(windTriggerCount * (ANOMALY_DURATION.wind ?? 30), effectiveTime)
  const windCoverageRate = effectiveTime > 0 ? windTime / effectiveTime : 0
  const turbulenceCap = Math.floor(windTime / TURBULENCE_CD_SECONDS)

  const normalNonWindElements = activeNonWindElements
    .map(e => ({ ...e, triggerCount: e.triggerCount * (1 - windCoverageRate) }))
    .filter(e => e.triggerCount > 0)
  const turbulenceNonWindElements = activeNonWindElements
    .map(e => ({ ...e, triggerCount: e.triggerCount * windCoverageRate }))
    .filter(e => e.triggerCount > 0)

  let disorderCount = 0
  if (windCoverageRate < 1 && normalNonWindElements.length >= 2) {
    const triggerCountValues = normalNonWindElements.map(e => e.triggerCount)
    const sum = triggerCountValues.reduce((a, b) => a + b, 0)
    const max = Math.max(...triggerCountValues, 0)
    // min(sum-1, 2×(sum-max))：取序列最大覆盖次数与多数元素约束的较小值
    disorderCount = Math.min(sum - 1, 2 * (sum - max))
    if (disorderCount < 0) disorderCount = 0
    anomalyEvents.push({
      id: 'disorder-events',
      type: 'disorder',
      label: '紊乱',
      source: '非风时间窗内不同属性异常交替覆盖',
      count: disorderCount,
      formula: 'disorderCount = min(sum(allElementTriggerCount) - 1, 2 × (sum(allElementTriggerCount) - maxElementTriggerCount))',
      fields: [
        'perElement[].triggerCount',
        'normalNonWindElements[].element',
        'windCoverageRate',
        'ANOMALY_DURATION',
        'DISORDER_FORMULAS',
        'PanelValues.disorderBaseMultiplierBonus',
        'PanelValues.disorderDamageBonus',
      ],
      note: `按风化覆盖率折算非风窗口占比 ${round((1 - windCoverageRate) * 100, 1)}%；紊乱伤害不继承 anomalyDmgBonus 和异常暴击。`,
    })
  }

  // ---- 4. 计算异常覆盖率 ----
  // 变种元素（physical_polar_assault 等）是独立元素：独立积蓄管、独立代码编号，可与原属性紊乱，
  // 仅伤害倍率/异常形式借鉴原属性。覆盖率按变种自身元素统计，不合并回基础元素。
  const coverageTriggerCounts: Record<string, number> = {}
  for (const [elem, count] of Object.entries(elementTriggerCounts)) {
    coverageTriggerCounts[elem] = (coverageTriggerCounts[elem] ?? 0) + count
  }
  const elementDurations: Record<string, number> = {}
  for (const { element, applierSlot } of activeElements) {
    elementDurations[element] = getAnomalyDuration(panels[applierSlot] ?? panels[0], element)
  }
  const coverage = calcCoverage(coverageTriggerCounts, totalTime, invincibleTime, elementDurations, hasWindChar)

  // 霜寒状态使敌人受到暴击伤害+10%，按霜寒覆盖率折算；只影响伤害结算面板，不影响积蓄。
  const frostCritBonus = 10 * (coverage.frostCoverageRate ?? 0)
  const damagePanels = frostCritBonus > 0
    ? panels.map(p => ({ ...p, enemyCritDmgTakenBonus: (p.enemyCritDmgTakenBonus ?? 0) + frostCritBonus }))
    : panels

  // ---- 5. 计算紊乱伤害或乱流伤害 ----
  const dmgConfig: DamageCalcConfig = {
    enemyDefense,
    enemyDefReduction,
    enemyResistances,
    enemyResReduction,
    stunned,
    stunMultiplier,
    velinaCinema2CorrosionRate,
    globalAnomalyMultiplier,
    aliceCoweringConfig: input.aliceCoweringConfig,
  }

  let disorderDamage: DisorderDamageResult | undefined
  let turbulenceDamage: TurbulenceDamageResult | undefined
  let turbulenceCount = 0
  let velinaCorrosionSource: VelinaCorrosionSource | undefined

  if (hasWindChar) {
    // 有风属性：风化窗口内的非风触发改走乱流
    turbulenceCount = Math.min(
      turbulenceNonWindElements.reduce((sum, e) => sum + e.triggerCount, 0),
      turbulenceCap,
    )
    turbulenceDamage = calcTurbulenceDamage(
      turbulenceNonWindElements,
      windCharSlot,
      damagePanels,
      dmgConfig,
      elementTriggerCounts.wind ?? 0,
      turbulenceCap,
    )
    // 风蚀状态机按最终乱流次数重新结算（注入积蓄仍基于预构建的 preTurbulenceCount）
    const windPanel = panels[windCharSlot] ?? panels[0]
    velinaCorrosionSource = simulateVelinaCorrosionState(
      turbulenceCount,
      windTriggerCount,
      (windPanel.velinaCinema2 ?? 0) > 0,
      (windPanel.velinaCinema6 ?? 0) > 0,
      (windPanel.velinaCinema2CorrosionRate as number) ?? velinaCinema2CorrosionRate,
    )
    const velinaBroadFromCorrosionCount = velinaCorrosionSource?.broadCycloneCount ?? 0
    const velinaMicroCycloneCount = velinaCorrosionSource?.microCycloneCount ?? 0

    anomalyEvents.push({
      id: 'turbulence-events',
      type: 'turbulence',
      label: '乱流',
      source: '风化窗口内，非风异常触发改为乱流事件',
      count: turbulenceCount,
      formula: 'turbulenceCount = min(Σ nonWindElement.triggerCount × windCoverageRate, floor(风化时长 / 3s乱流CD)); boostedCount = 风蚀状态机中“2风蚀触发乱流”的次数；这些次数按非风乱流事件数量分配，倍率区 += 150%',
      fields: [
        'turbulenceNonWindElements[].triggerCount',
        'windCoverageRate',
        'turbulenceCap',
        'TURBULENCE_FORMULAS',
        'VelinaCorrosionState.boostedTurbulenceCount',
        'TurbulenceDamageDetail.boostedCount',
        'windCharSlot',
        'PanelValues.anomalyDmgBonus',
        'PanelValues.anomalyCritRate',
        'PanelValues.anomalyCritDmg',
        'PanelValues.assaultCritRate',
        'PanelValues.assaultCritDmg',
        'velinaCorrosion',
        'TURBULENCE_DECIBEL_BONUS=85',
      ],
      note: `风化覆盖率 ${round(windCoverageRate * 100, 1)}%，乱流槽位 ${turbulenceCap} 次（3秒CD，多次风化窗口合并不封顶）；乱流继承异常增伤和异常暴击，每次奖励85喧响，触发者归属风底属性提供者，队友伴随获得一半。${velinaCorrosionSource?.note ?? ''} 2命风化期望风蚀=${round(velinaCorrosionSource?.c2WindGainExpected ?? 0, 2)}，6命返还=${velinaCorrosionSource?.cinema6RefundCount ?? 0}次，强化乱流=${velinaCorrosionSource?.boostedTurbulenceCount ?? 0}次。`,
    })
    anomalyEvents.push({
      id: 'velina-corrosion-condensed-cyclone',
      type: 'release',
      label: '维琳娜微域气旋风异放',
      source: '0或1个风蚀时，触发乱流获得1点风蚀并触发 Condensed Cyclone',
      count: velinaMicroCycloneCount,
      formula: 'microCount = 风蚀状态机中“0或1风蚀触发乱流”的次数；每次微域气旋触发一次145%倍率风属性异放',
      fields: ['velinaCorrosion<2', 'turbulenceCount', 'Condensed Cyclone', 'releaseMultiplier=145%'],
      note: '0或1个风蚀时，再次触发乱流会获得1点风蚀，并伴随触发微域气旋；微域气旋触发一次145%倍率风属性异放。',
    })
    anomalyEvents.push({
      id: 'velina-corrosion-broad-cyclone',
      type: 'release',
      label: '维琳娜风蚀替换广域气旋',
      source: '2个风蚀时，再次触发乱流清空风蚀，微域气旋替换为广域气旋',
      count: velinaBroadFromCorrosionCount,
      formula: 'broadCount = 风蚀状态机中“2风蚀触发乱流”的次数；本次微域气旋替换为广域气旋，触发255%风异放，并使本次乱流倍率区 += 150%',
      fields: ['velinaCorrosion=2', 'Sweeping Cyclone #1×10 + #2×2', 'releaseMultiplier=255', 'turbulenceMultiplier+150%'],
      note: '2个风蚀时，再次触发乱流会清空风蚀；本该触发的微域气旋替换为广域气旋，同时把这次触发的乱流倍率提高150%。强化次数会继续分配到各个非风属性乱流伤害事件。',
    })
  }

  // 非风时间窗内的紊乱：紊乱需要2种以上元素交替触发（新异常覆盖老异常），wind不参与
  if (normalNonWindElements.length >= 2 && disorderCount > 0) {
    disorderDamage = calcDisorderDamage(
      normalNonWindElements,
      disorderCount,
      damagePanels,
      dmgConfig,
    )
  }

  // ---- 5.5 标准元素 DOT 伤害（灼烧/感电/侵蚀） ----
  // 物理（畏缩）、冰（霜寒）、风（风化）没有 DOT 伤害，只有特殊效果
  let standardDotDamage: StandardDotDamageResult | undefined
  if (!hasWindChar && coverage.effectiveDoTTime > 0) {
    const dotElements = normalNonWindElements.filter(e => e.element in STANDARD_DOT_CONFIG)
    if (dotElements.length > 0) {
      standardDotDamage = calcStandardDotDamage(
        dotElements,
        damagePanels,
        coverage.effectiveDoTTime,
        dmgConfig,
      )
    }
  }

  // ---- 6. 计算喧响奖励 ----
  const decibelBonus =
    totalTriggerCount * ANOMALY_DECIBEL_BONUS +
    disorderCount * DISORDER_DECIBEL_BONUS +
    turbulenceCount * TURBULENCE_DECIBEL_BONUS

  const slotCount = Math.max(3, panels.length)
  const perSlotAnomalyTriggers = calcPerSlotAnomalyTriggers(perElement, slotCount)
  const perSlotDisorderTriggers = calcPerSlotDisorderTriggers(normalNonWindElements, disorderCount, slotCount)
  const perSlotTurbulenceTriggers = Array(slotCount).fill(0)
  if (windCharSlot >= 0 && windCharSlot < slotCount && turbulenceCount > 0) {
    // 乱流喧响触发者归属风底属性提供者；其他队友在 perSlotBonus 中按50%伴随获得。
    perSlotTurbulenceTriggers[windCharSlot] = turbulenceCount
  }
  const perSlotBonus = calcPerSlotAnomalyDecibelBonus(
    perSlotAnomalyTriggers,
    perSlotDisorderTriggers,
    perSlotTurbulenceTriggers,
  )

  // ---- 7. 畏缩 DOT 伤害 ----
  // 触发条件：任何异常触发（爱丽丝 DOT 不限物理，风化吞掉畏缩也打 DOT）
  // 覆盖时间 = 总异常有效时间（扣无敌后）
  let aliceCoweringDot: AliceCoweringDotResult | undefined
  if (input.aliceCoweringConfig && totalTriggerCount > 0 && coverage.effectiveDoTTime > 0) {
    const physicalContribs = [
      ...(elementMap.get('physical') ?? []),
      ...(elementMap.get('physical_polar_assault') ?? []),
    ]
    if (physicalContribs.length > 0) {
      aliceCoweringDot = calcAliceCoweringDot(
        physicalContribs,
        damagePanels,
        coverage.effectiveDoTTime,
        dmgConfig,
      )
    }
  }

  // ---- 8. 返回结果 ----
  return {
    perElement,
    totalTriggerCount,
    disorderCount,
    decibelBonus,
    perSlotAnomalyTriggers,
    perSlotDisorderTriggers,
    perSlotTurbulenceTriggers,
    perSlotBonus,
    coverage,
    disorderDamage,
    turbulenceDamage,
    velinaCorrosionSource,
    standardDotDamage,
    aliceCoweringDot,
    anomalyEvents: anomalyEvents.filter(event => event.count > 0),
  }
}

// ============ 特殊动作喧响奖励计算（原有，保持不变） ============

/** 特殊动作喧响奖励计算
 *
 * 个人获得完整奖励，队友伴随获得50%：
 * - 弹刀：215/次，队友各得107.5/次
 * - 闪避反击：10/次，队友各得5/次
 * - 快速支援：20/次，队友各得10/次
 */
export function calcSpecialActionBonus(
  perSlotParry: number[],
  perSlotChain: number[],
  perSlotDodgeCounter: number[],
  perSlotQuickAssist: number[],
): { parry: number; chain: number; dodgeCounter: number; quickAssist: number; total: number; perSlotParry: number[]; perSlotChain: number[]; perSlotDodgeCounter: number[]; perSlotQuickAssist: number[]; perSlotBonus: number[] } {
  const slotCount = Math.max(
    perSlotParry.length,
    perSlotChain.length,
    perSlotDodgeCounter.length,
    perSlotQuickAssist.length,
  )
  const totalParry = perSlotParry.reduce((a, b) => a + b, 0)
  const totalChain = perSlotChain.reduce((a, b) => a + b, 0)
  const totalDodgeCounter = perSlotDodgeCounter.reduce((a, b) => a + b, 0)
  const totalQuickAssist = perSlotQuickAssist.reduce((a, b) => a + b, 0)

  const parry = totalParry * 215
  const chain = totalChain * 10
  const dodgeCounter = totalDodgeCounter * 10
  const quickAssist = totalQuickAssist * 20

  const ownReward = (slot: number) =>
    (perSlotParry[slot] ?? 0) * 215
    + (perSlotChain[slot] ?? 0) * 10
    + (perSlotDodgeCounter[slot] ?? 0) * 10
    + (perSlotQuickAssist[slot] ?? 0) * 20

  const perSlotBonus: number[] = []
  for (let i = 0; i < slotCount; i++) {
    let companion = 0
    for (let j = 0; j < slotCount; j++) {
      if (j === i) continue
      companion += ownReward(j) * 0.5
    }
    perSlotBonus.push(ownReward(i) + companion)
  }

  return {
    parry,
    chain,
    dodgeCounter,
    quickAssist,
    total: parry + chain + dodgeCounter + quickAssist,
    perSlotParry,
    perSlotChain,
    perSlotDodgeCounter,
    perSlotQuickAssist,
    perSlotBonus,
  }
}

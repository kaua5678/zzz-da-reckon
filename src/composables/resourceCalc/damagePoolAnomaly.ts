/**
 * 异常 / 附加伤害尾段 —— 自 `composables/resourceCalc/damagePool.ts#buildDamagePoolRows`
 * 的 :1142–1725 原样外提（CC-9a，2026-09-25，零行为搬迁）。
 *
 * 职责（一个域：**异常池产出行 + 角色专属附伤块**）：风属性异常事件（维琳娜风异放按轴内
 * 非风触发占比拆段）/ 乱流 / 紊乱明细 / 按元素异常累积（虚拟面板 + 按触发者分摊结算），
 * 以及角色专属异常附加行的**派发点**（按模块能力 `extraAnomalyRows` 收集分组、稳定排序后展开）
 * 与仍内联的 1581 蕾米埃尔耀变/特殊虚耀。柏妮思 C6 灼烧迸发已于 CC-19a（2026-09-26）、
 * 1401 极性强击/爱丽丝 C6 决胜附伤/爱丽丝畏缩 DOT 与 1261 简 C6 已于 CC-19b（2026-09-26）
 * 迁进各角色模块的 `extraAnomalyRows`。
 *
 * 与外层闭包的通信面 = `AnomalyRowsEnv`：共享输出数组 `rows`（**按原顺序 push，禁止换成
 * 返回值拼接**）+ `ctx` 快照 + 只读局部量/闭包（`agentName` / `enemyDamageRes` / `isAxis` /
 * `windSlot` / 三个轴内占比函数 / `axisStunFor` / `pushRelease`）。函数**不** import
 * `./damagePool`（只 `import type` `DamagePoolContext`，运行时无环），也不写任何外层可变量——
 * `pushRelease` 自带闭包写共享 `rows`，其余全是只读查询。
 *
 * 依赖方向：本文件不得 import `./damagePool`（值）；只依赖类型与同目录兄弟模块
 * （`./anomalyPanels` / `./skillRows` / `./helpers`）与引擎子模块（`@/core/damage` 等）。
 */
import { calcAnomalyDamage } from '@/core/damage'
import { panelAt } from '@/core/panel'
import { ANOMALY_SINGLE_HIT_MULTIPLIER, STANDARD_DOT_CONFIG, resolveStatElement } from '@/core/anomalyPool/helpers'
import { fmt } from '@/utils/format'
import type { PanelValues } from '@/types/catalog'
import type { AnomalyEventExecution } from '@/types/resource'
import { elementLabel, parseReleaseMultiplier, type DamagePoolRow } from './helpers'
// 异常面板簇（D 簇）与招式行取值簇（C 簇）：同目录兄弟模块直接指真实现。
import {
  buildAnomalyVirtualPanel,
  buildAnomalySettlementEntries,
  getTeamAnomalyDurationBonus,
  getRemielleLevelValue,
  remielleSpecialVoidflareCount,
  calcVoidflareDamage,
  findSlotByIdentity,
} from './anomalyPanels'
import { findMoveById } from './skillRows'
import { getAgentMechanic } from '@/mechanics'
import type { ExtraAnomalyRowGroup } from '@/mechanics'
// 纯类型：运行时被擦除，与 damagePool.ts 的 `emitAnomalyRows` 值导入不构成运行时环。
import type { DamagePoolContext } from './damagePool'

/**
 * 「排序 + 展开」纯函数（CC-19a，设计稿 §4）：按 order 稳定升序排序后拼接各分组的 rows。
 * `Array.prototype.sort` 自 ES2019 起稳定，故同 order 保持入队顺序（= 队伍槽位顺序）。
 */
export function flattenAnomalyRowGroups(groups: ExtraAnomalyRowGroup[]): DamagePoolRow[] {
  return [...groups].sort((a, b) => a.order - b.order).flatMap(g => g.rows)
}

/** 尾段外提的显式环境：把原 `buildDamagePoolRows` 里被尾段读取的闭包量显式化（调用期间不变）。 */
export interface AnomalyRowsEnv {
  ctx: DamagePoolContext
  /** 共享输出数组：按原顺序 push，禁止换成返回值拼接 */
  rows: DamagePoolRow[]
  agentName: (agentId: string, slot: number) => string
  /** 类型照原局部量推断结果写（`damageResistances ?? resistances ?? {}`） */
  enemyDamageRes: Record<string, number>
  /** 调用处传 `Boolean(isAxis)`（尾段只作真值判断） */
  isAxis: boolean
  windSlot: number
  inWindowFraction: (element: string) => number
  nonWindInAxisFraction: () => number
  ultimateInAxisFraction: (slot?: number) => number
  /** 原 `buildDamagePoolRows` 闭包：伴随事件易伤 0/1（非轴回落全局覆盖率） */
  axisStunFor: (moveId: string) => number
  /** 原 `buildDamagePoolRows` 闭包：异放行结算并 push 进共享 `rows` */
  pushRelease: (row: { id: string; slot: number; agentId: string; name: string; count: number; multiplier: number; source: string; note?: string; element?: string; panel?: PanelValues; settlementPanel?: PanelValues; releaseCrit?: AnomalyEventExecution['releaseCrit']; stunnedOverride?: number }) => void
}

/**
 * 异常 / 附加伤害尾段（零行为搬迁，CC-9a）。
 * 函数体 = 原 `buildDamagePoolRows` :1142–1725 逐字保留（仅去 2 空格公共缩进），
 * 只在头部解构 `env.ctx` 与 `env` 局部量；其余表达式一字不改。
 */
export function emitAnomalyRows(env: AnomalyRowsEnv): void {
  const {
    configStore, catalogStore,
    adjustedResourceResult, damagePanels, stunCoverage, axisAllocation: allocMap,
    anomalyPoolResult,
    remielleEntryPanels, remielleAnomalyMultiplier,
  } = env.ctx
  const {
    rows, agentName, enemyDamageRes, isAxis, windSlot,
    inWindowFraction, nonWindInAxisFraction, ultimateInAxisFraction,
    axisStunFor, pushRelease,
  } = env
  const windChar = windSlot >= 0 ? configStore.team[windSlot] : null
  const windAgentId = windChar?.agentId ?? ''
  const windRate = anomalyPoolResult?.coverage?.windCoverageRate ?? 0

  for (const event of anomalyPoolResult?.anomalyEvents ?? []) {
    if (event.count <= 0 || windSlot < 0 || !windAgentId) continue
    if (event.type === 'release' && event.id.includes('velina-corrosion')) {
      // 风异放（微域145%/广域255%）随乱流触发：失衡轴内按「轴内非风异常触发占比」拆
      // in/out 两段（轴内异常触发→轴内乱流→轴内风异放，用户口径 2026-08）；非轴保持全局覆盖率
      const total = Math.floor(event.count)
      if (!isAxis) {
        pushRelease({
          id: `pool-release-${event.id}`,
          slot: windSlot,
          agentId: windAgentId,
          name: event.label,
          count: total,
          multiplier: parseReleaseMultiplier(event),
          source: event.source,
          note: event.note,
        })
        continue
      }
      const frac = nonWindInAxisFraction()
      const inCount = Math.min(total, Math.round(total * frac))
      const outCount = total - inCount
      if (inCount > 0) {
        pushRelease({
          id: `pool-release-${event.id}-in`,
          slot: windSlot,
          agentId: windAgentId,
          name: event.label,
          count: inCount,
          multiplier: parseReleaseMultiplier(event),
          source: event.source,
          note: `${event.note}；失衡内·全额失衡易伤`,
          stunnedOverride: 1,
        })
      }
      if (outCount > 0) {
        pushRelease({
          id: `pool-release-${event.id}-out`,
          slot: windSlot,
          agentId: windAgentId,
          name: event.label,
          count: outCount,
          multiplier: parseReleaseMultiplier(event),
          source: event.source,
          note: `${event.note}；轴外·无易伤`,
          stunnedOverride: 0,
        })
      }
    }
  }

  for (const detail of anomalyPoolResult?.turbulenceDamage?.details ?? []) {
    const applierAgentId = configStore.team[detail.applierSlot]?.agentId ?? ''
    rows.push({
      id: `turbulence-${detail.element}-${detail.applierSlot}`,
      slot: windSlot >= 0 ? windSlot : 0,
      agentId: windAgentId,
      agentName: windAgentId ? agentName(windAgentId, windSlot) : '风属性角色',
      type: '乱流',
      name: `${elementLabel(detail.element)}乱流`,
      element: detail.element,
      source: `${agentName(applierAgentId, detail.applierSlot)} 的${elementLabel(detail.element)}异常基础区`,
      count: detail.count ?? 0,
      perDamage: (detail.count ?? 0) > 0 ? detail.damage / (detail.count ?? 1) : detail.damage,
      totalDamage: detail.damage,
      multiplier: detail.turbulenceMultiplier,
      note: `T=${detail.remainingTime}s，倍率=${detail.turbulenceMultiplier}%${detail.boostedCount ? `，其中${detail.boostedCount}次吃风蚀+150%倍率` : ''}`,
    })
  }

  // ---- 紊乱伤害（入池，不再单独从 totalDamageWithDisorder 累加） ----
  for (const detail of anomalyPoolResult?.disorderDamage?.details ?? []) {
    if (detail.damage <= 0 || detail.events <= 0) continue
    const triggerAgentId = configStore.team[detail.triggerSlot]?.agentId ?? ''
    const applierAgentId = configStore.team[detail.applierSlot]?.agentId ?? ''
    rows.push({
      id: `disorder-${detail.element}-${detail.applierSlot}-${detail.triggerSlot}`,
      slot: detail.triggerSlot,
      agentId: triggerAgentId,
      agentName: agentName(triggerAgentId, detail.triggerSlot),
      type: '紊乱',
      name: `紊乱（覆盖${elementLabel(detail.element)}）`,
      element: detail.element,
      source: `${agentName(applierAgentId, detail.applierSlot)} 的${elementLabel(detail.element)}异常被${agentName(triggerAgentId, detail.triggerSlot)}覆盖`,
      count: detail.events,
      perDamage: detail.perEventDamage,
      totalDamage: detail.damage,
      multiplier: detail.disorderMultiplier,
      note: `T=${detail.remainingTime}s，倍率=${detail.disorderMultiplier}%，anomalyMass=${detail.anomalyMass}，settlement=${detail.settlementMultiplier}`,
    })
  }

  const anomalyDamageSpecs: Record<string, {
    label: string
    perTick?: number
    tickInterval?: number
    baseTicks?: number
    single?: number
    baseFormula: string
  }> = {
    // 数值来源统一引 core/anomalyPool/helpers（规则 11）：DoT 三项取 STANDARD_DOT_CONFIG，
    // 单次倍率取 ANOMALY_SINGLE_HIT_MULTIPLIER；baseFormula 改插值，渲染结果与原字面量逐字相同。
    fire: {
      label: '灼烧',
      perTick: STANDARD_DOT_CONFIG.fire.tickMultiplier,
      tickInterval: STANDARD_DOT_CONFIG.fire.tickInterval,
      baseTicks: STANDARD_DOT_CONFIG.fire.totalTicks,
      baseFormula: `灼烧基础 ${STANDARD_DOT_CONFIG.fire.tickMultiplier}% × ${STANDARD_DOT_CONFIG.fire.totalTicks} tick（10秒/${STANDARD_DOT_CONFIG.fire.tickInterval}秒）`,
    },
    electric: {
      label: '感电',
      perTick: STANDARD_DOT_CONFIG.electric.tickMultiplier,
      tickInterval: STANDARD_DOT_CONFIG.electric.tickInterval,
      baseTicks: STANDARD_DOT_CONFIG.electric.totalTicks,
      baseFormula: `感电基础 ${STANDARD_DOT_CONFIG.electric.tickMultiplier}% × ${STANDARD_DOT_CONFIG.electric.totalTicks} tick`,
    },
    ether: {
      label: '侵蚀',
      perTick: STANDARD_DOT_CONFIG.ether.tickMultiplier,
      tickInterval: STANDARD_DOT_CONFIG.ether.tickInterval,
      baseTicks: STANDARD_DOT_CONFIG.ether.totalTicks,
      baseFormula: `侵蚀基础 ${STANDARD_DOT_CONFIG.ether.tickMultiplier}% × ${STANDARD_DOT_CONFIG.ether.totalTicks} tick（10秒/${STANDARD_DOT_CONFIG.ether.tickInterval}秒）`,
    },
    physical: { label: '强击', single: ANOMALY_SINGLE_HIT_MULTIPLIER.physical, baseFormula: `强击 ${ANOMALY_SINGLE_HIT_MULTIPLIER.physical}% 单次` },
    ice: { label: '碎冰', single: ANOMALY_SINGLE_HIT_MULTIPLIER.ice, baseFormula: `碎冰 ${ANOMALY_SINGLE_HIT_MULTIPLIER.ice}% 单次（冻结次数=碎冰次数）` },
    wind: { label: '风化', single: ANOMALY_SINGLE_HIT_MULTIPLIER.wind, baseFormula: `风化 ${ANOMALY_SINGLE_HIT_MULTIPLIER.wind}% 单次` },
  }
  // 风化窗口内的火/电/以太 DoT 与冰冻结类不生效，按 (1 - windRate) 折算；
  // 强击、极性强击这类事件伤害仍可触发，因此保留 physical/physical_polar_assault/wind 全额次数。
  const windBlockedAnomalyElements = new Set(['fire', 'electric', 'ether', 'ice'])
  for (const prog of anomalyPoolResult?.perElement ?? []) {
    const spec = anomalyDamageSpecs[prog.element]
    if (!spec || prog.triggerCount <= 0) continue
    const effectiveTriggerCount = windBlockedAnomalyElements.has(prog.element)
      ? prog.triggerCount * (1 - windRate)
      : prog.triggerCount
    if (effectiveTriggerCount <= 0) continue
    const build = buildAnomalyVirtualPanel(prog, damagePanels, configStore, catalogStore)
    if (!build) continue

    const durationBonus = getTeamAnomalyDurationBonus(configStore, catalogStore, prog.element)
    let multiplier = spec.single ?? 0
    let formula = spec.baseFormula
    if (!spec.single && spec.perTick && spec.tickInterval && spec.baseTicks) {
      const ticks = spec.baseTicks + (spec.tickInterval > 0 ? Math.round(durationBonus / spec.tickInterval) : 0)
      multiplier = spec.perTick * ticks
      formula = `${spec.perTick}% × ${ticks} tick${durationBonus > 0 ? `（含${durationBonus}秒延长）` : ''}`
    }

    // 维琳娜6命：对风化状态敌人再次施加风化，按平均剩余时长给风化事件增伤（每1s +2.5%，上限40%）
    if (prog.element === 'wind') {
      const windPanel = panelAt(damagePanels, windSlot)
      const velinaC6 = (windPanel as any)?.velinaCinema6 ?? 0
      const windCount = prog.triggerCount
      if (velinaC6 && windCount > 1) {
        const avgRemaining = (30 * (windCount - 1) / windCount) / 2
        const c6BonusPct = Math.min(40, 2.5 * avgRemaining)
        multiplier *= (1 + c6BonusPct / 100)
        formula += ` · 6命风化期望+${c6BonusPct.toFixed(1)}%（平均剩余${avgRemaining.toFixed(1)}s）`
      }
    }

    // 按触发者分摊结算：每人用自己的面板独立结算
    const settlementEntries = buildAnomalySettlementEntries(build, damagePanels, effectiveTriggerCount, configStore, catalogStore)

    for (const entry of settlementEntries) {
      if (entry.triggerCount <= 0) continue
      const result = calcAnomalyDamage({
        panel: build.panel,
        settlementPanel: entry.panel,
        baseMultiplier: multiplier,
        element: prog.element as any,
        enemyDefense: configStore.enemy.defense,
        enemyDefReduction: 0,
        enemyDefFlatReduction: 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes[resolveStatElement(prog.element) ?? ''] ?? 0,
        enemyResReduction: entry.panel?.enemyResReduction ?? 0,
        stunned: stunCoverage,
        stunMultiplier: configStore.enemy.stunVuln,
        critMode: 'expect',
        damageKind: 'anomaly',
        anomalyMultiplier: remielleAnomalyMultiplier,
      })

      const perDamage = result.damage
      const totalDamage = perDamage * entry.triggerCount
      const noteParts = [`${formula}`]
      if (settlementEntries.length > 1) {
        noteParts.push(`${entry.name}结算 · 积蓄占比${(entry.share*100).toFixed(0)}% · ${entry.triggerCount}次`)
      }
      rows.push({
        id: `anomaly-damage-${prog.element}-${entry.slot}`,
        slot: entry.slot,
        agentId: configStore.team[entry.slot]?.agentId ?? '',
        agentName: agentName(configStore.team[entry.slot]?.agentId ?? '', entry.slot),
        type: spec.label as DamagePoolRow['type'],
        name: settlementEntries.length > 1
          ? `${spec.label}（${elementLabel(prog.element)}·${entry.name}结算）`
          : `${spec.label}（${elementLabel(prog.element)}虚拟面板）`,
        element: prog.element,
        source: `属性异常${settlementEntries.length > 1 ? '按积蓄占比分摊' : '虚拟面板'}结算`,
        count: entry.triggerCount,
        perDamage,
        totalDamage,
        multiplier,
        note: noteParts.join(' · '),
      })
    }
  }

  // 角色专属异常附加行（CC-19a 2026-09-26，设计稿 docs/mcp-cc19-extra-anomaly-rows.md §2）：
  // 柏妮思 C6 灼烧迸发已迁进 `burnice.ts#extraAnomalyRows`；派发点放在原块 1 的位置，只放一次。
  // 返回分组，跨全队按 order 稳定排序后展开（rowsnap 按行顺序求哈希，故禁止改块序）。
  const extraGroups: ExtraAnomalyRowGroup[] = []
  configStore.team.forEach((char, slot) => {
    const groups = char?.agentId
      ? getAgentMechanic(char.agentId)?.extraAnomalyRows?.({
        slot,
        charResult: adjustedResourceResult?.characters.find(c => c.slot === slot),
        windRate,
        anomalyProgress: (el) => anomalyPoolResult?.perElement.find(prog => prog.element === el),
        buildVirtualPanel: (prog) => buildAnomalyVirtualPanel(prog, damagePanels, configStore, catalogStore),
        buildSettlementEntries: (build, count) => buildAnomalySettlementEntries(build, damagePanels, count, configStore, catalogStore),
        axisStunFor,
        enemy: configStore.enemy,
        enemyDamageRes,
        anomalyMultiplier: remielleAnomalyMultiplier,
        teamAgentId: (s) => configStore.team[s]?.agentId ?? '',
        agentName,
        panel: panelAt(damagePanels, slot),
        cinemaLevel: configStore.team[slot]?.cinemaLevel ?? 0,
        isAxis,
        stunCoverage,
        inWindowFraction,
        ultimateInAxisFraction,
        axisInUnits: (key) => allocMap[key]?.inAxisUnits ?? 0,
        getMechanicSetting: (k, d) => configStore.getMechanicSetting(k, d),
        anomalyPool: anomalyPoolResult,
      })
      : undefined
    if (groups) extraGroups.push(...groups)
  })
  for (const r of flattenAnomalyRowGroups(extraGroups)) rows.push(r)

  const remielleSlot = findSlotByIdentity(configStore, catalogStore, ['1581'])
  const remiellePanel = remielleSlot >= 0 ? panelAt(damagePanels, remielleSlot) : undefined
  const remielleEntryPanel = remielleSlot >= 0 ? panelAt(remielleEntryPanels, remielleSlot) : undefined
  if (remiellePanel && remielleEntryPanel) {
    const remielleSkills = catalogStore.agentSkillsByAgentMap.get(configStore.team[remielleSlot]?.agentId ?? '')
    const otherSlots = [0, 1, 2].filter(slot => slot !== remielleSlot)
    const perSlotAnomaly = anomalyPoolResult?.perSlotAnomalyTriggers ?? []
    const voidflareBySlot = otherSlots
      .map(slot => ({
        slot,
        count: Math.max(0, Math.floor(perSlotAnomaly[slot] ?? 0)),
        element: catalogStore.agentsMap.get(configStore.team[slot]?.agentId ?? '')?.damageElement ?? 'physical',
        panel: panelAt(damagePanels, slot),
      }))
      .filter(item => item.count > 0 && item.panel)
    const voidflareTotal = voidflareBySlot.reduce((sum, item) => sum + item.count, 0)

    if (voidflareTotal > 0 && remielleSkills) {
      const skillLevelBonus = remiellePanel.skillLevelBonus ?? 0
      const c1ResIgnore = (remiellePanel.remielleCinema1SpecialVoidflareCount ?? 0) > 0 ? 50 : 0
      const c6LuminizeMultiplier = 1 + Math.max(0, remiellePanel.remielleCinema6LuminizeTriggerMultiplier ?? 0)
      const qBatches = Math.floor(voidflareTotal / 3)
      const firstOtherSlot = otherSlots[0]
      const secondOtherSlot = otherSlots[1]
      const firstPerBatch = otherSlots.length === 1
        ? 3
        : Math.max(0, Math.min(3, Math.floor(configStore.getTeamMechanicSetting(`remielle.q:${remielleSlot}`, 1))))
      const secondPerBatch = Math.max(0, 3 - firstPerBatch)
      const qCountBySlot: Record<string, number> = {}
      if (otherSlots.length === 1) {
        qCountBySlot[String(firstOtherSlot)] = qBatches * 3
      } else {
        qCountBySlot[String(firstOtherSlot)] = qBatches * firstPerBatch
        qCountBySlot[String(secondOtherSlot)] = qBatches * secondPerBatch
      }
      const actionRows = [
        {
          id: 'remielle-luminize-assist',
          name: '支援技花羽轮舞·耀变',
          moveId: '1581015',
          countsBySlot: Object.fromEntries(voidflareBySlot.map(item => [item.slot, item.count])),
        },
        {
          id: 'remielle-luminize-ultimate',
          name: '终结技缭乱终幕·耀变',
          moveId: '1581016',
          countsBySlot: qCountBySlot,
        },
        {
          id: 'remielle-luminize-basic',
          name: '普通攻击惊鸿·耀变',
          moveId: '1581008',
          countsBySlot: Object.fromEntries(voidflareBySlot.map(item => [item.slot, item.count * c6LuminizeMultiplier])),
        },
      ]

      for (const action of actionRows) {
        const move = findMoveById(remielleSkills, action.moveId)
        const luminizeRow = move?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
        const multiplier = getRemielleLevelValue(luminizeRow, skillLevelBonus)
        if (multiplier <= 0) continue
        const actionCount = Object.values(action.countsBySlot).reduce((a, b) => a + b, 0)
        if (actionCount <= 0) continue

        for (const item of voidflareBySlot) {
          const count = action.countsBySlot[String(item.slot)] ?? 0
          if (count <= 0 || !item.panel) continue
          const result = calcVoidflareDamage({
            sourcePanel: item.panel,
            remiellePanel,
            multiplier,
            element: item.element,
            enemyDefense: configStore.enemy.defense,
            enemyResistances: enemyDamageRes,
            stunMultiplier: configStore.enemy.stunVuln,
            stunned: stunCoverage,
            cinema1ResIgnore: c1ResIgnore,
          })
          rows.push({
            id: `${action.id}-${item.slot}`,
            slot: remielleSlot,
            agentId: configStore.team[remielleSlot]?.agentId ?? '',
            agentName: agentName(configStore.team[remielleSlot]?.agentId ?? '', remielleSlot),
            type: '耀变',
            name: action.name,
            element: item.element,
            source: `${agentName(configStore.team[item.slot]?.agentId ?? '', item.slot)} 的${elementLabel(item.element)}异常虚耀`,
            count,
            perDamage: result.damage,
            totalDamage: result.damage * count,
            note: `来源虚耀 ${count} 次 · ${result.formula}`,
          })
        }
      }

      const specialCount = remielleSpecialVoidflareCount(remiellePanel)
      if (specialCount > 0) {
        const rainbowMove = findMoveById(remielleSkills, '1581007')
        const rainbowLuminizeRow = rainbowMove?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
        const rainbowMultiplier = getRemielleLevelValue(rainbowLuminizeRow, skillLevelBonus)
        const specialMultiplier = rainbowMultiplier * 2.5
        if (specialMultiplier > 0) {
          const result = calcVoidflareDamage({
            sourcePanel: remielleEntryPanel,
            remiellePanel: remielleEntryPanel,
            multiplier: specialMultiplier,
            element: 'lumiflux',
            enemyDefense: configStore.enemy.defense,
            enemyResistances: enemyDamageRes,
            stunMultiplier: configStore.enemy.stunVuln,
            stunned: stunCoverage,
            cinema1ResIgnore: c1ResIgnore,
          })
          rows.push({
            id: 'remielle-special-voidflare',
            slot: remielleSlot,
            agentId: configStore.team[remielleSlot]?.agentId ?? '',
            agentName: agentName(configStore.team[remielleSlot]?.agentId ?? '', remielleSlot),
            type: '特殊虚耀',
            name: '普通攻击垂虹·特殊虚耀',
            element: 'lumiflux',
            source: '蕾米进场记录面板 × 2.5 特殊独立乘区',
            count: specialCount,
            perDamage: result.damage,
            totalDamage: result.damage * specialCount,
            note: `垂虹倍率 ${fmt(rainbowMultiplier)}% × 2.5 · ${result.formula}`,
          })
        }
      }
    }
  }
}

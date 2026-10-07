/**
 * 异常 / 附加伤害尾段 —— 自 `composables/resourceCalc/damagePool.ts#buildDamagePoolRows`
 * 的 :1142–1725 原样外提（CC-9a，2026-09-25，零行为搬迁）。
 *
 * 职责（一个域：**异常池产出行 + 角色专属附伤块**）：风属性异常事件（维琳娜风异放按轴内
 * 非风触发占比拆段）/ 乱流 / 紊乱明细 / 按元素异常累积（虚拟面板 + 按触发者分摊结算），
 * 以及角色专属异常附加行的**派发点**（按模块能力 `extraAnomalyRows` 收集分组、稳定排序后展开）。
 * 各角色块已全部迁进各自模块：柏妮思 C6 灼烧迸发已于 CC-19a（2026-09-26）、
 * 1401 极性强击/爱丽丝 C6 决胜附伤/爱丽丝畏缩 DOT 与 1261 简 C6 已于 CC-19b（2026-09-26）、
 * 1581 蕾米埃尔耀变/特殊虚耀已于 CC-19c（2026-09-26）迁进 `extraAnomalyRows`。
 * 本文件不再有内联角色块；派发点是异常尾段唯一的角色出口。
 *
 * 与外层闭包的通信面 = `AnomalyRowsEnv`：共享输出数组 `rows`（**按原顺序 push，禁止换成
 * 返回值拼接**）+ `ctx` 快照 + 只读局部量/闭包（`agentName` / `enemyDamageRes` / `isAxis` /
 * 三个轴内占比函数 / `axisStunFor` / `pushRelease`）。函数**不** import
 * `./damagePool`（只 `import type` `DamagePoolContext`，运行时无环），也不写任何外层可变量——
 * `pushRelease` 自带闭包写共享 `rows`，其余全是只读查询。
 *
 * 依赖方向：本文件不得 import `./damagePool`（值）；只依赖类型与同目录兄弟模块
 * （`./anomalyPanels` / `./skillRows` / `./helpers`）与引擎子模块（`@/core/damage` 等）。
 */
import { calcPoolAnomalyDamage, calcPoolDirectDamage, type PoolDamageEnv } from './poolDamage'
import { panelAt } from '@/core/panel'
import { ANOMALY_SINGLE_HIT_MULTIPLIER, STANDARD_ANOMALY_LABEL, isCorrosionCycloneRelease, standardDot, windEffectiveTriggerCount } from '@/core/anomalyPool/helpers'
import { corrosionOwner } from '@/core/anomalyPool/corrosion'
import { elementLabel, parseReleaseMultiplier, type DamagePoolRow } from './helpers'
// 异常面板簇（D 簇）与招式行取值簇（C 簇）：同目录兄弟模块直接指真实现。
import {
  buildAnomalyVirtualPanel,
  buildAnomalySettlementEntries,
  getTeamAnomalyDurationBonus,
} from './anomalyPanels'
import { getAgentMechanic, teamMechanicSlots } from '@/mechanics'
import type { ExtraAnomalyRowGroup } from '@/mechanics'
// 纯类型：运行时被擦除，与 damagePool.ts 的 `emitAnomalyRows` 值导入不构成运行时环。
import type { DamagePoolContext } from './damagePool'
import type { ReleaseRowInput } from './damagePoolDirect'

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
  /** CC-176/177：伤害入参拼装环境（= damagePool.ts 的 poolEnv），经 `ExtraAnomalyRowsInput.directDamage` / `.anomalyDamage` 交给模块 */
  poolEnv: PoolDamageEnv
  inWindowFraction: (element: string) => number
  nonWindInAxisFraction: () => number
  ultimateInAxisFraction: (slot?: number) => number
  /** 原 `buildDamagePoolRows` 闭包：伴随事件易伤 0/1（非轴回落全局覆盖率） */
  axisStunFor: (moveId: string) => number
  /** 原 `buildDamagePoolRows` 闭包：异放行结算并 push 进共享 `rows` */
  pushRelease: (row: ReleaseRowInput) => void
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
    entrySnapshotPanels, globalAnomalyMultiplier,
  } = env.ctx
  const {
    rows, agentName, enemyDamageRes, isAxis, poolEnv,
    inWindowFraction, nonWindInAxisFraction, ultimateInAxisFraction,
    axisStunFor, pushRelease,
  } = env
  const windRate = anomalyPoolResult?.coverage?.windCoverageRate ?? 0
  const teamMechanics = teamMechanicSlots(configStore.team)
  // r711：气旋异放是风蚀持有者（维琳娜）的专属产出 ⇒ 归属取事件产出者的槽位（与事件生产同一判定 `corrosionOwner`），
  // 面板随槽位走。原取「第一个风属性槽」：双风队维琳娜排在洛克茜 / 赛维里安之后时，行挂到对方名下、用对方面板结算。
  const cycloneSlot = corrosionOwner(teamMechanics)?.slot ?? -1
  const cycloneAgentId = configStore.team[cycloneSlot]?.agentId ?? ''

  for (const event of anomalyPoolResult?.anomalyEvents ?? []) {
    if (event.count <= 0 || !cycloneAgentId) continue
    if (isCorrosionCycloneRelease(event)) { // CC-69：原写死事件 id 子串
      // 风异放（微域145%/广域255%）随乱流触发：失衡轴内按「轴内非风异常触发占比」拆
      // in/out 两段（轴内异常触发→轴内乱流→轴内风异放，用户口径 2026-08）；非轴保持全局覆盖率
      const total = Math.floor(event.count)
      if (!isAxis) {
        pushRelease({
          id: `pool-release-${event.id}`,
          slot: cycloneSlot,
          agentId: cycloneAgentId,
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
          slot: cycloneSlot,
          agentId: cycloneAgentId,
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
          slot: cycloneSlot,
          agentId: cycloneAgentId,
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

  // 乱流行归属 = 引擎乱流结算槽 `damageInputs.turbulence.windSlot`（`calcTurbulenceDamage` 用它取结算面板）——
  // 行归属与结算面板同源，本层不再另判风槽（r712）。有乱流明细 ⇒ 必有该入参，`?? 0` 只为类型收窄。
  const turbulenceSlot = anomalyPoolResult?.damageInputs.turbulence?.windSlot ?? 0
  const turbulenceAgentId = configStore.team[turbulenceSlot]?.agentId ?? ''
  for (const detail of anomalyPoolResult?.turbulenceDamage?.details ?? []) {
    const applierAgentId = configStore.team[detail.applierSlot]?.agentId ?? ''
    rows.push({
      id: `turbulence-${detail.element}-${detail.applierSlot}`,
      slot: turbulenceSlot,
      agentId: turbulenceAgentId,
      agentName: agentName(turbulenceAgentId, turbulenceSlot),
      type: '乱流',
      name: `${elementLabel(detail.element)}乱流`,
      element: detail.element,
      source: `${agentName(applierAgentId, detail.applierSlot)} 的${elementLabel(detail.element)}异常基础区`,
      count: detail.count,
      perDamage: detail.count > 0 ? detail.damage / detail.count : detail.damage,
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

  // 标准异常：名字、DoT 跳数与单次倍率都取 core/anomalyPool/helpers（规则 11；与结果页事件同源）。
  // 风化窗口内 DoT 与冻结不结算、强击照常：规则单源 `windEffectiveTriggerCount`（core/anomalyPool/helpers）
  for (const prog of anomalyPoolResult?.perElement ?? []) {
    const label = STANDARD_ANOMALY_LABEL[prog.element]
    if (!label || prog.triggerCount <= 0) continue
    const effectiveTriggerCount = windEffectiveTriggerCount(prog.element, prog.triggerCount, windRate)
    if (effectiveTriggerCount <= 0) continue
    const build = buildAnomalyVirtualPanel(prog, damagePanels, configStore, catalogStore)
    if (!build) continue

    const durationBonus = getTeamAnomalyDurationBonus(configStore, catalogStore, prog.element)
    const dot = standardDot(prog.element, durationBonus)
    let multiplier = dot ? dot.tickMultiplier * dot.ticks : ANOMALY_SINGLE_HIT_MULTIPLIER[prog.element]
    let formula = dot
      ? `${dot.tickMultiplier}% × ${dot.ticks} tick${durationBonus > 0 ? `（含${durationBonus}秒延长）` : ''}`
      : `${label} ${multiplier}% 单次${prog.element === 'ice' ? '（冻结次数=碎冰次数）' : ''}`

    // 风化事件倍率加成：派发给挂出 `windAnomalyBonus` 能力的在队模块（CC-36b 2026-09-27；现为维琳娜 6 命），面板取该模块
    // 自己的槽。r711：原按「第一个风属性槽」派发（当时队里至多一个风角色）⇒ 双风队维琳娜排后时加成整个丢失。
    if (prog.element === 'wind') {
      const owner = teamMechanics.find(m => m.module.windAnomalyBonus)
      const bonus = owner?.module.windAnomalyBonus?.({ panel: panelAt(damagePanels, owner.slot), triggerCount: prog.triggerCount }) ?? null
      if (bonus) {
        multiplier *= (1 + bonus.pct / 100)
        formula += bonus.note
      }
    }

    // 按触发者分摊结算：每人用自己的面板独立结算
    const settlementEntries = buildAnomalySettlementEntries(build, damagePanels, effectiveTriggerCount, configStore, catalogStore)

    for (const entry of settlementEntries) {
      if (entry.triggerCount <= 0) continue
      // 结算面板减防减抗由 calcAnomalyDamage 内部读取（CC-175）；标准异常没有面板外额外量
      const result = calcPoolAnomalyDamage(poolEnv, {
        panel: build.panel,
        settlementPanel: entry.panel,
        baseMultiplier: multiplier,
        element: prog.element,
        stunned: stunCoverage,
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
        type: label,
        name: settlementEntries.length > 1
          ? `${label}（${elementLabel(prog.element)}·${entry.name}结算）`
          : `${label}（${elementLabel(prog.element)}虚拟面板）`,
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
        anomalyMultiplier: globalAnomalyMultiplier,
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
        entryPanel: panelAt(entrySnapshotPanels, slot),
        skills: catalogStore.agentSkillsByAgentMap.get(configStore.team[slot]?.agentId ?? ''),
        panelOf: (s) => panelAt(damagePanels, s),
        teamElement: (s) => catalogStore.agentsMap.get(configStore.team[s]?.agentId ?? '')?.damageElement ?? 'physical',
        getTeamMechanicSetting: (k, d) => configStore.getTeamMechanicSetting(k, d),
        elementLabel,
        directDamage: (row) => calcPoolDirectDamage(poolEnv, row),
        anomalyDamage: (row) => calcPoolAnomalyDamage(poolEnv, row),
      })
      : undefined
    if (groups) extraGroups.push(...groups)
  })
  for (const r of flattenAnomalyRowGroups(extraGroups)) rows.push(r)
}

/**
 * 伤害池行构建（从 useResourceCalc 抽离的纯函数；快照式入参，无 store/computed 依赖）。
 *
 * 职责：按角色/事件把执行计划拆成 直伤/异放/乱流/紊乱/灼烧感电侵蚀强击碎冰 等展示行——
 *  · 直伤行：resolveExecutionDamage 元素覆盖 → 轴内/轴外易伤拆分（捏轴认领、CD 自动行占比、
 *    诺姆赠送连携、希希芙毒素爆发、雨果/叶瞬光特判、技能表直读兜底）；
 *  · 异放/极性紊乱：Boss 异常状态轴归因（逐窗状态链取样）+ 失衡内占比拆段；
 *  · 异常 DoT：虚拟面板 + 按触发者分摊结算；角色专属直伤块（柏妮思余烬/琉音强特拆分/
 *    般岳影画6附伤等）也在本文件。
 *
 * 依赖注入：全部输入经 DamagePoolContext 快照传入（computed 在 useResourceCalc 侧解包），
 * computeWindowDuration 为例外（需要 configStore 实时窗口时长，函数注入保持单一职责）。
 */
import { calcDirectDamage, calcAnomalyDamage, resolveSpecialDamageProfile } from '@/core/damage'
// 面板数组按位置压缩（下标 ≠ 槽位号）⇒ 一律 panelAt 按身份取，不用 damagePanels[slot]（见 core/panel.ts）。
import { panelAt } from '@/core/panel'
import { ANOMALY_SINGLE_HIT_MULTIPLIER, getBaseElement, resolveStatElement } from '@/core/anomalyPool/helpers'
import { getAgentMechanic } from '@/mechanics'
import type { AgentAxisOverlays, AxisScalarOverlays } from '@/mechanics'
// 2026-09-16 round 17（R15-c）：`YESHUGUANG_FULL_STUN_MOVES` 与 `HUGO_FULL_STUN_MOVES` 的 import
// 已删——两处白名单判据迁进各自模块的 `stunOverrideForMove` 钩子。
// 2026-09-17 round 18（R15-d）：`veilStunMultiplier` 的 import 也已删——帷幕封顶算式整条迁进
// `yeshuguang.ts#applyPanel`（连面板阶段硬编码块一起），本文件对该角色**零 import**。
import type { TeamResourceResult, StunPoolResult, AnomalyPoolResult, InStunAnomalySummary } from '@/types/resource'
import type { BossAnomalyStateResult } from '@/core/stunAxis/inStunAnomaly'
import type { StunAxis } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import type { AnomalyEventExecution } from '@/types/resource'
import {
  parseReleaseMultiplier,
  safeElement,
  type DamagePoolRow,
} from './helpers'
// 异常面板簇（D 簇）已迁 `./anomalyPanels`（R22 熵批 2 / R22-S2 刀 C）——同目录兄弟模块
// 直接指真实现，不走 `./helpers` 的 re-export 壳（壳只服务目录外的既有消费者面）。
// CC-9a：尾段已外提 `./damagePoolAnomaly`，本文件只剩 `getWindInfectionElement` 一个消费者。
import { getWindInfectionElement } from './anomalyPanels'
// 招式行取值簇（C 簇）已迁 `./skillRows`（R22 熵批 2 / R22-S2 刀 B）——同目录兄弟模块
// 直接指真实现，不走 `./helpers` 的 re-export 壳（壳只服务目录外的既有消费者面）。
// 面板/机制编排簇（B 簇）已迁 `./panelPhases`（R22 熵批 1 / T67-a1 刀 A）——同目录兄弟模块
// 直接指真实现，不走 `./helpers` 的 re-export 壳（壳只服务目录外的既有消费者面）。
// CC-9a（2026-09-25）：异常/附加伤害尾段（原 :1142–1725）已原样外提 `./damagePoolAnomaly.ts`。
import { emitAnomalyRows } from './damagePoolAnomaly'
// CC-9b（2026-09-25）：逐角色主循环三段（原 :423–671 / :672–927 / :928–1131）已原样外提。
import { emitCharDirectRows } from './damagePoolDirect'
import { emitCharReleaseRows } from './damagePoolRelease'
import { emitCharExtraRows } from './damagePoolCharExtras'
import type { CharRowsEnv, CharLocals } from './damagePoolDirect'

/** 伤害池构建入参：useResourceCalc 侧各 computed 的解包快照 */
export interface DamagePoolContext {
  configStore: ReturnType<typeof import('@/stores/config').useConfigStore>
  catalogStore: ReturnType<typeof import('@/stores/catalog').useCatalogStore>
  /** 转大修正后的资源池结果 */
  adjustedResourceResult: TeamResourceResult | null
  /** 结算面板（含霜寒/风化侵染盖章） */
  damagePanels: PanelValues[]
  /** 失衡易伤覆盖率（收敛值） */
  stunCoverage: number
  /** 轴内单位分配（栈遍历反推） */
  axisAllocation: Record<string, { slot: number; inAxisUnits: number }>
  /** 伴随事件易伤（child moveId → 0/1） */
  attachedInAxisMap: Record<string, number>
  anomalyPoolResult: AnomalyPoolResult | null
  inStunAnomalyState: InStunAnomalySummary | null
  bossAnomalyState: BossAnomalyStateResult | null
  stunPoolResult: StunPoolResult | null
  effectiveStunAxes: StunAxis[]
  /** 蕾米进场记录面板（特殊虚耀用） */
  entrySnapshotPanels: PanelValues[]
  /** 蕾米异化系数倍率（1 + (异化度+提升)/100） */
  globalAnomalyMultiplier: number
  /** 琉音转大收敛次数（余音直伤用） */
  ultPromoteCount: number
  agentNames: Record<string, string>
  autoActive: boolean
  stunAxisResult: unknown
  /**
   * 按**槽位**归属的轴窗口 overlay 原始返回（CC-17 2026-09-26）：
   * `slot → AgentAxisOverlays`（该槽模块 `axisWindowOverlays` 的原始返回，含 4 个 moveId 桶）。
   * 消费端（`directRowBonus`）只读**本行所属槽**的桶——旧的跨模块全局桶会把可琳扫除帮手
   * 泄漏给队友轴内 `basic_attack` 行（设计稿 `docs/mcp-cc17-axis-overlay-consume.md` §2）。
   */
  axisBucketsBySlot: Map<number, AgentAxisOverlays>
  /**
   * 按**槽位**索引的标量覆盖（非轴折算臂 + 与轴无关的标量臂；见 `AxisScalarOverlays`）。
   * 标量对全角色全部行同值，没有 moveId 可索引 ⇒ 必须按槽位键控，否则会泄漏给队友行。
   */
  axisScalarBySlot: Map<number, AxisScalarOverlays>
  /** 当前窗口时长（秒）：函数注入（读 configStore 失衡延时等实时口径） */
  computeWindowDuration: () => number
}

export function buildDamagePoolRows(ctx: DamagePoolContext): DamagePoolRow[] {

    const {
    configStore, catalogStore,
    adjustedResourceResult, damagePanels, stunCoverage, axisAllocation: allocMap, attachedInAxisMap: attachedInAxis,
    anomalyPoolResult, inStunAnomalyState,
    globalAnomalyMultiplier, agentNames, autoActive,
    stunAxisResult,
  } = ctx
  if (!adjustedResourceResult || damagePanels.length === 0) return []
    const rows: DamagePoolRow[] = []
    const enemyDamageRes = configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}
    const isAxis = (configStore.useStunAxis || autoActive) && stunAxisResult
    // 轴内涉及的槽位（有轴内动作的槽位）；其余槽位（如换了辅助、没进轴）走全局覆盖率「单独算」
    const axisSlots = new Set<number>()
    for (const a of Object.values(allocMap)) axisSlots.add(a.slot)
    // 记录已认领的轴内单位数，避免同 moveId 多行（如诺姆膛温换连携）重复认领
    const claimedInAxis: Record<string, number> = {}

    function agentName(agentId: string, slot: number) {
      return agentNames[agentId] || catalogStore.agentsMap.get(agentId)?.name?.zhCN || `槽${slot + 1}`
    }
    const infectionElement = getWindInfectionElement(configStore, catalogStore)
    const windSlot = configStore.team.findIndex(c => {
      const agent = c.agentId ? catalogStore.agentsMap.get(c.agentId) : null
      return agent?.damageElement === 'wind'
    })

    /** 把一个 (slot, moveId) 的总单位数切成轴内/轴外两段（轴外段无易伤） */
    function axisSplitFor(slot: number, moveId: string, totalUnits: number): { inUnits: number; outUnits: number } {
      if (!isAxis) return { inUnits: 0, outUnits: totalUnits }
      const key = `${slot}:${moveId === 'basic_attack' ? 'basic' : moveId}`
      const alloc = allocMap[key]
      if (!alloc || alloc.inAxisUnits <= 0) return { inUnits: 0, outUnits: totalUnits }
      const already = claimedInAxis[key] ?? 0
      const remainingIn = Math.max(0, alloc.inAxisUnits - already)
      const inUnits = Math.min(remainingIn, totalUnits)
      claimedInAxis[key] = already + inUnits
      return { inUnits, outUnits: totalUnits - inUnits }
    }

    /** 伴随事件易伤：非轴模式用全局覆盖率；轴模式跟随父动作是否完全落在窗口内（0/1） */
    function axisStunFor(moveId: string): number {
      if (!isAxis) return stunCoverage
      return attachedInAxis[moveId] ?? 0
    }

    // @fact engine:damage/减防通道 口径: 直伤与异放的防御区输入 = 面板通用 enemyDefReduction（妮可40%/叶瞬光C1 20%/席德C2 20%/伊芙琳C1/爱芮C2/千夏C1/音擎 千面日陨·索魂影眸…）+ 行级 moveId 限定 defIgnore（叶瞬光C2/C6/雨果C2/雅1命…），同字段加算；面板 enemyDefFlatReduction 进穿透值通道。异常质量区已由 calcAnomalyMass 读施加者面板，结算区不再补（双计） | 据 用户实测@2026-09-08（直伤角色偏低）+ docs/GAME_TERM_TO_CODE_FIELD.md §4·复核@2026-09-25·复核@2026-09-27 | 验 src/composables/__tests__/damagePoolDefDown.test.ts | 锚 src/composables/resourceCalc/damagePool.ts#pushDirect | 信 确认
    // @fact engine:damage/非轴失衡易伤 口径: 非轴模式（含 autoActive 未命中预设时的部署态）直伤行 stunned = 行级 stunOverride ?? 全局失衡覆盖率 stunCoverage（= min(1, 失衡次数×单窗/有效时长)，雨果决算截断另扣），生效倍率 = 1 + (Boss失衡易伤−1 + 面板失衡易伤加成/100) × 覆盖率；轴模式改为「轴内=1 / 轴外=0」分段，未进轴槽位回落覆盖率 | 据 探针实测@2026-09-10（部署态 1011/1141/1031 非轴 ×1.1923、雨果/琉音/莱特部署态加权信用 0.1966）+ docs/ENGINE_PIPELINE_GUIDE.md 坑37·复核@2026-09-25·复核@2026-09-27 | 验 src/composables/__tests__/nonAxisStunVulnProbe.test.ts + src/composables/__tests__/archiveStunVulnProbe.test.ts | 锚 src/composables/resourceCalc/damagePool.ts#pushDirect | 信 确认
    function pushDirect(row: {
      id: string; slot: number; agentId: string; name: string; element: string; source: string; count: number; multiplier: number; note?: string; skillDamageTarget?: any; moveId?: string; critRateBonus?: number; critDmgBonus?: number; dmgBonus?: number; sheerDmgBonus?: number; flatDamageBonus?: number; resIgnore?: number; basisValueOverride?: number; basisLabelOverride?: string; stunOverride?: number; defIgnore?: number; penRatioBonus?: number; sourceTag?: 'gift' | 'stun' | 'self'
    }) {
      if (row.count <= 0 || row.multiplier <= 0) return
      const basePanel = panelAt(damagePanels, row.slot)
      if (!basePanel) return
      // 行级穿透率（如希格莉德影画2 出枪式/敛枪式 +24%）：浅克隆面板叠加 penRatio，其余字段不变
      const panel = row.penRatioBonus
        ? { ...basePanel, penRatio: (basePanel.penRatio ?? 0) + row.penRatioBonus }
        : basePanel
      const stunForThis = row.stunOverride !== undefined
        ? row.stunOverride
        : stunCoverage
      // 叶瞬光帷幕易伤（口径见 yeshuguang.ts#veilStunBase）：吃满「boss 基础失衡易伤 +
      // 全部失衡易伤加成」再按影画封顶。基数已在**面板阶段**由 `yeshuguang.ts#applyPanel`
      // 算好并盖章在 `panel.veilStunVulnBase` 上（`calcDirectDamage` 内部还会加一次
      // bonus/100，所以模块侧已把 bonus 反向扣掉，使最终落到 veilStunMultiplier 的值上）。
      //
      // 2026-09-17 round 18 / R15-d 编排层棘轮：原判据 `row.agentId === '1431' &&
      // (panel as any).veilStunCapMult && stunForThis > 0` 里的 **agentId 项已删**——
      // `veilStunCapMult` 的**唯一写入方 = `yeshuguang.ts#applyPanel`**（本批从
      // `helpers.ts` 的 `agent.id === '1431'` 硬编码块一并迁入）⇒ 字段非 0 即蕴含是本角色
      // （判据同 T6，与本文件 `:879 burniceMechanicSource` / `:953 liuyinMechanicSource` /
      // `:985 banyueC6CrushAttach` 同族）。**其余两项逐位保留**：
      //  · `veilStunCapMult` 非 0 = 身份判据（非本角色 `emptyPanel()` 恒 0）；
      //  · `stunForThis > 0` = 「轴外段不吃帷幕封顶」的门控（R14 分诊 §4.2 要求逐位保留）。
      //    ⚠ **诚实负结果（2026-09-17 round 18 实测，别再重做这个探针）**：把这一项删掉后跑
      //    10 队 × 3 轴态 × 2 命座 = 60 态（boss 易伤推到 2.5/3.5 让封顶真咬合），对全行原文
      //    （`id|slot|agentId|moveId|stunMult|count|totalDamage(9位)|note`）取 sha256 ⇒
      //    **逐字节一致**（`diff` 无输出）。根因：`stunForThis === 0` 时本层已是死路——
      //    紧接着的 `stunMultVal` 三元 `stunForThis > 0 ? … : 1` 把它压成 1，且
      //    `calcStunMultiplier` 在 `cov <= 0` 时直接 `return alwaysMult`（**不看 base**）
      //    ⇒ 即「能走到本行的 stunForThis 恒 > 0」。保留它是为了与 R14 分诊的判据面一致 +
      //    防未来有人改 `stunMultVal` 的那个三元，**不是因为它现在拦得住东西**。
      let stunBase = configStore.enemy.stunVuln
      if (panel.veilStunCapMult && stunForThis > 0) {
        stunBase = panel.veilStunVulnBase
      }
      const stunMultVal = stunForThis > 0
        ? 1 + (stunBase - 1) * stunForThis
        : 1
      const rowAgent = catalogStore.agentsMap.get(row.agentId)
      const result = calcDirectDamage({
        panel,
        skillMultiplier: row.multiplier,
        damageElement: safeElement(row.element),
        enemyDefense: configStore.enemy.defense,
        // 减防/无视防御（GAME_TERM_TO_CODE_FIELD §4）：面板通用值（妮可 40%/叶瞬光C1 20%/席德C2 20%/
        // 伊芙琳C1/爱芮C2/千夏C1/音擎 千面日陨·索魂影眸 等）+ 行级 moveId 限定值（叶瞬光C2/C6、雨果C2、
        // 雅1命、席德…），两者同字段加算。**2026-09-08 修**：此前只传行级 `row.defIgnore`，面板通用值被
        // 静默丢弃（直伤整条通道失效，实测 妮可队 -21%、席德+妮可队 -29%）。
        enemyDefReduction: (panel.enemyDefReduction ?? 0) + (row.defIgnore ?? 0),
        enemyDefFlatReduction: panel.enemyDefFlatReduction ?? 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes[resolveStatElement(row.element) ?? ''] ?? 0,
        enemyResReduction: (panel.enemyResReduction ?? 0) + (row.resIgnore ?? 0),
        stunMultiplier: stunBase,
        stunned: stunForThis,
        critMode: 'expect',
        count: row.count,
        skillDamageTarget: row.skillDamageTarget,
        critRateBonus: row.critRateBonus,
        critDmgBonus: row.critDmgBonus,
        dmgBonus: row.dmgBonus,
        sheerDmgBonus: row.sheerDmgBonus,
        flatDamageBonus: row.flatDamageBonus,
        infectionElement,
        basisValueOverride: row.basisValueOverride,
        basisLabelOverride: row.basisLabelOverride,
        specialDamageProfile: rowAgent ? resolveSpecialDamageProfile(rowAgent) : undefined,
      })
      rows.push({
        id: row.id,
        slot: row.slot,
        agentId: row.agentId,
        agentName: agentName(row.agentId, row.slot),
        type: '直伤',
        name: row.name,
        element: row.element,
        source: row.source,
        count: row.count,
        perDamage: row.count > 0 ? result.damage / row.count : 0,
        totalDamage: result.damage,
        note: row.note ?? '',
        stunMult: stunMultVal,
        moveId: row.moveId,
        sourceTag: row.sourceTag,
        multiplier: row.multiplier,
      })
    }

    // 异放限定修正的来源：本角色模块（scope 缺省 self）+ 在场声明 `releaseModifierScope: 'team'` 的其他模块（CC-121）
    const teamReleaseModules = [...new Set(configStore.team.map(c => (c?.agentId ? getAgentMechanic(c.agentId) : undefined)))]
      .filter(m => m?.releaseModifier && m.releaseModifierScope === 'team')
    function resolveReleaseModifier(agentId: string): { enemyResReduction: number; enemyDefReduction?: number; note: string } {
      const own = getAgentMechanic(agentId)
      const sources = own?.releaseModifier ? [own, ...teamReleaseModules.filter(m => m !== own)] : teamReleaseModules
      const acc = { enemyResReduction: 0, enemyDefReduction: 0, note: '' }
      for (const m of sources) {
        const r = m!.releaseModifier!({ panels: damagePanels })
        acc.enemyResReduction += r.enemyResReduction
        acc.enemyDefReduction += r.enemyDefReduction ?? 0
        acc.note += r.note
      }
      return acc
    }
    function pushRelease(row: { id: string; slot: number; agentId: string; name: string; count: number; multiplier: number; source: string; note?: string; element?: string; panel?: PanelValues; settlementPanel?: PanelValues; releaseCrit?: AnomalyEventExecution['releaseCrit']; stunnedOverride?: number }) {
      if (row.count <= 0 || row.multiplier <= 0) return
      const basePanel = row.panel ?? panelAt(damagePanels, row.slot)
      const settlementPanel = row.settlementPanel ?? basePanel
      if (!basePanel) return
      const element = row.element ?? 'wind'
      const releaseMod = resolveReleaseModifier(row.agentId)
      // 异放专属暴击（如爱芮影画1）：掌控超过阈值后每点额外加暴击率
      const critOverride = row.releaseCrit
        ? {
            rate: row.releaseCrit.ratePct
              + Math.max(0, (row.releaseCrit.masteryValue ?? settlementPanel?.anomalyMastery ?? 0) - (row.releaseCrit.masteryThreshold ?? 0))
                * (row.releaseCrit.masteryPerPointRatePct ?? 0),
            dmg: row.releaseCrit.dmgPct,
            labelPrefix: '异放暴击',
          }
        : undefined
      const result = calcAnomalyDamage({
        panel: basePanel,
        settlementPanel,
        baseMultiplier: row.multiplier,
        element: element as any,
        enemyDefense: configStore.enemy.defense,
        // 异放同样吃面板通用减防（结算区口径：docs/mechanism-reference.md §异常结算区含减防）+ 异放限定 releaseModifier
        enemyDefReduction: (settlementPanel?.enemyDefReduction ?? 0) + (releaseMod.enemyDefReduction ?? 0),
        enemyDefFlatReduction: settlementPanel?.enemyDefFlatReduction ?? 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes[resolveStatElement(element) ?? ''] ?? 0,
        enemyResReduction: (settlementPanel?.enemyResReduction ?? 0) + releaseMod.enemyResReduction,
        stunned: row.stunnedOverride ?? stunCoverage,
        stunMultiplier: configStore.enemy.stunVuln,
        critMode: 'expect',
        damageKind: 'release',
        anomalyMultiplier: globalAnomalyMultiplier,
        anomalyCritOverride: critOverride,
      })
      rows.push({
        id: row.id,
        slot: row.slot,
        agentId: row.agentId,
        agentName: agentName(row.agentId, row.slot),
        type: '异放',
        name: row.name,
        element,
        source: row.source,
        count: row.count,
        perDamage: result.damage,
        totalDamage: result.damage * row.count,
        note: `${row.note ?? ''}${releaseMod.note}`,
        multiplier: row.multiplier,
      })
    }

    /** 解析异放倍率：固定 releaseMultiplier（Type A）或「原异常单次倍率 × 比例」（Type B） */
    function releaseMultiplierFor(event: AnomalyEventExecution, element: string, triggerPanel: PanelValues, stunCov: number): number {
      if (event.releaseRatio) {
        const rr = event.releaseRatio
        const perTenPct = rr.perTenByElement[element] ?? 0
        const stunMult = (rr.stunBonusPct ?? 0) > 0 ? 1 + ((rr.stunBonusPct ?? 0) / 100) * stunCov : 1
        // 「相对于原属性异常伤害的比例」句式（南宫羽颤音异放）：倍率 = 原异常单次倍率 × 元素比例%
        if (rr.basis === 'anomalyDamageRatio') return (ANOMALY_SINGLE_HIT_MULTIPLIER[element] ?? 0) * (perTenPct / 100) * stunMult
        // basisValue：模块按原文口径预先写入（如「初始」= 局外，CC-125）；缺省读触发者局内面板
        const basisValue = rr.basisValue ?? Number(triggerPanel[rr.basis] ?? 0)
        return (ANOMALY_SINGLE_HIT_MULTIPLIER[element] ?? 0) * (basisValue / 10) * (perTenPct / 100) * stunMult
      }
      return parseReleaseMultiplier(event)
    }

    // 失衡内异常系统 v2：轴模式下 dominant 归因候选 = 时间线实际活跃元素（窗均覆盖为权重，
    // 有触发但覆盖极小的元素给最小权重保底）；空数组 = 无时间线可用，回落全局覆盖率近似
    const inStunAttributionCandidates = (): Array<{ element: string; autoRatio: number }> =>
      (inStunAnomalyState?.elements ?? [])
        .filter(e => e.avgCoverage > 0 || e.triggerCount > 0)
        .map(e => ({ element: e.element, autoRatio: e.avgCoverage > 0 ? e.avgCoverage : 0.01 }))

    /**
     * 事件计数器（用户口径 2026-08-24「异放次数源」）：元素失衡内触发占比 =
     * 时间线轴内触发数 / 全局池触发数（基础元素归并）。池无该元素数据 → 0（全部视为轴外）。
     * 非轴场景不建逐事件状态机——轴外 = 总量 − 失衡内（用户裁决，平凡减法）。
     */
    const inWindowFraction = (element: string): number => {
      const base = getBaseElement(element)
      let total = 0
      for (const p of anomalyPoolResult?.perElement ?? []) {
        if (getBaseElement(p.element) === base) total += p.triggerCount ?? 0
      }
      if (total <= 0) return 0
      const inside = inStunAnomalyState?.elements.find(e => e.element === base)?.triggerCount ?? 0
      return Math.max(0, Math.min(1, inside / total))
    }

    /**
     * 轴内非风异常触发占比（维琳娜风异放）：乱流 = 风化窗口内非风异常触发，
     * 风异放随乱流触发 → 轴内占比 = 轴内非风触发 / 全局非风触发（风化覆盖率约掉）。
     * 非轴回落全局覆盖率（现状口径）。
     */
    const nonWindInAxisFraction = (): number => {
      if (!isAxis) return stunCoverage
      const inNonWind = (inStunAnomalyState?.elements ?? [])
        .filter(e => getBaseElement(e.element) !== 'wind')
        .reduce((s, e) => s + (e.triggerCount ?? 0), 0)
      let globalNonWind = 0
      for (const p of anomalyPoolResult?.perElement ?? []) {
        if (getBaseElement(p.element) !== 'wind') globalNonWind += p.triggerCount ?? 0
      }
      if (globalNonWind <= 0) return 0
      return Math.max(0, Math.min(1, inNonWind / globalNonWind))
    }

    /**
     * 终极技轴内占比（琉音6命余音/爱丽丝6命附伤等「终结技驱动附伤」）：指定槽位时只算该槽
     * （爱丽丝状态进入=自身 SW3+终结），缺省全队（琉音转大=队友终结技入场）。非轴回落全局覆盖率。
     */
    const ultimateInAxisFraction = (slot?: number): number => {
      if (!isAxis) return stunCoverage
      let inAxis = 0
      let total = 0
      for (const ch of adjustedResourceResult?.characters ?? []) {
        if (slot !== undefined && ch.slot !== slot) continue
        for (const e of ch.executions ?? []) {
          if (e.category !== 'chain' || !/终结技|ultimate/i.test(e.moveName ?? '')) continue
          total += e.count ?? 0
          inAxis += allocMap[`${ch.slot}:${e.moveId}`]?.inAxisUnits ?? 0
        }
      }
      return total > 0 ? Math.max(0, Math.min(1, inAxis / total)) : stunCoverage
    }

    /**
     * 异放失衡易伤拆分：inStunBound 事件全额记失衡内；其余按事件计数器占比拆
     * 「失衡内(stunned=1 全额易伤)/轴外(stunned=0 无易伤)」两段。非轴模式返回单段旧口径。
     */
    const releaseStunSegments = (
      event: AnomalyEventExecution,
      element: string,
      count: number,
      carrierInAxisFraction?: number,
    ): Array<{ count: number; stunned: number; suffix: string; tag: string }> => {
      if (!isAxis || count <= 0) return [{ count, stunned: -1, suffix: '', tag: '' }]
      if (event.inStunBound) return [{ count, stunned: 1, suffix: '-in', tag: '失衡内·全额失衡易伤' }]
      // 跟随载体招式（前台招式绑定，玩家捏轴可精确控制）：失衡内占比 = 载体块轴内单位 / 载体总数
      const frac = event.followCarrierInStun && carrierInAxisFraction !== undefined
        ? Math.max(0, Math.min(1, carrierInAxisFraction))
        : inWindowFraction(element)
      const countIn = Math.min(count, Math.round(count * frac))
      const segs: Array<{ count: number; stunned: number; suffix: string; tag: string }> = []
      if (countIn > 0) segs.push({ count: countIn, stunned: 1, suffix: '-in', tag: '失衡内·全额失衡易伤' })
      if (count - countIn > 0) segs.push({ count: count - countIn, stunned: 0, suffix: '-out', tag: '轴外·无易伤' })
      return segs
    }

    const seenDirectIds = new Map<string, number>()

    const charEnv: CharRowsEnv = {
      ctx, rows, isAxis: Boolean(isAxis), axisSlots, axisSplitFor, axisStunFor,
      pushDirect, pushRelease, releaseMultiplierFor, inStunAttributionCandidates,
      releaseStunSegments, seenDirectIds, agentName,
      ultimateInAxisFraction,
    }
    for (const charResult of adjustedResourceResult.characters) {
      const slot = charResult.slot
      const agent = catalogStore.agentsMap.get(charResult.agentId)
      const skills = catalogStore.agentSkillsByAgentMap.get(charResult.agentId)
      // CC-35d-B2 2026-09-27：原本槽级 `liuyinSrc` 已删——「跳过通用强特行」改由模块能力
      // `skipsGenericDirectRow` 判定（与重放块同在 liuyin.ts，门控同源）。
      const cl: CharLocals = { charResult, slot, agent, skills }
      emitCharDirectRows(charEnv, cl)
      emitCharReleaseRows(charEnv, cl)
      emitCharExtraRows(charEnv, cl)
    }

    emitAnomalyRows({
      ctx, rows, agentName, enemyDamageRes, isAxis: Boolean(isAxis), windSlot,
      inWindowFraction, nonWindInAxisFraction, ultimateInAxisFraction,
      axisStunFor, pushRelease,
    })

  return rows.filter(row => row.totalDamage > 0)
}

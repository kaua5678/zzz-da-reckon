/**
 * **资源池共享视图的数据面**（T188，用户 2026-11-03 口径，逐字）：
 *
 * > 「我在**很多地方的比较**中都会要求**完整的资源展示页显示**，**资源页的一切**支撑了结果的有效性和可溯源性。」
 *
 * ⇒ 比较处要**就地打开资源页那一整套**（不是摘要卡），且**单一事实源**（本仓最怕「两处漂移」）。
 * 本模块 = 那一套的**唯一数据面**：
 *
 *   ① `ResourcePoolSnapshot` = **一个档位**的快照（视图的入参）：全部字段取自 `useResourceCalc` 的
 *      `.value` 读数（唯一取数口；页面不得现读 store 再自己算），**纯值** ⇒ 出
 *      `withAnalysisScenario` 场景后照常可读（场景跑完即 dispose，见 `curvePointPool.ts`）；
 *   ② `resourcePoolSnapshotFromCalc` = **唯一构造入口**：ResultPage 传 UI 现场，比较入口传该档重放场景
 *      （`useCurvePointPool` 在场景里调它）⇒ 两个入口喂进 `ResourcePoolView` 的是**同一种东西**；
 *   ③ **纯派生读数**（伤害占比 / 队伍总览 / 异常事件行 / 逐窗图注入 / 三态）——同一快照喂两个入口
 *      ⇒ 读数逐位相等（判据 `src/composables/__tests__/resourcePoolView.test.ts`）。
 *
 * ## 为什么比较入口必须传快照、不能现读 store
 *
 * 比较入口的「这一档」是**差分重放**出来的（`configDelta` + `curvePointPool`）：页面上的
 * `useResourceCalc()` 属于**当前档**，现读会显示另一个档的数字（`curvePointPool.ts` 头注释）。
 * ⇒ 该档的**配置标量**（窗长 / 战斗时间 / 无敌时间 / Boss 失衡易伤 / 合轴吸收率 / 非轴 φ / 轴开关 …）
 * 也随快照带出，展示层一律**不读 store**。
 *
 * ## 缺读数怎么显示（用户口径：不补造、不编 0）
 *
 * 缺读数（非轴队 / 弃轴 / 未采）⇒ 该块**如实写「无/未采」+ 原因**，**不补造、不编 0**。
 * 判据住 `resourceBlockStates`（纯函数 + 单测），页面按它渲染「无 + 原因」，而不是把块藏掉。
 */
import type { EvalConfig } from '@/stores/config'
import type { PanelValues } from '@/types/catalog'
import type {
  AnomalyEventRecord,
  AnomalyPoolResult,
  SpecialActionBonusResult,
  StunPoolResult,
  TeamResourceResult,
} from '@/types/resource'
import type { AnomalyVirtualPanelBuild } from '@/composables/resourceCalc/anomalyPanels'
import type { DamagePoolRow, DamageSourceBreakdown, DamageSourceTotals } from '@/composables/resourceCalc/helpers'
import type { ContinuousWindowSplit } from '@/core/continuousStun'
import type { StunRealization } from '@/core/stunTimeline'
import type { StunPhaseTimeline } from '@/core/stunPhaseTimeline'
import type { ExecutedMoveCount, StackTraversalResult } from '@/core/stunAxisStack'
import type { PoolSummarySection } from '@/mechanics/typesView'
import type { CharacterDamageShare, DamageShareCategory } from '@/components/charts/TeamDamage3DChart.vue'
import type { AxisFillMoveGroup } from '@/components/AxisWindowChart.vue'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import { teamPoolSummaries } from '@/composables/agentMechanicView'
import { axisWindowView, type AxisWindowView, type AxisWindowViewInput } from '@/composables/axisWindowView'
import { computePerSlotBuildUp } from '@/composables/positionCompare'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import { DEFAULT_NO_AXIS_VULN_SHARE, NO_AXIS_VULN_SHARE_SETTING } from '@/composables/resourceCalc/noAxisVulnShare'

/**
 * **一个档位的资源池快照**（视图唯一入参）。
 *
 * 字段名与取数口一一对应（`stunPoolResult` → `stunPool` 等）：取数口 = `createResourceCalc` 的返回值
 * （`useResourceCalc.ts` 末尾的 `return { … }`），改一处要两处一起看。
 */
export interface ResourcePoolSnapshot {
  // ── 三份池（引擎读数）──
  /** 队伍资源结果；**非空**——没有它就没有快照（视图的 prop 才是可空的） */
  resourceResult: TeamResourceResult
  stunPool: StunPoolResult | null
  anomalyPool: AnomalyPoolResult | null
  // ── 伤害 ──
  /** 全队总伤害 = 伤害池求和（`calc.teamTotalDamage`） */
  damage: number
  damagePoolRows: DamagePoolRow[]
  damageSourceBreakdown: DamageSourceBreakdown[]
  damageSourceTotals: DamageSourceTotals
  // ── 异常展示 ──
  specialActionBonus: SpecialActionBonusResult | null
  anomalyVirtualPanels: AnomalyVirtualPanelBuild[]
  moduleAnomalyEventRecords: AnomalyEventRecord[]
  anomalyDamageEvents: AnomalyEventRecord[]
  /** 角色模块声明的资源段（`teamPoolSummaries` 钩子产物） */
  poolSummarySections: PoolSummarySection[]
  // ── 轴 / 失衡展示读数 ──
  continuousStun: ContinuousWindowSplit | null
  stunRealization: StunRealization | null
  stunPhaseTimeline: StunPhaseTimeline | null
  /** 名义失衡窗长 W（秒）= `calc.windowDuration`（含全队失衡延时） */
  windowDuration: number
  /** 有效战斗时间（秒）= `calc.stunEffectiveTime`（战斗时间 − 无敌时间） */
  effectiveTime: number
  /** 轴栈（`calc.stackTraversalResult`）；`null` = 非轴队 / 弃轴（如实为空，不补一行「平A」凑数） */
  axisStack: StackTraversalResult | null
  /** 逐窗兑现图三件输入之一：时间轴逐窗快照（`calc.stunTimeline.slots`） */
  stunTimelineSlots: NonNullable<AxisWindowViewInput['slots']>
  /** 逐窗兑现图三件输入之二：生效轴（只用来取名，不参与判定） */
  effectiveStunAxes: NonNullable<AxisWindowViewInput['axes']>
  /** 窗尾填充展开成真实招式（`calc.axisFillExpansion`） */
  axisFillExpansion: Record<string, ExecutedMoveCount>
  // ── 面板（失衡易伤展示读它：`useStunVulnDisplay`）──
  panels: PanelValues[]
  // ── 该档的配置标量（展示层不得读 store：本档可能是差分重放出来的）──
  battleTime: number
  invincibleTime: number
  enemyStunVuln: number
  comboAlignAbsorbRatio: number
  noAxisVulnShare: number
  /** 引擎真·轴模式（`calc.stunAxisResult !== null`） */
  isAxisMode: boolean
  /** 失衡窗口占比（0..1，含决算截断损失秒的权威口径）= `calc.stunCoverage` */
  stunCoverage: number
  /** 引擎弃轴读数（`resourceResult.convergence.axisFallback`） */
  axisFallback: boolean
  useStunAxis: boolean
  autoActive: boolean
  // ── 名称 ──
  agentNames: Record<string, string>
  /** 槽位 → agentId（下标 = 槽位号；空槽 = `""`） */
  slotAgentIds: string[]
  /** 槽位名（旧口径 `agentNames[id] || 槽i`，0-based）——逐槽 chip 用 */
  slotNames: string[]
  /** 槽位名（旧口径 `agentNames[id] || 槽(i+1)`，1-based）——总览 / 逐窗图道名用 */
  slotLabels: string[]
  /** 琉音好评转大次数（资源卡展示；`hug60` = 吃连携窗口的那部分） */
  ultPromoteCount: number
  ultPromoteHug60: number
  /** 本档重算耗时（ms）；ResultPage 无此读数 ⇒ `null`（如实不显示） */
  ms: number | null
}

/** 快照的附加元信息（比较入口给得出、ResultPage 给不出） */
export interface ResourcePoolSnapshotMeta {
  /** 本次重算耗时（ms）；缺省 `null`（如实不显示，不编 0ms） */
  ms?: number | null
}

/**
 * **唯一构造入口**：从一份求值读数（`calc`）+ 该求值的配置（`config`）建一个档位快照。
 *
 * ⚠ `calc` 与 `config` 必须**同源**：ResultPage 传 `useResourceCalc()` + UI store；比较入口传
 * `withAnalysisScenario` 的 `s.calc` + `s.config`（本档重放的现场）。混搭（拿 UI store 配场景 calc）
 * 会让「队友面板加成」等按当前档取值——那正是 `curvePointPool` 头注释警告的错配。
 *
 * 读不到资源结果（队伍无角色 / 技能数据不完整）⇒ 返回 `null`：**没有快照**，由视图渲染「未采/无」+ 原因。
 */
export function resourcePoolSnapshotFromCalc(
  calc: ResourceCalc,
  config: EvalConfig,
  meta: ResourcePoolSnapshotMeta = {},
): ResourcePoolSnapshot | null {
  // 唯一取数口：全部经 `.value` 读既有单一事实源（这里读一次 = 与页面原先逐块读同一批 computed）
  const resourceResult = calc.resourceResult.value
  if (!resourceResult) return null
  const damagePoolRows = calc.damagePoolRows.value
  const anomalyPool = calc.anomalyPoolResult.value
  const agentNames = calc.agentNames.value
  const slotAgentIds = [0, 1, 2].map(i => config.team[i]?.agentId ?? '')
  const nameOfSlot = (slot: number, oneBased: boolean): string =>
    agentNames[slotAgentIds[slot] ?? ''] || `槽${oneBased ? slot + 1 : slot}`
  const stunTimeline = calc.stunTimeline.value
  return {
    resourceResult,
    stunPool: calc.stunPoolResult.value,
    anomalyPool,
    damage: calc.teamTotalDamage.value,
    damagePoolRows,
    damageSourceBreakdown: calc.damageSourceBreakdown.value,
    damageSourceTotals: calc.damageSourceTotals.value,
    specialActionBonus: calc.specialActionBonus.value,
    anomalyVirtualPanels: calc.anomalyVirtualPanels.value,
    moduleAnomalyEventRecords: calc.moduleAnomalyEventRecords.value,
    anomalyDamageEvents: calc.anomalyDamageEvents.value,
    poolSummarySections: teamPoolSummaries(config.team, {
      damagePoolRows,
      anomalyPoolResult: anomalyPool,
      getMechanicSetting: (id, fallback) => config.getMechanicSetting(id, fallback),
    }),
    continuousStun: calc.continuousStun.value,
    stunRealization: calc.stunRealization.value,
    stunPhaseTimeline: calc.stunPhaseTimeline.value,
    windowDuration: calc.windowDuration.value,
    effectiveTime: calc.stunEffectiveTime.value,
    axisStack: calc.stackTraversalResult.value,
    stunTimelineSlots: stunTimeline.slots,
    effectiveStunAxes: calc.effectiveStunAxes.value,
    axisFillExpansion: calc.axisFillExpansion.value,
    panels: calc.panels.value,
    battleTime: resourceResult.totalTime,
    invincibleTime: config.enemy.invincibleTime,
    enemyStunVuln: config.enemy.stunVuln,
    comboAlignAbsorbRatio: config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO),
    noAxisVulnShare: config.getMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, DEFAULT_NO_AXIS_VULN_SHARE),
    isAxisMode: calc.stunAxisResult.value !== null,
    stunCoverage: calc.stunCoverage.value,
    axisFallback: resourceResult.convergence.axisFallback === true,
    useStunAxis: config.useStunAxis,
    autoActive: calc.autoActive.value,
    agentNames,
    slotAgentIds,
    slotNames: slotAgentIds.map((_, i) => nameOfSlot(i, false)),
    slotLabels: slotAgentIds.map((_, i) => nameOfSlot(i, true)),
    ultPromoteCount: calc.ultPromoteCount.value,
    ultPromoteHug60: calc.ultPromoteHug60.value,
    ms: meta.ms ?? null,
  }
}

// ==================== 纯派生读数（同一快照 ⇒ 同一读数） ====================

/**
 * 伤害占比·按伤害类型（`damagePoolRows` 按 `type` 汇总）。
 *
 * 从 `views/ResultPage.vue` 原样搬出（T188 抽共享视图，函数体逐字保留）：改口径只改这一处。
 */
export function damageShareCategoriesOf(rows: readonly DamagePoolRow[], total: number): DamageShareCategory[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.type, (totals.get(row.type) ?? 0) + row.totalDamage)
  }
  // 紊乱伤害已纳入 damagePoolRows（type='紊乱'），无需额外加算
  return [...totals.entries()]
    .map(([label, damage]) => ({
      key: label,
      label,
      damage,
      pct: total > 0 ? (damage / total) * 100 : 0,
    }))
    .sort((a, b) => b.damage - a.damage)
}

/**
 * 个人伤害占比条目 = 3D 透视图的共享形状（`TeamDamage3DChart#CharacterDamageShare`）
 * + 总览/列表要用的**槽位**与**个人总伤**（结构扩展，不重写形状——规则 29）。
 */
export interface CharacterDamageShareEntry extends CharacterDamageShare {
  slot: number
  /** 个人总伤害（= 该角色各行 `totalDamage` 之和） */
  total: number
}

/**
 * 个人伤害占比（按角色 × 伤害类型）：逐角色个人总伤、占全队比、个人构成。
 *
 * 槽位名一律走快照的 `slotLabels`（1-based 旧口径）——比较入口的槽位名必须来自**该档**，不是页面现场。
 */
export function characterDamageSharesOf(
  snapshot: ResourcePoolSnapshot,
): CharacterDamageShareEntry[] {
  const perAgent = new Map<string, Map<string, number>>()
  const addDamage = (agentId: string, label: string, damage: number) => {
    if (!agentId || damage <= 0) return;
    let categories = perAgent.get(agentId);
    if (!categories) {
      categories = new Map<string, number>();
      perAgent.set(agentId, categories);
    }
    categories.set(label, (categories.get(label) ?? 0) + damage);
  }
  for (const row of snapshot.damagePoolRows) {
    addDamage(row.agentId, row.type, row.totalDamage);
  }
  // 紊乱伤害已纳入 damagePoolRows（type='紊乱'），无需从 details 额外加算
  const total = snapshot.damage;
  return snapshot.slotAgentIds
    .map((agentId, slot) => {
      const categories = perAgent.get(agentId) ?? new Map<string, number>();
      const charTotal = [...categories.values()].reduce((a, b) => a + b, 0);
      return {
        agentId,
        name: snapshot.slotLabels[slot] ?? `${slot + 1} 号位`,
        slot,
        total: charTotal,
        pct: total > 0 ? (charTotal / total) * 100 : 0,
        categories: [...categories.entries()]
          .map(([label, damage]) => ({
            key: label,
            label,
            damage,
            // 个人伤害构成占比：该伤害类型占该角色个人总伤害的比例
            pct: charTotal > 0 ? (damage / charTotal) * 100 : 0,
          }))
          .sort((a, b) => b.damage - a.damage),
      };
    })
    .filter(share => share.total > 0);
}

/** 队伍总览一行（逐槽：伤害/积蓄/失衡占比 + 能量/喧响 + 招式计数） */
export interface TeamOverviewRow {
  slot: number
  name: string;
  damage: number;
  damagePct: number;
  buildup: number;
  buildupPct: number;
  stun: number;
  stunPct: number;
  energy: number;
  decibel: number;
  exSpecialCount: number;
  ultimateCount: number;
}

/**
 * 队伍总览（逐槽四占比 + 能量/喧响 + 强特/终结次数）。
 *
 * `getAgent` 注入目录读取口（本模块不碰 store；页面传 `catalogStore`，测试传桩）：
 * 逐槽积蓄归因走 `positionCompare#computePerSlotBuildUp` 单一实现（异属性赠送归接收人）。
 */
export function teamOverviewOf(
  snapshot: ResourcePoolSnapshot,
  damageShares: readonly CharacterDamageShareEntry[],
  getAgent: (agentId: string) => { damageElement?: string } | undefined,
): TeamOverviewRow[] {
  const damageTotal = snapshot.damage;
  const stunTotal = snapshot.stunPool?.totalStunBuildUp ?? 0;
  const perSlotBuildUp = computePerSlotBuildUp(
    snapshot.anomalyPool,
    snapshot.slotAgentIds.map(agentId => ({ agentId })),
    { getAgent },
  );
  const totalBuildUp = perSlotBuildUp.reduce((sum, v) => sum + v, 0);
  return snapshot.slotAgentIds.map((agentId, slot) => {
    const share = damageShares.find(item => item.slot === slot);
    // 链内不再写第二个 `?.`（判据 28：`stunPool` 判空后 `perSlotStun` 必在）
    const stun = snapshot.stunPool ? snapshot.stunPool.perSlotStun[slot] ?? 0 : 0;
    const resource = snapshot.resourceResult.characters.find(item => item.slot === slot);
    const buildup = perSlotBuildUp[slot] ?? 0;
    return {
      slot,
      name: snapshot.slotLabels[slot] ?? agentId,
      damage: share?.total ?? 0,
      damagePct: damageTotal > 0 ? ((share?.total ?? 0) / damageTotal) * 100 : 0,
      buildup,
      buildupPct: totalBuildUp > 0 ? (buildup / totalBuildUp) * 100 : 0,
      stun,
      stunPct: stunTotal > 0 ? (stun / stunTotal) * 100 : 0,
      energy: resource?.energySource.total ?? 0,
      decibel: resource?.decibelSource.total ?? 0,
      exSpecialCount: resource?.executedExSpecialCount ?? 0,
      ultimateCount: resource?.executedUltimateCount ?? 0,
    };
  });
}

/**
 * 异常事件行（三个来源合并 + 角色执行计划里的异常事件）。
 *
 * 三源 = 池的 `anomalyEvents` / 角色模块登记的 `moduleAnomalyEventRecords` / 异常伤害事件
 * `anomalyDamageEvents`（顺序即此，页面不重排）；第四源 = 资源结果里各角色的 `anomalyEventExecutions`。
 */
export function anomalyEventRowsOf(snapshot: ResourcePoolSnapshot): AnomalyEventRecord[] {
  const rows: AnomalyEventRecord[] = [
    ...(snapshot.anomalyPool?.anomalyEvents ?? []),
    ...snapshot.moduleAnomalyEventRecords,
    ...snapshot.anomalyDamageEvents,
  ];
  for (const char of snapshot.resourceResult.characters) {
    // `anomalyEventExecutions` 是**必填**字段（types/resource/agentResources.ts）⇒ 不写死兜底（判据 28）
    for (const event of char.anomalyEventExecutions) {
      if (event.count <= 0) continue
      rows.push({
        id: `resource-${char.slot}-${event.eventId}`,
        type: event.eventType === 'special_voidflare' ? 'special_voidflare' : 'luminize',
        label: event.eventName,
        source: `${snapshot.agentNames[char.agentId] || char.agentName || `槽${char.slot + 1}`} 的异常事件执行计划`,
        count: event.count,
        formula: event.formula,
        fields: event.fields,
        note: event.note,
      });
    }
  }
  return rows;
}

/**
 * **逐窗兑现图**的视图注入（`axisWindowView` 的三份输入全在快照里）。
 *
 * 非轴队 / 弃轴 / 轴栈为空 ⇒ `hasTrace: false`（空视图）——页面据此**如实写「无 + 原因」**，
 * 不画一张空图糊弄（原因文案见 `resourceBlockStates`）。
 */
export function axisWindowsOf(
  snapshot: ResourcePoolSnapshot | null,
  nameOf: (slot: number, moveId: string) => string,
  nameOfSlot: (slot: number) => string,
): AxisWindowView {
  // 快照缺失（未采）⇒ 空视图：三份输入都按「没量到」传，**不编 0**
  const stack = snapshot?.axisStack ?? null;
  return axisWindowView({
    trace: stack ? stack.windowTrace : undefined,
    skipped: stack ? stack.skipped : undefined,
    slots: snapshot?.stunTimelineSlots,
    axes: snapshot?.effectiveStunAxes,
    nameOf,
    nameOfSlot,
  });
}

/**
 * 窗尾填充 → 真实招式（按槽分组给逐窗图底部那行）。
 *
 * 数据 = 快照的 `axisFillExpansion`（与伤害侧**同一个**兜底池函数与同一份资源读数），本函数只排序、取名、分量纲
 * （`basic` 的 count 是秒数，其余是次数）。
 */
export function axisFillMoveGroupsOf(
  snapshot: ResourcePoolSnapshot | null,
  nameOf: (slot: number, moveId: string) => string,
  nameOfSlot: (slot: number) => string,
): AxisFillMoveGroup[] {
  const stack = snapshot?.axisStack ?? null;
  const secs = stack ? stack.basicFillBySlot : {};
  const groups: AxisFillMoveGroup[] = [];
  for (const slot of Object.keys(secs).map(Number).sort((a, b) => a - b)) {
    const seconds = secs[slot] ?? 0;
    if (!(seconds > 0)) continue;
    const moves = Object.values(snapshot?.axisFillExpansion ?? {})
      .filter(v => v.slot === slot)
      .map(v => ({
        moveId: v.moveId,
        name: v.moveId === 'basic' ? '平A' : nameOf(slot, v.moveId),
        count: v.count,
        unit: (v.moveId === 'basic' ? 'seconds' : 'times') as 'seconds' | 'times',
      }))
      .sort((a, b) => b.count - a.count);
    groups.push({ slot, name: nameOfSlot(slot), seconds, moves });
  }
  return groups;
}

// ==================== 三态：有读数 / 无读数（+原因）/ 未采 ====================

/**
 * 资源块的**三态**（用户口径：缺读数 ⇒ 如实写「无/未采」+ 原因，不补造、不编 0）。
 *
 * 覆盖面 = **页面真的会渲染「无 + 原因」的那几块**（键集就是消费面：`ResourcePoolView` 逐键读它）——
 * 不做「算了没人看」的键（规则 16：零调用点 = 死口径）。伤害族四块（总览/占比/来源/伤害池）
 * 的缺读数只有「队伍或技能数据不完整」一种成因，那时整个资源页走 `无法计算` 占位（快照根本建不出来）。
 *
 * 为什么要有这一层而不是在模板里写一串 `v-if`：`v-if` 把「没这回事」（非轴队没有逐窗轨迹 = 如实为空）
 * 与「没量到」（未采）**混成同一种静默**——用户看到的是「少了一块卡」，分不清是引擎没产出还是页面忘了画。
 * 三态把这两种都变成**看得见的一句话**。
 */
export const RESOURCE_BLOCK_KEYS = [
  'timeSummary',
  'stunPool',
  'axisWindows',
  'anomalyPool',
  'virtualPanels',
  'anomalyEvents',
  'specialAction',
] as const

export type ResourceBlockKey = (typeof RESOURCE_BLOCK_KEYS)[number]

export interface ResourceBlockState {
  /** 块标识（页面与测试共用同一批键） */
  key: ResourceBlockKey
  /** 块标题（页面写「无」时的抬头，与卡片标题同源，不在页面各写一套） */
  label: string
  /**
   * 缺读数时的原因：**空串 = 有读数**（页面用**原生 `v-if`** 决定渲染哪一支——只有原生条件收窄得到
   * 类型，布尔标志收窄不到）；非空 = 页面在 `v-else` 里如实写这一句。
   */
  reason: string
}

/** 块标题（`ResourcePoolView` 与判据共用一份） */
export const RESOURCE_BLOCK_LABELS: Record<ResourceBlockKey, string> = {
  timeSummary: '时间分配汇总',
  stunPool: '失衡池汇总',
  axisWindows: '逐窗兑现（轴模式）',
  anomalyPool: '积蓄池汇总',
  virtualPanels: '异常虚拟面板',
  anomalyEvents: '异常事件明细',
  specialAction: '特殊动作喧响',
}

/** 未采（整个快照缺失）的原因文案——与「无（引擎没产出）」分开写，别让用户以为是自己没打出来 */
export const RESOURCE_POOL_NOT_COLLECTED =
  '未采：这一档没有资源池快照（没带现场差分 / 重算还没回来）⇒ 如实为空，不补造、不编 0';

/**
 * 逐窗兑现块**缺读数**的原因（三种形态逐字区分）：
 *
 * · **非轴队**：没启用失衡轴 ⇒ 根本没有轴窗这个概念（不是「轴打空了」）；
 * · **弃轴**：用户要了轴、引擎按资源判定装不下 ⇒ 退回无轴打法（`convergence.axisFallback`）；
 * · **轴栈为空**：轴开着、也没被弃，但这一档没排出任何窗口（如失衡次数 0）。
 *
 * 有轨迹 ⇒ 返回空串（页面画图）。
 */
export function axisWindowsAbsenceReasonOf(snapshot: ResourcePoolSnapshot): string {
  const stack = snapshot.axisStack;
  if (stack && stack.windowTrace.length > 0) return '';
  if (snapshot.axisFallback) {
    return '弃轴：轴的资源需求超出时间预算，引擎已退回无轴打法 ⇒ 没有逐窗轨迹（调高合轴率可试救）';
  }
  if (!snapshot.useStunAxis && !snapshot.autoActive) {
    return '非轴队（未启用失衡轴、也没有自动轴命中）⇒ 没有轴窗这回事，如实为空';
  }
  return '轴栈为空：这一档没有排出任何失衡窗（如实为空，不补一行「平A」凑数）';
}

/**
 * 全部资源块的三态读数（`snapshot === null` ⇒ 全部按「未采」上报）。
 *
 * 判据：`resourcePoolView.test.ts`（未采 / 非轴队 / 弃轴 / 有读数四态 + 同一快照两次调用逐位相等）。
 */
export function resourceBlockStates(snapshot: ResourcePoolSnapshot | null): Record<ResourceBlockKey, ResourceBlockState> {
  const out = {} as Record<ResourceBlockKey, ResourceBlockState>;
  const put = (key: ResourceBlockKey, present: boolean, reason: string) => {
    out[key] = { key, label: RESOURCE_BLOCK_LABELS[key], reason: present ? '' : reason };
  };
  if (!snapshot) {
    for (const key of RESOURCE_BLOCK_KEYS) put(key, false, RESOURCE_POOL_NOT_COLLECTED);
    return out;
  }
  put('timeSummary', true, '');
  put(
    'stunPool',
    snapshot.stunPool !== null,
    '无：本轮没有失衡池读数（引擎未产出）——不编 0，也不假装打过失衡',
  );
  const absence = axisWindowsAbsenceReasonOf(snapshot);
  put('axisWindows', absence === '', absence);
  put(
    'anomalyPool',
    snapshot.anomalyPool !== null,
    '无：本轮没有积蓄池读数（引擎未产出异常池）',
  );
  put(
    'virtualPanels',
    snapshot.anomalyVirtualPanels.length > 0,
    '无：本次求值没有异常虚拟面板（没有任何属性异常触发）',
  );
  put(
    'anomalyEvents',
    anomalyEventRowsOf(snapshot).length > 0,
    '无：没有异常事件明细（异常池 / 模块登记 / 执行计划三源都为空）',
  );
  put(
    'specialAction',
    snapshot.specialActionBonus !== null,
    '无：本轮没有特殊动作喧响读数（引擎未产出）',
  );
  return out;
}

/**
 * 属性贡献账：**贡献账（`core/contributionLedger.ts`）的第一个适配器**（2026-10-20）。
 *
 * 用户 Excel 口径：
 * > 「横轴是拐力提供者，纵轴是属性区，每当有拐力事件我就在提供者对应的属性区加该拐力，
 * >   最后所有拐力求和得到具体的局内加成、局内固定加成等数据，横向求和得到每个属性区总拐力。」
 *
 * 本文件只做三件事——**求和与归并全在 `contributionLedger`**：
 *   ① 把 buff 批次映射成 `Contribution`（提供者 = origin，维度 = 属性 stat）；
 *   ② 属性 → 属性区（复用 `utils/statMeta` 的 `STAT_META.zone`，**不造第二套分区口径**）；
 *   ③ 与真实面板对账（`reconcileLedger`），把不走 buff 通道的来源显式列成差额。
 *
 * ⚠ **覆盖范围（诚实标注）**：本账只统计 **buff 通道**（`collectAllBuffs` 收集到的 effects）。
 * 以下来源**不经过** buff 通道，因此不在账内，而会出现在 `reconcile` 的差额里：
 * 驱动盘主副词条、角色模块 `applyPanel` 专属面板效果、`attributeConversions` 转模、
 * `teamPanelEffects` 队友面板增益、编排层通用规则（元素异常时长 / 侵染区）。
 * 差额不是 bug，它是「还有别的通道」的如实标注；将来把这些通道也接入本账时，差额自然归零。
 */
import type { BuffEffect, BuffEffectOrigin, PanelValues } from '@/types/catalog'
import type { CollectedBuffs } from '@/core/buff'
import { normalizePanelStatAlias, resolveEffectValue } from '@/core/buff'
import {
  buildLedgerTable,
  reconcileLedger,
  type Contribution,
  type ContributionAdapter,
  type ContributionOrigin,
  type LedgerReconcileRow,
  type LedgerTable,
} from '@/core/contributionLedger'
import { STAT_META, type FormulaZone } from '@/utils/statMeta'
import { getPanelStat } from '@/utils/panelStat'

/**
 * 面板上实际存在的 stat 键（`Object.keys` 是 `panelStat.ts` 头注释点名的合法键来源之一）。
 * 用 `Object.keys` 而不是 `Object.entries`：后者的值类型还要再断言一次，前者交给 `getPanelStat` 读。
 */
function PANEL_STAT_KEYS_OF(panel: Readonly<PanelValues>): string[] {
  return Object.keys(panel)
}

/**
 * `panelPhases#TeamPanelContribution` 的结构形参（避免 core → composables 的值依赖，判据 19）。
 * 形状复用 `BuffEffectOrigin`（判据 29：同一形状写两处以上就引用具名类型）。
 */
export interface TeamPanelContributionLike {
  stat: string
  value: number
  mode: 'flat' | 'pct'
  origin: BuffEffectOrigin & { kind: 'teamEffect' }
}

/** `core/panel` 的 `DiscContribution` 结构形参（避免 core 内部循环依赖的类型搬运） */
export interface DiscContributionLike {
  stat: string
  value: number
  mode: 'flat' | 'pct'
  /** 形状复用 `BuffEffectOrigin`（判据 29：同一形状写两处以上就引用具名类型） */
  origin: BuffEffectOrigin & { kind: 'driveDisc' }
  slotKey?: string
}

/** 属性矩阵的两个相位（与用户 Excel 的「局外 / 局内」两张表对应；固定值并入各自相位的 flat） */
export type AttributePhase = 'outOfCombat' | 'inCombat'

const ZONE_ORDER: FormulaZone[] = [
  '基础属性', '暴击区', '增伤区', '防御/穿透区', '贯穿力区', '贯穿增伤区',
  '锐化增伤区', '抗性/易伤区', '失衡区', '异常积蓄区', '异常伤害区', '能量/喧响区', '其他',
]

/** 行序：角色自身 → 音擎 → 驱动盘 → 队友 → 队友面板效果 → 环境 */
/**
 * 面板属性的公式分解清单。
 *
 * 分两类（决定展示形态）：
 * - **乘算型**（`Atk`/`Hp`/`Def`/`Impact`）：走累加器，`最终 = 基础×(1+大%)+小值`，有大小词条之分；
 * - **加法型**（暴击/增伤/精通/穿透…）：面板上直接累加，没有「大/小词条」概念，只有总量。
 *
 * 用户 2026-10-20：「你这 UI 只显示了攻击生命防御冲击属性啊」——
 * 修前只有 4 条乘算型，加法型属性（暴击率、暴击伤害、异常精通、穿透率…）完全不出现。
 */
const CORE_STAT_FORMULAS: { stat?: 'Atk' | 'Hp' | 'Def' | 'Impact'; label: string; key: string }[] = [
  { stat: 'Atk', label: '攻击力', key: 'atk' },
  { stat: 'Hp', label: '生命值', key: 'hp' },
  { stat: 'Def', label: '防御力', key: 'def' },
  { stat: 'Impact', label: '冲击力', key: 'impact' },
  // —— 加法型（无大小词条之分）——
  { label: '暴击率', key: 'critRate' },
  { label: '暴击伤害', key: 'critDmg' },
  { label: '异常精通', key: 'anomalyProficiency' },
  { label: '异常掌控', key: 'anomalyMastery' },
  { label: '穿透率', key: 'penRatio' },
  { label: '穿透值', key: 'penFlat' },
  { label: '增伤', key: 'dmgBonus' },
  { label: '异常伤害', key: 'anomalyDmgBonus' },
  { label: '能量自动回复', key: 'energyRegen' },
]

const KIND_ORDER: Record<string, number> = {
  agent: 0, wEngine: 1, driveDisc: 2, teammate: 3, teamEffect: 4, team: 5,
}

const STAT_ZONE = new Map<string, FormulaZone>(STAT_META.map(m => [m.value, m.zone]))
const STAT_MODE = new Map<string, 'flat' | 'pct'>(STAT_META.map(m => [m.value, m.mode]))

/** 属性 → 属性区；未登记的属落到「其他」，不静默丢弃 */
export function zoneOfStat(stat: string): FormulaZone {
  return STAT_ZONE.get(stat) ?? '其他'
}

/** buff effect（同一相位内，已按两批求值顺序就位）→ 贡献 */
interface EffectItem {
  effect: BuffEffect
  value: number
}

function originOfEffect(effect: BuffEffect): ContributionOrigin {
  const origin = effect.origin
  if (!origin) return { key: 'unknown', label: '未标注来源', kind: 'other', slot: -1 }
  return {
    key: `${origin.kind}|${origin.provider}|${origin.slot}`,
    label: origin.provider,
    kind: origin.kind,
    slot: origin.slot,
  }
}

const effectAdapter: ContributionAdapter<EffectItem, string> = {
  // ⚠ 必须过别名归一：数据里 `anomalyDamageBonus` 与 `anomalyDmgBonus` 是**同一个面板字段**
  // （引擎 `applyStat` 两个 case 加到同一处）。不归一 ⇒ 矩阵把同一字段拆成两栏，列和与真实面板对不上，
  // 用户会以为「核心公式也这么错算了」（2026-10-20 实测反馈）。
  keyOf: item => normalizePanelStatAlias(item.effect.stat),
  amountOf: item => item.value,
  modeOf: item => {
    const stat = normalizePanelStatAlias(item.effect.stat)
    return STAT_MODE.get(stat) ?? (item.effect.mode === 'pct' ? 'pct' : 'flat')
  },
  originOf: item => originOfEffect(item.effect),
  detailOf: item => item.effect.origin?.source ?? '未标注来源',
  idOf: item => item.effect.id,
  // 第三维「具体内容」：effect id 本身就是唯一内容标识（核心被动 / 影画2 / 套装2pc…），
  // 配合 origin 的提供者，三者共同构成「提供者 × 属性 × 内容」的唯一落位。
  slotKeyOf: item => item.effect.id,
  orderKey: stat => ZONE_ORDER.indexOf(zoneOfStat(stat)),
}

export interface AttributeLedgerTable extends LedgerTable<string> {
  phase: AttributePhase
  /** 属性 → 属性区（展示层分组表头用） */
  zoneOf: (stat: string) => FormulaZone
}

/**
 * 三张表（用户 2026-10-20 定口径）：
 *   **基础** = 角色白值 + 音擎白值（`calcBasePanel`）—— 不可再拆的来源
 *   **加成** = 驱动盘词条 + buff 通道 + 队友面板效果（`applyDriveDiscConfig` + `collected` + `teamPanelContributions`）
 *   **最终** = 基础 × (1 + Σ加成%) + Σ加成固定值（引擎真实面板）
 *
 * 用户的理由：「基础，加成，最终，就这三个可以显示所有内容。**差额其实不需要**」——
 * 只有前两层都有来源时，第三层才能被逐格解释；差额行存在的唯一原因就是「有来源没结构化」。
 */
/** 一条「基础 × (1+大%) + 小值」形式的公式分解（面板核心属性） */
export interface StatFormula {
  stat: string
  label: string
  /** 白值（角色+音擎基础） */
  base: number
  /** 局外大词条累计 % */
  outPct: number
  /** 局外小词条累计固定值 */
  outFlat: number
  /** 局外总数值 */
  outTotal: number
  /** 局内大词条累计 % */
  inPct: number
  /** 局内小词条累计固定值 */
  inFlat: number
  /** 局内总数值 */
  inTotal: number
  /**
   * 属性类型：`mult` = 乘算型（基础×(1+大%)+小值，有大小词条）；
   * `add` = 加法型（面板直接累加，无大小词条）。
   */
  kind: 'mult' | 'add'
  /**
   * 大/小词条的**来源拆解**（用户 2026-10-20：「三号位防御不是接近两千啊。你这个没区分开」）——
   * 只给汇总会让人把「多个乘区累乘的结果」误读成「某一条固定值」。
   * 每条 = 谁给的 / 什么类型（大词条 pct 还是小词条 flat）/ 多少。
   */
  sources: {
    phase: 'outOfCombat' | 'inCombat'
    label: string
    kind: 'pct' | 'flat'
    value: number
    /** 第三维「具体内容」：与 label 一起保证唯一落位（同一 label 下可能有多条不同内容） */
    slotKey?: string
  }[]
}

export interface AttributeLedger {
  /** 基础层：角色白值 + 音擎白值（`calcBasePanel`），按 stat 列 */
  base: LedgerTable<string>
  /** 词条层：驱动盘主副词条 + 音擎高级词条的**增量**（`withDiscs − base`） */
  statLine: LedgerTable<string>
  /**
   * **公式分解**（用户 2026-10-20：「这里可以显示公式，局内局外，大词条小词条分别多少，
   * 算出来局外总数值，局内总数值」）。
   *
   * 每个核心属性给出一条可直接手算的式子：
   *   局外 = 白值 × (1 + 局外大%) + 局外小值
   *   局内 = 局外 × (1 + 局内大%) + 局内小值
   * 与 `core/buff.ts#recalcAccumStat` 同一算式（引擎即此法），数字取自已记录的面板字段。
   */
  formulas: StatFormula[]
  outOfCombat: AttributeLedgerTable
  /** 加成本层（含已结构化的队友面板效果） */
  inCombat: AttributeLedgerTable
  /** 最终层：引擎真实面板（`panels.inCombat`），与加成列和逐格对账后应无差额 */
  final: LedgerTable<string>
  /**
   * 差额对账：真实面板 − 账本合计，按属性列出。
   * 非零 = 该属性有一部分来自不走 buff 通道的来源（主副词条 / applyPanel / 转模 / 团队面板效果…）。
   */
  reconcile: { phase: AttributePhase; rows: LedgerReconcileRow<string>[] }[]
}

/**
 * 由**某相位的 buff 批次**建一张属性账。
 *
 * @param evalPanel 求值基准面板：formula/derived 的源值读它。
 *   局外批次传局外面板；局内批次按 `core/buff.ts#applyBuffs` 的两批求值语义取**局外面板**
 *   （加成批先落，派生批再读最终值 —— 见那里的 `@fact core/buff/两批求值`）。
 */
export function buildAttributeLedgerTable(
  phase: AttributePhase,
  effects: readonly BuffEffect[],
  evalPanel: PanelValues,
  coverageMap?: Map<string, number>,
): AttributeLedgerTable {
  const items: EffectItem[] = []
  for (const effect of effects) {
    const value = resolveEffectValue(effect, evalPanel, coverageMap?.get(effect.id))
    if (value === null) continue
    items.push({ effect, value })
  }
  const table = buildLedgerTable(items, effectAdapter)
  return { ...table, phase, zoneOf: zoneOfStat }
}

/**
 * 把一个**成品面板**摊成一张表单行的账（基础层 / 最终层用）。
 *
 * 这两层不是「多来源求和」，而是引擎已经算好的绝对值 —— 仍走同一个 `buildLedgerTable`，
 * 是为了让三层在结构上同形：同样有行列、同样能逐格对账，展示层不必写两套渲染。
 */
function buildStatTable(
  panel: PanelValues,
  origin: { kind: 'base' | 'final'; provider: string; slot: number },
  detail: string,
): LedgerTable<string> {
  const items: Contribution[] = []
  // 键来自「面板上实际有什么」⇒ 走 `utils/panelStat` 这个唯一合法的任意键通道
  //（不要 `as unknown as Record`：`privateCfgFields` 判据会红，且它正是绕过面板类型检查的那类写法）
  for (const stat of PANEL_STAT_KEYS_OF(panel)) {
    const value = getPanelStat(panel, stat)
    if (typeof value !== 'number' || value === 0 || stat === 'slot') continue
    items.push({
      key: normalizePanelStatAlias(stat),
      amount: value,
      mode: STAT_MODE.get(stat) ?? 'flat',
      origin: { key: origin.kind, label: origin.provider, kind: origin.kind, slot: origin.slot },
      detail,
    })
  }
  return buildLedgerTable(items, {
    keyOf: c => c.key,
    amountOf: c => c.amount,
    modeOf: c => c.mode,
    originOf: c => c.origin,
    detailOf: c => c.detail ?? detail,
    orderKey: stat => ZONE_ORDER.indexOf(zoneOfStat(stat)),
  })
}

/**
 * 两层面板的**增量**摊成账（词条层用）：`to − from`，逐属性求差。
 *
 * 为什么能这么算：`applyDriveDiscConfig` 对**加法型**字段（攻击小词条 / 精通 / 暴击…）是纯累加，
 * 差值就是该层贡献；对百分比型（`atkPct`）同理——它不是面板值而是加成输入，差值仍等于该层输入量。
 * 复合型字段（`atk` 本身 = 基础×(1+%)+固定）差值也成立，因为 `applyDriveDiscConfig` 内部按同一公式重算。
 */
function buildDeltaTable(
  from: PanelValues,
  to: PanelValues,
  origin: { kind: 'driveDisc'; provider: string; slot: number },
  detail: string,
): LedgerTable<string> {
  const items: Contribution[] = []
  for (const stat of PANEL_STAT_KEYS_OF(to)) {
    if (stat === 'slot') continue
    const value = getPanelStat(to, stat)
    if (typeof value !== 'number') continue
    const delta = value - (getPanelStat(from, stat) ?? 0)
    if (delta === 0) continue
    items.push({
      key: normalizePanelStatAlias(stat),
      amount: delta,
      mode: STAT_MODE.get(stat) ?? 'flat',
      origin: { key: origin.kind, label: origin.provider, kind: origin.kind, slot: origin.slot },
      detail,
    })
  }
  return buildLedgerTable(items, {
    keyOf: c => c.key,
    amountOf: c => c.amount,
    modeOf: c => c.mode,
    originOf: c => c.origin,
    detailOf: c => c.detail ?? detail,
    // 「不重」判据要稳定唯一 id：同一属性只出现一次，用 (层, stat) 组合
    idOf: c => `${origin.kind}-${c.key}`,
    orderKey: stat => ZONE_ORDER.indexOf(zoneOfStat(stat)),
  })
}

/**
 * 建完整属性账（局外 + 局内 + 对账）。
 *
 * @param panels `outOfCombat` 用于局外批次求值与对账；`inCombat` 用于局内对账。
 *   局内批次的**求值基准**按两批求值语义仍取局外面板。
 */
export function buildAttributeLedger(
  collected: Pick<CollectedBuffs, 'outOfCombat' | 'inCombat'>,
  panels: {
    /** 基础层：角色白值 + 音擎白值（`PanelResult.base`） */
    base?: PanelValues
    /** 词条层：基础 + 驱动盘主副词条 + 音擎高级词条（`PanelResult.withDiscs`） */
    withDiscs?: PanelValues
    outOfCombat: PanelValues
    inCombat: PanelValues
  },
  coverageMap?: Map<string, number>,
  /**
   * 队友 `teamPanelEffects` 的结构化上报（2026-10-20）：这些写入原本不在 buff 通道里，
   * 只能从面板差值反推成「不明差额」。接入后它们成为账本里的正常一行，
   * 差额里只剩真正非结构化的来源（主副词条等）。
   */
  teamPanelContributions?: readonly TeamPanelContributionLike[],
  /** 驱动盘/音擎词条的逐条上报（`calcPanel#discContributions`）：用于公式行拆解来源 */
  discContributions?: readonly DiscContributionLike[],
): AttributeLedger {
  const outOfCombat = buildAttributeLedgerTable('outOfCombat', collected.outOfCombat, panels.outOfCombat, coverageMap)
  // ⚠ 局内批次的求值基准必须用**局内最终面板**，不能用局外面板。
  //
  // 2026-10-20 用户实测纠正：「蕾米异化度又只有整数没有精通转模了」——修前这里传 `panels.outOfCombat`，
  // 于是 `remielle_refringe_coefficient_from_ap`（x × 0.02）按**局外**精通 502 算成 10.04，
  // 而引擎 `applyBuffs` 的实际两批求值语义是「加成批落完再求 formula」⇒ 读局内最终精通 648 = 12.96。
  // 账本与引擎一旦不同源，差额行就会把「转模部分」误报成「非 buff 通道来源」——
  // 那正是这张表要消灭的误导（看似账本，实则有隐藏差额）。
  const emptyTable = (): LedgerTable<string> => buildLedgerTable([] as Contribution[], {
    keyOf: c => c.key,
    amountOf: c => c.amount,
    modeOf: c => c.mode,
    originOf: c => c.origin,
    detailOf: c => c.detail ?? '',
  })
  // 未传基础层时给空表（外部直调），展示层会显示「未提供」
  const base = panels.base
    ? buildStatTable(panels.base, { kind: 'base', provider: '角色白值', slot: -1 }, '基础值')
    : emptyTable()

  /**
   * **词条层**（`withDiscs − base` 的增量）：驱动盘主副词条 + 音擎高级词条。
   *
   * 用户 2026-10-20：「他不走 buff 通道是因为核心逻辑还没有结构化…给他结构化呗」——
   * 这一层正是「走 `applyDriveDiscConfig` 而不是 buff 通道」的典型：不给它结构化，
   * 「基础 + 加成 = 最终」对攻击/精通就永远差一截，只能靠差额行解释。
   * 现在它作为**独立一行**进入加成层（提供者 = 「驱动盘词条」），差额随之缩小。
   */
  const statLine = (panels.withDiscs && panels.base)
    ? buildDeltaTable(panels.base, panels.withDiscs, { kind: 'driveDisc', provider: '驱动盘词条', slot: -1 }, '主副词条 / 音擎高级词条')
    : emptyTable()

  const inCombatBase = buildAttributeLedgerTable('inCombat', collected.inCombat, panels.inCombat, coverageMap)
  // 词条层（主副词条 / 音擎高级词条）也并进加成表：它同样是「最终面板的来源之一」，
  // 不并进来就会在「基础+加成=最终」里当差额（用户 2026-10-20：差额其实不需要）。
  inCombatBase.rows.unshift(...statLine.rows)
  for (const [stat, amount] of statLine.totals) {
    inCombatBase.totals.set(stat, (inCombatBase.totals.get(stat) ?? 0) + amount)
    if (!inCombatBase.columnMode.has(stat)) inCombatBase.columnMode.set(stat, statLine.columnMode.get(stat) ?? 'flat')
  }
  const mergedColumns = new Set([...inCombatBase.columns, ...statLine.columns])
  inCombatBase.columns = [...mergedColumns].sort(
    (a, b) => (ZONE_ORDER.indexOf(zoneOfStat(a)) - ZONE_ORDER.indexOf(zoneOfStat(b))) || a.localeCompare(b),
  )
  // 把队友面板效果的**结构化上报**并进局内表（与 buff 通道同形：同一 origin 归同一行、同一 stat 归同一列）
  const inCombat: AttributeLedgerTable = (() => {
    if (!teamPanelContributions?.length) return inCombatBase
    const rows = new Map(inCombatBase.rows.map(r => [r.origin.key, r]))
    const totals = new Map(inCombatBase.totals)
    const columnMode = new Map(inCombatBase.columnMode)
    for (const c of teamPanelContributions) {
      if (!c.value) continue
      const key = `${c.origin.kind}|${c.origin.provider}|${c.origin.slot}`
      let row = rows.get(key)
      if (!row) {
        row = {
          origin: { key, label: c.origin.provider, kind: c.origin.kind, slot: c.origin.slot },
          cells: new Map(),
          contributionCount: 0,
        }
        rows.set(key, row)
      }
      let cell = row.cells.get(c.stat)
      if (!cell) {
        cell = { key: c.stat, amount: 0, mode: c.mode, entries: [] }
        row.cells.set(c.stat, cell)
      }
      cell.amount += c.value
      cell.entries.push({ id: `teamEffect-${c.origin.slot}-${c.stat}`, detail: c.origin.source, amount: c.value })
      row.contributionCount += 1
      totals.set(c.stat, (totals.get(c.stat) ?? 0) + c.value)
      if (!columnMode.has(c.stat)) columnMode.set(c.stat, c.mode)
    }
    const columns = [...totals.keys()].sort((a, b) => {
      const d = ZONE_ORDER.indexOf(zoneOfStat(a)) - ZONE_ORDER.indexOf(zoneOfStat(b))
      return d !== 0 ? d : a.localeCompare(b)
    })
    const sortedRows = [...rows.values()].sort((a, b) => {
      const ka = KIND_ORDER[a.origin.kind] ?? 9
      const kb = KIND_ORDER[b.origin.kind] ?? 9
      if (ka !== kb) return ka - kb
      const sa = a.origin.slot ?? -1
      const sb = b.origin.slot ?? -1
      if (sa !== sb) return sa - sb
      return a.origin.label.localeCompare(b.origin.label)
    })
    return { phase: 'inCombat', columns, rows: sortedRows, totals, columnMode, zoneOf: zoneOfStat }
  })()

  /**
   * 基础层（白值）与最终层（引擎真实面板）——用户 2026-10-20 定的三表：
   * 「基础，加成，最终，就这三个可以显示所有内容。差额其实不需要」。
   *
   * 基础层来源 = `calcBasePanel`（角色 60 级白值 + 音擎白值），它是**不可再拆**的起点；
   * 有了它，「加成层」只需要解释增量，用户不必再靠"差额"去猜。
   */
  const final = buildStatTable(panels.inCombat, { kind: 'final', provider: '最终面板', slot: -1 }, '最终值')

  /**
   * 公式分解：白值 → 局外 → 局内，与引擎 `recalcAccumStat` 同一算式。
   *
   * 大/小词条的累计量来自 `core/buff.ts#recordAccumInputs` 记录的相位键
   * （`outOfCombatDefPct` / `inCombatDefPct` …）——此前累加器算完就把输入丢了，
   * 导致「克拉蕾的局内大防御、局外大防御都没算」在展示层无从查证。
   */
  const formulas: StatFormula[] = CORE_STAT_FORMULAS.map(({ stat, label, key }) => {
    const base = getPanelStat(panels.base ?? panels.outOfCombat, key) ?? 0
    const outPct = getPanelStat(panels.outOfCombat, `outOfCombat${stat}Pct`) ?? 0
    const outFlat = getPanelStat(panels.outOfCombat, `outOfCombat${stat}Flat`) ?? 0
    const inPct = getPanelStat(panels.inCombat, `inCombat${stat}Pct`) ?? 0
    const inFlat = getPanelStat(panels.inCombat, `inCombat${stat}Flat`) ?? 0
    // 来源拆解：把「大/小词条」按提供者归集（主副词条一条、套装/buff/队友各一条）
    const sources: StatFormula['sources'] = []
    const pctStat = `${key}Pct`
    const flatStat = `${key}Flat`
    const push = (phase: 'outOfCombat' | 'inCombat', table: LedgerTable<string>, labelPrefix: string) => {
      const pctCell = table.totals.get(pctStat)
      if (pctCell) sources.push({ phase, label: `${labelPrefix}·大词条`, kind: 'pct', value: pctCell })
      const flatCell = table.totals.get(flatStat)
      if (flatCell) sources.push({ phase, label: `${labelPrefix}·小词条`, kind: 'flat', value: flatCell })
    }
    // 主副词条 / 音擎高级词条：逐条来自 `calcPanel#discContributions`（applyDriveDiscConfig 上报），
    // 不用「差值反解」——差值只有合成结果，分不清 pct/flat（用户：三号位防御不是接近两千，要区分开）。
    for (const c of discContributions ?? []) {
      if (c.stat !== pctStat && c.stat !== flatStat) continue
      sources.push({
        phase: 'outOfCombat',
        label: c.origin.source,
        kind: c.stat === pctStat ? 'pct' : 'flat',
        value: c.value,
        slotKey: c.slotKey,
      })
    }
    push('outOfCombat', outOfCombat, '局外 buff/套装')
    push('inCombat', inCombat, '局内 buff/队友')
    // 加法型（暴击/增伤/精通…）没有「白值」，面板值就是总量；乘算型保留 base 与大小词条
    return {
      stat: key,
      label,
      base: stat ? base : 0,
      outPct: stat ? outPct : 0,
      outFlat: stat ? outFlat : 0,
      outTotal: getPanelStat(panels.outOfCombat, key) ?? 0,
      inPct: stat ? inPct : 0,
      inFlat: stat ? inFlat : 0,
      inTotal: getPanelStat(panels.inCombat, key) ?? 0,
      kind: stat ? 'mult' : 'add',
      sources,
    } satisfies StatFormula
  }).filter(f => f.base > 0 || f.outTotal > 0 || f.inTotal > 0)

  const panelOf = (phase: AttributePhase): PanelValues =>
    phase === 'outOfCombat' ? panels.outOfCombat : panels.inCombat
  const actualOf = (phase: AttributePhase) => (stat: string) => getPanelStat(panelOf(phase), stat)

  return {
    base,
    statLine,
    outOfCombat,
    inCombat,
    final,
    formulas,
    reconcile: [
      { phase: 'outOfCombat', rows: reconcileLedger(outOfCombat, actualOf('outOfCombat')) },
      { phase: 'inCombat', rows: reconcileLedger(inCombat, actualOf('inCombat')) },
    ],
  }
}

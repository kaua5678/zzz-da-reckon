/**
 * 命座提升率的**三分乘区分解**（用户 2026-11-05 裁决，逐字）：
 *
 * > 「纯属性提升的命座可以直接用面板计算，涉及资源的需要重算新资源的净增益，
 * >   在此基础上乘面板属性增益。」
 * > 「很多名座都加速失衡加速积蓄还有新招式。还是不锁吧」
 *
 * ## 为什么不是「新面板 / 旧面板」直接比值
 * 伤害公式是**分区块**的（基底 → 增伤 → 锐化 → 贯穿 → 防御 → 抗性 → 易伤 → 失衡 → 侵染 → 暴击 → 最终 →
 * 次数），同一个面板字段只进其中一块；直接拿总面板比值会（a）把不同块的值混成一档，（b）在跨块时给出
 * **符号都错**的结论。（c）更要命的是——**执行级命座根本不改面板**：实测 1401 C6 / 1181 C6 面板逐字段
 * 不变而伤害 +20.6% / +71.0%，任何面板比值都只能报 0%。
 *
 * ## 本模块的口径：三段串联的商，全部由**引擎自己**算
 * 对每一级 `C(n-1) → C(n)`，取两个现场（before / after）的**伤害池上下文快照**
 * （`useResourceCalc#damagePoolContext`），在同一份快照上做**反事实重算**，按用户原话的顺序串联：
 *
 * | 段 | 换什么 | 读数 |
 * |---|---|---|
 * | **① 资源** | 新次数 / 新执行计划，**单次伤害冻结在旧值** | `resourcePct` = 新资源基线的净增益 |
 * | **② 执行级** | 同样的招式，**单次伤害变了**（技能等级 / 倍率 / 附伤 / 新招式行） | `execPct` |
 * | **③ 面板** | **在新资源基线上**乘面板属性增益 | `attrPct` |
 *
 * 三段连乘 = 总提升（**定义式**：每一步的分母都是上一步的结果）。
 * 这个分解**任何一级都算得出来**，不需要先分类——分类是分解的**读数**，不是它的前提。
 *
 * ## 为什么必须用引擎的同一份伤害池，而不是自己写一套乘区连乘
 * 用户裁决与仓库口径都要求「面板增益由**同一份乘区函数**在只换面板的输入上求商」
 * （AGENTS 规则 17 / 交接文档 §3）。自己连乘会在这些地方错：
 * - 暴击区是 `1 + cr×cd` 且**暴击率封顶 100%**、溢出部分还会换爆伤（`core/critMultiplier`）；
 * - 防御区的 `penFlat` 与 `enemyDefFlatReduction` 加算、穿透率与减防相乘（`core/damageMultipliers`）；
 * - 元素字段按 `resolveStatElement` 解析（烈霜读冰、变种读基础元素）；
 * - 失衡易伤的 **Always 通道**与覆盖率插值、行级 `stunOverride`；
 * - 异常行用**虚拟面板**（掌控/精通/积蓄加权），异放还有 releaseModifier 的额外减防减抗。
 * 这些都不在「面板字段」上，用比值法必然算错。⇒ 这里只做**换面板 / 换次数重跑**，不重写任何公式。
 *
 * ## 不锁口径
 * 用户在 2026-11-05 明确「不锁吧」：本分解读的是调用方给的现场（`stunCountLock === -1` 的自由收敛态）。
 * 锁口径会把「加速失衡 / 加速积蓄 / 新招式」三条真实收益清零（实测 `auto-1591` 锁 3 窗 C1 = 44.4M
 * vs 自由 C1 = 156.86M）⇒ 分解出来的 `resourcePct` 会恒为 0，等于把这个模块的目的抹掉。
 * 判据见 `__tests__/cinemaUpliftBreakdown.test.ts`「锁口径会吞掉资源型收益」。
 */
import { buildDamagePoolRows, type DamagePoolContext } from '@/composables/resourceCalc/damagePool'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'
import { getPanelStat, setPanelStat } from '@/utils/panelStat'
import { damageFormulaFieldOf } from '@/core/damageFormulaFields'
import {
  DAMAGE_ELEMENTS, ELEMENT_FIELD_PREFIX, ENEMY_DEBUFF_KIND_CONFIG, enemyDebuffStatId,
  type EnemyDebuffKind,
} from '@/utils/enemyDebuffStats'
import { RESISTANCE_CHANNELS, resIgnoreBaseStatId, resIgnoreStatId } from '@/utils/resistanceChannels'
import type { PanelValues } from '@/types/catalog'

/** 面板快照：槽位号 → 面板（按槽位号索引，不是数组下标——面板数组是压缩的，见 core/panel.ts） */
export type PanelSnapshot = Map<number, PanelValues>

/** 从压缩面板数组取快照（未盖章的条目跳过；盖章口径见 core/panel.ts） */
export function snapshotPanels(panels: readonly PanelValues[]): PanelSnapshot {
  const out: PanelSnapshot = new Map()
  for (const p of panels) {
    const slot = p.slot
    if (typeof slot === 'number' && slot >= 0) out.set(slot, p)
  }
  return out
}

/** 用一个「按槽位换面板」的变换重跑伤害池，返回总伤害与逐行结果（行集 = 引擎原样，不增不减） */
export function rebuildDamagePool(
  ctx: DamagePoolContext,
  swapPanel: (slot: number, panel: PanelValues) => PanelValues,
): { total: number; rows: DamagePoolRow[] } {
  const panels: PanelValues[] = []
  for (const p of ctx.damagePanels) {
    const slot = p.slot
    panels.push(typeof slot === 'number' && slot >= 0 ? swapPanel(slot, p) : p)
  }
  const rows = buildDamagePoolRows({ ...ctx, damagePanels: panels })
  return { total: rows.reduce((s, r) => s + r.totalDamage, 0), rows }
}

/**
 * 分解出的**乘区身份**（可以任意组合——一级命座常常同时改面板与资源，硬塞进单一枚举就是骗人）：
 * - `RESOURCE` 资源型：次数 / 能量 / 喧响 / 失衡次数 / 异常触发次数变了；
 * - `EXEC`     执行级：招式 / 倍率 / 附伤 / 新招式行——同样的招式单次伤害变了；
 * - `ATTR`     属性型：伤害公式字段（白名单 ∪ 元素族）变了，在新基线上乘出去的增益。
 */
export type CinemaZone = 'RESOURCE' | 'EXEC' | 'ATTR'

/** 面板字段 diff 的一条记录 */
export interface PanelFieldChange {
  stat: string
  before: number
  after: number
}

/** 分解的四个中间读数（展示「新基线」用；单位 = 队伍总伤害） */
export interface CinemaBreakdownBaselines {
  /** C(n-1) 实算总伤害 */
  before: number
  /** **纯资源段**：新次数 × 旧单次伤害（单次伤害冻结，只让次数变） */
  pureResource: number
  /** **新资源基线** = 旧面板 + 新资源/执行（资源型命座换来的净增益就落在这段） */
  afterResource: number
  /** C(n) 实算总伤害 */
  after: number
}

/**
 * 一层的**三分区读数**（全部是百分比，`Pct` 后缀）。
 *
 * 恒等式（**定义式**，不是拟合；每一步的分母都是上一步的结果）：
 * `(1 + resourcePct/100) × (1 + execPct/100) × (1 + attrPct/100) = 1 + totalPct/100`
 */
export interface CinemaBreakdown {
  /** 总提升率 %（= 引擎实算 after / before − 1） */
  totalPct: number
  /** **资源型**：次数 / 能量 / 喧响 / 失衡次数换来的净增益 %（单次伤害冻结在旧值上求商） */
  resourcePct: number
  /** **执行级**：同样的招式**单次伤害变了**（技能等级 / 招式倍率 / 附伤 / 新招式行）% */
  execPct: number
  /** **属性型**：在**新资源基线**上乘的面板属性增益 %（用户原话「在此基础上乘面板属性增益」） */
  attrPct: number
  /** 真的动了的乘区（按 资源 → 执行 → 面板 顺序）；空数组 = 本级无收益 */
  components: CinemaZone[]
  /** 紧凑的组成标签（`'NONE'` / `'ATTR'` / `'RESOURCE+EXEC'` / `'RESOURCE+EXEC+ATTR'` …） */
  tier: string
  /** 本级的**伤害公式字段**变化（只列进白名单 / 元素族公式字段的那些） */
  attrFields: Array<PanelFieldChange & { role: string }>
  /** 本级的**资源通道字段**变化（能量效率 / 冲击力 / 失衡值加成 / 持续时间…） */
  resourceFields: PanelFieldChange[]
  /** 本级的执行级面板字段变化（`skillLevelBonus` / `skillDmgBonus*`）——在面板上但改的是倍率 */
  execFields: PanelFieldChange[]
  /** 只在这一级才出现的**新招式行**（新招式/新附伤 = 结构性执行级内容的机器读数） */
  newRows: string[]
  /**
   * **走资源管线的白名单字段**：公式上是乘区，但实测面板增益 ≈ 0 ——
   * 因为它们的效果体现在**次数**上（积蓄效率/掌控决定触发次数，能量效率/冲击力决定次数与窗口），
   * 而次数是资源阶段算好的、换面板重跑伤害池不会变。它们的收益已经计在 `resourcePct`/`execPct` 里，
   * 单列出来是为了**不让人以为「面板字段变了却没收益」是缺陷**（1091C1 实测就是这一类）。
   */
  attrFieldsViaResource: string[]
  /** 四个中间读数（展示「新基线」与对账用） */
  baselines: CinemaBreakdownBaselines
  /**
   * 三段商**没法定义**（旧池某种伤害彻底消失 ⇒ 纯资源基线 ≤ 0）。
   * 为 true 时三块读数不可逐段解读，展示层应如实标注而不是把噪声当结论。
   */
  coupled: boolean
}

/** 资源通道字段：改它只动资源循环，不动单次伤害式（与 damageFormulaFields 头注释的分界线一致） */
const RESOURCE_CHANNEL_RE = /^(energy|flashEnergy|decibel|backstageEnergy|nonOperatingEnergy|demaraEnergy|timeSlice|impact|inCombatImpact|outOfCombatImpact|healingAmount|zhenyuanEnergy|stunDuration)/

/** 执行级面板字段：长相在面板上，改的却是**倍率**或**招式归属**（3/5 命技能等级、招式类型增伤） */
const EXEC_PANEL_RE = /^skillLevel(Bonus|Coef)$|^skillDmgBonus(__|$)/

/** 判定「这一块真的动了」的门槛（%）：与 `cinemaUplift#UPLIFT_EPSILON_PCT` 同口径 */
export const BREAKDOWN_EPSILON_PCT = 0.05

/**
 * 元素族的伤害公式字段（白名单里有意**不登记**的那一批）。
 *
 * 为什么要在本模块另列一份：`core/damageFormulaFields.ts` 是**core 层白名单**，它按
 * 「core 不得出现角色前缀字段（判据 22）」只登记通用字段；而元素族的减抗/减防/元素增伤/
 * 元素贯穿/元素锐化/元素积蓄效率**全都是伤害乘区**（由 `utils/elementStatKeys` 生成），
 * 属性贡献账不需要它们（那些字段在角色专属段），但**命座分类必需**——
 * 实测 1021C1「敌方物理抗性 −16%」若只查白名单会被判成「非公式字段」而误分到资源型。
 * 这里按 `elementStatKey` 同一套命名规则派生，不手抄字段名。
 */
const ELEMENT_FORMULA_STATS: ReadonlySet<string> = (() => {
  const set = new Set<string>()
  // 自身无视抗性的全元素字段（enemyResIgnoreDirect / enemyResIgnoreAnomaly）同样是公式字段
  for (const channel of RESISTANCE_CHANNELS) set.add(resIgnoreBaseStatId(channel))
  const kinds = Object.keys(ENEMY_DEBUFF_KIND_CONFIG) as EnemyDebuffKind[]
  for (const e of DAMAGE_ELEMENTS) {
    if (!ELEMENT_FIELD_PREFIX[e]) continue
    for (const kind of kinds) set.add(enemyDebuffStatId(kind, e))
    // 自身无视抗性两族（2026-11-09 三通道）：同样是抗性乘区字段，且**作用范围不同**
    // （直伤族只进直伤、异常族只进异常）——不登记会被判成「非公式字段」而误分到资源型。
    for (const channel of RESISTANCE_CHANNELS) set.add(resIgnoreStatId(channel, e))
    for (const suffix of ['Dmg', 'SheerDmg', 'SharpDmg', 'CritDmg', 'AnomalyBuildUpEfficiency']) {
      set.add(e + suffix)
    }
  }
  return set
})()

/**
 * 执行级面板字段名（`skillLevelBonus` / `skillDmgBonus__x` …）。
 *
 * 为什么要单独认出它们：这些字段**长在面板上、被伤害池直接读**，但读出来的不是「属性」而是
 * **倍率系数**（`damagePoolDirect` 用 `getSkillLevelCoef(panel.skillLevelBonus).damageCoef` 乘倍率）。
 * 若不把它们从「面板」里摘出去，反事实换面板时会连**倍率**一起换掉 ⇒ 执行级被算成面板增益
 * （实测错法：3/5 命通用技能等级 8%+ 被报成 attr=8.16 / exec=0，归因完全反了）。
 */
export function isExecPanelStat(stat: string): boolean {
  return EXEC_PANEL_RE.test(stat.split('__')[0])
}

/**
 * 把执行级字段**冻在给定面板上**（其余字段取 `source`）。
 *
 * 用法 = 反事实重算前的预处理：`withPanels` 注入的「新面板」先经过这道闸，
 * 执行级字段一律回落到**资源基线那一侧**的值，于是换面板只换属性、不换倍率。
 */
export function freezeExecStats(panel: PanelValues, source: PanelValues): PanelValues {
  const out: PanelValues = { ...panel }
  for (const key of Object.keys(source)) {
    if (!isExecPanelStat(key)) continue
    // 按**运行期字符串键**读写面板：唯一合法通道是 utils/panelStat（与其余动态键读点同源，规则 11）
    setPanelStat(out, key, getPanelStat(source, key) ?? 0)
  }
  // 源上没有的执行级字段要归零——否则 after 侧新增的 skillLevelBonus 会从"目标面板"漏过来
  for (const key of Object.keys(panel)) {
    if (!isExecPanelStat(key)) continue
    if (getPanelStat(source, key) === undefined) setPanelStat(out, key, 0)
  }
  return out
}

/** 面板字段 → 伤害公式角色（白名单 ∪ 元素族公式字段）；`null` = 不进伤害式 */
export function formulaRoleOf(stat: string): string | null {
  const base = stat.split('__')[0]
  return damageFormulaFieldOf(base)?.role ?? (ELEMENT_FORMULA_STATS.has(base) ? '元素族公式字段' : null)
}

/**
 * **快照绑定**：把伤害池上下文里**读的是活 store** 的那几项一起冻下来
 * （`configStore.team` 的命座等级 / 机制设置读数）。
 *
 * 为什么必须有它（2026-11-05 实测踩到的错法的教训）：`buildDamagePoolRows` 的入参是快照，
 * 但它内部的角色循环仍读 `ctx.configStore.team[i].cinemaLevel`（模块的 cinema 分支、行级附加、
 * 异常事件派发），机制设置也现读 store。命座分析器是**逐级改命座再求值**的，
 * 若快照不绑住这两项，用「after 的执行计划 + before 的面板」重算时读到的仍是 **after 的命座等级**
 * ⇒ 资源/执行侧的效果从反事实里漏回来，属性型被系统性多算（实测错法：1401 全系 attr 与 res 同时虚高，
 * 1301C2 纯 atk 命座报成 attr=20 / res=20 / exec=−16.7）。
 *
 * 绑法 = 换成一个**只有这几项不同**的 store 视图：队伍按快照的命座等级重建，其余字段与方法原样透传
 * （模块钩子里还可能读别的 store 方法，不能整体替换）。
 */
export function bindPoolStore(
  ctx: DamagePoolContext,
  cinemaLevels: Readonly<Record<number, number>>,
  mechanicSettings: Readonly<Record<string, number>> = {},
): DamagePoolContext {
  const baseStore = ctx.configStore as unknown as {
    team: ReadonlyArray<Record<string, unknown>>
  } & Record<string, unknown>
  const team = baseStore.team.map((member, slot) => (
    cinemaLevels[slot] === undefined ? member : { ...member, cinemaLevel: cinemaLevels[slot] }
  ))
  const view = new Proxy(baseStore, {
    get(target, prop, receiver) {
      if (prop === 'team') return team
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'getMechanicSetting' || prop === 'getTeamMechanicSetting') {
        return (id: string, fallback: number) => (
          Object.prototype.hasOwnProperty.call(mechanicSettings, id)
            ? mechanicSettings[id]
            : (value as (id: string, fallback: number) => number).call(target, id, fallback)
        )
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { ...ctx, configStore: view as unknown as DamagePoolContext['configStore'] }
}

/**
 * 两个面板快照逐字段 diff。
 *
 * 三个桶的分法 = 用户「纯属性 vs 资源」那句话的机器化：
 * - **公式字段**（白名单 ∪ 元素族）→ 属性型；
 * - **资源通道字段**（能量/喧响/冲击力/失衡值加成/持续时间）→ 资源型；
 * - **倍率类面板字段**（`skillLevelBonus` / `skillDmgBonus*`）→ 执行级（它们在面板上，改的却是倍率）；
 * - 其余（角色专属开关/状态位）→ 执行级：它们改的是「怎么打」，不是「打出多少」。
 *
 * 纯函数：输入是快照，输出是读数，不碰引擎、不碰 store，测试可直接构造。
 */
export function diffPanels(
  before: PanelSnapshot,
  after: PanelSnapshot,
  slots?: readonly number[],
): {
  attrFields: CinemaBreakdown['attrFields']
  resourceFields: PanelFieldChange[]
  execFields: PanelFieldChange[]
} {
  const attrFields: CinemaBreakdown['attrFields'] = []
  const resourceFields: PanelFieldChange[] = []
  const execFields: PanelFieldChange[] = []
  const slotList = slots ?? [...new Set([...before.keys(), ...after.keys()])]
  for (const slot of slotList) {
    const pb = before.get(slot)
    const pa = after.get(slot)
    const keys = new Set<string>([
      ...(pb ? Object.keys(pb as unknown as Record<string, unknown>) : []),
      ...(pa ? Object.keys(pa as unknown as Record<string, unknown>) : []),
    ])
    for (const key of keys) {
      const b = pb ? (getPanelStat(pb, key) ?? 0) : 0
      const a = pa ? (getPanelStat(pa, key) ?? 0) : 0
      // 面板上除了数值还有**非数值载荷**（如蕾米的 `remielleTeammateDrops`：设置映射原样挂在面板上，
      // 供她自己的资源卡/异常行读取）。它们不进伤害公式，也不是「属性」——直接跳过，
      // 否则 `Math.abs({} - {})` 得到 NaN，会让「有变化」的判断静默失效。
      if (typeof a !== 'number' || typeof b !== 'number') continue
      if (Math.abs(a - b) <= 1e-9) continue
      const base = key.split('__')[0]
      const role = formulaRoleOf(key)
      if (EXEC_PANEL_RE.test(base)) execFields.push({ stat: key, before: b, after: a })
      else if (role != null) attrFields.push({ stat: key, before: b, after: a, role })
      else if (RESOURCE_CHANNEL_RE.test(base)) resourceFields.push({ stat: key, before: b, after: a })
      else execFields.push({ stat: key, before: b, after: a })
    }
  }
  const byStat = (x: { stat: string }, y: { stat: string }) => x.stat.localeCompare(y.stat)
  attrFields.sort(byStat)
  resourceFields.sort(byStat)
  execFields.sort(byStat)
  return { attrFields, resourceFields, execFields }
}

/**
 * 伤害行的**身份键**：同一招式在两级的「单次伤害」可比，必须靠它对齐。
 *
 * 为什么不用 `id`：`id` 带同招式多行的去重序号（`seenDirectIds`），序号会随行数变化漂移；
 * 也不用 `multiplier`：那正是执行级会改的东西。取「槽位 + 类型 + 招式身份 + 名字 + 元素」这一组
 * ——它只描述「这是哪一招打的什么伤害」，不描述「打了多少次」「单次多少」。
 */
function rowKey(row: DamagePoolRow): string {
  return [row.slot, row.type, row.moveId ?? '', row.name, row.element].join('|')
}

/** 一级读数用的行聚合（次数 + 总伤害）；单次伤害由 `total / count` 得到 */
interface RowAggregate { count: number; total: number }

function aggregateRows(rows: readonly DamagePoolRow[]): Map<string, RowAggregate> {
  const out = new Map<string, RowAggregate>()
  for (const row of rows) {
    const key = rowKey(row)
    const prev = out.get(key)
    if (prev) {
      prev.count += row.count
      prev.total += row.totalDamage
    } else {
      out.set(key, { count: row.count, total: row.totalDamage })
    }
  }
  return out
}

/** 百分比（%），分母 ≤ 0 时返回 0（与 cinemaUplift#gainPct 同口径） */
function pctOf(after: number, before: number): number {
  return before > 0 ? ((after - before) / before) * 100 : 0
}

export interface CinemaBreakdownInput {
  /** before 现场（C(n-1)）的伤害池上下文快照（**必须已 `bindPoolStore`**，否则命座等级会漏） */
  beforeCtx: DamagePoolContext
  /** after 现场（C(n)）的伤害池上下文快照（同上） */
  afterCtx: DamagePoolContext
  /**
   * 用**指定面板**重算伤害池（= `useResourceCalc#damagePoolContextWithPanels`）。
   *
   * 为什么必须由调用方注入而不是本模块自己 §{ ...ctx, damagePanels }§：
   * 结算侧还有**异常池三项伤害**（紊乱 / 乱流 / 畏缩 DoT）是用面板另算的，只换 `damagePanels`
   * 会让异常族继续读旧面板 ⇒ 面板增益被系统性低估、差额漏进执行级残差。
   * 注入 = 让「换面板」这件事只有一处实现，本模块只管算术。
   */
  withPanels: (ctx: DamagePoolContext, panels: PanelValues[]) => DamagePoolContext
  /** before / after 的**结算面板**数组（= ctx.damagePanels 的那一份，含霜寒/侵染盖章） */
  beforePanels: readonly PanelValues[]
  afterPanels: readonly PanelValues[]
  /** 被评估的槽位（缺省 = 全部） */
  slots?: readonly number[]
  /** 两句总伤害（缺省用快照重算；传引擎实算值可省两次求值） */
  beforeTotal?: number
  afterTotal?: number
}

/** 把「按槽位换面板」的变换灌进上下文（唯一入口是调用方注入的 `withPanels`） */
function swapPanels(
  input: Pick<CinemaBreakdownInput, 'withPanels'>,
  ctx: DamagePoolContext,
  current: readonly PanelValues[],
  from: PanelSnapshot,
  to: PanelSnapshot,
): DamagePoolContext {
  const next = current.map(p => {
    const slot = p.slot
    if (typeof slot !== 'number' || slot < 0) return p
    const target = to.get(slot) ?? p
    // 执行级字段（技能等级 / 招式增伤）**冻在 from 那一侧**：它是倍率不是属性，
    // 换面板只许换属性，否则换面板会把倍率一起换掉（归因反过来，见 isExecPanelStat 头注释）。
    const source = from.get(slot) ?? target
    return freezeExecStats(target, source)
  })
  return input.withPanels(ctx, next)
}

/**
 * **三分区分解**（本模块的唯一入口）。按用户 2026-11-05 的原话顺序，做成三段**串联**的商：
 *
 * 1. **资源**：同样的招式、**同样的单次伤害**，只把次数换成新阶段的次数
 *    ⇒ `resourcePct` = pureResource / before − 1
 * 2. **执行级**：在新资源基线上，**同样的招式单次伤害变了**（技能等级 / 倍率 / 附伤 / 新招式行）
 *    ⇒ `execPct` = afterResource / pureResource − 1
 * 3. **面板**：在**新资源基线**上乘面板属性增益（面板从 before 换成 after）
 *    ⇒ `attrPct` = after / afterResource − 1
 *
 * 三段连乘 = 总提升（**定义式**：`after` 是链的终点，每一步的分母都是上一步的结果）。
 *
 * ## 两个关键的手法（都是实测逼出来的）
 * **① 「次数」与「单次伤害」靠行身份拆开**：用 after 的执行计划 + **旧面板**重跑伤害池，
 * 得到的行次数是新的、单次伤害也是新的；再按行身份去旧池取**旧单次伤害**，
 * 用「新次数 × 旧单次」拼出「只换资源」的伤害，差值归执行级。
 * 这条拆分**不需要锁失衡次数**（锁口径会把资源通道清零，用户 2026-11-05 已明确不要）。
 *
 * **② 失衡易伤覆盖率冻结在旧值**：覆盖率是**资源/时间通道**的产物（多打几次失衡 ⇒ 更多秒吃易伤），
 * 用户把「加速失衡」明确归资源型。不冻的话覆盖率抬升会改变同一招式的**单次伤害**，
 * 被误算成执行级（实测 1401C1 纯面板命座因此报出假执行级）。它真正的贡献留在 ① 的**次数**里。
 */
export function computeCinemaBreakdown(input: CinemaBreakdownInput): CinemaBreakdown {
  const beforeSnapshot = snapshotPanels(input.beforePanels)
  const afterSnapshot = snapshotPanels(input.afterPanels)

  const beforePool = rebuildDamagePool(input.beforeCtx, (_s, p) => p)
  const afterPool = rebuildDamagePool(input.afterCtx, (_s, p) => p)
  const beforeTotal = input.beforeTotal ?? beforePool.total
  const afterTotal = input.afterTotal ?? afterPool.total
  const beforeRows = aggregateRows(beforePool.rows)

  // 新资源基线：新执行计划 + 旧面板 + 旧失衡覆盖率（只换资源/执行）
  const resCtx = swapPanels(input, { ...input.afterCtx, stunCoverage: input.beforeCtx.stunCoverage }, input.afterCtx.damagePanels, afterSnapshot, beforeSnapshot)
  const resPool = rebuildDamagePool(resCtx, (_s, p) => p)
  const resRows = aggregateRows(resPool.rows)

  // ① 纯资源：新次数 × **旧单次伤害**（旧池里没有的招式行 ⇒ 单次伤害无旧值 ⇒ 整体归执行级）
  let pureResource = 0
  const newRows: string[] = []
  for (const [key, agg] of resRows) {
    const old = beforeRows.get(key)
    if (!old || old.count <= 0) {
      newRows.push(key)
      continue
    }
    pureResource += agg.count * (old.total / old.count)
  }
  newRows.sort()

  const resourcePct = pctOf(pureResource, beforeTotal)
  const execPct = pctOf(resPool.total, pureResource)
  const attrPct = pctOf(afterTotal, resPool.total)

  const diff = diffPanels(beforeSnapshot, afterSnapshot, input.slots)
  /**
   * 通道判定 = **以实测为准**，面板字段 diff 只在「量不到」时兜底。
   *
   * 为什么不能只靠 diff（2026-11-05 实机 DOM 读回抓到的缺陷）：白名单里有一批字段，
   * 公式上确实是乘区，但它们的**效果走的是资源管线**而不是伤害池——
   * `anomalyBuildUpEfficiency` / `anomalyMastery` 决定**触发次数**（资源阶段算好），
   * `energyGainEfficiency` / `impact` 决定次数与窗口。换面板重跑伤害池时，次数不会变
   * ⇒ `attrPct` 实测就是 0。旧判据却因为「白名单字段变了」把 `ATTR` 写进标签，
   * 于是 1091C1 印出「面板 ±<0.1%」却在 `ATTR` 组里——**标签与读数自相矛盾**。
   *
   * 现在的判据：哪一段实测非零就归哪一段；**三段全为零**（本级确实量不到收益）时才回落到
   * 「哪个通道有字段变化」——这正是 1011C1（能量效率 +12%，本夹具伤害零移动）那种情况需要的兜底。
   */
  const measured = {
    RESOURCE: Math.abs(resourcePct) >= BREAKDOWN_EPSILON_PCT,
    EXEC: Math.abs(execPct) >= BREAKDOWN_EPSILON_PCT,
    ATTR: Math.abs(attrPct) >= BREAKDOWN_EPSILON_PCT,
  }
  const anyMeasured = measured.RESOURCE || measured.EXEC || measured.ATTR
  const components: CinemaZone[] = []
  if (measured.RESOURCE || (!anyMeasured && diff.resourceFields.length > 0)) components.push('RESOURCE')
  if (measured.EXEC || (!anyMeasured && (diff.execFields.length > 0 || newRows.length > 0))) components.push('EXEC')
  if (measured.ATTR || (!anyMeasured && diff.attrFields.length > 0)) components.push('ATTR')

  return {
    totalPct: pctOf(afterTotal, beforeTotal),
    resourcePct,
    execPct,
    attrPct,
    components,
    tier: components.length > 0 ? components.join('+') : 'NONE',
    attrFields: diff.attrFields,
    resourceFields: diff.resourceFields,
    execFields: diff.execFields,
    newRows,
    attrFieldsViaResource: measured.ATTR ? [] : diff.attrFields.map(f => f.stat),
    baselines: {
      before: beforeTotal,
      pureResource,
      afterResource: resPool.total,
      after: afterTotal,
    },
    // 三段商没法定义（旧池某种伤害彻底消失 ⇒ 纯资源基线 ≤ 0）⇒ 如实标耦合，不伪造数字。
    coupled: !(beforeTotal > 0) || !(pureResource > 0),
  }
}

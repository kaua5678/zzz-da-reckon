/**
 * 自由对比工作台 · x 轴维度注册表 + 系列/约束规格（纯数据 + 纯函数）
 *
 * 与 `metrics.ts` 同构：**加一个 x 维度 = 往 `AXES` 里加一行**（判据：不动组件、不改 SVG）。
 *
 * 设计取向（用户 2026-09-14「要求不明确」时的正解，不是第 N 张专用图）：
 * ```
 * 系列 = 自选实体（单人 | 整队）× 自选配置码（影画 + 精炼）
 *  x   = 自选维度        y = 自选指标        约束 = 其余一切（Boss/金数/难度/版本/配装…）
 * ```
 * 判据 = **任何一维都能单独改，其余不动**；加新指标/新 x 维度是「往表里加一行」不是「再造一张图」。
 */

// ========== 配置码 ==========
// 实现已外提 `utils/setupCode.ts`（2026-10-25：队伍对比「逐槽锁定」要用同一套解析，复制一份会在
// 「右位 0 = 无专武」这条边界上分叉）。此处只转出，保持自由对比既有 import 面不变。
import { formatSetupCode, parseSetupCode, setupCodeLabel, type SetupCode } from '@/utils/setupCode'
export { formatSetupCode, parseSetupCode, setupCodeLabel, type SetupCode }

// ========== 系列规格 ==========

/**
 * 系列要对比的「实体」：
 * - `team`：整队（三人组）—— y 读全队量（或按槽位挑的人）
 * - `agent`：单人 —— 把该角色放进**固定基底队**（约束里指定的另两人），y 只读他的分量
 *
 * ⚠「单人」的实现口径：**引擎没有单角色求值入口**（`useResourceCalc` 从 `configStore.team[0..2]`
 * 构建，语义恒为队伍级）。所以单人 = 固定队友 + 读该槽位子集 —— 这也正是 `damagePoolRows`
 * 天生带 `slot/agentId` 的原因，不是缺陷是设计。
 */
export type SubjectKind = 'team' | 'agent'

export interface SeriesSpec {
  /** 稳定 id（图例/筛选/去重键） */
  id: string
  kind: SubjectKind
  /** kind='team' 时是三人 id；kind='agent' 时是单人 id（队友在约束里给） */
  members: string[]
  /** 该系列的**缺省**配置码（影画 + 精炼）：`slotCodes` 没填的槽位用它 */
  code: SetupCode
  /**
   * 整队系列：只让**这一槽**跟随 x 轴档位（如影画 0→6），其余两槽固定用 `code` / `slotCodes`。
   * 缺省（undefined）= 全部槽位一起跟档位走（「全队同步升命」）。
   *
   * 用途（用户 2026-10-27）：「一个队伍三人的命座提升率，三条线共图」——三条**同成员**整队系列
   * 各设 `variedSlot` 0/1/2、x = 影画，就得到「另两人固定 01、只变一人」的三条边际曲线。
   * 为什么必须同队形：单人系列会把本人放到槽 0（队友用一对全局基底），三条线的槽位排列不同，
   * C0 基线就不再是同一支队；整队系列 + `variedSlot` 保持成员与槽位顺序完全一致。
   */
  variedSlot?: number
  /**
   * 逐槽配置覆盖（2026-10-25，用户：「队友是固定65丽娜61克拉蕾，怎么选」）。
   *
   * **为什么必须有**：`code` 一个码会套到**全部三个槽位**（`engine.ts` 的 `condSlots.get(slot) ?? code`），
   * 于是「诺姆 30 + 丽娜 65 + 克拉蕾 61」这种最常见的实战配置根本表达不出来——
   * 只能靠「锁定条件」逐个人填，而条件的用途是**场景约束**（用户原话「维琳娜0/1/2命是条件」），
   * 混用会让人分不清「这是被比的还是被锁的」。
   *
   * 语义：数组下标 = 槽位号；`null`/缺省 = 该槽用 `code`。
   * 与 `code` 的优先级：**条件 > slotCodes > code**（条件永远胜，见 engine 装配段）。
   */
  slotCodes?: ReadonlyArray<SetupCode | null>
}

/**
 * 空系列占位：档位/切片枚举只读 `AxisOptions`，与成员/配置无关；
 * `series` 为空时求值循环不会执行，但仍要能枚举出档位与切片（UI 的代价预告也用它）。
 */
export const EMPTY_SERIES_SPEC: SeriesSpec = { id: '', kind: 'agent', members: [], code: { cinema: 0, wengine: 1 } }

// ========== x 轴维度 ==========

/**
 * CC-189：原先还有 'gold'（总限定金）与 'difficulty'（操作难度档）两个维度——下拉可选，但求值器从不读它们的
 * 覆盖字段 ⇒ 每档装配相同、画出一条平线（假维度）。两者都没有现成口径（金怎么分给三人 / 难度档映射哪些旋钮），
 * 已删除。要加回来：先定口径并在 engine.ts 装配段消费 override，再加一行 AXES。
 */
export type AxisId = 'setupCode' | 'cinema' | 'wengine' | 'period'

/**
 * x 轴维度定义。**加维度 = 加一行**。
 *
 * `levels` 是**纯枚举**（不碰 store）：返回该维度上要跑哪些档位。
 * 求值器按返回的档位逐个「装配 → 求值 → 恢复」。
 */
export interface AxisDef {
  id: AxisId
  label: string
  /**
   * 作为**切片维度**时的短名（如「影画」而不是「影画 0→N」）。
   * 同一维度当 x 轴时要说明枚举方向，当切片标题时只要变量名 ⇒ 两处用不同的词。
   */
  sliceLabel: string
  hint: string
  /**
   * 枚举该维度上的档位。**纯函数**：只描述「要跑哪些档」，不写 store。
   * @param spec 系列规格（配置码/成员，维度可能用得上）
   * @param opts 档位生成参数（各维度自己解释）
   */
  levels: (spec: SeriesSpec, opts: AxisOptions) => AxisLevel[]
}

/** 一个 x 档位 */
export interface AxisLevel {
  /** x 轴上的排序键（数值，等距或按值均可，UI 按此升序排） */
  x: number
  /** 刻度标签 */
  label: string
  /** 该档位下覆盖到系列上的配置（求值器据此装配） */
  override: LevelOverride
}

/** 档位对系列的覆盖（未给的字段沿用系列自身配置码） */
export interface LevelOverride {
  cinema?: number
  wengine?: number
  /** 危局期 id（= boss-presets 里所选 Boss 的 `phaseId`；period 维度用，求值器按它装配该期 Boss） */
  periodId?: string
}

export interface AxisOptions {
  /** 影画上限（cinema 维度用，默认 6） */
  cinemaMax?: number
  /** 精炼上限（wengine 维度用，默认 5） */
  wengineMax?: number
  /** 期数清单（period 维度用）：所选 Boss 的各期危局，id = `phaseId`，建议按时间从旧到新 */
  periods?: Array<{ id: string; label: string }>
  /** 配置码维度：要跑哪几个码（默认 `DEFAULT_SETUP_CODES`） */
  setupCodes?: string[]
  /** 条件角色影画切片的上限（`sliceLevelsOf` 的条件切片用，默认 6） */
  conditionCinemaMax?: number
}

/** 用户原话里的配置码序列（「21 / 11 / 20 / 01」）—— 配置码维度的默认候选 */
export const DEFAULT_SETUP_CODES = ['01', '11', '21', '20'] as const

export const AXES: AxisDef[] = [
  {
    id: 'setupCode',
    label: '配置码',
    sliceLabel: '配置码',
    hint: '横轴 = 影画+精炼的两位配置码（用户原话「21/11/20/01」）—— 默认档就是这四个',
    levels: (_spec, opts) => {
      const list = opts.setupCodes?.length ? opts.setupCodes : [...DEFAULT_SETUP_CODES]
      return list
        .map(parseSetupCode)
        .filter((c): c is SetupCode => c !== null)
        .map((c, i) => ({
          x: i,
          label: formatSetupCode(c),
          override: { cinema: c.cinema, wengine: c.wengine },
        }))
    },
  },
  {
    id: 'cinema',
    label: '影画 0→N',
    sliceLabel: '影画',
    hint: '横轴 = 命座等级，精炼固定在系列配置码上 —— 「看这个角色吃几命开始赚」',
    levels: (_spec, opts) => {
      const max = Math.max(0, Math.min(6, opts.cinemaMax ?? 6))
      return Array.from({ length: max + 1 }, (_, v) => ({
        x: v,
        label: `${v}命`,
        override: { cinema: v },
      }))
    },
  },
  {
    id: 'wengine',
    label: '专武精炼 1→5',
    sliceLabel: '专武精炼',
    hint: '横轴 = 专武精炼档（0 = 无专武），命座固定在系列配置码上',
    levels: (_spec, opts) => {
      const max = Math.max(1, Math.min(5, opts.wengineMax ?? 5))
      // 含 0 = 无专武档：用户可能就是想知道「不抽专武差多少」
      return Array.from({ length: max + 1 }, (_, v) => ({
        x: v,
        label: v === 0 ? '无专武' : `精${v}`,
        override: { wengine: v },
      }))
    },
  },
  {
    id: 'period',
    label: 'Boss 期数',
    sliceLabel: 'Boss 期数',
    hint: '横轴 = 所选 Boss 的各期危局（换期 = 换血量/抗性/弱点）—— 「这队能打几期」；需先在条件里选 Boss',
    levels: (_spec, opts) => (opts.periods ?? []).map((p, i) => ({
      x: i,
      label: p.label,
      override: { periodId: p.id },
    })),
  },
]

export const AXIS_BY_ID: ReadonlyMap<AxisId, AxisDef> = new Map(AXES.map(a => [a.id, a]))

/** 默认 x 维度 = 配置码（用户原话「21 对比 11」就是这个维度） */
export const DEFAULT_AXIS_ID: AxisId = 'setupCode'

export function axisOptions(): Array<{ value: AxisId; label: string }> {
  return AXES.map(a => ({ value: a.id, label: a.label }))
}

// ========== 切片维度（第二变量） ==========

/**
 * 切片维度 = 2D 图之外的**第三个变量**：同一组「系列 × x × y」按它切成多张
 * （多重二维切片）或叠成 3D 的一条道。用户口径（2026-10-17）：
 *   「自由对比中，加入3维图或者多重二维切片，便于某些变量情况下的比较。」
 *
 * 两种切片：
 *  - `axis`：复用既有 x 维度注册表（`AXES`）——如 x = 专武精炼、切片 = 影画；
 *  - `condition`：把某个**锁定条件角色**的影画逐档切开（用户原话里「维琳娜 0/1/2 命」本来就是条件，
 *    此前只能改条件重跑，现在一次出全）。
 *
 * ⚠ **禁止与 x 轴抢同一字段**（`sliceConflicts`）：两个轴都写 cinema 时，求值器只能二选一，
 * 另一条轴就会画成平线——那正是 CC-189 删掉「金数/难度」两个假维度的原因。
 * 宁可让下拉里不出现这个组合，也不让用户跑完才发现某条轴没生效。
 *
 * @fact engine:freeCompare/切片维度 口径: 切片与 x 轴覆盖同一档位字段时禁止组合（否则一条轴静默失效） | 据 用户@2026-10-17 | 验 freeCompare.test.ts | 锚 src/composables/freeCompare/axes.ts#sliceConflicts | 信 高
 * ⟳复核: 新增 x 维度或 LevelOverride 字段时，复核 AXIS_FIELDS 是否同步登记（漏登记 = 抢字段组合不再被拦） | 到期 2027-04-17
 */
export type SliceSpec =
  | { kind: 'axis'; axisId: AxisId }
  | { kind: 'condition'; agentId: string }

/** 一个切片档位 */
export interface SliceLevel {
  /** 稳定 id（DOM key / 结果切片识别） */
  id: string
  /** 切片标题（如「2命」「精3」） */
  label: string
  /** 轴切片：该片追加的档位覆盖（与 x 档位同字段的组合已被禁止） */
  axisOverride?: LevelOverride
  /** 条件切片：该片把该条件角色的影画固定到 `cinema` */
  condition?: { agentId: string; cinema: number }
}

/** x 轴覆盖的档位字段（切片不能与 x 抢同一个） */
const AXIS_FIELDS: Record<AxisId, ReadonlyArray<keyof LevelOverride>> = {
  setupCode: ['cinema', 'wengine'],
  cinema: ['cinema'],
  wengine: ['wengine'],
  period: ['periodId'],
}

/** 该切片与 x 轴是否覆盖同一字段（true = 禁止组合，见上方 @fact） */
export function sliceConflicts(slice: SliceSpec, xAxisId: AxisId): boolean {
  if (slice.kind === 'condition') return false
  const mine = AXIS_FIELDS[slice.axisId]
  const theirs = AXIS_FIELDS[xAxisId]
  return mine.some(f => theirs.includes(f))
}

/**
 * 枚举切片档位（纯函数，与 `AxisDef.levels` 同构）。
 * 轴切片直接复用 x 维度注册表；条件切片 = 0..`conditionCinemaMax` 命。
 */
export function sliceLevelsOf(spec: SeriesSpec, slice: SliceSpec, opts: AxisOptions = {}): SliceLevel[] {
  if (slice.kind === 'condition') {
    const max = Math.max(0, Math.min(6, opts.conditionCinemaMax ?? 6))
    return Array.from({ length: max + 1 }, (_, cinema) => ({
      id: `condition:${slice.agentId}:${cinema}`,
      label: `${cinema}命`,
      condition: { agentId: slice.agentId, cinema },
    }))
  }
  const axis = AXIS_BY_ID.get(slice.axisId)
  if (!axis) return []
  return axis.levels(spec, opts).map((level, i) => ({
    id: `axis:${slice.axisId}:${i}`,
    label: level.label,
    axisOverride: level.override,
  }))
}

/** 切片维度在图表标题里的名字（没开切片时调用方不调用它，直接传 null） */
export function sliceTitleOf(slice: SliceSpec, nameOf: (agentId: string) => string): string {
  if (slice.kind === 'condition') return `${nameOf(slice.agentId)} 影画`
  return AXIS_BY_ID.get(slice.axisId)?.sliceLabel ?? slice.axisId
}

/**
 * 切片下拉选项（`value` 走 `sliceKeyOf` 编码）。
 * 用 type 别名而不是 interface：naive 的 SelectMixedOption 带 `[k: string]: unknown`，
 * interface 没有隐式索引签名 ⇒ 赋值不过（对象字面量才有）。
 */
export type SliceOption = {
  value: string
  label: string
  disabled?: boolean
}

/**
 * 切片下拉：`无` + 不与 x 抢字段的轴 + 已锁定的条件角色。
 * `periodsAvailable = false`（没选 Boss）时保留 Boss 期数项但置灰——直接隐藏会让用户
 * 以为「期数不能切片」，而实际只是缺一个前置条件。
 */
export function sliceOptions(
  xAxisId: AxisId,
  conditions: ReadonlyArray<{ agentId: string }>,
  nameOf: (agentId: string) => string,
  periodsAvailable = true,
): SliceOption[] {
  const out: SliceOption[] = [{ value: '', label: '无（单张 2D 图）' }]
  for (const axis of AXES) {
    if (sliceConflicts({ kind: 'axis', axisId: axis.id }, xAxisId)) continue
    out.push({
      value: `axis:${axis.id}`,
      label: `${axis.sliceLabel}（切片）`,
      disabled: axis.id === 'period' && !periodsAvailable,
    })
  }
  for (const c of conditions) {
    out.push({ value: `condition:${c.agentId}`, label: `${nameOf(c.agentId)} 影画（切片）` })
  }
  return out
}

/** 下拉值 ↔ 切片规格（`''` = 无切片） */
export function sliceKeyOf(slice: SliceSpec | null): string {
  if (!slice) return ''
  return slice.kind === 'axis' ? `axis:${slice.axisId}` : `condition:${slice.agentId}`
}

export function parseSliceKey(key: string): SliceSpec | null {
  if (!key) return null
  const sep = key.indexOf(':')
  if (sep <= 0) return null
  const kind = key.slice(0, sep)
  const value = key.slice(sep + 1)
  if (!value) return null
  if (kind === 'axis') {
    const axis = AXES.find(a => a.id === value)
    return axis ? { kind: 'axis', axisId: axis.id } : null
  }
  if (kind === 'condition') return { kind: 'condition', agentId: value }
  return null
}

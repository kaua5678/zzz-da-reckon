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

/**
 * 配置码 = 两位数字：左位 = 影画/命座（0–6），右位 = 专武精炼（1–5，精炼 1 = 只有本体）。
 *
 * 用户裁决 2026-09-14（逐字）：「两个数字通常指配置，比如 21 第一个是代表 2命，1 代表专武精炼1」。
 * ⇒ `21` = 2 命 + 精炼 1；`01` = 0 命 + 本体。
 *
 * **右位 = 0 的边界（如 `20`）按「无专武」解释** —— 见 `SetupCode.wengine` 的 0 分支。
 * 这是本会话提案里必须点明给用户的一条：游戏里没有「精炼 0」，所以 0 只能读作「没这把专武」。
 */
export interface SetupCode {
  /** 影画/命座 0–6 */
  cinema: number
  /**
   * 专武精炼 1–5；**0 = 无专武**（穿下位/常驻音擎）。
   * 承载现成：`GoldStep.kind='wengine'`（value 1-5），无专武 = **不写该槽的 wEngine 获取步**。
   */
  wengine: number
}

/** 配置码字符串（如 "21" / "01" / "20"）→ 结构化。非法返回 null（不抛，UI 直接标红） */
export function parseSetupCode(text: string): SetupCode | null {
  const s = text.trim()
  if (!/^\d{2}$/.test(s)) return null
  const cinema = Number(s[0])
  const wengine = Number(s[1])
  if (cinema > 6) return null
  if (wengine > 5) return null
  return { cinema, wengine }
}

/** 结构化 → 配置码字符串（UI 回显/去重键） */
export function formatSetupCode(c: SetupCode): string {
  return `${c.cinema}${c.wengine}`
}

/** 人类可读标签（图例/悬浮卡）：`21` → 「2命 精1」；`20` → 「2命 无专武」 */
export function setupCodeLabel(c: SetupCode): string {
  return c.wengine === 0 ? `${c.cinema}命 无专武` : `${c.cinema}命 精${c.wengine}`
}

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
  /** 该系列的配置码（影画 + 精炼） */
  code: SetupCode
}

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
}

/** 用户原话里的配置码序列（「21 / 11 / 20 / 01」）—— 配置码维度的默认候选 */
export const DEFAULT_SETUP_CODES = ['01', '11', '21', '20'] as const

export const AXES: AxisDef[] = [
  {
    id: 'setupCode',
    label: '配置码',
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

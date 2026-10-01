/**
 * 自由对比工作台 · y 轴指标注册表（单一事实源）
 *
 * 为什么是「注册表」而不是一处 switch：用户要的是「各项数据也能比」的**自由对比工作台**
 * （用户原话 2026-09-14：「这就是个自由的对比图表，可以比单人也能比全队，各项数据也能比」）。
 * 判据 = **加一个新指标就是往 `METRICS` 数组里加一行**，不动组件、不动 SVG、不动表格列。
 * 换成 switch/if-else 的话，每加一个指标要改 N 处（取值 switch + 单位 switch + 格式化 switch
 * + 每份脚本时的取值点）——那正是"再造一张图"的翻版。
 *
 * **三条硬口径**（写指标时必须遵守，否则数值会静默错）：
 *  ① 失衡次数一律取 `stunPoolResult.stunCount`（**不适** `resourceResult.plannedStunCount`
 *     —— 后者是「外层不动点喂进本轮的输入值」不是答案，`types/resource/team.ts:94-99`
 *     记着 2026-09-07 的误读事故：同队实测 1.27 vs 池真值 4.00，读错零报错）。
 *  ② 前台占用一律取 `netFrontlineOccupation`（单一事实源 `core/resource/helpers.ts`），
 *     不要自己 Σ `totalTime`（会漏合轴抵扣/轴内节省）。
 *  ③ Boss 血量比用出错，**脑子里想的 hpRatio 不是引擎字段** —— 引擎里没有这个量，
 *     它是消费端 `damage / configStore.enemy.hp` 派生的（范式见 `archiveDeployStun.test.ts`）。
 *
 * **取 vector 不取标量**：同一批 poolRows / resourceResult 我要按槽位、按伤害类型、按
 * sourceTag 反复分组 ⇒ `read(ctx)` 返回一个**数字向量**（key → value，含聚合键 `__total__`），
 * 由 UI 侧按「系列要哪个槽位」挑一个分量。**这样做的原因**：一次引擎求值 ~0.3-0.4s
 * （codes: `TeamComparePage.vue` 注释「每队 ~10 次 ≈ 3~4 秒」），为一个系列重新求值只是因为
 * 「这次想看另一个人的伤害」是不可接受的代价。
 */
import { compact } from '@/utils/format'
import type { ResourceCalc } from '@/composables/useResourceCalc'

/** 一次求值后引擎暴露的全部读数（= useResourceCalc() 的返回值） */
export type Calc = ResourceCalc

/**
 * 读指标时的环境（引擎侧取不到、由调用方给的上下文）。
 * `hp` 单独给是因为「Boss 血量比」这个量**引擎里根本没有** —— 它是消费端
 * `damage / enemy.hp` 的派生量（范式 `archiveDeployStun.test.ts`）。把它塞进 read 的
 * 参数而不是从 store 反查，是为了让本注册表保持纯函数（可直接单测，无需 pinia）。
 */
export interface MetricEnv {
  /** 当前 Boss 血量（0 = 未知，此时比例类指标读 0 而不是 NaN） */
  hp: number
}

/** 聚合键：总量。UI 要「全队」就读它，要「某个角色」读 `${agentId}` */
export const TOTAL_KEY = '__total__'

/** 向量：分组键 → 数值。永远带 `__total__` */
export type MetricVector = Record<string, number>

/**
 * 指标作用域：
 * - `team`：团队量，槽位分组无意义（UI 不出槽位选择器）
 * - `perSlot`：可以按角色取（向量里除了 `__total__` 还有 `agentId` 分量）
 */
export type MetricScope = 'team' | 'perSlot'

export interface MetricDef {
  id: string
  /** UI 显示名 */
  label: string
  /** 一句说明（作为 tooltip，写清口径而不是复述公式） */
  hint: string
  scope: MetricScope
  /** 展示时的小数位数（0 = 整数） */
  digits: number
  /** 单位后缀（'' = 无；'%'=读数是 0~1 的比例） */
  unit: '' | '%' | ' /s'
  /** 是否为「越大越好」（false = 越小越好）。消费方：`bestSeriesIndexByLevel` → 汇总表每档最优系列着色（CC-204） */
  higherBetter: boolean
  /**
   * 读取向量。**必须纯读**——不许触发第二次求值（引擎 computed 是惰性的「读即重算」，
   * 在 read 里写 store 会造成无限递归或性能塌方）。
   */
  read: (ctx: Calc, env: MetricEnv) => MetricVector
}

// ---------- 内部小工具 ----------

/** 单值向量（团队指标用） */
const solo = (v: number): MetricVector => ({ [TOTAL_KEY]: v })

const num = (v: number | undefined | null): number =>
  Number.isFinite(v) ? (v as number) : 0

/**
 * 按任意 key 把行聚合成 { key: sum } + __total__（本文件 perSlot 指标的唯一聚合口径，CC-284）。
 * key 为空（槽位没有角色）时只计入 __total__、不产生空键分量——CC-284 前角色循环各自这样跳过，
 * 伤害行路径则会写出 `''` 键（UI 只按 agentId 取分量，从不读空键）。
 */
function sumRowsBy<T>(rows: ReadonlyArray<T>, key: (r: T) => string | undefined, val: (r: T) => number | undefined | null): MetricVector {
  const out: MetricVector = { [TOTAL_KEY]: 0 }
  for (const r of rows) {
    const v = num(val(r))
    out[TOTAL_KEY] += v
    const k = key(r)
    if (k) out[k] = (out[k] ?? 0) + v
  }
  return out
}

/** resourceResult.characters[] 的逐角色字段 → 向量 */
type CalcCharacter = NonNullable<Calc['resourceResult']['value']>['characters'][number]
const perCharacter = (ctx: Calc, val: (c: CalcCharacter) => number | undefined | null): MetricVector =>
  sumRowsBy(ctx.resourceResult.value?.characters ?? [], c => c.agentId, val)

/** 按槽位下标排列的数组（perSlotStun 等）→ 向量；槽位 i 的归属 = characters[i].agentId */
const perSlotArray = (ctx: Calc, arr: ReadonlyArray<number>): MetricVector =>
  sumRowsBy(arr.map((v, i) => ({ v, id: ctx.resourceResult.value?.characters?.[i]?.agentId })), r => r.id, r => r.v)

// ---------- 指标注册表 ----------

/**
 * y 轴候选。**加指标 = 往这里加一行**（判据：不动组件/不改 SVG/不改表格）。
 *
 * 分组约定（UI 用法）：`__total__` = 全队；`${agentId}` = 该角色的分量（perSlot 指标才有）。
 */
export const METRICS: MetricDef[] = [
  // ===== 伤害 =====
  {
    id: 'teamTotalDamage',
    label: '队伍总伤',
    hint: 'Σ damagePoolRows.totalDamage —— 全队 180s 结算总伤害（含直伤/异常/DoT）',
    scope: 'team', digits: 0, unit: '', higherBetter: true,
    read: ctx => solo(num(ctx.teamTotalDamage.value)),
  },
  {
    id: 'dmgBySlot',
    label: '分人伤害',
    hint: '按伤害池行归属槽位求和 —— 单人系列就读该角色的分量',
    scope: 'perSlot', digits: 0, unit: '', higherBetter: true,
    read: ctx => sumRowsBy(ctx.damagePoolRows.value, r => r.agentId, r => r.totalDamage),
  },
  {
    id: 'dmgBossHpRatio',
    label: 'Boss 血量比',
    hint: '总伤 ÷ enemy.hp（100% = 恰好击杀）—— 引擎没有这个字段，是消费端派生量',
    scope: 'team', digits: 1, unit: '%', higherBetter: true,
    read: (ctx, env) => solo(env.hp > 0 ? num(ctx.teamTotalDamage.value) / env.hp : 0),
  },
  {
    id: 'dmgPerSecond',
    label: '每秒伤害 DPS',
    hint: '总伤 ÷ resourceResult.totalTime（秒）—— 派生式，非引擎字段',
    scope: 'team', digits: 0, unit: ' /s', higherBetter: true,
    read: (ctx) => {
      const t = num(ctx.resourceResult.value?.totalTime) || 1
      return solo(num(ctx.teamTotalDamage.value) / t)
    },
  },
  {
    id: 'dmgAnomaly',
    label: '异常·派生伤害',
    hint: '伤害池里非「直伤」行的合计（异放/乱流/耀变/DoT/紊乱…）—— 看异常体系贡献占比',
    scope: 'perSlot', digits: 0, unit: '', higherBetter: true,
    read: ctx => sumRowsBy(
      ctx.damagePoolRows.value.filter(r => r.type !== '直伤'),
      r => r.agentId,
      r => r.totalDamage,
    ),
  },
  {
    id: 'dmgGift',
    label: '赠送/失衡送伤害',
    hint: 'sourceTag = gift 或 stun 的伤害行合计（诺姆转连携/琉音转大/失衡白送连携）',
    scope: 'perSlot', digits: 0, unit: '', higherBetter: true,
    read: ctx => sumRowsBy(
      ctx.damagePoolRows.value.filter(r => r.sourceTag === 'gift' || r.sourceTag === 'stun'),
      r => r.agentId,
      r => r.totalDamage,
    ),
  },

  // ===== 失衡 =====
  {
    id: 'stunCount',
    label: '失衡次数',
    hint: 'StunPoolResult.stunCount = floor(有效总失衡值 ÷ Boss 失衡值)（含返还/白送）——**不要**用 resourceResult.plannedStunCount',
    scope: 'team', digits: 0, unit: '', higherBetter: true,
    read: ctx => solo(num(ctx.stunPoolResult.value?.stunCount)),
  },
  {
    id: 'stunBuildUp',
    label: '全队有效失衡值',
    hint: 'StunPoolResult.totalStunBuildUp（已扣除失衡窗口内的无效失衡值）',
    scope: 'team', digits: 0, unit: '', higherBetter: true,
    read: ctx => solo(num(ctx.stunPoolResult.value?.totalStunBuildUp)),
  },
  {
    id: 'stunPerSlot',
    label: '分人失衡贡献',
    hint: 'perSlotStun —— 该角色打出的有效失衡值（谁在破韧）',
    scope: 'perSlot', digits: 0, unit: '', higherBetter: true,
    read: ctx => perSlotArray(ctx, ctx.stunPoolResult.value?.perSlotStun ?? []),
  },
  {
    id: 'windowDuration',
    label: '单窗失衡时长',
    hint: 'stunTime + 连携窗口 4s + 全队失衡延时（琉音+2/般岳C1+2 等）',
    scope: 'team', digits: 1, unit: '', higherBetter: true,
    read: ctx => solo(num(ctx.windowDuration.value)),
  },

  // ===== 异常 =====
  {
    id: 'anomalyTriggers',
    label: '异常触发次数',
    hint: 'AnomalyPoolResult.totalTriggerCount（所有元素之和）',
    scope: 'team', digits: 0, unit: '', higherBetter: true,
    read: ctx => solo(num(ctx.anomalyPoolResult.value?.totalTriggerCount)),
  },
  {
    id: 'anomalyTriggersPerSlot',
    label: '分人异常触发',
    hint: 'perSlotAnomalyTriggers —— 该角色归属的异常触发次数',
    scope: 'perSlot', digits: 0, unit: '', higherBetter: true,
    read: ctx => perSlotArray(ctx, ctx.anomalyPoolResult.value?.perSlotAnomalyTriggers ?? []),
  },
  {
    id: 'anomalyCoverage',
    label: '异常覆盖率',
    hint: 'coverage.coverageRate = 有效 DoT 时间 ÷ 战斗时间',
    scope: 'team', digits: 1, unit: '%', higherBetter: true,
    read: ctx => solo(num(ctx.anomalyPoolResult.value?.coverage?.coverageRate)),
  },
  {
    id: 'disorderDamage',
    label: '紊乱伤害',
    hint: 'disorderDamage.totalDamage（无风属性时才有值）—— 缺两种矛盾属性时读不到',
    scope: 'team', digits: 0, unit: '', higherBetter: true,
    read: ctx => solo(num(ctx.anomalyPoolResult.value?.disorderDamage?.totalDamage)),
  },

  // ===== 回能 / 喧响 =====
  {
    id: 'exSpecialCount',
    label: '强特次数',
    hint: 'characters[].exSpecialCount = 总能量 ÷ 强特消耗（读 derivedEnergy 差异可看出 ≠ overflow）',
    scope: 'perSlot', digits: 1, unit: '', higherBetter: true,
    read: ctx => perCharacter(ctx, c => c.exSpecialCount),
  },
  {
    id: 'ultimateCount',
    label: '终结技次数',
    hint: 'characters[].ultimateCount = 总喧响 ÷ ultimateCost（失衡外层的反馈量之一）',
    scope: 'perSlot', digits: 2, unit: '', higherBetter: true,
    read: ctx => perCharacter(ctx, c => c.ultimateCount),
  },
  {
    id: 'chainCountTotal',
    label: '连携次数',
    hint: 'characters[].chainCountTotal = 每次失衡连携数 × 失衡次数',
    scope: 'perSlot', digits: 1, unit: '', higherBetter: true,
    read: ctx => perCharacter(ctx, c => c.chainCountTotal),
  },

  // ===== 时间分配 =====
  {
    id: 'frontlineTime',
    label: '前台时间',
    hint: 'timeAllocation.frontlineTime（秒）—— 该角色占场时间，多了会挤主C',
    scope: 'perSlot', digits: 1, unit: '', higherBetter: false,
    read: ctx => perCharacter(ctx, c => c.timeAllocation?.frontlineTime),
  },
  {
    id: 'basicAttackTime',
    label: '平A时间',
    hint: 'timeAllocation.basicAttackTime（秒）—— 账本留给该角色自由输出的秒数',
    scope: 'perSlot', digits: 1, unit: '', higherBetter: true,
    read: ctx => perCharacter(ctx, c => c.timeAllocation?.basicAttackTime),
  },

  // ===== 收敛健康度（越小越好 / 布尔） =====
  {
    id: 'timeBudgetResidual',
    label: '时间预算残差',
    hint: 'convergence.timeBudgetResidualSeconds —— 账本超预算又没消化掉的秒数，>0 = 结算不严格',
    scope: 'team', digits: 2, unit: '', higherBetter: false,
    read: ctx => solo(num(ctx.resourceResult.value?.convergence?.timeBudgetResidualSeconds)),
  },
  {
    id: 'overflowSeconds',
    label: '招式截断秒数',
    hint: 'overflowSeconds —— 为塞进 180s 砍掉的招式时间（>0 = 资源没兑现成动作）',
    scope: 'team', digits: 1, unit: '', higherBetter: false,
    read: ctx => solo(num(ctx.resourceResult.value?.overflowSeconds)),
  },
]

/** id → 定义（UI/参数序列化都走这张表查找，不再各写一条 if） */
export const METRIC_BY_ID: ReadonlyMap<string, MetricDef> = new Map(METRICS.map(m => [m.id, m]))

export function metricDef(id: string): MetricDef | undefined {
  return METRIC_BY_ID.get(id)
}

/** 单位化展示：数字 → 带单位的字符串（百分比读数 ×100） */
export function formatMetric(def: MetricDef, v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (def.unit === '%') return `${(v * 100).toFixed(def.digits)}%`
  const body = def.digits === 0 ? compact(Math.round(v)) : v.toFixed(def.digits)
  return def.unit ? `${body}${def.unit}` : body
}

/**
 * CC-204：汇总表胜负着色——每个 x 档里按指标方向（`higherBetter`）找最优系列，返回系列下标集合（与 `series` 同序）。
 * - 越小越好的指标（前台时间 / 时间残差 / 溢出秒数）取最小值；
 * - 并列（相对差 ≤ 1e-9）全部标出；`null`（该档无读数）不参与；
 * - 该档可比系列 < 2 ⇒ 空集：没有对手就没有胜负（单系列对比不着色）；
 * - 所有可比系列取值相同 ⇒ 空集：全员并列不算谁赢。
 */
export function bestSeriesIndexByLevel(
  def: Pick<MetricDef, 'higherBetter'>,
  series: ReadonlyArray<{ values: ReadonlyArray<number | null> }>,
): Array<Set<number>> {
  const levels = Math.max(0, ...series.map(s => s.values.length))
  const out: Array<Set<number>> = []
  for (let i = 0; i < levels; i++) {
    const cands: Array<[number, number]> = []
    series.forEach((s, si) => {
      const v = s.values[i]
      if (v !== null && v !== undefined && Number.isFinite(v)) cands.push([si, v])
    })
    const best = new Set<number>()
    if (cands.length >= 2) {
      const vals = cands.map(([, v]) => v)
      const target = def.higherBetter ? Math.max(...vals) : Math.min(...vals)
      const tol = 1e-9 * Math.max(1, Math.abs(target))
      const worst = def.higherBetter ? Math.min(...vals) : Math.max(...vals)
      if (Math.abs(worst - target) > tol) {
        for (const [si, v] of cands) if (Math.abs(v - target) <= tol) best.add(si)
      }
    }
    out.push(best)
  }
  return out
}

/** UI 下拉选项 */
export function metricOptions(): Array<{ value: string; label: string }> {
  return METRICS.map(m => ({ value: m.id, label: m.label }))
}

/**
 * 招式执行行构建（R43 结构熵切面：自 `core/resource/helpers.ts` 纯搬运，零逻辑改动）。
 *
 * 为什么这一族是内聚切面：`buildExecutions` 是行物化的**唯一生产者**，
 * `materializeRows` 是它的**唯一入口**（cfg 快照/恢复做相位隔离），
 * `feasibleRows` 是账本侧同源物化（`rowTimeLimit` 有限时按装配同一算法截断），
 * `buildAnomalyEventExecutions` 是异常事件侧的同一构建范式。四者共享
 * 「行 = 引擎产出、倍率由编排层补」的行口径，只**下行**依赖 `./rowAccounting.ts`
 * （行级收入/利用率）与 `./timeTruncation.ts`（截断）——无反向边（闸门实测无双向边、无 TDZ）。
 */
import type {
  CharacterOperationConfig, SkillExecution, IterationState, AnomalyEventExecution,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics/registry'
import { effectiveBattleTime } from '@/core/effectiveTime'
import { resolveExtraExCount } from '@/data/exSpecialPlans'
import { EVADE_ASSIST_ACTION_TIME_SECONDS, EVADE_ASSIST_MOVE_ID } from '@/data/resourceDefaults'
import {
  applyExecutionUtilization, applyEventUtilization, extraNecessaryActionOf,
} from './rowAccounting'
import { truncateExecutionsToFrontline } from './timeTruncation'

// ============ 招式执行计划 ============

/**
 * 行物化的**唯一入口**（自顶向下重构·阶段1，2026-09-08）。
 *
 * 为什么必须有它：`buildExecutions` 里仍有多模块写 cfg 缓存字段（同调用内消费者）。**跨相位**的
 * 相位写入已全部拆到 `materializePhaseState`（引擎侧显式补写，2026-09-09 阶段1 第二刀）——
 * 本函数的快照/恢复只兜住剩下的「同调用内」缓存，试探测量（`materializeRows`）因此与装配行同源。
 * 历史：相位写入留在钩子里时「同一 (cfg, state) 在不同调用点/不同相位得到不同行」，正是
 * 「试探测量 ≠ 装配行」的一类根因（实测 1591 队 s0：同一 state 下通用段行 count 10 vs 装配 11，少算 3.08s）。
 *
 * 纪律：调用前快照 cfg 顶层、调用后恢复——**任何**调用点都不再污染相位；对「只读 cfg」的通道
 * 无影响。后续阶段（赠行收进物化、统一残差、单调求解）一律以本函数为唯一扩展点。
 */
export function materializeRows(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  teamFrontlineSeconds = 0,
): SkillExecution[] {
  const cfgRecord = cfg as unknown as Record<string, unknown>
  // 快照 = 键数组 + 值数组（不建中间对象）；恢复只写「值变了」的键，只在「新增了键」时才 delete。
  // 语义与旧版 `{...cfg}` + 全量 delete/Object.assign 逐位一致（被删的键按原值补回、多出的键删掉），
  // 但常态（模块不写 cfg 或写回同值）零写入 ⇒ cfg 不退化成字典模式、下游属性读保持快路径。
  // 2026-09-23 mcp-engine：旧版在难度曲线 G2 爬梯里自耗时 4.6s / 18s（全引擎第一热点）。
  const snapKeys = Object.keys(cfgRecord)
  // 否决记录（2026-09-23 mcp-engine-r2）：把本行与下方比对换成原生 `Object.values` 实测**更慢**——微基准 105 键对象
  // 快/字典模式均 ~5×（map 130–155ms vs values 790–820ms / 4 万次），全库等价 dump 52.6s → 63.8s。别再试。
  const snapVals = snapKeys.map(k => cfgRecord[k])
  const rows = buildExecutions(cfg, state, chainCountTotal, teamFrontlineSeconds)
  const nowKeys = Object.keys(cfgRecord)
  let sameKeys = nowKeys.length === snapKeys.length
  for (let i = 0; sameKeys && i < nowKeys.length; i++) sameKeys = nowKeys[i] === snapKeys[i]
  if (sameKeys) {
    // 常态：键集合未变 ⇒ 只补回改过的值
    for (let i = 0; i < snapKeys.length; i++) {
      const k = snapKeys[i]!
      if (!Object.is(cfgRecord[k], snapVals[i])) cfgRecord[k] = snapVals[i]
    }
  } else {
    // 模块本次调用**新增**的缓存键：置 undefined 而不 delete（2026-09-23）——delete 会把 cfg 打进字典模式，
    // 此后每次物化都走本慢分支、下游属性读全部变慢（实测 13 个角色模块每轮新增键，占 materializeRows 自耗时 ~1/3；
    // 微基准 1619→897ms、对象保持快模式）。以后新角色往 cfg 写同调用缓存字段**自动**走快路径，无需逐模块预声明。
    // 语义：键存在且值为 undefined ≡ 键不存在——全仓对 cfg 无 `in`/`hasOwnProperty` 判定，JSON 序列化（热启动键等）
    // 同样忽略 undefined 值；由 `allAgentsGuards.test.ts` 对全部角色开/关逐位锁定。
    const had = new Set(snapKeys)
    for (const k of nowKeys) {
      if (had.has(k)) continue
      if (rowFastPathsEnabled) cfgRecord[k] = undefined
      else delete cfgRecord[k]
    }
    for (let i = 0; i < snapKeys.length; i++) {
      const k = snapKeys[i]!
      if (!Object.is(cfgRecord[k], snapVals[i]) || !Object.prototype.hasOwnProperty.call(cfgRecord, k)) cfgRecord[k] = snapVals[i]
    }
  }
  return rows
}

/**
 * 账本侧「可行行」物化（债 2 批 2-1 截断外环回灌，2026-09-19 R37-J2）。
 *
 * = `materializeRows`（同产行、同 cfg 快照/恢复语义）+ 当 `rowTimeLimit` 是有限非负数时，按装配同一算法
 * `truncateExecutionsToFrontline` 把**招式行**截到 ≤ rowTimeLimit 秒（平A填充行先占位、不参与截断，与 S4 装配同源：
 * 传 available = 平A秒 + rowTimeLimit）。rowTimeLimit 缺省/非有限/负数 ⇒ 原样返回 materializeRows 的数组（默认路径
 * 零分支零 delta，引用同一数组）。
 *
 * 为什么放 helpers：与 buildExecutions / materializeRows / truncateExecutionsToFrontline 同族，读写双方都在判据 14 死通道
 * 扫描面内；写入方只有 `core/resource.ts#calcTeamResources` 的重折环（返回前恒删除 cfg.rowTimeLimit）。
 */
export function feasibleRows(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  teamFrontlineSeconds = 0,
  rowTimeLimit?: number,
): SkillExecution[] {
  const memo = feasibleRowsMemo
  if (memo.active && memo.cfg === cfg && memo.state === state && Object.is(memo.chain, chainCountTotal)
    && Object.is(memo.teamFrontline, teamFrontlineSeconds) && Object.is(memo.limit, rowTimeLimit)) {
    memo.hits++
    return memo.rows!
  }
  const rows = feasibleRowsUncached(cfg, state, chainCountTotal, teamFrontlineSeconds, rowTimeLimit)
  if (memo.active) {
    memo.cfg = cfg; memo.state = state; memo.chain = chainCountTotal
    memo.teamFrontline = teamFrontlineSeconds; memo.limit = rowTimeLimit; memo.rows = rows
  }
  return rows
}

/**
 * `feasibleRows` 的**作用域内单槽记忆**（2026-09-23 mcp-engine-r2）。
 *
 * 为什么：`iterate` Step 1 对同一槽先后调 `calcEnergySource` 与 `calcRawDecibelParts`，两者各物化一次行；
 * 本轮强特次数不变时（收敛尾段的常态）喧响侧的 `rowState` 就是 `prev` **同一对象**，参数五元组逐项同身份
 * ⇒ 第二次物化是纯重复。实测全库 104 预设 × 3 命座：544,410 次调用中 191,495 次与上一次同参数（35%）。
 *
 * **只在 `withFeasibleRowsMemo` 作用域内生效**（`iterate` 包一层），作用域外恒走原路径——
 * 作用域内不会有别处改写 cfg / state（`iterate` 是纯映射，行由 `materializeRows` 快照/恢复隔离），
 * 命中返回同一数组：消费者只做 `reduce` 求和、不改写行。
 * 两条前提的实测证据（`.zc/perf/purity.perf.ts`，104 预设 × 3 命座）：同参数重物化 **191,495 次 0 次行不同**、
 * 首次结果被消费后 **0 次被改写**；`iterate` 85,779 次调用 **0 次改写入参 states**。
 * 键用身份比较（cfg/state 对象 + 3 个数值 `Object.is`）：cfg 字段被改写而对象身份不变的情形不可能发生在单次
 * `iterate` 内（上述隔离）；作用域退出即清空，不跨调用持有引用。
 * @fact engine:物化行作用域记忆 口径: `feasibleRows` 仅在 `withFeasibleRowsMemo` 作用域（= 单次 `iterate`）内按「cfg/state 同对象 + chain/teamFrontline/rowTimeLimit `Object.is` 相等」复用上一次结果（单槽），作用域外恒重算；前提 = 作用域内 cfg/state 不被改写、消费者不改写行（纯度探针实测 0 违规） | 据 mcp-engine-r2 纯度探针@2026-09-23·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30 | 验 src/core/__tests__/feasibleRowsMemo.test.ts | 锚 src/core/resource/rowBuild.ts#withFeasibleRowsMemo | 信 高
 * ⟳复核: iterate 内新增「改写 cfg/state」或「就地改写行」的消费者时，重跑 `.zc/perf/purity.perf.ts`（iterMutated / rowsMutated 须仍为 0）+ feasibleRowsMemo.test A/B | 到期 2026-12-31
 */
const feasibleRowsMemo: {
  active: boolean
  cfg: CharacterOperationConfig | null
  state: IterationState | null
  chain: number
  teamFrontline: number
  limit: number | undefined
  rows: SkillExecution[] | null
  hits: number
} = { active: false, cfg: null, state: null, chain: NaN, teamFrontline: NaN, limit: undefined, rows: null, hits: 0 }

function clearFeasibleRowsMemoSlot(): void {
  feasibleRowsMemo.cfg = null
  feasibleRowsMemo.state = null
  feasibleRowsMemo.rows = null
}

/** 在作用域内启用 `feasibleRows` 单槽记忆（可重入：嵌套调用沿用外层作用域）。 */
export function withFeasibleRowsMemo<T>(fn: () => T): T {
  if (feasibleRowsMemo.active || !rowFastPathsEnabled) return fn()
  feasibleRowsMemo.active = true
  try {
    return fn()
  } finally {
    feasibleRowsMemo.active = false
    clearFeasibleRowsMemoSlot()
  }
}

/** 命中计数（测试/诊断用） */
export function getFeasibleRowsMemoHits(): number {
  return feasibleRowsMemo.hits
}

/**
 * 行物化快路径总开关（测试做 A/B 逐位对照用；生产恒开）：关 ⇒ `feasibleRows` 不记忆、`materializeRows` 对新增键 delete。
 * 两条快路径的前提都依赖**角色模块的写法**（同调用缓存字段写 cfg、不改写行），新角色可能打破——
 * `src/core/__tests__/allAgentsGuards.test.ts` 对 catalog 全部角色自动做开/关逐位对照，新增角色零配置纳入。
 */
let rowFastPathsEnabled = true
export function setRowFastPathsEnabled(on: boolean): void {
  rowFastPathsEnabled = on
}

function feasibleRowsUncached(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  teamFrontlineSeconds: number,
  rowTimeLimit: number | undefined,
): SkillExecution[] {
  const rows = materializeRows(cfg, state, chainCountTotal, teamFrontlineSeconds)
  if (rowTimeLimit == null || !Number.isFinite(rowTimeLimit) || rowTimeLimit < 0) return rows
  let basicTime = 0
  for (const e of rows) {
    if (e.moveId === 'basic_attack' && isFrontlineExecution(e)) basicTime += e.totalTime ?? 0
  }
  return truncateExecutionsToFrontline(rows, basicTime + rowTimeLimit).executions
}

/** 构建招式执行记录。`moduleInputRows`（可选出参）：接收**物化钩子派发前**的引擎行快照——
 *  供 buildResourceResult 复现钩子当时看到的行基准（阶段1 第二刀，见 AgentResourceResultInput）。
 *  `patchInputRows`（可选出参，CC-198）：同理接收 **patchExecutions 派发前**的行快照（含额外强特行、
 *  backstageAutoRows 等 buildExecutions 之后物化的行）。两者都是浅拷贝：数组新建、行对象共享。 */
export function buildExecutions(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  teamFrontlineSeconds = 0,
  moduleInputRows?: SkillExecution[],
  patchInputRows?: SkillExecution[],
): SkillExecution[] {
  const executions: SkillExecution[] = []

  // 平A（用秒均数据汇总，不单独列每段）
  if (state.basicAttackTime > 0) {
    executions.push({
      moveId: 'basic_attack',
      moveName: '普通攻击（平A汇总）',
      category: 'basic',
      count: 0, // 平A用时间，不按次数
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: state.basicAttackTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.basicAttackDecibelPerSec,
      totalDecibelRecovery: state.basicAttackTime * cfg.basicAttackDecibelPerSec,
      energyRecovery: cfg.basicAttackRegenPerSec,
      totalEnergyRecovery: state.basicAttackTime * cfg.basicAttackRegenPerSec,
      timeBucket: 'basic',
      ...(cfg.basicBenchmarkMoveId ? { benchmarkMoveId: cfg.basicBenchmarkMoveId } : {}),
    })
  }

  // 模块专属必做动作行（CC-26，自蕾米埃尔一/四命内联迁出）：如特殊虚耀跟随「普通攻击：垂虹」触发，需补入垂虹动作。
  // 次数/时长/喧响由模块能力 `extraNecessaryAction` 给出；无 moveId 时不补行（与原 `&& cfg.remielleRainbowEndMoveId` 等价），
  // 但时间合计（helpers.ts）照旧按 count × actionTime 预留——与迁移前口径一致。
  for (const extraAction of extraNecessaryActionOf(cfg, state)) {
    if (!extraAction.moveId) continue
    const car = extraAction.comboAlignRatio
    executions.push({
      moveId: extraAction.moveId,
      moveName: extraAction.moveName,
      category: 'basic',
      count: extraAction.count,
      actionTime: extraAction.actionTime,
      comboAlignRatio: car,
      totalTime: extraAction.count * extraAction.actionTime,
      totalComboAlignTime: extraAction.count * extraAction.actionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      ...(extraAction.decibelRecovery === undefined ? {} : {
        decibelRecovery: extraAction.decibelRecovery,
        totalDecibelRecovery: extraAction.count * extraAction.decibelRecovery,
      }),
      timeBucket: 'necessary',
    })
  }

  // 强特
  if (state.exSpecialCount > 0 && !cfg.skipGenericExSpecial) {
    const car = cfg.exSpecialComboAlignRatio
    const freeEx = Math.max(0, Math.floor(cfg.freeExSpecialCount ?? 0))
    const paidEx = Math.max(0, state.exSpecialCount - freeEx)
    executions.push({
      moveId: cfg.exSpecialMoveId,
      moveName: '强化特殊技（EX Special）',
      category: 'special',
      count: state.exSpecialCount,
      actionTime: cfg.exSpecialActionTime,
      comboAlignRatio: car,
      comboAlignSource: 'setting',
      totalTime: state.exSpecialCount * cfg.exSpecialActionTime,
      totalComboAlignTime: state.exSpecialCount * cfg.exSpecialActionTime * car,
      energyConsume: cfg.exSpecialEnergyConsume,
      // 免费强特不扣能量（只对付费部分收费）
      totalEnergyConsume: paidEx * cfg.exSpecialEnergyConsume,
      decibelRecovery: cfg.exSpecialDecibelRecovery,
      totalDecibelRecovery: state.exSpecialCount * cfg.exSpecialDecibelRecovery,
      timeBucket: 'necessary',
    })
  }

  // 终结技
  if (state.ultimateCount > 0) {
    const car = cfg.ultimateComboAlignRatio
    executions.push({
      moveId: cfg.ultimateMoveId,
      moveName: '终结技（Ultimate）',
      category: 'chain',
      count: state.ultimateCount,
      actionTime: cfg.ultimateActionTime,
      comboAlignRatio: car,
      comboAlignSource: 'setting',
      totalTime: state.ultimateCount * cfg.ultimateActionTime,
      totalComboAlignTime: state.ultimateCount * cfg.ultimateActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.ultimateDecibelRecovery,
      totalDecibelRecovery: state.ultimateCount * cfg.ultimateDecibelRecovery,
      timeBucket: 'necessary',
    })
  }

  // 连携（始终生成，即使次数为 0 也进执行计划，供失衡轴动作池放置）
  {
    const car = cfg.chainComboAlignRatio
    executions.push({
      moveId: cfg.chainMoveId,
      moveName: '连携技（Chain Attack）',
      category: 'chain',
      count: chainCountTotal,
      actionTime: cfg.chainActionTime,
      comboAlignRatio: car,
      comboAlignSource: 'setting',
      totalTime: chainCountTotal * cfg.chainActionTime,
      totalComboAlignTime: chainCountTotal * cfg.chainActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.chainDecibelRecovery,
      totalDecibelRecovery: chainCountTotal * cfg.chainDecibelRecovery,
      source: 'stun',
      timeBucket: 'necessary',
    })
  }

  // 角色机制模块追加专属动作，如维琳娜风华/广域气旋。
  if (moduleInputRows) {
    moduleInputRows.length = 0
    moduleInputRows.push(...executions)
  }
  getAgentMechanic(cfg.agentId)?.buildExecutions?.({ cfg, state, executions, teamFrontlineSeconds })

  // 通用「单次释放必打招 + 可持续招」强特（buildCharConfig 已 skipGenericExSpecial + 预存缩放倍率）。
  const sustainedEx = cfg.sustainedEx
  if (sustainedEx) {
    const count = Math.max(0, state.exSpecialCount)
    const pushSeg = (moveId: string, actionTime: number) => {
      if (count <= 0) return
      executions.push({
        moveId,
        moveName: moveId,
        category: 'special',
        count,
        actionTime,
        comboAlignRatio: 0,
        totalTime: count * actionTime,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0,
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        timeBucket: 'necessary',
      })
    }
    for (const o of sustainedEx.opener) pushSeg(o.moveId, o.actionTime)
    if (count > 0) {
      const s = sustainedEx.sustain
      executions.push({
        moveId: s.moveId,
        moveName: s.moveId,
        category: 'special',
        count,
        actionTime: s.actionTime,
        comboAlignRatio: 0,
        totalTime: count * s.actionTime,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0,
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        damageMultiplier: s.damageMultiplier,
        damageMultiplierOverride: true,
        dazeMultiplier: s.dazeMultiplier,
        dazeMultiplierOverride: true,
        anomalyBuildUp: s.anomalyBuildUp,
        anomalyBuildUpOverride: true,
        timeBucket: 'necessary',
      })
    }
    for (const f of sustainedEx.finisher) pushSeg(f.moveId, f.actionTime)
  }

  // 额外强特行（免费/窗口门控，2026-09 用户裁决「引擎别太窄」）：注册表 src/data/exSpecialPlans.ts，
  // buildCharConfig 预存进 cfg.extraExPlans；行值由 enrichExecutionPlan 按 moveId 回填
  // （多段动作经 moveFusions 融合），能量成本 0（免费/替代资源由模块账本记）。
  for (const plan of cfg.extraExPlans ?? []) {
    const count = resolveExtraExCount(plan, {
      battleSeconds: Math.max(0, cfg.battleTime ?? 0),
      exCount: Math.max(0, Math.floor(state.exSpecialCount ?? 0)),
    })
    if (count <= 0) continue
    executions.push({
      moveId: plan.moveId,
      moveName: plan.label,
      category: 'special',
      count,
      actionTime: plan.actionTime,
      comboAlignRatio: 0,
      totalTime: count * plan.actionTime,
      totalComboAlignTime: 0,
      energyConsume: plan.energyCost,
      totalEnergyConsume: count * plan.energyCost,
      decibelRecovery: plan.decibelRecovery,
      totalDecibelRecovery: count * plan.decibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }

  // 模块后台自动行（CC-26b，自蕾米埃尔「光辉回转」内联迁出）：**必须在此处派发**——次数依赖「构建到这一步为止」的
  // executions（前台动作计数 countFrontActions）；挪到末尾 patchExecutions 会多数闪避反击等后续行，结果即变。
  const backstageAutoRows = getAgentMechanic(cfg.agentId)?.backstageAutoRows?.({ cfg, state, executions, teamFrontlineSeconds })
  if (backstageAutoRows) executions.push(...backstageAutoRows)

  // 闪避反击（Dodge Counter）
  if (cfg.dodgeCounterCount > 0 && cfg.dodgeCounterActionTime > 0) {
    const car = cfg.dodgeCounterComboAlignRatio
    executions.push({
      moveId: cfg.dodgeCounterMoveId,
      moveName: '闪避反击（Dodge Counter）',
      category: 'dodge',
      count: cfg.dodgeCounterCount,
      actionTime: cfg.dodgeCounterActionTime,
      comboAlignRatio: car,
      comboAlignSource: 'setting',
      totalTime: cfg.dodgeCounterCount * cfg.dodgeCounterActionTime,
      totalComboAlignTime: cfg.dodgeCounterCount * cfg.dodgeCounterActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.dodgeCounterDecibelRecovery,
      totalDecibelRecovery: cfg.dodgeCounterCount * cfg.dodgeCounterDecibelRecovery,
      timeBucket: 'necessary',
    })
  }

  // 轻弹刀（Defensive Assist #1）：count = 正常弹刀 + 不带支援突击弹刀
  const totalDefensiveAssist = (cfg.parryCount ?? 0) + (cfg.parryNoFollowUpCount ?? 0)
  if (totalDefensiveAssist > 0 && cfg.defensiveAssistActionTime > 0) {
    const car = cfg.defensiveAssistComboAlignRatio
    // x弹刀时间豁免（2026-09-02 用户口径）：非主弹窗位这 N 次弹刀行不占前台时间（喧响/失衡照计）
    const freeN = Math.min(totalDefensiveAssist, Math.max(0, Math.floor(cfg.parryTimeFreeCount ?? 0)))
    const charged = Math.max(0, totalDefensiveAssist - freeN)
    executions.push({
      moveId: cfg.defensiveAssistMoveId,
      moveName: '轻弹刀（Defensive Assist #1）',
      category: 'assist',
      count: totalDefensiveAssist,
      actionTime: cfg.defensiveAssistActionTime,
      comboAlignRatio: car,
      comboAlignSource: 'setting',
      totalTime: charged * cfg.defensiveAssistActionTime,
      totalComboAlignTime: charged * cfg.defensiveAssistActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.defensiveAssistDecibelRecovery,
      totalDecibelRecovery: totalDefensiveAssist * cfg.defensiveAssistDecibelRecovery,
      timeBucket: 'necessary',
    })
  }

  // @fact engine:time/回避支援 口径: 无招架支援的角色，一次黄光交互产「回避支援」行 = 1.166s 必要前台 + 零伤害零失衡（时停＝纯亏时间）；判据用 `!defensiveAssistMoveId`（数据驱动、不列角色名单，真斗 1441 那种「有 moveId 但 actionTime=0」不会被误判）；215 喧响走 calcSpecialActionBonus 的 parry 通道按 parryCount 计、行内 decibel 给 0 不重复计；不套 parryTimeFreeCount 豁免 | 据 用户@2026-09-15「弹刀和回避支援本身都是对黄光的一次交互…一个角色要么只能弹刀，要么只能回避…只是前面弹刀的1.16秒换成了1.16秒的时停效果，纯亏时间」+「按照真实的模拟来，老测试不通过就修改老测试」·复核@2026-09-25·复核@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/core/__tests__/evadeAssist.test.ts | 锚 src/core/resource/rowBuild.ts#buildExecutions | 信 确认
  // ⟳复核: raw 里「回避支援」若补出倍率/失衡数据（当前 param 块完全缺失）或弹刀侧 1.166 众数口径变了，须重对 | 到期 2026-12-15
  // 回避支援（Evade Assist）：**没有招架支援的角色**对黄光的那一次交互。
  // 口径（用户 2026-09-15）：「弹刀和回避支援本身都是对黄光的一次交互…一个角色要么只能弹刀，
  // 要么只能回避」「回避支援和支援突击用的公式是一样的，而且也有215喧响奖励，只是前面弹刀的
  // 1.16秒换成了1.16秒的时停效果，纯亏时间」⇒ 与轻弹刀同长同 215，但**不产伤害/失衡**。
  // 判据走数据、不列角色名单（规则 6）：`defensiveAssistMoveId` 为空 = 该角色没有招架支援。
  // 实测命中 6 个：1081 比利 / 1181 格莉丝 / 1211 丽娜 / 1241 朱鸢 / 1311 耀嘉音 / 1351 波可娜。
  // ⚠ 必须用 `defensiveAssistMoveId`（而非 `defensiveAssistActionTime > 0`）分派：真斗 1441
  //   **有** moveId 但 actionTime=0（既存数据缺口，见账本 Open），它是招架型，不能被误判成回避。
  // ⚠ 不套 `parryTimeFreeCount`（x 弹刀时间豁免）：那条豁免的语义是「非主弹窗位的弹刀不占前台」，
  //   回避按用户口径**照扣**（时停期间自己也没输出 = 纯亏）。215 喧响走 `calcSpecialActionBonus`
  //   的 parry 通道（按 parryCount 计），与弹刀同，故此处行内 decibel 给 0、不重复计。
  // 本体在原文里没有任何倍率（raw 无 param 块）⇒ 零倍率、只占时间的合成行（先例：般岳后摇）。
  if (!cfg.defensiveAssistMoveId && cfg.parryCount > 0 && cfg.assistFollowUpMoveId) {
    executions.push({
      moveId: EVADE_ASSIST_MOVE_ID,
      moveName: '回避支援（Evade Assist）',
      category: 'assist',
      count: cfg.parryCount,
      actionTime: EVADE_ASSIST_ACTION_TIME_SECONDS,
      comboAlignRatio: 0,
      totalTime: cfg.parryCount * EVADE_ASSIST_ACTION_TIME_SECONDS,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      damageMultiplier: 0,
      damageMultiplierOverride: true,
      timeBucket: 'necessary',
      skillTableNote: '回避支援 = 该角色对黄光的一次交互（无招架支援）；时停 1.166s/次，不产伤害与失衡',
    })
  }

  // 支援突击（Assist Follow-Up）：只随正常弹刀（不带支援突击弹刀无此段）
  if (cfg.parryCount > 0 && cfg.assistFollowUpActionTime > 0) {
    const car = cfg.assistFollowUpComboAlignRatio
    const freeN = Math.min(cfg.parryCount, Math.max(0, Math.floor(cfg.parryTimeFreeCount ?? 0)))
    const charged = Math.max(0, cfg.parryCount - freeN)
    executions.push({
      moveId: cfg.assistFollowUpMoveId,
      moveName: '支援突击（Assist Follow-Up）',
      category: 'assist',
      count: cfg.parryCount,
      actionTime: cfg.assistFollowUpActionTime,
      comboAlignRatio: car,
      comboAlignSource: 'setting',
      totalTime: charged * cfg.assistFollowUpActionTime,
      totalComboAlignTime: charged * cfg.assistFollowUpActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.assistFollowUpDecibelRecovery,
      totalDecibelRecovery: cfg.parryCount * cfg.assistFollowUpDecibelRecovery,
      timeBucket: 'necessary',
    })
  }

  // 反制支援（Counter Assist）：boss 控制技（紫光技）**整组化解**——一组 = 一次动作
  // （本体 + 紧随的专属支援突击，两行由 data/moveFusions.ts#CLARET_COUNTER_ASSIST 融合）。
  // 刻意不并进 parryCount：不产轻弹刀/支援突击行、不拿弹刀 215 特殊动作奖励、不参与
  // 「保底4失衡」的每次弹刀失衡反推（用户口径 2026-09-12「完全不拿 215，只算行内喧响」）。
  const counterAssistCount = Math.max(0, Math.floor(cfg.counterAssistCount ?? 0))
  const counterAssistActionTime = cfg.counterAssistActionTime ?? 0
  if (counterAssistCount > 0 && cfg.counterAssistMoveId && counterAssistActionTime > 0) {
    const car = cfg.counterAssistComboAlignRatio ?? 0
    const decibel = cfg.counterAssistDecibelRecovery ?? 0
    executions.push({
      moveId: cfg.counterAssistMoveId,
      moveName: '反制支援（Counter Assist）',
      category: 'assist',
      count: counterAssistCount,
      actionTime: counterAssistActionTime,
      comboAlignRatio: car,
      comboAlignSource: 'setting',
      totalTime: counterAssistCount * counterAssistActionTime,
      totalComboAlignTime: counterAssistCount * counterAssistActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: decibel,
      totalDecibelRecovery: counterAssistCount * decibel,
      timeBucket: 'necessary',
    })
  }

  // 招式执行计划完全构建后，模块可做最终修正（如按招式标签补增伤/暴击/固定附加伤害）。
  if (patchInputRows) {
    patchInputRows.length = 0
    patchInputRows.push(...executions)
  }
  getAgentMechanic(cfg.agentId)?.patchExecutions?.({ cfg, state, executions, teamFrontlineSeconds })

  // 合轴率来源（CC-453）：上面 7 处读 cfg.*ComboAlignRatio（= 用户覆盖 ?? 倍率表默认）的行已标 'setting'；
  // 其余（引擎常量行、模块 buildExecutions/patchExecutions 推的行、跟随别的招式比例的衍生行）在此统一标 'fixed'，模块字面量不用改。
  return executions.map(exec => applyExecutionUtilization(cfg, exec.comboAlignSource ? exec : { ...exec, comboAlignSource: 'fixed' }))
}

export function buildAnomalyEventExecutions(cfg: CharacterOperationConfig, state: IterationState, totalTime = 180): AnomalyEventExecution[] {
  const events: AnomalyEventExecution[] = []
  getAgentMechanic(cfg.agentId)?.buildAnomalyEvents?.({ cfg, state, events, totalTime })

  const cannonRotorMultiplier = cfg.cannonRotorDamageMultiplier ?? 0
  const cannonRotorCooldown = cfg.cannonRotorCooldownSeconds ?? 0
  if (cannonRotorMultiplier > 0 && cannonRotorCooldown > 0) {
    const count = Math.ceil(effectiveBattleTime({ battleTime: totalTime, invincibleTime: cfg.invincibleTime }) / cannonRotorCooldown)
    events.push({
      eventId: 'cannon_rotor_crit_proc',
      eventName: '加农转子额外伤害',
      eventType: 'direct_damage',
      count,
      damageMultiplier: cannonRotorMultiplier,
      formula: `count = ceil(有效战斗时长 / ${cannonRotorCooldown})；damage = 攻击力 × ${cannonRotorMultiplier}% × 装备者直伤乘区`,
      fields: ['cannonRotorDamageMultiplier', 'cannonRotorCooldownSeconds', 'atk', 'crit/directDamageZones'],
      note: '按命中并暴击可稳定触发处理；次数受精修 CD 封顶（战斗时长扣 boss 无敌），伤害应按装备者当前直伤乘区结算。',
    })
  }

  // 蕾米埃尔「特殊虚耀」事件已迁入其模块 `buildAnomalyEvents`（CC-26；由本函数开头的钩子派发）
  return events.map(event => applyEventUtilization(cfg, event))
}

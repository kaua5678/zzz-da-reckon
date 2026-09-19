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
import { getAgentMechanic } from '@/mechanics'
import { countFrontActions, effectiveBackstageTime, effectiveBattleTime, frontBlockSeconds, phaseDelayedCooldown } from '@/core/effectiveTime'
import { resolveExtraExCount } from '@/data/exSpecialPlans'
import { EVADE_ASSIST_ACTION_TIME_SECONDS, EVADE_ASSIST_MOVE_ID } from '@/data/resourceDefaults'
import {
  applyExecutionUtilization, applyEventUtilization, remielleSpecialVoidflareUseCount,
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
  const cfgSnapshot = { ...cfgRecord }
  const rows = buildExecutions(cfg, state, chainCountTotal, teamFrontlineSeconds)
  for (const k of Object.keys(cfgRecord)) {
    if (!Object.prototype.hasOwnProperty.call(cfgSnapshot, k)) delete cfgRecord[k]
  }
  Object.assign(cfgRecord, cfgSnapshot)
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
  const rows = materializeRows(cfg, state, chainCountTotal, teamFrontlineSeconds)
  if (rowTimeLimit == null || !Number.isFinite(rowTimeLimit) || rowTimeLimit < 0) return rows
  let basicTime = 0
  for (const e of rows) {
    if (e.moveId === 'basic_attack' && isFrontlineExecution(e)) basicTime += e.totalTime ?? 0
  }
  return truncateExecutionsToFrontline(rows, basicTime + rowTimeLimit).executions
}

/** 构建招式执行记录。`moduleInputRows`（可选出参）：接收**物化钩子派发前**的引擎行快照——
 *  供 buildResourceResult 复现钩子当时看到的行基准（阶段1 第二刀，见 AgentResourceResultInput）。 */
export function buildExecutions(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  teamFrontlineSeconds = 0,
  moduleInputRows?: SkillExecution[],
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
    })
  }

  // 蕾米一/四命：特殊虚耀跟随「普通攻击：垂虹」触发，需要补入垂虹动作
  const remielleRainbowEndCount = remielleSpecialVoidflareUseCount(cfg)
  if (remielleRainbowEndCount > 0 && cfg.remielleRainbowEndMoveId) {
    const car = cfg.remielleRainbowEndComboAlignRatio
    executions.push({
      moveId: cfg.remielleRainbowEndMoveId,
      moveName: '普通攻击：垂虹（特殊虚耀载体）',
      category: 'basic',
      count: remielleRainbowEndCount,
      actionTime: cfg.remielleRainbowEndActionTime,
      comboAlignRatio: car,
      totalTime: remielleRainbowEndCount * cfg.remielleRainbowEndActionTime,
      totalComboAlignTime: remielleRainbowEndCount * cfg.remielleRainbowEndActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.remielleRainbowEndDecibelRecovery,
      totalDecibelRecovery: remielleRainbowEndCount * cfg.remielleRainbowEndDecibelRecovery,
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
  const sustainedEx = (cfg as unknown as Record<string, unknown>).sustainedEx as
    | {
        opener: { moveId: string; actionTime: number }[]
        sustain: { moveId: string; actionTime: number; damageMultiplier: number; dazeMultiplier: number; anomalyBuildUp: number }
        finisher: { moveId: string; actionTime: number }[]
      }
    | undefined
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

  // 蕾米后台飞行状态：每5秒自动释放一次 Radiant Turn；合轴100%，不占前台时间。
  // 后台时间含无敌秒（先扣）；CD 被蕾米本人前台时间插进循环造成相位延后 → 等效使用 CD（core/effectiveTime.ts）；
  // 前台块长 = 前台时间 / 切上次数（切上前台频率 × 非平A前台动作次数；蕾米暂无滑块声明，频率缺省 1，
  // 可经 cfg['setting:remielle.frontSwitchRatio'] 覆盖）。
  if (cfg.remielleEnabled && cfg.remielleRadiantTurnMoveId) {
    const block = frontBlockSeconds(
      state.frontlineTime ?? 0,
      countFrontActions(executions, { fusedMoveIds: [cfg.assistFollowUpMoveId] }),
      Number((cfg as unknown as Record<string, unknown>)['setting:remielle.frontSwitchRatio'] ?? 1),
      5,
    )
    const radiantInterval = phaseDelayedCooldown(5, state.frontlineTime, effectiveBattleTime(cfg), block)
    const radiantTurnCount = Math.floor(effectiveBackstageTime(state.backstageTime, cfg) / radiantInterval)
    if (radiantTurnCount > 0) {
      executions.push({
        moveId: cfg.remielleRadiantTurnMoveId,
        moveName: 'Special Attack: Ode to Dawn - Radiant Turn（后台）',
        category: 'special',
        count: radiantTurnCount,
        actionTime: cfg.remielleRadiantTurnActionTime ?? 0,
        comboAlignRatio: 1,
        totalTime: 0,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
      decibelRecovery: cfg.remielleRadiantTurnDecibelRecovery ?? 0,
      totalDecibelRecovery: radiantTurnCount * (cfg.remielleRadiantTurnDecibelRecovery ?? 0),
      timeBucket: 'backstage',
    })
    }
  }

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
      totalTime: charged * cfg.defensiveAssistActionTime,
      totalComboAlignTime: charged * cfg.defensiveAssistActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.defensiveAssistDecibelRecovery,
      totalDecibelRecovery: totalDefensiveAssist * cfg.defensiveAssistDecibelRecovery,
      timeBucket: 'necessary',
    })
  }

  // @fact engine:time/回避支援 口径: 无招架支援的角色，一次黄光交互产「回避支援」行 = 1.166s 必要前台 + 零伤害零失衡（时停＝纯亏时间）；判据用 `!defensiveAssistMoveId`（数据驱动、不列角色名单，真斗 1441 那种「有 moveId 但 actionTime=0」不会被误判）；215 喧响走 calcSpecialActionBonus 的 parry 通道按 parryCount 计、行内 decibel 给 0 不重复计；不套 parryTimeFreeCount 豁免 | 据 用户@2026-09-15「弹刀和回避支援本身都是对黄光的一次交互…一个角色要么只能弹刀，要么只能回避…只是前面弹刀的1.16秒换成了1.16秒的时停效果，纯亏时间」+「按照真实的模拟来，老测试不通过就修改老测试」 | 验 src/core/__tests__/evadeAssist.test.ts | 锚 src/core/resource/rowBuild.ts#buildExecutions | 信 确认
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
  getAgentMechanic(cfg.agentId)?.patchExecutions?.({ cfg, state, executions, teamFrontlineSeconds })

  return executions.map(exec => applyExecutionUtilization(cfg, exec))
}

export function buildAnomalyEventExecutions(cfg: CharacterOperationConfig, state: IterationState, totalTime = 180): AnomalyEventExecution[] {
  const events: AnomalyEventExecution[] = []
  getAgentMechanic(cfg.agentId)?.buildAnomalyEvents?.({ cfg, state, events, totalTime })

  const remielleRainbowEndCount = remielleSpecialVoidflareUseCount(cfg)
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

  if (remielleRainbowEndCount > 0 && cfg.remielleRainbowEndMoveId) {
    events.push({
      eventId: 'remielle_special_voidflare_event',
      eventName: '特殊虚耀',
      eventType: 'special_voidflare',
      carrierMoveId: cfg.remielleRainbowEndMoveId,
      carrierMoveName: '普通攻击：垂虹',
      count: remielleRainbowEndCount,
      formula: 'count = (remielleCinema1SpecialVoidflareCount + remielleCinema4SpecialVoidflareRefillCount) × remielleCinema6SpecialVoidflareTriggerMultiplier',
      fields: [
        'remielleCinema1SpecialVoidflareCount',
        'remielleCinema4SpecialVoidflareRefillCount',
        'remielleCinema6SpecialVoidflareTriggerMultiplier',
        'remielleRainbowEndMoveId',
      ],
      note: '异常事件只记录次数和载体动作；不进入普通招式执行计划，不读取 damageMultiplier。',
    })
  }
  return events.map(event => applyEventUtilization(cfg, event))
}

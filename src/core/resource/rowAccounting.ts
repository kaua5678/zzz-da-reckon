/**
 * 行级收入账本 + 利用率/冷却切片（R43 结构熵切面：自 `core/resource/helpers.ts` 纯搬运）。
 *
 * 为什么这一族是内聚切面：这一段统一回答「**一行值多少**」——
 * `rowEnergyTotal` / `rowDecibelTotal`（逐分支与 `enrichExecutionPlan` 同语义，
 * 记账层 == 展示层）、资源利用率缩放（`getUtilizedCount` / `applyExecutionUtilization` /
 * `applyEventUtilization`）、12s 冷却切片（`cappedCooldownTriggers` /
 * `timeSliceTriggerCounts`），以及喧响获得效率与「强化特殊技必做动作时间」的
 * 三个私有求解器（`exSpecial*`）。对 helpers.ts 其它符号**零内部依赖**（闸门实测出度 0）。
 *
 * ⚠ `exSpecialNecessaryTime` / `exSpecialComboAlignTime` / `exSpecialComboAlignCredit` /
 * `rowEnergyTotal` / `rowDecibelTotal` 在原文件是**私有**符号，跨缝被 helpers.ts 与
 * `./resourceIncome.ts` 消费 ⇒ 在本文件导出、由消费方 import
 * （**不进 helpers 的公开面**，导出面零增零减）。
 */
import type {
  CharacterOperationConfig, SkillExecution, IterationState, AnomalyEventExecution,
} from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'

// ============ 单角色喧响计算 ============

export function decibelEfficiencyMultiplier(cfg: CharacterOperationConfig): number {
  return 1 + ((cfg.panel.decibelGainEfficiency ?? 0) / 100)
}

export function remielleSpecialVoidflareUseCount(cfg: CharacterOperationConfig): number {
  const firstRound = cfg.panel.remielleCinema1SpecialVoidflareCount ?? 0
  if (firstRound <= 0) return 0
  const refillRound = cfg.panel.remielleCinema4SpecialVoidflareRefillCount ?? 0
  const c6Multiplier = 1 + Math.max(0, cfg.panel.remielleCinema6SpecialVoidflareTriggerMultiplier ?? 0)
  return (firstRound + Math.max(0, refillRound)) * c6Multiplier
}

/** 强化特殊技（及模块专属必做动作）前台时间：优先走角色机制模块覆盖（如卢西娅计划内E+A5），否则按通用公式 */
export function exSpecialNecessaryTime(cfg: CharacterOperationConfig, exSpecialCount: number, ultimateCount: number, prevState?: IterationState): number {
  const estimate = getAgentMechanic(cfg.agentId)?.estimateExSpecialTime?.({ cfg, exSpecialCount, ultimateCount, state: prevState })
  if (estimate) return estimate.necessaryTime
  return exSpecialCount * cfg.exSpecialActionTime
}

/** 强化特殊技（及模块专属必做动作）合轴时间：优先走角色机制模块覆盖，否则按通用公式 */
export function exSpecialComboAlignTime(cfg: CharacterOperationConfig, exSpecialCount: number, ultimateCount: number, prevState?: IterationState): number {
  const estimate = getAgentMechanic(cfg.agentId)?.estimateExSpecialTime?.({ cfg, exSpecialCount, ultimateCount, state: prevState })
  if (estimate) return estimate.comboAlignTime
  return exSpecialCount * cfg.exSpecialActionTime * cfg.exSpecialComboAlignRatio
}

/**
 * 强化特殊技合轴的**预算抵扣**部分：只有含在 necessaryTime 内的合轴（GROSS 约定，缺省）
 * 才能抵扣团队时间预算；NET 约定模块（照/卢西娅：合轴动作已从 necessaryTime 剔除、
 * 物化行不占前台）返回 0，防止同一重叠双重抵扣。通用公式路径全额可抵扣。
 */
export function exSpecialComboAlignCredit(cfg: CharacterOperationConfig, exSpecialCount: number, ultimateCount: number, prevState?: IterationState): number {
  const estimate = getAgentMechanic(cfg.agentId)?.estimateExSpecialTime?.({ cfg, exSpecialCount, ultimateCount, state: prevState })
  if (estimate) return estimate.comboAlignIncludedInNecessary === false ? 0 : estimate.comboAlignTime
  return exSpecialCount * cfg.exSpecialActionTime * cfg.exSpecialComboAlignRatio
}

export function cappedCooldownTriggers(rawCount: number, totalTime: number, cooldownSeconds: number): number {
  const raw = Math.max(0, Math.floor(rawCount))
  if (raw <= 0) return 0
  if (cooldownSeconds <= 0 || totalTime <= 0) return raw
  return Math.min(raw, Math.ceil(totalTime / cooldownSeconds))
}

export function getUtilizedCount(cfg: CharacterOperationConfig, actionId: string | undefined, rawCount: number): number {
  if (!actionId || rawCount <= 0) return rawCount
  const rule = cfg.resourceUtilization?.[actionId]
  if (!rule) return rawCount
  const rate = Math.max(0, Math.min(1, Number.isFinite(rule.rate) ? rule.rate : 1))
  let count = rawCount * rate
  if (rule.cap !== undefined && rule.cap !== null && Number.isFinite(Number(rule.cap))) {
    count = Math.min(count, Math.max(0, Number(rule.cap)))
  }
  return count
}

export function applyExecutionUtilization(cfg: CharacterOperationConfig, exec: SkillExecution): SkillExecution {
  if (exec.count <= 0) return exec
  const count = getUtilizedCount(cfg, exec.moveId, exec.count)
  if (count === exec.count) return exec
  const scale = exec.count > 0 ? count / exec.count : 1
  return {
    ...exec,
    count,
    totalTime: exec.totalTime * scale,
    totalComboAlignTime: exec.totalComboAlignTime * scale,
    totalEnergyConsume: exec.totalEnergyConsume * scale,
    totalDecibelRecovery: (exec.totalDecibelRecovery ?? 0) * scale,
    totalEnergyRecovery: (exec.totalEnergyRecovery ?? 0) * scale,
    totalSpecialResourceRecovery: exec.totalSpecialResourceRecovery !== undefined ? exec.totalSpecialResourceRecovery * scale : undefined,
    totalHealingAmount: exec.totalHealingAmount !== undefined ? exec.totalHealingAmount * scale : undefined,
  }
}

export function applyEventUtilization(cfg: CharacterOperationConfig, event: AnomalyEventExecution): AnomalyEventExecution {
  if (event.count <= 0) return event
  const directRule = cfg.resourceUtilization?.[event.eventId]
  const actionId = directRule ? event.eventId : (event.carrierMoveId ?? event.eventId)
  const count = getUtilizedCount(cfg, actionId, event.count)
  return count === event.count ? event : { ...event, count }
}

export function timeSliceTriggerCounts(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  totalTime: number,
  exSpecialCount = state.exSpecialCount,
): { dodgeCounter: number; exSpecial: number; assist: number; chain: number; total: number } {
  const cooldown = 12
  const dodgeCounter = cappedCooldownTriggers(cfg.dodgeCounterCount, totalTime, cooldown)
  const exSpecial = cappedCooldownTriggers(exSpecialCount, totalTime, cooldown)
  const assist = cappedCooldownTriggers(cfg.quickAssistCount + cfg.parryCount, totalTime, cooldown)
  const chain = cappedCooldownTriggers(chainCountTotal, totalTime, cooldown)
  return { dodgeCounter, exSpecial, assist, chain, total: dodgeCounter + exSpecial + assist + chain }
}

/**
 * 行级喧响收入——与 enrichExecutionPlan 的 decibel 分支逐分支同语义（记账层 == 展示层）：
 * - basic_attack 行：时间通道原值（enrich 不回填其 decibel，模块可改写 total，如伊德海莉蓄力置 0）；
 * - moveId 在 cfg.decibelRecoveryByMoveId（倍率表预存，键存在 = 表中找到）：
 *   decibelRecoveryOverride = 模块口径换算行值（洛克茜自旋每秒×秒数）；显式 0 = 模块禁用；
 *   缺省 = 表值 || 行值 || 0；总收入 = 单次值 × max(0,count)（利用率缩放已在 count 里）；
 * - 假 id / 表中未找到：行 total 原值（enrich 同分支不 patch decibel）。
 * - 非有限值防线：畸形/不完整配置（测试合成 cfg 缺字段等）可让行值成 NaN——账本绝不带 NaN
 *   （NaN 会毒化次数迭代并被环检测的 JSON 签名物化成 null，实测合成队 ex/ult 全 null）。
 */
const finiteOr0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function rowDecibelTotal(cfg: CharacterOperationConfig, row: SkillExecution): number {
  if (row.moveId === 'basic_attack') return finiteOr0(row.totalDecibelRecovery)
  const table = cfg.decibelRecoveryByMoveId
  if (!table || !Object.prototype.hasOwnProperty.call(table, row.moveId)) return finiteOr0(row.totalDecibelRecovery)
  const perCount = row.decibelRecoveryOverride
    ? finiteOr0(row.decibelRecovery)
    : row.decibelRecovery === 0
      ? 0
      : (finiteOr0(table[row.moveId]) || finiteOr0(row.decibelRecovery) || 0)
  return finiteOr0(perCount * Math.max(0, finiteOr0(row.count)))
}

/**
 * 行级能量收入——与 enrichExecutionPlan 的 energy 分支逐分支同语义（记账层 == 展示层，rowDecibelTotal 同构）：
 * - basic_attack 行：时间通道原值（state.basicAttackTime × basicAttackRegenPerSec 的载体，enrich 不回填
 *   其 energy，模块可改写 total——伊德海莉蓄力置 0、朱鸢以太弹 carve 按比例缩）；
 * - moveId 在 cfg.energyRecoveryByMoveId（倍率表预存，键存在 = 表中找到）：
 *   显式 0 = 模块禁用（衍生行口径保留：回能留在平A聚合行防双计——sigrid 平A分段/liuyin 猜拳/
 *   nangong 地雷/jane 萨霍夫跳/alice 星仪序曲）；缺省 = 表值 || 行值 || 0（模块预计算行——
 *   伊德海莉蓄力循环 slam/follow 闪能——表值 0 落行值）；总收入 = 单次值 × max(0,count)
 *   （利用率缩放已在 count 里）；能量侧暂无口径冲突行（债务审计 MODULE_VALUE_DIFF=0），
 *   不设 override 通道——将来出现洛克茜自旋式每秒口径再按 decibelRecoveryOverride 同构补。
 * - 假 id / 表中未找到：行 total 原值（enrich 同分支不 patch energy）。
 * - 非有限值防线：同 rowDecibelTotal（NaN 会毒化次数迭代并被环检测的 JSON 签名物化成 null）。
 */
export function rowEnergyTotal(cfg: CharacterOperationConfig, row: SkillExecution): number {
  if (row.moveId === 'basic_attack') return finiteOr0(row.totalEnergyRecovery)
  const table = cfg.energyRecoveryByMoveId
  if (!table || !Object.prototype.hasOwnProperty.call(table, row.moveId)) return finiteOr0(row.totalEnergyRecovery)
  const perCount = row.energyRecovery === 0
    ? 0
    : (finiteOr0(table[row.moveId]) || finiteOr0(row.energyRecovery) || 0)
  return finiteOr0(perCount * Math.max(0, finiteOr0(row.count)))
}

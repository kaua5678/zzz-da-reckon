/**
 * CC-203：额外能力**硬门控表**的唯一事实源——引擎（`composables/resourceCalc/panelPhases.ts#evalAdditionalAbilityBuffGates`，
 * 用户强行勾上也拦）与 store 默认门控（`stores/config.ts#deriveTeammateBuffEnabled`，决定默认勾不勾）共读本表，
 * 所以「哪些 buff 随额外能力门控」只有一份答案。求值都用 `./teamCondition#evalAdditionalAbility`。
 *
 * CC-203 之前：引擎手写 15 角色的表，store 只看来源标签「额外能力」——
 *   ① 15 条「额外能力」buff（莱卡恩、柚叶、蕾米埃尔……）只有软门控，未触发时强行勾上照样生效；
 *   ② 跨来源条目（席德核心被动、潘引壶影画一、波可娜影画六）store 不知道，默认勾上、引擎静默丢弃。
 */
import type { TeammateBuffGroup } from '@/types/catalog'
import { getAgentSpec } from './registry'

/**
 * 额外能力硬门控的**跨来源**登记（CC-203 起只剩这一类）：buff 来源不是「额外能力」，但与拥有者 spec
 * `additionalAbility` 同条件。来源为「额外能力」的 buff 不必登记——`additionalGateBuffTable` 从数据派生。
 *
 * - 1461 席德：两条 buff 来源是核心被动 / 影画二，spec 注明「核心被动与影画2 同条件，两条 buff 一并门控」。
 * - 1421 潘引壶：影画一再 +10% 以额外能力触发为前提。
 * - 1351 波可娜：影画六「困迹对追加攻击以外也生效」以困迹（额外能力）为前提（CC-199）。
 *
 * 专属修正不在这里：凯撒「有任意队友」近似、菲欧妮 tier3「异常数≥3」走模块能力 `adjustAdditionalAbilityGates`（CC-67）。
 */
export const ADDITIONAL_GATE_CROSS_SOURCE_BUFFS: Readonly<Record<string, readonly string[]>> = {
  '1461': ['seed.core_vanguard_bright_attack', 'seed.cinema_2_encirclement_def_ignore'],
  '1421': ['pan_yinhu.cinema_1_stupefaction_dmg'],
  '1351': ['pulchra_cinema_6_trap_all'],
}

/**
 * 来源标签是否为「额外能力」：`额外能力`、`额外能力：<能力名>`（spec teamBuffs，如 1511「额外能力：天使队长」）
 * 或 `额外能力（<效果名>）`（teammate-buffs.json，如 1571「额外能力（技术鸿沟）」「额外能力（嗯呢弹幕）」）。
 * CC-309 前只认全等 `额外能力` ⇒ 带后缀的标签静默逃过门控；CC-310 补上括号形（诺姆两条 buff 曾在额外能力未触发时照样生效）。
 * 引擎门控表与 additionalGate.test.ts 共用本谓词。
 */
export function isAdditionalAbilitySourceLabel(label: string): boolean {
  return label === '额外能力' || /^额外能力[：（(]/.test(label)
}

const additionalGateTableCache = new WeakMap<readonly TeammateBuffGroup[], Readonly<Record<string, readonly string[]>>>()

/**
 * CC-203：额外能力硬门控表（拥有者组 id → buff id 列表），**从数据派生**：
 * 来源（`source.zhCN ?? sourceLabel.zhCN`）为「额外能力」（含「额外能力：<能力名>」，见 `isAdditionalAbilitySourceLabel`）、且拥有者 spec 声明了 `additionalAbility` 的 buff，
 * 加上 `ADDITIONAL_GATE_CROSS_SOURCE_BUFFS`。
 *
 * 引擎与 store 都读本函数（见文件头）。
 * 拥有者无 `additionalAbility` 声明（现：1511 南宫羽，见 additionalGate.test.ts `AA_OWNER_EXEMPT`）⇒ 不门控，与 store 一致。
 * 按 `groups` 数组身份缓存（catalog 载入后不变）。
 */
export function additionalGateBuffTable(groups: readonly TeammateBuffGroup[]): Readonly<Record<string, readonly string[]>> {
  const hit = additionalGateTableCache.get(groups)
  if (hit) return hit
  const table: Record<string, string[]> = {}
  for (const group of groups) {
    if (!getAgentSpec(group.id)?.additionalAbility) continue
    for (const buff of group.buffs) {
      if (isAdditionalAbilitySourceLabel(buff.source?.zhCN ?? buff.sourceLabel?.zhCN ?? '')) (table[group.id] ??= []).push(buff.id)
    }
  }
  for (const [agentId, buffIds] of Object.entries(ADDITIONAL_GATE_CROSS_SOURCE_BUFFS)) {
    const list = (table[agentId] ??= [])
    for (const id of buffIds) if (!list.includes(id)) list.push(id)
  }
  additionalGateTableCache.set(groups, table)
  return table
}

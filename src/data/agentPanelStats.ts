import type { PanelValues } from '@/types/catalog'

/**
 * 角色专属面板属性的初值表（CC-34a 2026-09-27，census §5.29）。
 *
 * 这些键既是 `PanelValues` 字段，也可能是 buff 数据（`public/static/catalog.json` / `teammate-buffs.json`）里的 stat 键。
 * - **初值**：`emptyPanel()`（`core/panel.ts`）按 `group` 把本表铺在原位置——**键序 = 本表顺序，不要随意重排**
 *   （面板对象的键序会进入快照哈希；原位置：`stun` 组在 `stunDmgMultiplierBonusCapAlways` 之后，
 *   `anomaly` 组在 `anomalyReleaseDmgBonus` 之后）。初值一律 0。
 *   ⚠ CC-165：蕾米埃尔 6 命三个 `*TriggerMultiplier` 字段是**加成**（catalog effect id = `*_multiplier_bonus`，
 *   模块按 `1 + x` 读），不是倍率——历史上按「倍率类初值 1」铺成 1，与 `1 + x` 叠成 0 命 ×2、6 命 ×3。
 *   新增字段先看 catalog 语义与模块读法再定初值，不要按名字里的 Multiplier 猜。
 * - **累加**：`applyStat`（`core/buff.ts`）的 default 分支按键名直加（`panel[stat] += value`），core 不逐个写字段名。
 *
 * 新增角色专属面板属性：在这里加一行 + `types/catalog.ts` 的 `PanelValues` 声明 +（需要展示时）`utils/statMeta.ts` 标签。
 * 本表只管「存放与累加」；怎么用由角色模块（如 `mechanics/agents/remielle.ts`）自己读。
 */
export type AgentPanelStatGroup = 'stun' | 'anomaly'

export const AGENT_PANEL_STATS = [
  { key: 'veilStunCapMult', group: 'stun', initial: 0 }, // 叶瞬光（语义见 PanelValues 声明与叶瞬光模块）
  { key: 'veilStunVulnBase', group: 'stun', initial: 0 }, // 叶瞬光
  { key: 'remielleRefringeCoefficient', group: 'anomaly', initial: 0 },
  { key: 'remielleRefringeCoefficientBonusPct', group: 'anomaly', initial: 0 },
  { key: 'remielleLuminizeMultiplierBonus', group: 'anomaly', initial: 0 },
  { key: 'remielleCinema4LuminizeMultiplierBonus', group: 'anomaly', initial: 0 },
  { key: 'remielleCinema1SpecialVoidflareCount', group: 'anomaly', initial: 0 },
  { key: 'remielleCinema1SpecialVoidflareDamage', group: 'anomaly', initial: 0 },
  { key: 'remielleFlowerFeatherDanceDecibelPerUse', group: 'anomaly', initial: 0 },
  { key: 'remielleCinema4SpecialVoidflareRefillCount', group: 'anomaly', initial: 0 },
  { key: 'remielleCinema6LuminizeTriggerMultiplier', group: 'anomaly', initial: 0 }, // 加成语义（CC-165）
  { key: 'remielleCinema6SpecialVoidflareTriggerMultiplier', group: 'anomaly', initial: 0 }, // 加成语义（CC-165）
  { key: 'remielleCinema6FleetingGraceVoidflareTriggerMultiplier', group: 'anomaly', initial: 0 }, // 加成语义（CC-165）
  { key: 'remielleCinema6SpecialVoidflareCount', group: 'anomaly', initial: 0 },
  { key: 'remielleCinema6SpecialVoidflareDamageRatio', group: 'anomaly', initial: 0 },
] as const satisfies ReadonlyArray<{ key: keyof PanelValues; group: AgentPanelStatGroup; initial: number }>

type AgentPanelStat = (typeof AGENT_PANEL_STATS)[number]
export type AgentPanelStatKey = AgentPanelStat['key']

/** 某组角色专属面板属性的初值（键序 = 表序），供 `emptyPanel()` 原位铺开 */
export function agentPanelStatInitials<G extends AgentPanelStatGroup>(group: G): Record<Extract<AgentPanelStat, { group: G }>['key'], number> {
  const out: Record<string, number> = {}
  for (const s of AGENT_PANEL_STATS) if (s.group === group) out[s.key] = s.initial
  return out as never // 精确键集由签名保证；运行时按 group 过滤
}

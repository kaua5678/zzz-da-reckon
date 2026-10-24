import type { AgentMechanicModule, AgentPanelInput } from '../types'

/**
 * 挽昼（1601·锋御/燎源）——v1 测试服占位包（nanoka 3.4.1+19836465），2026-10-25 第一刀 = **面板层**。
 *
 * ## 已接线（本文件）
 * - 核心被动·初始转化：「每 1% 初始暴击伤害 → 初始暴击率 +0.35%」。口径与克拉蕾同款
 *   （`claret.ts#applyClaretPanel`）：读**局外**面板、按整 1% floor、不封顶。
 * - 核心被动·极昼：进入接战获得，暴击率 +40%、造成伤害无视目标 20% 防御力，持续 15s；
 *   原文「艾尔妲与林德薇恩处于后场时持续时间不再减少」「发动任意强化特殊技/聚锋时重新获得」
 *   ⇒ 轮转高频刷新，**满覆盖近似**（debt: 状态机未建模，等引擎有逐事件时间通道后落真窗口）。
 *
 * ## 已定口径、待接线（下一步，写在 spec `resources` 里）
 * 1. **锐能（sharpness）**：进场 +60；强化特殊技（曦生/晦尽/晦尽改）30/发（raw「锐能消耗 30点」×3 行 +
 *    1 行无 id 属曦生改）；自动累积 = catalog `level60.sharpnessRegen` = 1.5/s（gachabase `sharpness_gain`
 *    逐招列已入库 16 行，与克拉蕾同口径**暂不重复计**）。
 * 2. **残痕 / 毁伤**：部分锐化伤害积累残痕值，**600 点 = 1 层**（用户 2026-10-25 裁决：沿用克拉蕾口径）；
 *    同时存量 ≤3 层；重击类招式（平A四段/强化特殊技/连携/支援突击）命中时消耗（≤3 层/次），每层触发 1 次毁伤。
 *    积累值 = catalog `gash_buildup` 逐招行（2026-10-25 已从 gachabase 补入 26 行）。
 *    ⚠ 用户裁决：**本期不建模毁伤伤害**（1601 数据缺毁伤倍率行，克拉蕾是 1625.6%），毁伤只出次数驱动愿力。
 * 3. **愿力**：全队每消除 1 层残痕 +40（上限 160）；≥120 消耗 120 发动「普通攻击：执旌·聚锋」
 *    ⇒ 每 3 次毁伤 = 1 次聚锋（40×3=120，160 的池上限在 3 层节奏下永不咬合）。
 * 4. **链齿 / 旗令**：每次聚锋各 +1；链齿 → 「强化特殊技：焚夜·长暗终焉」，旗令 →
 *    「强化特殊技：燃灯·永昼之炬」**或**「终结技：此行，共赴前路」。
 *    ⚠ 用户裁决 2026-10-25：**旗令优先给终结技**（产愿核 → 二段终结清烬痕），永昼之炬本版按 0 次。
 * 5. **愿核**：「此行，共赴前路」消耗 1 旗令 → 1 愿核 → 解锁「终结技：此愿，重塑万象」（不耗喧响）。
 * 6. **烬痕**：聚锋/长暗终焉/永昼之炬/两个终结技命中时按**实际伤害的 75%** 累积；
 *    「此愿，重塑万象」终结一击消除全部烬痕、直接扣除等量血量（用户 2026-10-25：**计入总伤害**）。
 *
 * ⚠ 命座：raw 影画 1–6 全是 `TestKey_PlaceHolder`（无数据）⇒ 命座相关一律不标 implemented。
 */
const SUNBRINGER_AGENT_ID = '1601'

/** 每 1% 初始暴击伤害 → 初始暴击率（核心被动 Lv.7） */
export const INITIAL_CRIT_DMG_TO_CRIT_RATE = 0.35
/** 极昼：暴击率 +40（满覆盖近似） */
export const POLAR_DAY_CRIT_RATE = 40
/** 极昼：造成伤害无视目标 20% 防御力（满覆盖近似） */
export const POLAR_DAY_DEF_IGNORE = 20
/**
 * 本文件曾在此导出 8 个「锐能 / 残痕 / 愿力 / 烬痕」常量（60 / 30 / 600 / 3 / 40 / 160 / 120 / 0.75）。
 * 2026-10-25：它们尚无消费者（机制体未落地 ⇒ deadChannelLs 判死导出）⇒ 数值暂存 spec 施工图
 * （`src/specs/agents/1601.json` notes 的「明日实录」清单，逐项含出处）——机制落地时从那里取值重建常量，
 * 不要回到「先导出常量、后写消费者」的顺序（本仓死导出门禁会拦）。
 */

export function applySunbringerPanel({ panel, outOfCombatPanel }: AgentPanelInput): void {
  // 核心被动·初始转化：只读局外面板，整 1% floor（与克拉蕾同口径）
  const initialCritDmg = outOfCombatPanel.critDmg
  if (initialCritDmg > 0) {
    panel.critRate = panel.critRate + Math.floor(initialCritDmg + 1e-9) * INITIAL_CRIT_DMG_TO_CRIT_RATE
  }
  // 极昼：满覆盖近似（见文件头）
  panel.critRate = panel.critRate + POLAR_DAY_CRIT_RATE
  panel.enemyDefReduction = panel.enemyDefReduction + POLAR_DAY_DEF_IGNORE
}

export const sunbringerMechanic: AgentMechanicModule = {
  id: 'agent:sunbringer',
  agentIds: [SUNBRINGER_AGENT_ID],
  name: '挽昼',
  description: 'v1 占位包（3.4.1+19836465）：面板层已接线（初始暴伤→暴击 0.35%/1%、极昼 暴击+40% / 无视 20% 防御）；'
    + '锐能/残痕/愿力/链齿·旗令/愿核/烬痕六条资源循环口径已定、待接线（模块头注释 §1–§6）。',
  applyPanel: applySunbringerPanel,
}

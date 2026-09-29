/**
 * 特化（职业）/ 属性 code → 中文名映射（纯搬运自 TeamConfigPage.vue）。
 * 消费面：角色下拉标签 + 套装效果门槛标签，两处共用同一份（本页单一来源）。
 *
 * ⚠ 两个映射**整体随搬、不拆散**：留在 .vue 里会让同一份口径在两个文件各持一份（破规则 11）。
 */
export const SPECIALTY_LABEL: Record<string, string> = {
  attack: '强攻',
  stun: '击破',
  anomaly: '异常',
  support: '支援',
  defense: '防护',
  rupture: '命破',
  sharpen: '锋御',
}
export const ATTRIBUTE_LABEL: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
  lumiflux: '流明',
  frostfire: '烈霜',
  frost: '霜',
  honed_edge: '利刃',
  xuanmo: '玄墨',
}

/**
 * 伤害元素 code → 中文名（伤害行 / 异常积蓄进度的 `element`，含变种元素）。
 * 与 `ATTRIBUTE_LABEL`（角色属性）是两个域：变种元素只出现在这里；辉光 / 流明的叫法两域各自沿用原值（CC-214 未改口径）。
 * CC-214 前有 5 份副本（resourceCalc/helpers、ResultPage、ResourceUtilizationPage、ResourceResultCard、impactVariables），
 * 页面副本缺 ether_ink / frostfire / physical_polar_assault，仪玄的异常进度直接显示原始 id。
 * 源码锁：`src/utils/__tests__/elementLabelSingleSource.test.ts`。
 */
export const DAMAGE_ELEMENT_LABEL: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
  lumiflux: '辉光',
  physical_polar_assault: '极性强击',  // 爱丽丝物理变种
  ether_ink: '玄墨',                  // 仪玄以太变种（独立积蓄槽）
  frostfire: '烈霜',                  // 雅独立元素
}

export function damageElementLabel(element: string): string {
  return DAMAGE_ELEMENT_LABEL[element] ?? element
}

/**
 * 角色卡片三枚标签（稀有度 / 职业 / 属性）的 naive-ui 样式：单一来源（CC-281）。
 * CC-281 前 `components/CharacterCard.vue` 与 `views/ResourcePage.vue` 各持一份逐字相同的颜色表与 rarity→type 三元式。
 * 颜色表未收录的 code（当前 `lumiflux` / `frostfire`，ATTRIBUTE_LABEL 有而颜色表没有）落到灰色兜底——
 * 这是搬迁前两份副本的共同现状，搬迁不改；是否补色属审美未决项（§24.120）。
 */
export interface AgentTagColor { color: string; textColor: string }
const FALLBACK_TAG_COLOR: AgentTagColor = { color: '#555', textColor: '#fff' }
const SPECIALTY_TAG_COLOR: Record<string, AgentTagColor> = {
  attack: { color: '#c0392b', textColor: '#fff' },
  stun: { color: '#d97706', textColor: '#fff' },
  anomaly: { color: '#7c3aed', textColor: '#fff' },
  support: { color: '#2563eb', textColor: '#fff' },
  defense: { color: '#047857', textColor: '#fff' },
  rupture: { color: '#db2777', textColor: '#fff' },
  sharpen: { color: '#0f766e', textColor: '#fff' },
}
const ATTRIBUTE_TAG_COLOR: Record<string, AgentTagColor> = {
  physical: { color: '#9ca3af', textColor: '#fff' },
  fire: { color: '#ef4444', textColor: '#fff' },
  ice: { color: '#38bdf8', textColor: '#fff' },
  electric: { color: '#facc15', textColor: '#fff' },
  ether: { color: '#a78bfa', textColor: '#fff' },
  wind: { color: '#34d399', textColor: '#fff' },
  frost: { color: '#60a5fa', textColor: '#fff' },
  honed_edge: { color: '#f472b6', textColor: '#fff' },
  xuanmo: { color: '#6366f1', textColor: '#fff' },
}

export function specialtyTagColor(specialty: string | undefined): AgentTagColor {
  return SPECIALTY_TAG_COLOR[specialty ?? ''] ?? FALLBACK_TAG_COLOR
}
export function attributeTagColor(attribute: string | undefined): AgentTagColor {
  return ATTRIBUTE_TAG_COLOR[attribute ?? ''] ?? FALLBACK_TAG_COLOR
}
export function rarityTagType(rarity: string | undefined): 'warning' | 'success' | 'default' {
  return rarity === 'S' ? 'warning' : rarity === 'A' ? 'success' : 'default'
}

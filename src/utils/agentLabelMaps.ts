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

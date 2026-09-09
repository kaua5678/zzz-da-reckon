// 预设队伍分类口径（单一事实源）。
//
// 用户裁决 2026-09-08：
// - 一级分类（group）= 队伍**输出核心**的职业队名；击破/支援/防护是辅助位，
//   「怎么能作为一个命名呢」→ 不作为一级分类，队里没有输出位则该队不收录。
//   输出核心 = 预设槽位 0（本库约定 0=主C）；槽位 0 是辅助位时退到队内第一个输出位。
//   复核确认（用户 2026-09-08）：`auto-1511-1561-1411`（南宫羽+维琳娜+柚叶）投稿声明的主C 是
//   南宫羽（击破），但击破不作分类名 → 按队内输出位归「异常队·风」（维琳娜），用户判"暂时归类于
//   异常队没啥问题"。这类"辅助位带队的实战队"共 4 条，全部走同一条退化规则，不单独开例外。
// - 二级分类（subgroup）= 该输出核心的属性（用户：「自动按主C属性分」）——
//   手编预设漏填 subgroup 曾导致「命破·火」只出 1 条（般岳其余队掉进「未分属性」）。
// 消费方：scripts/gen-auto-presets.mjs（生成）+ scripts/sync-preset-categories.mjs（回填/校验）。
// TS 侧同源：src/data/teamPresets.ts 头注释。

/** 特化代码 → 一级分类名（只含输出定位；辅助定位不出现在这里 = 不能当队名） */
export const SPECIALTY_GROUP = {
  attack: '强攻队',
  rupture: '命破队',
  anomaly: '异常队',
  sharpen: '锋御队',
  edgeguard: '锋御队',
}

/** 辅助定位（击破/支援/防护）：可以进队，但不能作为队伍的一级分类名 */
export const SUPPORT_SPECIALTIES = new Set(['stun', 'support', 'defense'])

/** 元素/属性代码 → 二级分类中文名 */
export const ELEMENT_LABEL = {
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

/** 该特化是否是输出核心（可作为一级分类） */
export function isCarrySpecialty(specialty) {
  return Object.keys(SPECIALTY_GROUP).includes(String(specialty ?? ''))
}

/**
 * 队伍输出核心（分类主体）：预设槽位 0（本库约定 0=主C）；槽位 0 是辅助位时
 * 退到队内第一个输出定位成员（按槽位顺序）。整队无输出位 → null（不该收录）。
 * @param {string[]} team 槽位顺序的 agentId 列表
 * @param {(id: string) => any | undefined} agentOf agentId → catalog 角色记录
 */
export function resolveCarryAgent(team, agentOf) {
  const ids = (team ?? []).map(String)
  if (ids.length && isCarrySpecialty(agentOf(ids[0])?.specialty)) return ids[0]
  return ids.find(id => isCarrySpecialty(agentOf(id)?.specialty)) ?? null
}

/**
 * 预设分类（一级 + 二级）。
 * @returns {{ group: string, subgroup: string, carryId: string } | null}
 *          null = 队内无输出位，不构成可命名的队伍
 */
export function classifyPreset(team, agentOf) {
  const carryId = resolveCarryAgent(team, agentOf)
  if (!carryId) return null
  const carry = agentOf(carryId)
  const group = SPECIALTY_GROUP[carry.specialty]
  if (!group) return null
  const element = carry.damageElement ?? carry.attribute ?? ''
  const label = ELEMENT_LABEL[element]
  if (!label) {
    // 属性未登记中文名：大声失败，不静默写英文原值（历史上 'lumiflux' 就是这么漏进预设的）
    throw new Error(`预设分类失败：角色 ${carryId}(${carry.name?.zhCN ?? ''}) 属性「${element}」无中文标签，请补 ELEMENT_LABEL`)
  }
  return { group, subgroup: label, carryId }
}

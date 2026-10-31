/**
 * 只读审计：队友 buff「作用域措辞 ↔ 生效面」对账（2026-10-31 蕾米影画二实测后补）。
 *
 * 这一类缺陷长什么样（真实事故）：原文「**队伍中[异常]角色**…无视目标 15% 防御力」，
 * 数据侧写成 `target.kind: 'default'`（全队），且没有任何按接收槽的过滤器 ⇒ 击破/支援队友的
 * 异常结算也白吃 15%（实测队 [1581,1511,1411]：C2 时 1411 紊乱单跳 104970 → 114324，恰为防御区
 * 比值）。这类错误**不会**被类型系统、`validate:data`、`statMeta` 或数值单测抓住——它们只校验
 * 「字段名存在、写法合法、公式能算」，不校验「这句话的主语/受益人是谁」。
 *
 * 判据（本脚本只报不红，需人工分诊——噪音形态见下）：
 *   队友 buff 的 description 里出现**受益人限定词**（队伍中[异常]角色 / [强攻]角色 / 该代理人 /
 *   正兵 / 拥有[X]的代理人 / 处于[X]状态下的队友），而它的 effects 全部是 `target.kind: 'default'`
 *   **且**没有 `excludeTargetAgentIds`、也没有模块级 `teammateBuffRecipientFilter` 认领这些效果 id
 *   ⇒ 候选：该 buff 可能越界给了全队。
 *
 * 为什么只报不红：`队伍中存在[X]角色时触发` 是**门控**不是受益人；音擎/驱动盘的 requirement 另有
 * 自己的 specialty 判定；已登记为「面板级近似」的条目属于**已知**近似（见下方 KNOWN_APPROX）。
 * 做成硬门会逼人把措辞改掉而不是把作用域改对。
 *
 * 用法（仓库根）：node scripts/audit-buff-scope.mjs
 * 退出码恒 0（只读审计）；新增条目请人工判断后要么修实现、要么在 KNOWN_APPROX 里补一行理由。
 */
import { readFileSync } from 'node:fs'

/** 已人工分诊的已知近似：{ buffId: 理由 }。**新增前先确认真的是近似而不是错误。** */
const KNOWN_APPROX = {
  'orphie.additional_def_ignore': '原文限「拥有[准星聚焦]的代理人…[追加攻击]伤害」，面板级近似为全队所有伤害（CC 草稿口径②，收益 >0 但方向已知偏高）',
  'orphie.cinema_1_crosshair_focus_dmg': '影画一「处于[准星聚焦]状态下的队友」——准星聚焦本身是全队增益，队友覆盖面≈全队（近似，非错误）',
  'seed.core_vanguard_bright_attack': '席德「明攻只给正兵、围杀给席德与正兵」已由 xide.ts#teammateBuffRecipientFilter 按接收槽过滤（文本命中但实现已处理）',
  'seed.cinema_2_encirclement_def_ignore': '同上，xide 接收槽过滤器覆盖',
}

const RESTRICT = /队伍中\[异常\]角色|队伍中\[强攻\]角色|全队\[锋御\]|该代理人|正兵|拥有\[[^\]]+\]的代理人|处于\[[^\]]+\]状态下的队友/

const groups = JSON.parse(readFileSync('public/static/teammate-buffs.json', 'utf8'))
const rows = []
for (const g of groups) {
  for (const b of g.buffs ?? []) {
    const text = (b.description && b.description.zhCN) || ''
    if (!RESTRICT.test(text)) continue
    const hasExclude = (b.effects || []).some(e => e.excludeTargetAgentIds && e.excludeTargetAgentIds.length > 0)
    const kinds = [...new Set((b.effects || []).map(e => e.target && e.target.kind))]
    const allDefault = kinds.length > 0 && kinds.every(k => k === 'default')
    if (hasExclude || !allDefault) continue
    if (KNOWN_APPROX[b.id]) continue
    rows.push({ group: g.id, buff: b.id, kinds, text: text.slice(0, 120).replace(/\s+/g, ' ') })
  }
}

console.log('== 队友 buff 作用域候选（措辞限定了受益人，但效果是全队且无排除/无接收槽过滤）==')
if (rows.length === 0) console.log('  （0 条：抽样面非空 = ' + groups.length + ' 组）')
for (const r of rows) console.log('  - ' + r.group + ' / ' + r.buff + ' :: ' + r.text)
console.log('\n人工分诊：修实现（如 remielle 的 teammateBuffRecipientFilter）或登记 KNOWN_APPROX；不要改措辞。')

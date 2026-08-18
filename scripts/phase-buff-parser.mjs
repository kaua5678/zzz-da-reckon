/**
 * 危局当期 buff 牌文本解析器（nanoka selectable_buff 描述 → 引擎字段）
 *
 * 输入：buff 牌描述文本（多段效果，段间以换行/分号分隔；含 <color> 富文本标签）
 * 输出：{ title, testOnly, effects[], unparsed[] }
 *
 * 口径（用户拍板）：
 * - 失衡易伤 → stunDmgMultiplierBonus（与击破角色 buff 同字段，直接加，不折算覆盖率）
 * - 异常特性 2/3 名 → anomalyCount 分档（应用时按队伍实际异常人数选档）
 * - 强攻/异常等特性限定 → specialty 条件（应用时队伍无该特性角色则该条不生效）
 * - 其余条件效果（施放后持续 X 秒等）→ 默认满覆盖录入，原文保留在 note
 * - (Test1)TBD 测试服占位 → testOnly: true（不参与解析/推荐，等正式服）
 * - 未命中规则表的段落 → unparsed（UI 展示原文，用户可手动补全局 Buff）
 */

export const ELEMENT_MAP = {
  物理: 'physical', 火: 'fire', 冰: 'ice', 电: 'electric', 以太: 'ether', 风: 'wind',
}

/** 招式限定 → targetSkillType */
const SKILL_TYPE_MAP = {
  普通攻击: 'basic', 强化特殊技: 'exSpecial', 特殊技: 'special', 终结技: 'ultimate', 连携技: 'chain',
}

/** 元素备选（长词优先，避免"以太"被拆成单字） */
const EL = '(物理|以太|冰|火|电|风)'

/**
 * 单段效果规则：{ re, apply(match) }
 * 段落内循环匹配：命中后删除已匹配文本，继续匹配剩余部分（一段可出多个效果）。
 */
const RULES = [
  // 多招式列表伤害提升：[A]、[B]、[C]造成的伤害提升 X%（每个招式一个效果）
  { re: /(\[[^\]\[]+\](?:、\[[^\]\[]+\])*)(?:的)?(?:伤害|造成的伤害)提升\s*(-?\d+)%/, apply: m => {
      const moves = m[1].split('、').map(x => x.replace(/[\[\]]/g, ''))
      const out = []
      for (const mv of moves) {
        const t = SKILL_TYPE_MAP[mv]
        if (t) out.push({ stat: 'skillDmgBonus', value: +m[2], targetSkillType: t })
      }
      return out.length > 0 ? out : null
    } },
  // 暴击伤害提升 X%
  { re: /暴击伤害提升\s*(-?\d+)%/, apply: m => ({ stat: 'critDmg', value: +m[1] }) },
  // 攻击力提升 X%
  { re: /攻击力提升\s*(-?\d+)%/, apply: m => ({ stat: 'atkPct', value: +m[1] }) },
  // 异常精通提升 X点
  { re: /异常精通提升\s*(-?\d+)\s*点/, apply: m => ({ stat: 'anomalyProficiency', value: +m[1] }) },
  // 异常伤害提升 X%
  { re: /异常伤害提升\s*(-?\d+)%/, apply: m => ({ stat: 'anomalyDmgBonus', value: +m[1] }) },
  // 异常积蓄值提升 X% / 积蓄效率提升 X%
  { re: /(?:属性异常)?积蓄(?:值)?(?:积累)?效率?提升\s*(-?\d+)%/, apply: m => ({ stat: 'anomalyBuildUpEfficiency', value: +m[1] }) },
  // X属性伤害提升 X%
  { re: new RegExp(`${EL}属性?伤害提升\\s*(-?\\d+)%`), apply: m => ({ stat: `${ELEMENT_MAP[m[1]]}Dmg`, value: +m[2] }) },
  // 全属性伤害抗性降低 X%
  { re: /全属性伤害抗性(?:降低|无视)\s*(-?\d+)%/, apply: m => ({ stat: 'enemyResReduction', value: +m[1] }) },
  // X属性伤害抗性降低/无视 X%（两种语序："X属性伤害抗性降低30%" 与 "无视其30%的X属性伤害抗性"）
  { re: new RegExp(`${EL}属性?伤害抗性(?:降低|无视)\\s*(-?\\d+)%`), apply: m => ({ stat: `enemy${ELEMENT_MAP[m[1]][0].toUpperCase()}${ELEMENT_MAP[m[1]].slice(1)}ResReduction`, value: +m[2] }) },
  { re: new RegExp(`无视其\\s*(-?\\d+)%的${EL}属性?伤害抗性(?:和${EL}属性?伤害抗性)+`), apply: m => {
      const out = [m[2], m[3]].filter(Boolean).map(el => ({ stat: `enemy${ELEMENT_MAP[el][0].toUpperCase()}${ELEMENT_MAP[el].slice(1)}ResReduction`, value: +m[1] }))
      return out.length > 1 ? out : out[0] ?? null
    } },
  { re: new RegExp(`无视其\\s*(-?\\d+)%的${EL}属性?伤害抗性`), apply: m => ({ stat: `enemy${ELEMENT_MAP[m[2]][0].toUpperCase()}${ELEMENT_MAP[m[2]].slice(1)}ResReduction`, value: +m[1] }) },
  // 无视敌人 X% 防御力 / 防御力降低 X%
  { re: /(?:无视(?:敌人)?|防御力降低)\s*(-?\d+)%的?防御力/, apply: m => ({ stat: 'enemyDefReduction', value: +m[1] }) },
  // 失衡易伤提升 X%（直接加，不折算）
  { re: /失衡易伤(?:倍率)?提升\s*(-?\d+)%/, apply: m => ({ stat: 'stunDmgMultiplierBonus', value: +m[1] }) },
  // 敌人受到的易伤倍率提升 X%（敌方易伤区）
  { re: /受到的易伤倍率提升\s*(-?\d+)%/, apply: m => ({ stat: 'enemyDamageTakenBonus', value: +m[1] }) },
  // 贯穿伤害提升 X%（命破贯穿增伤区）
  { re: /贯穿伤害提升\s*(-?\d+)%/, apply: m => ({ stat: 'sheerDmgBonus', value: +m[1] }) },
  // 锐化伤害提升 X%（锋御锐化增伤区，独立乘区）
  { re: /锐化伤害提升\s*(-?\d+)%/, apply: m => ({ stat: 'sharpDmgBonus', value: +m[1] }) },
  // 锐暴伤害提升 X%
  { re: /锐暴伤害提升\s*(-?\d+)%/, apply: m => ({ stat: 'sharpCritDmg', value: +m[1] }) },
  // 穿透率提升 X%
  { re: /穿透率提升\s*(-?\d+)%/, apply: m => ({ stat: 'penRatio', value: +m[1] }) },
  // 防御力提升 X%（己方）
  { re: /防御力提升\s*(-?\d+)%/, apply: m => ({ stat: 'defPct', value: +m[1] }) },
  // 生命值上限提升 X%
  { re: /生命值上限提升\s*(-?\d+)%/, apply: m => ({ stat: 'hpPct', value: +m[1] }) },
  // 造成失衡值提升 X% / 失衡值积累效率提升 X%
  { re: /(?:造成(?:的)?|对敌人造成的)?失衡值(?:积累)?(?:效率)?提升\s*(-?\d+)%/, apply: m => ({ stat: 'stunBuildUpBonus', value: +m[1] }) },
  // 招式限定伤害提升：[X]造成的伤害提升 Y%
  { re: /\[([^\]\[]+)\](?:的)?(?:伤害|造成的伤害)提升\s*(-?\d+)%/, apply: m => {
      const t = SKILL_TYPE_MAP[m[1]]
      return t ? { stat: 'skillDmgBonus', value: +m[2], targetSkillType: t } : null
    } },
  // 终结技伤害提升 X%（无括号形式）
  { re: /终结技伤害提升\s*(-?\d+)%/, apply: m => ({ stat: 'skillDmgBonus', value: +m[1], targetSkillType: 'ultimate' }) },
  // 强化特殊技伤害提升 X%
  { re: /强化特殊技伤害提升\s*(-?\d+)%/, apply: m => ({ stat: 'skillDmgBonus', value: +m[1], targetSkillType: 'exSpecial' }) },
]

/** 特性限定提取 */
const SPECIALTY_RE = /\[(强攻|异常|击破|命破|支援|防护|锋御)\](?:特性)?/
/** 异常特性 2/3 名 */
const ANOMALY_COUNT_RE = /队伍(?:内|中)?存在(\d)\/(\d)名\[异常\]特性/
/** "的X分别提升 A/B" 档位（如 的异常精通分别提升30点/70点、的异常伤害分别提升10%/25%） */
const RANKED_RE = /的([\u4e00-\u9fff]+?)分别提升\s*(-?[\d.]+)(?:点|%)?\s*\/\s*(-?[\d.]+)(?:点|%)?/g
/** 档位属性名 → 引擎字段（2/3 名分档只有这几类） */
const RANKED_STAT_MAP = {
  异常精通: 'anomalyProficiency',
  异常伤害: 'anomalyDmgBonus',
  属性异常伤害: 'anomalyDmgBonus',
  攻击力: 'atkPct',
}
/** 匹配后残留的噪音片段（不报警告） */
const NOISE_RE = /持续\s*-?[\d.]+\s*秒|重复触发时刷新|刷新持续时间|上限|叠层|命中(?:敌人)?时|处于[^，。]*状态|触发|后，|，|。|的|使|其|额外|同时|分别|提升|降低|无视|存在|名|特性|代理人|全队|队伍|攻击|敌人|自身|本次|效果|时间|至多/

function stripTags(s) {
  return s.replace(/<color=[^>]+>/g, '').replace(/<\/color>/g, '').trim()
}

/** 解析单段（循环：命中即删，继续匹配剩余），返回 effects[] */
function parseSegment(seg, cond) {
  const effects = []
  let rest = seg
  let guard = 0
  while (rest && guard++ < 12) {
    let hit = null
    for (const rule of RULES) {
      const m = rest.match(rule.re)
      if (m) { hit = { rule, m }; break }
    }
    if (!hit) break
    const applied = hit.rule.apply(hit.m)
    if (applied) {
      const list = Array.isArray(applied) ? applied : [applied]
      for (const eff of list) {
        eff.note = seg
        if (cond) eff.cond = { ...(cond ?? {}), ...(eff.cond ?? {}) }
        effects.push(eff)
      }
    }
    rest = rest.replace(hit.m[0], '')
  }
  return { effects, rest }
}

/** 解析整张 buff 牌描述 */
export function parsePhaseBuff(title, desc) {
  const testOnly = /Test1|TBD/i.test(title)
  const text = stripTags(desc ?? '')
  const segments = text.split(/[\n;。]+/).map(s => s.trim()).filter(Boolean)
  const effects = []
  const unparsed = []
  for (const seg of segments) {
    // 异常特性 2/3 名分档：提取所有 "的X分别提升 A/B" 档位
    const countMatch = seg.match(ANOMALY_COUNT_RE)
    const ranked = [...seg.matchAll(RANKED_RE)]
    if (countMatch && ranked.length > 0) {
      for (const r of ranked) {
        const stat = RANKED_STAT_MAP[r[1]]
        if (stat) {
          effects.push({
            stat,
            value: +r[3], // 满编 3 名档
            note: seg,
            cond: { anomalyCount: [+r[2], +r[3]] },
          })
        } else {
          unparsed.push(seg)
        }
      }
      // 段内非档位部分（如异常触发后的减抗）继续走普通解析
      const restOfSeg = seg.replace(RANKED_RE, '')
      if (restOfSeg.trim()) {
        const specialty = restOfSeg.match(SPECIALTY_RE)?.[1]
        const { effects: more, rest } = parseSegment(restOfSeg, specialty ? { specialty } : null)
        effects.push(...more)
        if (!NOISE_RE.test(rest) && rest.trim()) unparsed.push(rest.trim())
      }
      continue
    }
    const specialty = seg.match(SPECIALTY_RE)?.[1]
    const { effects: more, rest } = parseSegment(seg, specialty ? { specialty } : null)
    effects.push(...more)
    if (!NOISE_RE.test(rest) && rest.trim()) unparsed.push(rest.trim())
  }
  return {
    title: testOnly ? title.trim() : title.replace(/\(Test1\)\s*TBD\s*/g, '').trim(),
    testOnly,
    effects,
    unparsed,
  }
}

/** 供 UI 显示用的效果标签（中文短名 + 数值 + 条件） */
const STAT_LABELS = {
  critDmg: '暴伤', atkPct: '攻击%', atkFlat: '攻击', anomalyProficiency: '精通',
  anomalyDmgBonus: '异常伤', anomalyBuildUpEfficiency: '积蓄效率',
  enemyResReduction: '全减抗', enemyDefReduction: '减防',
  stunDmgMultiplierBonus: '失衡易伤', enemyDamageTakenBonus: '易伤',
  sheerDmgBonus: '贯穿伤', sharpDmgBonus: '锐化伤', sharpCritDmg: '锐暴', penRatio: '穿透率', defPct: '防御%', hpPct: '生命%',
  stunBuildUpBonus: '失衡值', skillDmgBonus: '招式伤',
}
const EL_ZH_REV = Object.fromEntries(Object.entries(ELEMENT_MAP).map(([zh, en]) => [en, zh]))
function statLabelOf(stat) {
  if (STAT_LABELS[stat]) return STAT_LABELS[stat]
  // 元素推导：{el}Dmg / enemy{El}ResReduction
  const elMatch = stat.match(/^(physical|fire|ice|electric|ether|wind)Dmg$/)
  if (elMatch) return `${EL_ZH_REV[elMatch[1]]}伤`
  const resMatch = stat.match(/^enemy(Physical|Fire|Ice|Electric|Ether|Wind)ResReduction$/)
  if (resMatch) return `${EL_ZH_REV[resMatch[1].toLowerCase()]}减抗`
  return stat
}
export function effectLabel(eff) {
  const cond = []
  if (eff.cond?.anomalyCount) cond.push('异常2/3名')
  if (eff.cond?.specialty) cond.push(`${eff.cond.specialty}限定`)
  const unit = eff.stat === 'anomalyProficiency' ? '点' : '%'
  const parts = [statLabelOf(eff.stat), `+${eff.value}${unit}`]
  if (eff.targetSkillType) parts.push(`→${eff.targetSkillType}`)
  if (cond.length) parts.push(`[${cond.join('，')}]`)
  return parts.join(' ')
}

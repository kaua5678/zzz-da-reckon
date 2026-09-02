/**
 * 危局当期 buff 牌文本解析器（nanoka selectable_buff / layer_buff 描述 → 引擎字段）
 *
 * 输入：buff 牌描述文本（多段效果，段间以换行/分号/句号分隔；含 <color>/<Term>/<IconMap> 富文本标签）
 * 输出：{ title, testOnly, effects[], unparsed[] }
 *
 * 口径（用户拍板）：
 * - 失衡易伤 → stunDmgMultiplierBonus（与击破角色 buff 同字段，直接加，不折算覆盖率）
 * - 异常/强攻等特性人数分档（2/3 名异常、1/2 名强攻）→ cond.countTier
 *   { specialty, thresholds:[低档人数, 高档人数], values:[低档值, 高档值] }，
 *   应用时按队伍该特性实际人数选档（resolveBuffEffect）。
 * - 强攻/异常/击破/命破等特性限定 → cond.specialty（二元：队伍无该特性角色则该条不生效）
 * - 其余条件效果（施放后持续 X 秒等）→ 默认满覆盖录入，原文保留在 note
 * - (Test1)TBD 测试服占位 → testOnly: true（不参与解析/推荐，等正式服）
 * - 未命中规则表的段落 → unparsed（UI 展示原文，用户可手动补全局 Buff）
 *
 * 字段口径（描述 → 引擎字段，2026-09 重写）：
 * - 元素伤害（X属性伤害 / X伤害，可「和、/、与、及」并列）→ {el}Dmg
 * - 元素减抗（无视其 N% 的 X 伤害抗性 / X 伤害抗性降低 N%）→ enemy{El}ResReduction
 * - 全属性/全伤害减抗（全属性伤害抗性 / 全属性抗性 / 全伤害抗性 / 伤害抗性）→ enemyResReduction
 * - 减防（无视 N% 防御力 / 防御力降低 N%）→ enemyDefReduction
 * - 造成的伤害提升（无条件，区别于各限定伤害）→ dmgBonus
 * - 招式限定伤害 → skillDmgBonus + targetSkillType（basic/exSpecial/special/ultimate/chain/assist/dodgeCounter/dashAttack/additionalAttack）
 * - 属性异常伤害 / 异常伤害 → anomalyDmgBonus；[紊乱]伤害 → disorderDamageBonus；[异放]伤害 → anomalyReleaseDmgBonus
 * - 异常积蓄效率 / 积蓄效率 / 异常积蓄值 → anomalyBuildUpEfficiency
 * - 暴击伤害 → critDmg；暴击率 → critRate；攻击力 → atkPct；异常精通 → anomalyProficiency
 * - 失衡易伤倍率 → stunDmgMultiplierBonus；造成的失衡值 → stunBuildUpBonus
 * - 贯穿伤害 → sheerDmgBonus；锐化伤害 → sharpDmgBonus；锐暴伤害 → sharpCritDmg；穿透率 → penRatio
 * - 己方防御力提升 → defPct；生命值上限 → hpPct
 * - 喧响值获取效率 → decibelGainEfficiency；能量获取效率 → energyGainEfficiency；闪能获得效率 → flashEnergyGainEfficiency
 * - 受到的伤害提升 → enemyDamageTakenBonus；受到的暴击伤害提升 → enemyCritDmgTakenBonus
 */

export const ELEMENT_MAP = {
  物理: 'physical', 火: 'fire', 冰: 'ice', 电: 'electric', 以太: 'ether', 风: 'wind',
}

/** 招式限定 → targetSkillType（对齐 SkillDamageTarget；快速支援归入 assist） */
const SKILL_TYPE_MAP = {
  普通攻击: 'basic', 特殊技: 'special', 强化特殊技: 'exSpecial', 终结技: 'ultimate',
  连携技: 'chain', 支援攻击: 'assist', 快速支援: 'assist', 闪避反击: 'dodgeCounter', 冲刺攻击: 'dashAttack',
  追加攻击: 'additionalAttack',
}
/** 可命中招式（只匹配已知招式，避免把 [紊乱]/[异放]/[强攻] 等机制词误当招式） */
const MOVE = `(?:${Object.keys(SKILL_TYPE_MAP).join('|')})`

/** 元素备选（长词优先，避免"以太"被拆成单字；属性可选） */
const EL = '(?:物理属性|以太属性|火属性|冰属性|电属性|风属性|物理|以太|火|冰|电|风)'

function normEl(zh) {
  return ELEMENT_MAP[zh.replace(/属性$/, '')] ?? null
}
function cap(s) {
  return s[0].toUpperCase() + s.slice(1)
}

/**
 * 解析「无视其 N% 的 X 伤害抗性（和/、/与/及 …）*」子句 → enemy{El}ResReduction[]。
 * 支持两种数值写法：
 *   共享值：「无视其30%的冰属性伤害抗性和以太属性伤害抗性」→ 冰/以太 各 30
 *   各自值：「无视其20%的电属性伤害抗性和20%的火属性伤害抗性」→ 电/火 各 20
 */
function parseEnemyResReduction(clause) {
  const body = clause.replace(/^无视(?:敌人|其)?\s*/, '')
  const parts = body.split(/(?:和|、|与|及)/).map(s => s.trim())
  const out = []
  let curVal = null
  for (const p of parts) {
    const m = p.match(new RegExp(`^(\\d+)%的?(${EL})伤害抗性$`))
    if (m) {
      curVal = +m[1]
      const el = normEl(m[2])
      if (el) out.push({ stat: `enemy${cap(el)}ResReduction`, value: curVal })
    } else {
      const el = normEl(p.replace(/伤害抗性$/, ''))
      if (el && curVal != null) out.push({ stat: `enemy${cap(el)}ResReduction`, value: curVal })
    }
  }
  return out
}

/**
 * 单段效果规则：{ re, apply(match) }
 * 段落内循环匹配：命中后删除已匹配文本，继续匹配剩余部分（一段可出多个效果）。
 * 顺序 = 特异性高者在前（先元素/限定伤害，后通用伤害），避免「暴击伤害」被通用「伤害」吞掉。
 */
const RULES = [
  // 多元素伤害并列：[A]伤害和[B]伤害提升 N%（一个元素一个效果）
  {
    re: new RegExp(`((?:${EL})伤害(?:(?:和|、|与|及)(?:${EL})伤害)*)(?:将)?(?:额外)?提升\\s*(-?\\d+)%`),
    apply: m => {
      const els = m[1].split(/(?:和|、|与|及)/).map(s => normEl(s.replace(/伤害$/, '')))
      const out = els.map(el => (el ? { stat: `${el}Dmg`, value: +m[2] } : null)).filter(Boolean)
      return out.length ? out : null
    },
  },
  // 元素减抗（无视形式，支持并列/共享值/各自值）
  {
    re: new RegExp(`无视(?:敌人|其)?\\s*(?:-?\\d+%的?)?(?:${EL})伤害抗性(?:(?:和|、|与|及)(?:-?\\d+%的?)?(?:${EL})伤害抗性)*`),
    apply: m => {
      const out = parseEnemyResReduction(m[0])
      return out.length ? out : null
    },
  },
  // 元素减抗（降低形式）：X属性伤害抗性降低 N%
  { re: new RegExp(`(${EL})伤害抗性降低\\s*(-?\\d+)%`), apply: m => {
      const el = normEl(m[1])
      return el ? { stat: `enemy${cap(el)}ResReduction`, value: +m[2] } : null
    } },
  // 全属性/全伤害减抗（无视形式）
  { re: /无视(?:敌人|其)?\s*(-?[\d.]+)%的?(全属性伤害抗性|全属性抗性|全伤害抗性|伤害抗性)/, apply: m => ({ stat: 'enemyResReduction', value: +m[1] }) },
  // 全属性/全伤害减抗（降低形式）
  { re: /(全属性伤害抗性|全属性抗性|全伤害抗性)降低\s*(-?[\d.]+)%/, apply: m => ({ stat: 'enemyResReduction', value: +m[2] }) },
  // 减防（无视形式）
  { re: /无视(?:敌人|其)?\s*(-?[\d.]+)%的?防御力/, apply: m => ({ stat: 'enemyDefReduction', value: +m[1] }) },
  // 减防（降低形式，含「额外」；「防御」与「防御力」都认）
  { re: /(?:敌人)?防御(?:力)?(?:额外)?降低\s*(-?[\d.]+)%/, apply: m => ({ stat: 'enemyDefReduction', value: +m[1] }) },
  // 招式限定伤害（多招式，可含「命中时」；分隔符 、 / 和）
  {
    re: new RegExp(`(\\[${MOVE}\\](?:(?:[、\\/和])\\[${MOVE}\\])*)(?:命中(?:敌人)?时)?(?:对其)?(?:的)?(?:伤害|造成的伤害)(?:额外)?提升\\s*(-?[\\d.]+)%`),
    apply: m => {
      const moves = m[1].split(/[、\/和]/).map(x => x.replace(/[\[\]]/g, ''))
      const out = []
      for (const mv of moves) {
        const t = SKILL_TYPE_MAP[mv]
        if (t) out.push({ stat: 'skillDmgBonus', value: +m[2], targetSkillType: t })
      }
      return out.length > 0 ? out : null
    },
  },
  // 招式限定伤害（单招式，可含「命中时」）
  { re: new RegExp(`\\[(${MOVE})\\](?:命中(?:敌人)?时)?(?:对其)?(?:的)?(?:伤害|造成的伤害)(?:额外)?提升\\s*(-?[\\d.]+)%`), apply: m => {
      const t = SKILL_TYPE_MAP[m[1]]
      return t ? { stat: 'skillDmgBonus', value: +m[2], targetSkillType: t } : null
    } },
  // 无括号招式（终结技/强化特殊技/连携技/普通攻击…）：如「终结技造成的伤害额外提升15%」
  { re: /(终结技|强化特殊技|连携技|普通攻击|特殊技|闪避反击|冲刺攻击|追加攻击|支援攻击)(?:命中(?:敌人)?时)?(?:对其)?(?:的)?(?:伤害|造成的伤害)(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => {
      const t = SKILL_TYPE_MAP[m[1]]
      return t ? { stat: 'skillDmgBonus', value: +m[2], targetSkillType: t } : null
    } },
  // 失衡易伤（倍率可选，含「额外」）
  { re: /失衡易伤(?:倍率)?(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'stunDmgMultiplierBonus', value: +m[1] }) },
  // 增加其 N% 失衡易伤倍率（倒装语序，如「每层[裂伤]…增加其10%失衡易伤倍率」）
  { re: /增加其\s*(-?[\d.]+)%失衡易伤倍率/, apply: m => ({ stat: 'stunDmgMultiplierBonus', value: +m[1] }) },
  // 造成的失衡值
  { re: /(?:造成(?:的)?|对敌人造成的)?失衡值(?:积累)?(?:效率)?(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'stunBuildUpBonus', value: +m[1] }) },
  // 受到(的)暴击伤害提升（敌方受暴伤；必须在「暴击伤害」之前，避免误入 critDmg）
  { re: /受到(?:的)?暴击伤害(?:额外)?(?:提升|提高)\s*(-?[\d.]+)%/, apply: m => ({ stat: 'enemyCritDmgTakenBonus', value: +m[1] }) },
  // 暴击伤害（含「额外」）
  { re: /暴击伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'critDmg', value: +m[1] }) },
  // 暴击率
  { re: /暴击率提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'critRate', value: +m[1] }) },
  // 攻击力（含「额外」）
  { re: /攻击力(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'atkPct', value: +m[1] }) },
  // 异常精通
  { re: /异常精通提升\s*(-?[\d.]+)\s*点/, apply: m => ({ stat: 'anomalyProficiency', value: +m[1] }) },
  // 属性异常伤害和[紊乱]伤害并列提升（一个数值两效果）
  { re: /(?:属性)?异常伤害(?:和|、|与|及)\[?紊乱\]?(?:效果)?(?:造成的)?伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => [
      { stat: 'anomalyDmgBonus', value: +m[1] },
      { stat: 'disorderDamageBonus', value: +m[1] },
    ] },
  // 属性异常伤害 / 异常伤害（提升/增加）
  { re: /(?:属性)?异常伤害(?:额外)?(?:提升|增加)\s*(-?[\d.]+)%/, apply: m => ({ stat: 'anomalyDmgBonus', value: +m[1] }) },
  // [紊乱]伤害 / 紊乱造成的伤害
  { re: /(?:\[紊乱\]|紊乱)(?:效果)?(?:造成的)?伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'disorderDamageBonus', value: +m[1] }) },
  // [异放]伤害 / 异放伤害
  { re: /(?:\[异放\]|异放)(?:造成的)?伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'anomalyReleaseDmgBonus', value: +m[1] }) },
  // [乱流]伤害 / 乱流伤害
  { re: /(?:\[乱流\]|乱流)(?:造成的)?伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'turbulenceDamageBonus', value: +m[1] }) },
  // 异常积蓄效率 / 积蓄效率 / 异常积蓄值
  { re: /(?:属性异常)?积蓄(?:值)?(?:积累)?(?:效率)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'anomalyBuildUpEfficiency', value: +m[1] }) },
  // 贯穿伤害
  { re: /贯穿伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'sheerDmgBonus', value: +m[1] }) },
  // 锐化伤害（提升/提高）
  { re: /锐化伤害(?:提升|提高)\s*(-?[\d.]+)%/, apply: m => ({ stat: 'sharpDmgBonus', value: +m[1] }) },
  // 锐暴伤害
  { re: /(?:受到的)?锐暴伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'sharpCritDmg', value: +m[1] }) },
  // 穿透率
  { re: /穿透率提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'penRatio', value: +m[1] }) },
  // 己方防御力提升（必须在「无视…防御力」「防御力降低」之后，避免敌方减防被误读）
  { re: /防御力提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'defPct', value: +m[1] }) },
  // 生命值上限
  { re: /生命值上限提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'hpPct', value: +m[1] }) },
  // 喧响值获取效率
  { re: /喧响值(?:获取|获得)效率提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'decibelGainEfficiency', value: +m[1] }) },
  // 能量和闪能获得效率并列
  { re: /能量和闪能获得效率\s*提升\s*(-?[\d.]+)%/, apply: m => [
      { stat: 'energyGainEfficiency', value: +m[1] },
      { stat: 'flashEnergyGainEfficiency', value: +m[1] },
    ] },
  // 能量获取效率
  { re: /能量(?:获取|获得)效率提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'energyGainEfficiency', value: +m[1] }) },
  // 闪能获得效率
  { re: /闪能(?:获取|获得)效率\s*提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'flashEnergyGainEfficiency', value: +m[1] }) },
  // 受到(的)伤害提升（敌方易伤；必须在各限定伤害之后）
  { re: /受到(?:的)?伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'enemyDamageTakenBonus', value: +m[1] }) },
  // 首领敌人/自身 造成的伤害提升（boss 自我增益，非代理人 buff，跳过）
  { re: /(?:首领敌人|自身)造成的?伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: () => null },
  // 通用伤害提升（无条件；必须最后，避免吞掉限定伤害）
  { re: /(?:造成的)?伤害(?:额外)?提升\s*(-?[\d.]+)%/, apply: m => ({ stat: 'dmgBonus', value: +m[1] }) },
]

/** 特性限定提取 */
const SPECIALTY_RE = /\[(强攻|异常|击破|命破|支援|防护|锋御)\](?:特性)?/
/** 特性人数分档：队伍内存在 A/B 名 [X] 特性（如 异常 2/3 名、强攻 1 名/2 名；「名」位置两种写法都要兼容） */
const COUNT_TIER_RE = /队伍(?:内|中)?存在(\d+)\s*名?\s*\/\s*(\d+)\s*名?\[(强攻|异常|击破|命破|支援|防护|锋御)\]特性/
/** 分档数值：的X分别提升A/B 或 X提升A%/B%（长词优先避免「伤害」吞「暴击伤害」；非捕获避免抢占捕获组序号） */
const TIER_STAT = '(?:属性异常伤害|异常精通|异常伤害|异常积蓄效率|暴击伤害|攻击力|伤害)'
const TIER_RE = new RegExp(`的?(${TIER_STAT})(?:分别)?提升\\s*(-?[\\d.]+)(?:点|%)?\\s*\\/\\s*(-?[\\d.]+)(?:点|%)?`, 'g')
const TIER_STAT_MAP = {
  异常精通: 'anomalyProficiency',
  异常伤害: 'anomalyDmgBonus',
  '属性异常伤害': 'anomalyDmgBonus',
  异常积蓄效率: 'anomalyBuildUpEfficiency',
  暴击伤害: 'critDmg',
  攻击力: 'atkPct',
  伤害: 'dmgBonus',
}
/** 匹配后残留的噪音片段（不报警告） */
const NOISE_RE = /持续\s*-?[\d.]+\s*秒|重复触发时刷新|刷新持续时间|上限|叠层|命中(?:敌人)?时|处于[^，。]*状态|触发|后，|，|。|的|使|其|额外|同时|分别|提升|降低|无视|存在|名|特性|代理人|全队|队伍|攻击|敌人|自身|本次|效果|时间|至多/

function stripTags(s) {
  return s.replace(/<color=[^>]+>/g, '').replace(/<\/color>/g, '')
    .replace(/<Term:[^>]+>/g, '').replace(/<\/Term>/g, '')
    .replace(/<IconMap:[^>]+>/g, '').replace(/<\/IconMap>/g, '')
    .trim()
}

/** 解析单段（循环：命中即删，继续匹配剩余），返回 effects[] */
function parseSegment(seg, cond) {
  const effects = []
  let rest = seg
  let guard = 0
  while (rest && guard++ < 24) {
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

/** 叠层上限（每层 X% / 最多叠加 N 层 → 满覆盖按 X × N 录入） */
const PER_LAYER_RE = /每(?:层|有1层|拥有1层|持有1层)\[/
const STACK_COUNT_RE = /最多(?:可)?叠加\d+层|最多累计\d+层|最多\d+层|至多可以叠加\d+层/
const TRIGGER_RE = /后[，,]|时[，,]/
function maxStackOf(text) {
  let m = text.match(/最多(?:可)?叠加(\d+)层/)
  if (m) return +m[1]
  m = text.match(/最多累计(\d+)层/)
  if (m) return +m[1]
  m = text.match(/至多可以叠加(\d+)层/)
  if (m) return +m[1]
  m = text.match(/最多(\d+)层/)
  if (m) return +m[1]
  m = text.match(/施加1层\/(\d+)层/)
  if (m) return +m[1]
  m = text.match(/额外施加(\d+)层/)
  if (m) return +m[1] + 1 // 首层 + 额外 N 层
  m = text.match(/拥有(\d+)层\[[^\]]+\]时/)
  if (m) return +m[1]
  return null
}

/** 解析整张 buff 牌描述 */
export function parsePhaseBuff(title, desc) {
  const testOnly = /Test1|TBD/i.test(title)
  const text = stripTags(desc ?? '')
  const segments = text.split(/[\n;。；]+/).map(s => s.trim()).filter(Boolean)
  const effects = []
  const unparsed = []
  const maxStack = maxStackOf(text) ?? 1
  for (const seg of segments) {
    // 特性人数分档（异常 2/3 名 / 强攻 1/2 名）：提取所有「提升 A/B」档位
    const countMatch = seg.match(COUNT_TIER_RE)
    const tiers = countMatch ? [...seg.matchAll(TIER_RE)] : []
    if (countMatch && tiers.length > 0) {
      const specialty = countMatch[3]
      const thresholds = [+countMatch[1], +countMatch[2]]
      for (const t of tiers) {
        const stat = TIER_STAT_MAP[t[1]]
        if (stat) {
          effects.push({
            stat,
            value: +t[3], // 满编（高档）数值
            note: seg,
            cond: { countTier: { specialty, thresholds, values: [+t[2], +t[3]] } },
          })
        } else {
          unparsed.push(seg)
        }
      }
      // 段内非分档部分（如「异常触发后的减抗」）继续走普通解析
      const restOfSeg = seg.replace(TIER_RE, '')
      if (restOfSeg.trim()) {
        const specialty2 = restOfSeg.match(SPECIALTY_RE)?.[1]
        const { effects: more, rest } = parseSegment(restOfSeg, specialty2 ? { specialty: specialty2 } : null)
        effects.push(...more)
        if (!NOISE_RE.test(rest) && rest.trim()) unparsed.push(rest.trim())
      }
      continue
    }
    const specialty = seg.match(SPECIALTY_RE)?.[1]
    const cond = specialty ? { specialty } : null

    // 叠层拆分：每层[X] 整段叠层；否则「最多叠加 N 层」按触发器（后/时）拆前段 flat + 后段叠层
    let flatSeg = null
    let stackedSeg = null
    if (PER_LAYER_RE.test(seg)) {
      stackedSeg = seg
    } else if (STACK_COUNT_RE.test(seg)) {
      const m = seg.match(TRIGGER_RE)
      if (m) {
        const idx = m.index + m[0].length
        flatSeg = seg.slice(0, idx)
        stackedSeg = seg.slice(idx)
      } else {
        stackedSeg = seg
      }
    }

    if (flatSeg) {
      const { effects: more, rest } = parseSegment(flatSeg, cond)
      effects.push(...more)
      if (!NOISE_RE.test(rest) && rest.trim()) unparsed.push(rest.trim())
    }
    const target = stackedSeg ?? seg
    const { effects: more, rest } = parseSegment(target, cond)
    if (stackedSeg && maxStack > 1) {
      for (const e of more) e.value = Math.round(e.value * maxStack * 100) / 100
    }
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
  critDmg: '暴伤', critRate: '暴击率', atkPct: '攻击%', atkFlat: '攻击', anomalyProficiency: '精通',
  anomalyDmgBonus: '异常伤', anomalyBuildUpEfficiency: '积蓄效率',
  disorderDamageBonus: '紊乱伤', anomalyReleaseDmgBonus: '异放伤', turbulenceDamageBonus: '乱流伤',
  enemyResReduction: '全减抗', enemyDefReduction: '减防',
  stunDmgMultiplierBonus: '失衡易伤', enemyDamageTakenBonus: '易伤', enemyCritDmgTakenBonus: '受暴伤',
  sheerDmgBonus: '贯穿伤', sharpDmgBonus: '锐化伤', sharpCritDmg: '锐暴', penRatio: '穿透率', defPct: '防御%', hpPct: '生命%',
  stunBuildUpBonus: '失衡值', skillDmgBonus: '招式伤', dmgBonus: '伤害',
  decibelGainEfficiency: '喧响效率', energyGainEfficiency: '能量效率', flashEnergyGainEfficiency: '闪能效率',
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
  if (eff.cond?.countTier) {
    cond.push(`${eff.cond.countTier.specialty}${eff.cond.countTier.thresholds[0]}/${eff.cond.countTier.thresholds[1]}名`)
  }
  if (eff.cond?.specialty) cond.push(`${eff.cond.specialty}限定`)
  const unit = eff.stat === 'anomalyProficiency' ? '点' : '%'
  const parts = [statLabelOf(eff.stat), `+${eff.value}${unit}`]
  if (eff.targetSkillType) parts.push(`→${eff.targetSkillType}`)
  if (cond.length) parts.push(`[${cond.join('，')}]`)
  return parts.join(' ')
}

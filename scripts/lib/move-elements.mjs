/**
 * 招式伤害属性（element）解析——**单一事实源**（规则 11）。
 *
 * 为什么需要本模块（2026-09-18 round 23 查实）：
 * 旧导入器 `import-nanoka-missing.mjs#buildMove(skill, element)` 把**角色元素铺满每一招**
 * ⇒ 非本属性的段（如安比伏特速攻 #1~#3 是物理）白吃本属性伤害加成/抗性，异常积蓄也照给。
 * 用户 2026-09-17 裁决原话：「需要明确，不属于自身属性的伤害不难积累，
 * 比如格里斯的平a前几段物理不能给积蓄」。
 *
 * ⚠ **三条已实测的错路（别重走，这是本模块存在的理由）**：
 *
 * 1. **按 `skill_list` 的 id 直接查 catalog moveId —— 错**。`skill_list` 是 nanoka 自有编号，
 *    与倍率表 moveId **错位**（实测 767 个同号 id 里 **690 个名字对不上**；
 *    例：1011 的 `skill_list[1011002]` = 落雷，而倍率表 `1011002` = 伏特速攻#2）。
 *    本仓早已在 `enrich-nanoka-missing.mjs` 与 `import-nanoka-v12.mjs` 头注释记过这个坑
 *    （「skill_list 是 nanoka 自有编号，与倍率表 moveId 错位，不能按 id 硬套」）。
 * 2. **按名字把 `skill_list` 整条铺给该名字下所有段 —— 过粗**。安比「伏特速攻」整组
 *    `element_type=200`（物理），但原文是「**前三段**物理，**第四段**电属性」⇒ 会把 #4 也判成物理。
 * 3. **只认 `skill_list` 的 element_type —— 漏**。星见雅 1091 的 `skill_list` 名字是
 *    「普通攻击：风花（一、二段）」/「（三、四、五段）」，与倍率表条目名「普通攻击：风花」不等
 *    ⇒ 按名字 join 直接落空，整组无法解析。
 *
 * ★ **本模块的核心纪律：只在有正面证据时输出，没有证据就「不改」**。
 *   旧行为（角色元素铺满）本身就是一个已知近似；**没有证据的改动 = 用另一个猜测替换猜测**，
 *   且会让 delta 无法归因（规则 10）。故 `resolveMoveElements` 对无证据的 move
 *   **不返回条目**，由调用方保持原值。
 *
 * 证据强度（每条结果带 `source`，便于审计与逐条归因）：
 *   `param-suffix`  > `prose-segment` > `prose-single` > `skill-list`
 * 其中 `skill-list` 只在**名字完全相等且该条 element_type 非 0** 时采用
 * （`element_type == 0` 实测 62 条全是招架支援/回避支援/闪避这类**无伤害**动作 ⇒ 不是证据）。
 *
 * ⚠ **歧义即不猜**：原文说「造成物理伤害和电属性伤害」（同一段混伤，如格莉丝 1181 普攻）
 * 时**本模块不输出**——单一 `damageElement` 字段无法表达混伤，静默选一边会让数据骗下一个
 * agent（规则 16）。
 */

/** nanoka 属性码 → catalog 属性名（由 `full/*.json` 的 `element_type` 与 `catalog.agents[].attribute` 反查实证） */
export const ELEMENT_BY_CODE = {
  200: 'physical',
  201: 'fire',
  202: 'ice',
  203: 'electric',
  204: 'wind',
  205: 'ether',
  300: 'lumiflux',
}

/** 原文散文里的属性词 → catalog 属性名（烈霜 = 冰的显示名） */
export const ELEMENT_BY_WORD = {
  物理: 'physical',
  电属性: 'electric',
  火属性: 'fire',
  冰属性: 'ice',
  烈霜: 'ice',
  以太: 'ether',
  风属性: 'wind',
  流明: 'lumiflux',
}

const WORD_ALT = Object.keys(ELEMENT_BY_WORD).join('|')
/**
 * 中文数字表（**必须在 SEG_RULE 之前定义**——SEG_RULE 的字符类由它派生）。
 * ⚠ **必须含 `两`**（= 2）：原文写「前**两**段造成物理伤害」（1091 风花 / 1461 霜蕊轮舞）而不是
 * 「前二段」。第一版只收 `一二三四…十` ⇒ 该条整句匹配不上，星见雅 1091 的普攻分段**静默不解析**
 * （表现为「该改的没改」，比改错更难发现）。
 */
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const CN_CHARS = Object.keys(CN_NUM).join('')

/** 「…造成<color>X伤害」中的属性词 */
const ELEM_IN_TEXT = new RegExp(`(${WORD_ALT})伤害`, 'g')
/** 「第N段…造成X伤害」/「前N段…造成X伤害」/「后N段…造成X伤害」（N 含 `两`） */
const SEG_RULE = new RegExp(
  `(第([${CN_CHARS}]+)段|前([${CN_CHARS}]+)段|后([${CN_CHARS}]+)段)`
  + `[^。；]{0,40}?造成\\s*(?:<[^>]*>)?(${WORD_ALT})(?:</color>)?伤害`,
  'g',
)

/** 去标签 + 去空格（原文里属性词常被 <color> 包住） */
export function plain(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 中文数字 → 阿拉伯数字（只处理招式段序号会用到的 1–99）。
 *
 * ⚠ **2026-09-18 实测踩过的 bug**：第一版写成「`^([一..十])?十?([一..十])?$` + `tens*10+ones`」，
 * 于是「一」被解析成 **10**、「三」成 30（无「十」时也乘了 10）。当时 1011 恰好仍输出正确结果
 * （段键 10/20/30 与序号 10/20/30 自洽），属**偶然正确**——1341「第一段物理，后四段冰」的
 * 第 2~5 段则整片解析不出来。⇒ 单字直接查表；只有真含「十」才走十进制合成。
 */
function cnNum(s) {
  const str = String(s ?? '')
  if (!str) return null
  if (str.length === 1) return CN_NUM[str] ?? null
  const m = str.match(new RegExp(`^([${CN_CHARS}])?十([${CN_CHARS}])?$`))
  if (!m) return null
  const [, tens, ones] = m
  const t = tens ? CN_NUM[tens] : 1
  const o = ones ? CN_NUM[ones] : 0
  if (t == null || o == null) return null
  return t * 10 + o
}

/**
 * 解析一条 description 文本里的属性证据。
 * @returns {{kind:'segment', bySegment:Map<number,string>}
 *          | {kind:'single', element:string}
 *          | {kind:'ambiguous'} | {kind:'none'}}
 */
export function parseElementFromText(desc) {
  const text = plain(desc)
  if (!text) return { kind: 'none' }
  const all = new Set()
  for (const m of text.matchAll(ELEM_IN_TEXT)) all.add(ELEMENT_BY_WORD[m[1]])
  if (all.size === 0) return { kind: 'none' }

  const bySegment = new Map()
  let sawSegmentRule = false
  for (const m of text.matchAll(SEG_RULE)) {
    const [, , dNum, qNum, hNum, word] = m
    const element = ELEMENT_BY_WORD[word]
    const d = dNum ? cnNum(dNum) : null
    const q = qNum ? cnNum(qNum) : null
    const h = hNum ? cnNum(hNum) : null
    sawSegmentRule = true
    if (d != null) bySegment.set(d, element)
    else if (q != null) for (let i = 1; i <= q; i++) bySegment.set(i, element)
    else if (h != null) bySegment.set(-h, element) // 负键 = 「后 N 段」，按该组总段数展开
  }
  if (sawSegmentRule) return { kind: 'segment', bySegment }
  // 无按段指派：整招只提一种属性 ⇒ 单元素；提了多种（「和」混伤）⇒ 歧义，不猜
  if (all.size === 1) return { kind: 'single', element: [...all][0] }
  return { kind: 'ambiguous' }
}

/** param 名自带的属性后缀，如「一段伤害倍率（物理）」——最硬的证据（游戏内表格列名） */
export function parseElementFromParamName(paramName) {
  const m = plain(paramName).match(new RegExp(`[（(]\\s*(${WORD_ALT})\\s*[)）]`))
  return m ? ELEMENT_BY_WORD[m[1]] : null
}

/** 段序号（param 名里的「一段」「二段」…）——用于与原文的按段指派对齐 */
export function segmentOrdinal(paramName) {
  const m = plain(paramName).match(new RegExp(`第?([${CN_CHARS}]+)段`))
  return m ? cnNum(m[1]) : null
}

/**
 * 从 full raw 建「倍率表 moveId → 该 move 的原文归属条目」映射。
 *
 * 结构（nanoka full JSON）：`skill.<cat>.description[]` 里
 *  - **文本条目**只有 `{name, desc}`；
 *  - **倍率条目**只有 `{name, param:[{name, param:{moveId:…}}]}`。
 * 两者靠 **name 相等**配对（`import-nanoka-v12.mjs` 同款做法）。
 *
 * ⚠ 同名文本条目可能有多条（同一招式的不同解锁/模式版本，如 1181「高压射钉」×2）——
 * 取**第一条带属性证据**的，并把冲突记进 `conflicts` 供审计（不静默取首条）。
 */
export function buildMoveTextIndex(full) {
  const index = new Map()
  for (const cat of Object.values(full?.skill ?? {})) {
    if (!cat || typeof cat !== 'object') continue
    const entries = Array.isArray(cat.description) ? cat.description : []
    for (const entry of entries) {
      const params = Array.isArray(entry?.param) ? entry.param : []
      if (!params.length) continue
      const groupName = plain(entry?.name)
      const descs = entries
        .filter(x => !Array.isArray(x?.param) && plain(x?.name) === groupName)
        .map(x => x?.desc ?? '')
      const groupDesc = descs.find(d => parseElementFromText(d).kind !== 'none') ?? descs[0] ?? ''
      for (const p of params) {
        const paramName = plain(p?.name)
        for (const moveId of Object.keys(p?.param ?? {})) {
          if (index.has(moveId)) continue
          index.set(moveId, { groupName, groupDesc, paramName })
        }
      }
    }
  }
  return index
}

/**
 * `skill_list` 兜底：名字 → element（**只在名字完全相等、且 element_type 是真实属性时**用）。
 *
 * - `element_type == 0`（实测 62 条全是招架支援/回避支援/闪避这类无伤害动作）**不是证据** ⇒ 剔除。
 * - 名字里带「（一、二段）」这类分段限定的一律不参与（与倍率表条目名不等，天然落空；见错路 3）。
 * - ⚠ 同名多值（如格莉丝有两条「闪避反击：违章处罚」）**不取第一个**——那是「按名字联想」，
 *   正是规则 15 禁止的静默选最像的。冲突即作废，让调用方落到「不改」。
 */
export function buildSkillListIndex(full) {
  const byName = new Map()
  for (const info of Object.values(full?.skill_list ?? {})) {
    const name = plain(info?.name)
    if (!name) continue
    const code = info?.element_type
    if (!code) continue // 0 / 缺失 = 无属性证据
    const element = ELEMENT_BY_CODE[code]
    if (!element) continue
    const prev = byName.get(name)
    if (prev === undefined) byName.set(name, element)
    else if (prev !== element) byName.set(name, null) // 冲突 → 作废
  }
  for (const [k, v] of [...byName]) if (v === null) byName.delete(k)
  return byName
}

/**
 * 解析一个角色的全部 move 属性。**只为有正面证据的 move 返回条目**（无证据 = 不在 Map 里）。
 *
 * @param {object} full  `data/raw/nanoka_missing/full/<id>.json`
 * @param {Iterable<string>} moveIds  该角色 catalog 里的 moveId 全集
 * @returns {Map<string, {element:string, source:string, detail?:string}>}
 */
export function resolveMoveElements(full, moveIds) {
  const textIndex = buildMoveTextIndex(full)
  const skillList = buildSkillListIndex(full)
  const out = new Map()

  // 按「组」聚合：组内顺序必须按倍率表条目顺序（= 段序），不能按 moveId 字典序。
  const groups = new Map()
  for (const moveId of moveIds) {
    const info = textIndex.get(moveId)
    const key = info ? info.groupName : null
    if (key === null) continue // 不在原文里 ⇒ 无证据
    if (!groups.has(key)) groups.set(key, { info, moves: [] })
    groups.get(key).moves.push(moveId)
  }

  for (const { info, moves } of groups.values()) {
    const { groupDesc, paramName } = info

    // ① param 名后缀（最硬：游戏内表格列名自带属性）
    const fromParam = parseElementFromParamName(paramName)
    if (fromParam) {
      for (const moveId of moves) out.set(moveId, { element: fromParam, source: 'param-suffix', detail: paramName })
      continue
    }

    const parsed = parseElementFromText(groupDesc)
    if (parsed.kind === 'single') {
      for (const moveId of moves) out.set(moveId, { element: parsed.element, source: 'prose-single' })
      continue
    }
    if (parsed.kind === 'segment') {
      // ⚠ 段序号取自 param 名（「一段伤害倍率」→1），**不是数组下标**——
      //   同组里「伤害倍率」「失衡倍率」两类 param 交错，下标会错位。
      //   同一 moveId 出现多次时取**第一次**（伤害倍率先于失衡倍率）。
      const ordinals = new Map()
      for (const moveId of moves) {
        const pn = textIndex.get(moveId)?.paramName ?? ''
        const ord = segmentOrdinal(pn)
        if (ord != null && !ordinals.has(moveId)) ordinals.set(moveId, ord)
      }
      const total = ordinals.size ? Math.max(...ordinals.values()) : moves.length
      const bySeg = new Map()
      for (const [k, v] of parsed.bySegment) {
        if (k > 0) bySeg.set(k, v)
        // 「后 N 段」= 该组**最后** N 段（total-N+1 .. total）。
        // ⚠ 第一版写成 `total + k + 1`（k 为负）⇒ 只落一段：1091「后三段烈霜」只标了段 3，
        //   1341「后四段冰」只标了段 2。当时结果看似正确纯属「余下段本就等于角色元素」的巧合。
        else for (let i = total + k + 1; i <= total; i++) bySeg.set(i, v)
      }
      for (const moveId of moves) {
        const ord = ordinals.get(moveId)
        const el = ord != null ? bySeg.get(ord) : undefined
        if (el) out.set(moveId, { element: el, source: 'prose-segment', detail: `段${ord}/${total}` })
      }
      // 只解析出部分段 ⇒ 余下**不改**（不猜）；已解析的保持
      continue
    }
    if (parsed.kind === 'ambiguous') continue // 混伤 ⇒ 不猜，不改
    // ② 原文没提属性 ⇒ skill_list 整招兜底（element_type 非 0 且名字完全相等）
    const el = skillList.get(info.groupName)
    if (el) for (const moveId of moves) out.set(moveId, { element: el, source: 'skill-list', detail: info.groupName })
  }
  return out
}

/** 该 move 的哪些 row 承载属性（与导入器 `buildMove` 一致：伤害行 + 异常积蓄行） */
export const ELEMENT_ROW_KINDS = new Set(['damageMultiplier', 'anomaly'])

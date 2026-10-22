/**
 * CC-83：mechanics/types.ts 拆分护栏。卫星类型移至 typesRows.ts / typesHooks.ts / typesView.ts，由 types.ts 转出。
 *
 * ## 判据形态（2026-10-17 第二次订正）
 *
 * 第一版是 `split('\n').length < 1400`：文件以换行结尾时多切一个空串 ⇒ 1399 行判成 1400 报红，
 * **上限偷偷变成 1399 且取决于文件有没有末尾换行**（加/删一个换行就能骗过判据）。
 * 第二版修了换行，但**仍只量行数**——它答不了「新类型有没有写回 types.ts」：
 * 实测写回 6 行新 interface ⇒ 1405 红；同时删 6 行 `//` 注释 ⇒ 1399 **绿**。
 * 而本文件 1017 行注释里全是「为什么这么拆」的口径（规则 16）⇒ 判据在**奖励删知识**。
 *
 * 现行形态 = **结构白名单**（主判据）+ 行数天花板（粗兜底，留余量）+ 注释密度下限（防「删注释腾地方」）：
 *   ① types.ts 里 `export interface/type` 的名字集合必须**逐字等于** `TYPES_TS_DECLARATIONS`。
 *      新增类型 ⇒ 必须先来这里登记 ⇒ 强制一次「这个类型该住哪」的决策（多数该进卫星文件）。
 *   ② 卫星文件必须仍被转出（`from './typesRows'` 等）——否则「拆出去」只是把符号挪走、导入方全炸。
 *   ③ 行数天花板 1400（实测 1352，余量 48）——**只作粗兜底**，不承担「该不该拆」的判断。
 *   ④ 注释行 ≥ 950（实测 995）——**防「删注释腾地方」这条最廉价的变绿路径**。
 *
 * 反证（本判据该红的时候真的会红）：
 *   · 在 types.ts 里加一个 `export interface Foo {}` ⇒ ①红（白名单没有 Foo）；
 *   · 把 typesRows 的转出删掉 ⇒ ②红；
 *   · 删 50 行注释把新类型塞进来 ⇒ ④红。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXTRA_ANOMALY_ROW_ORDER as viaTypes } from '@/mechanics/types'
import { EXTRA_ANOMALY_ROW_ORDER as viaRows } from '@/mechanics/typesRows'

const TYPES_TS = resolve(__dirname, '../types.ts')

/**
 * **允许住在 types.ts 的类型**（显式登记，新增必须来改这里）。
 *
 * 判据：**其他类型要引用它**（`AgentMechanicModule` 的钩子入参、或 `TeamMechanic` 的组合根），
 * 且它不属于任何一颗卫星的职责（行类型→typesRows / 钩子 I/O→typesHooks / 展示层声明→typesView）。
 * 只在 types.ts 内部用的类型也登记在这里——白名单管的是「住在哪」，不是「导不导出」。
 *
 * ⚠ 往这里加一行之前先问：它能不能进 typesRows / typesHooks / typesView？
 * 能进就别加（CC-451 的教训：展示层声明一条条长在本文件里，把预算顶到 1483 红了 15 小时）。
 */
const TYPES_TS_DECLARATIONS = [
  // ---- 队伍 / 面板上下文（AgentMechanicModule 与各 Agent*Input 的公共入参）----
  'MechanicTeamMember',
  'ReadonlyTeam',
  'TeammateBuffGateInput',
  'AgentPanelInput',
  'AgentTeamPanelEffectInput',
  'AgentCharConfigInput',
  'AgentResourceInput',
  'AgentBackstageRowsInput',
  'AgentTeamPhase',
  // ---- 轴 ----
  'AxisActionLike',
  'AxisLike',
  'AgentAxisContext',
  // ---- 队伍配置 / 跨轮反馈 ----
  'AgentTeamConfigInput',
  'AgentTeamRoundInput',
  'ModuleFeedback',
  // ---- 强特时长 ----
  'AgentExSpecialTimeInput',
  'AgentExSpecialTimeEstimate',
  // ---- 事件 / 结果 / 招式变换 ----
  'AgentEventInput',
  'AgentResourceResultInput',
  'AgentSkillTransformInput',
  // ---- 钩子 I/O 的**入参**（出参形状在 typesHooks；这两个是 AgentMechanicModule 的入参位，见 CC-18 设计稿 §2-1）----
  'AgentDamageResolutionInput',
  'ReleaseModifierInput',
  // ---- 组合根 ----
  'TeamMechanic',
  'AgentMechanicModule',
]

/** 行数天花板：**粗兜底**，不承担「该不该拆」的判断（那是白名单的事）。实测 1352，留 48 行余量。 */
const TYPES_TS_LINE_CEILING = 1400
/** 注释行下限：防「删注释腾地方」。实测 995，留 45 行余量。 */
const TYPES_TS_COMMENT_FLOOR = 950

/** 去掉注释后的行（判注释密度用；与仓库其余源码锁同口径） */
function commentLineCount(lines: string[]): number {
  let inBlock = false
  let n = 0
  for (const ln of lines) {
    const t = ln.trim()
    if (t === '') continue
    if (inBlock) { n++; if (t.includes('*/')) inBlock = false; continue }
    if (t.startsWith('/*')) { n++; if (!t.includes('*/')) inBlock = true; continue }
    if (t.startsWith('//') || t.startsWith('*')) { n++; continue }
  }
  return n
}

describe('CC-83 mechanics/types.ts 拆分', () => {
  it('EXTRA_ANOMALY_ROW_ORDER 经 types.ts 转出 = 同一对象', () => {
    expect(viaTypes).toBe(viaRows)
    expect(Object.keys(viaTypes).length).toBeGreaterThan(0)
  })

  it('① types.ts 里的类型声明 = 登记白名单（新类型必须进卫星文件，或来此显式登记）', () => {
    const src = readFileSync(TYPES_TS, 'utf-8')
    const declared = [...src.matchAll(/^export (?:interface|type) (\w+)/gm)].map(m => m[1]).sort()
    expect(
      declared,
      'types.ts 的顶层类型集合变了。新类型默认该进 typesRows（行）/ typesHooks（钩子 I/O）/ typesView（展示层）；'
      + '确实必须住 types.ts 的，把它加进 TYPES_TS_DECLARATIONS 并写明为什么不能进卫星文件。',
    ).toEqual([...TYPES_TS_DECLARATIONS].sort())
  })

  it('② 三条转出仍在（拆出去的符号必须仍能从 types.ts 导入）', () => {
    const src = readFileSync(TYPES_TS, 'utf-8')
    // ⚠ 必须只认 **export … from** 行：本文件顶部还有 import … from 同三个路径，
    //    只写 toContain("from './typesRows'") 会被 import 行满足 ⇒ 删掉转出仍绿（实测注入 D 假阴性）。
    const reexport = (p: string) => new RegExp(`^export (?:type )?\\{[^}]*\\} from '${p}'`, 'm')
    for (const p of ['./typesRows', './typesHooks', './typesView']) {
      expect(src, `${p} 的转出被删了（拆出去的符号导入方会全炸）`).toMatch(reexport(p))
    }
    expect(src).toContain('export interface AgentMechanicModule')
  })

  it('③ 行数天花板（粗兜底）+ ④ 注释密度下限（防删注释腾地方）', () => {
    const src = readFileSync(TYPES_TS, 'utf-8')
    // 末尾换行不多算一行（第一版口径事故：见文件头注释）
    const lines = src.split('\n').filter((_, i, all) => i < all.length - 1 || all[i] !== '')
    expect(lines.length, 'types.ts 行数超天花板：该拆的新类型进卫星文件，不是删注释').toBeLessThanOrEqual(TYPES_TS_LINE_CEILING)
    // ④ 与 ③ 成对：只量行数会让「删注释」成为最廉价的变绿路径
    expect(
      commentLineCount(lines),
      'types.ts 注释行低于下限——「删注释腾地方」是最廉价的变绿路径，而注释里是「为什么这么拆」的口径（规则 16）',
    ).toBeGreaterThanOrEqual(TYPES_TS_COMMENT_FLOOR)
  })

  it('⑤ 六个能力声明形状是具名的（判据 29③：不许在 AgentMechanicModule 里写内联字面量）', () => {
    // CC-83 第二批（2026-10-17）：这六个原本是 AgentMechanicModule 里的内联对象字面量，
    // 共 103 行（含成员文档注释）。起名后搬进 typesHooks.ts，types.ts 只留一行引用。
    const src = readFileSync(TYPES_TS, 'utf-8')
    const hooks = readFileSync(resolve(__dirname, '../typesHooks.ts'), 'utf-8')
    for (const [field, typeName] of [
      ['axisRageCombos', 'AxisRageCombos'],
      ['releaseShare', 'ReleaseShareSpec'],
      // 2026-10-18：teammateSplit（Q 分配）被 teammateDrop（每队友丢弃 N 次）取代，具名类型随之换名
      ['teammateDrop', 'TeammateDropSpec'],
      ['axisGashResource', 'AxisGashResourceSpec'],
      ['finalizePass', 'FinalizePassSpec'],
    ] as const) {
      expect(src, `AgentMechanicModule.${field} 必须是具名类型引用，不许写回内联字面量`)
        .toMatch(new RegExp(`^  ${field}\\?: ${typeName}$`, 'm'))
      expect(hooks, `${typeName} 必须定义在 typesHooks.ts`).toMatch(new RegExp(`^export interface ${typeName} \\{`, 'm'))
    }
  })
})

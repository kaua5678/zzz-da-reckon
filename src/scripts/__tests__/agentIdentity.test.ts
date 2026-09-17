/**
 * T8 只读身份清单（`scripts/report-agent-identity.mjs`）的判据集。
 *
 * 三层价值：① 检测器可红性自证（构造源码，正例/反例成对）② 分类边界（纯具名定义 vs
 * 业务回调 vs 存储标志 unknown —— 后者**不可静默排除**，必须带消费者线索露面）
 * ③ 仓库级口径（旧尺与官方 `countAgentIdBranchLines` 同源、输出确定、观察项不并入度量）。
 *
 * ⚠ 本文件**只测报告面**：不改任何运行时语义，也不改 frozen/棘轮（换尺是独立后批）。
 * ⚠ 别名盲区（`fillerAgentId === '1051'`）刻意**不计入任何计数**——若要纳入，必须先
 *   在 check-guards 定义新形态并单独换尺，不许在报告脚本里悄悄加宽尺度。
 */
import { describe, expect, it } from 'vitest'
import {
  formatMarkdown,
  groupByIdentity,
  readIdentitySources,
  reportIdentity,
  scanIdentitySource,
  summarizeIdentity,
} from '../../../scripts/report-agent-identity.mjs'
import { countAgentIdBranchLines } from '../../../scripts/check-guards.mjs'
import {
  countIdentityBranchLines,
  identityComparison,
  isNonCharacterIdComparison,
  scanIdentityComparisons,
  scanNonCharacterIdComparisons,
} from '../../../scripts/lib/agent-identity-lines.mjs'

type Entry = ReturnType<typeof scanIdentitySource>['entries'][number]
/** 缩短断言：只扫 fixture 源码，返回逐条比较 */
const scan = (code: string): Entry[] => scanIdentitySource(code).entries

describe('执行尺（check-guards 棘轮的度量口径，AST 单源）', () => {
  // 为什么单独一组：换尺后**棘轮判据本身**靠这个 lib 计数。它若漏计/多计，
  // 「只减不增」就再次变成空的（旧正则正是这么漏掉 27 行的）。
  it('★ 三种形态都计，且按行去重（旧尺只认 agentId，另两种是本次换尺的理由）', () => {
    expect(countIdentityBranchLines(`if (c.agentId === '1431') work()`)).toBe(1)
    expect(countIdentityBranchLines(`if (c.id === '1581') work()`)).toBe(1)
    expect(countIdentityBranchLines(`if (c.teammateBuffId === 'remielle') work()`)).toBe(1)
    // 同一行两个形态 = 1 行（棘轮单位）；表达式数另计（更细的尺）
    const both = `if (c.id === '1581' || c.teammateBuffId === 'remielle') work()`
    expect(countIdentityBranchLines(both)).toBe(1)
    expect(scanIdentityComparisons(both)).toHaveLength(2)
  })

  it('★ `.id` 只在另一侧是四位数字字面量时才算角色判定（否则招式/数据行会被误计）', () => {
    // 换尺实测：不设限 49 行 → 加限 42 行，差的 7 行全是 `m.id === moveId` 族
    expect(countIdentityBranchLines(`const m = all.find(x => x.id === moveId)`)).toBe(0)
    expect(countIdentityBranchLines(`const m = all.find(x => x.id === dataId)`)).toBe(0)
    expect(countIdentityBranchLines(`if (row.id === 'row-name') work()`)).toBe(0)
    expect(countIdentityBranchLines(`if (row.id === 'basic') work()`)).toBe(0)
    expect(countIdentityBranchLines(`if (agent.id === '1431') work()`)).toBe(1)
    // 但 `agentId`/`teammateBuffId` 是身份专属名字 ⇒ 动态值**仍算**（排除它会造出新盲区）
    expect(countIdentityBranchLines(`if (c.agentId === targetId) work()`)).toBe(1)
    expect(countIdentityBranchLines(`if (c.teammateBuffId === want) work()`)).toBe(1)
  })

  it('★ 观察项与执行尺互斥：`.id` 非角色比较不得计数，但必须能单独取出来', () => {
    const src = `const a = all.find(x => x.id === moveId)\nif (agent.id === '1431') work()`
    expect(countIdentityBranchLines(src)).toBe(1)
    const obs = scanNonCharacterIdComparisons(src)
    expect(obs.map(e => e.text)).toEqual(['x.id === moveId'])
    // 同一个节点不得同时进两条通道（双计会虚高存量，漏取会让观察项消失）
    const measured = new Set(scanIdentityComparisons(src).map(e => `${e.line}:${e.column}`))
    expect(measured.has(`${obs[0]!.line}:${obs[0]!.column}`)).toBe(false)
  })

  it('注释与字符串里的同形文本不计（AST 天然不含，旧正则靠行首启发式）', () => {
    expect(countIdentityBranchLines(`// if (c.agentId === '1431') work()`)).toBe(0)
    expect(countIdentityBranchLines(`const s = "c.teammateBuffId === 'remielle'"`)).toBe(0)
    expect(countIdentityBranchLines(`/* 中间行 c.id === '1581' 不以星号开头 */`)).toBe(0)
  })

  it('节点级判据与扁平化面同源（报告的分类与棘轮的计数不得各判一份）', () => {
    const node = { kind: 0 }
    expect(identityComparison(node)).toBeNull()
    expect(isNonCharacterIdComparison(node)).toBe(false)
    // 真实仓库：执行尺读数必须能被两种取法分别复现（单文件求和 == 逐文件累加）
    const total = countIdentityBranchLines(`if (c.agentId === '1431') work()
if (c.id === '1581') work()`)
    expect(total).toBe(2)
  })
})

describe('T8 read-only identity inventory', () => {
  it('ignores comments and strings; detects multiline and reversed comparisons', () => {
    const entries = scan(`// agentId === '1431'
const text = "agent.id === '1431'";
/* a.teammateBuffId === 'remielle' */
if (agent?.id
 === '1431') work();
if ('1481' !== other['agentId']) work();`)
    expect(entries.map(e => [e.field, e.identity, e.category, e.line])).toEqual([
      ['id', '1431', 'business', 4], ['agentId', '1481', 'business', 6],
    ])
  })

  it('unwraps parentheses, as-expressions and non-null assertions around the receiver', () => {
    const entries = scan(`if ((a.id as string) === '1431') work();
if (a.teammateBuffId! === '1481') work();
if (((agent.agentId)) !== '1261') work();`)
    expect(entries.map(e => [e.field, e.identity, e.line])).toEqual([
      ['id', '1431', 1], ['teammateBuffId', '1481', 2], ['agentId', '1261', 3],
    ])
  })

  it('separates pure named definitions from business find callbacks', () => {
    const entries = scan(`function isAgent(a) { return a?.id === '1481' || a?.teammateBuffId === '1481' }
const isOther = a => a.id === '1481';
const slot = team.findIndex(c => { const a = get(c); return a.id === '1481' || a.teammateBuffId === '1481' });`)
    expect(entries.map(e => e.category)).toEqual(['definition', 'definition', 'definition', 'business', 'business'])
    expect(summarizeIdentity(entries)).toMatchObject({
      comparisons: 5, lines: 3,
      definition: { comparisons: 3, lines: 2 },
      business: { comparisons: 2, lines: 1 },
      definitionIdentities: ['1481'],
    })
  })

  it('keeps stored flags and dynamic values unknown, with a consumer trail instead of an exemption', () => {
    const entries = scan(`const enabled = a.id === '1581';
const flags = { isAgent: a.teammateBuffId === 'remielle' };
if (a.agentId === targetId) work();
if (enabled) apply(enabled);
if (flags.isAgent) apply(flags.isAgent);`)
    expect(entries.map(e => e.category)).toEqual(['unknown', 'unknown', 'unknown'])
    expect(entries.map(e => e.storedAs)).toEqual(['enabled', 'isAgent', undefined])
    // 存储标志必须带出同名消费行（声明自身不算消费者；属性访问 `flags.isAgent` 也算）
    expect(entries[0]!.consumers).toEqual([4])
    expect(entries[1]!.consumers).toEqual([5])
    // 动态量无字面量 ⇒ 不产生消费者线索，但仍逐条露面
    expect(entries[2]!.identity).toBeNull()
    expect(entries[2]!.reason).toContain('symbol resolution')
  })

  it('does not mistake unrelated string ids for characters', () => {
    expect(scan(`if (row.id === 'row-name') work();
if (row.id === 'luminize_multiplier') work();
if (agent.id === '1431') work();`).map(e => e.identity)).toEqual(['1431'])
  })

  it('reports local alias comparisons as an observation only, never as a counted entry', () => {
    const { entries, blindSpots } = scanIdentitySource(`const fillerAgentId = team[slot]?.agentId ?? ''
if (fillerAgentId === '1051') work();
if (agent.agentId === '1051') work();`)
    expect(entries.map(e => [e.field, e.identity, e.line])).toEqual([['agentId', '1051', 3]])
    expect(blindSpots.map(s => [s.alias, s.identity, s.line])).toEqual([['fillerAgentId', '1051', 2]])
    // 关键不变量：观察项与度量互斥（不许双计，也不许借观察项偷偷加宽尺度）
    const measured = new Set(entries.map(e => `${e.file}:${e.line}:${e.column}`))
    for (const s of blindSpots) expect(measured.has(`${s.file}:${s.line}:${s.column}`)).toBe(false)
  })

  it('counts two shapes on one source line once in line totals', () => {
    const entries = scan(`if (a.id === '1581' || a.teammateBuffId === 'remielle') work();`)
    const summary = summarizeIdentity(entries)
    expect(summary).toMatchObject({ comparisons: 2, lines: 1, business: { comparisons: 2, lines: 1 } })
    expect(entries[0]!.column).not.toBe(entries[1]!.column)
    // 同行双形态必须记为重叠，否则「形态数相加」会给出比真实存量更大的假数
    expect(summary.shapeOverlap).toEqual({ 'id+teammateBuffId': 1 })
    expect(summary.byShape.id.lines + summary.byShape.teammateBuffId.lines).toBe(2)
  })

  it('deduplicates by identity value: repeat comparisons collapse to one id, not one line', () => {
    const entries = scan(`const a = team.find(c => c.id === '1581' || c.teammateBuffId === 'remielle')
const b = team.find(c => c.id === '1581')
const c = team.find(x => x.id === '1581')`)
    expect(groupByIdentity(entries)).toEqual([
      { identity: '1581', comparisons: 3, lines: 3, categories: ['business'] },
      { identity: 'remielle', comparisons: 1, lines: 1, categories: ['business'] },
    ])
  })

  it('cross-checks every identity literal against the catalog data plane (规则 15)', () => {
    const first = reportIdentity()
    // 每个字面量必须给出解析结论：catalog 的 agent.id / teammateBuffId / 动态 / 解析不到
    for (const i of first.byIdentity) {
      expect(['agent.id', 'teammateBuffId', 'dynamic', 'unresolved']).toContain(i.resolves)
    }
    // 解析口径可证伪：catalog 里真实存在的 id 必须解析成功（不是「全都 unresolved」的假绿）
    const resolvedIds = first.byIdentity.filter(i => i.resolves === 'agent.id').map(i => i.identity)
    expect(resolvedIds.length).toBeGreaterThan(0)
    for (const id of resolvedIds) expect(id).toMatch(/^\d{4}$/)
    // 解析不到的必须逐个露出，不能被静默并进「已解析」
    expect(first.byIdentity.filter(i => i.resolves === 'unresolved').map(i => i.identity)).toEqual(['remielle'])
    // 动态值（`c.agentId === targetId`）只在 `agentId`/`teammateBuffId` 形态下存在：
    // `.id` 动态比较已改判为观察项（招式/数据行查找）⇒ 它们**不得**出现在 byIdentity 里
    if (first.byIdentity.some(i => i.identity === '<dynamic>')) {
      expect(first.byIdentity.find(i => i.identity === '<dynamic>')!.resolves).toBe('dynamic')
    }
    expect(first.nonCharacterIds.some(e => e.identity === null)).toBe(true)
  })

  it('measures HEAD by default so parallel-session WIP cannot fake the baseline', () => {
    // 取数纪律：本仓高频并行会话，工作树里可能有别人迁移中途的状态。
    // 不变量（与是否有 git 无关）：**只要真读到了 HEAD，就必须自称 HEAD**；
    // 一个文件回退 ⇒ 不许自称 HEAD（避免把工作树读数伪装成提交态基线）。
    const sources = readIdentitySources()
    const headCount = sources.filter(s => s.source === 'HEAD').length
    const head = reportIdentity()
    expect(head.fellBack).toBe(sources.length - headCount)
    if (headCount === sources.length) expect(head.measuredAt).toBe('HEAD')
    else if (headCount === 0) expect(head.measuredAt).toBe('worktree')
    else expect(head.measuredAt).toBe('mixed')
    expect(reportIdentity(undefined, { atHead: true })).toEqual(head)
    // 显式量工作树是**另一个**面（不保证相等）——但两面都必须自洽：表达式可加、行数独立去重
    const worktree = reportIdentity(undefined, { atHead: false })
    expect(worktree.measuredAt).toBe('worktree')
    expect(head.entries.length).toBeGreaterThan(0)
    for (const r of [head, worktree]) {
      expect(r.summary.comparisons).toBe(r.entries.length)
      expect(r.summary.lines).toBe(new Set(r.entries.map(e => `${e.file}:${e.line}`)).size)
    }
    expect(readIdentitySources(undefined, { atHead: false }).every(s => s.source === 'worktree')).toBe(true)
    // 真实仓库（有 git）必须是纯 HEAD 面 —— 否则基线在并行会话下不可复现
    if (headCount > 0) expect(headCount).toBe(sources.length)
  })

  it('keeps legacy and classified measures separate and self-consistent', () => {
    const first = reportIdentity()
    expect(countAgentIdBranchLines("if (a.agentId === '1431') work();")).toBe(1)
    // 旧尺必须与官方单一事实源同源（本脚本不自己实现第二份正则）
    expect(Number.isInteger(first.legacyLines)).toBe(true)
    // 表达式可加；行数**不可**按分类相加（同一行可同时出现两种形态/两类判定）
    expect(first.summary.comparisons)
      .toBe(first.summary.business.comparisons + first.summary.definition.comparisons + first.summary.unknown.comparisons)
    const shapeSum = Object.values(first.summary.byShape).reduce((n, g) => n + g.comparisons, 0)
    expect(shapeSum).toBe(first.summary.comparisons)
    // 旧尺行必须是新尺的子集（旧尺只能漏计、不能多计——多计说明新尺漏了形态）
    expect(first.summary.deltaVsLegacy.legacyLinesNotBusiness).toBe(0)
    expect(first.summary.deltaVsLegacy.businessLinesBeyondLegacyRuler)
      .toBe(first.summary.business.lines - first.legacyLines)
    // 同行双形态必须被记为重叠，且重叠数 ≤ 最小形态行数（否则「相加」会造出假存量）
    for (const [pair, n] of Object.entries(first.summary.shapeOverlap)) {
      const [a, b] = pair.split('+') as [string, string]
      expect(n).toBeLessThanOrEqual(Math.min(first.summary.byShape[a]!.lines, first.summary.byShape[b]!.lines))
      expect(n).toBeGreaterThan(0)
    }
  })

  it('reports deterministic repository output with legacy and classified measures separate', () => {
    const first = reportIdentity()
    expect(reportIdentity()).toEqual(first)
    expect(countAgentIdBranchLines("if (a.agentId === '1431') work();")).toBe(1)
    // 旧尺必须与官方单一事实源同源（本脚本不自己实现第二份正则），且**量同一个面**：
    // 官方函数施加在本脚本的取数面（默认 HEAD）上，必须与报告的 legacyLines 相等。
    // ⚠ 不能拿 countAgentBranchLines()（工作树面）对比——并行会话 WIP 会让两者合法地不等。
    const sameSurface = readIdentitySources().reduce((n, s) => n + countAgentIdBranchLines(s.content), 0)
    expect(first.legacyLines).toBe(sameSurface)
  })

  it('pins the evidence reason for each classification path', () => {
    // reason 是报告里给人看的**分类证据**——它必须区分「回调里选数据」与「普通函数体里的比较」，
    // 否则重命名/合并判定分支不会被任何判据发现（反向验证实测：拆掉回调通道仍全绿）。
    const entries = scan(`function isAgent(a) { return a?.id === '1481' }
const inline = team.findIndex(c => c.id === '1481')
function withExtras(a) { return a.id === '1481' && a.other }
if (a.id === '1481') work()
const flag = a.id === '1481'`)
    expect(entries.map(e => [e.category, e.reason])).toEqual([
      ['definition', 'named function returns only identity comparison(s)'],
      ['business', 'inline callback selects business data'],
      ['business', 'comparison inside business function'],
      ['business', 'conditional branch'],
      ['unknown', 'stored identity flag: consumer must be reviewed'],
    ])
  })

  it('rolls up character judgments without hardcoding a target number', () => {
    const { summary, legacyLines, entries } = reportIdentity()
    const cj = summary.characterJudgment
    // 合计 = 业务判定 ∪ 待核存储标志（两者按行去重，不许相加后再去重两次）
    expect(cj.businessLines).toBe(summary.business.lines)
    expect(cj.lines).toBeGreaterThanOrEqual(cj.businessLines)
    const union = new Set([
      ...entries.filter(e => e.category === 'business').map(e => `${e.file}:${e.line}`),
      ...entries.filter(e => e.category === 'unknown' && e.identity !== null
        && /^\d{4}$/.test(e.identity)).map(e => `${e.file}:${e.line}`),
    ])
    expect(cj.lines).toBe(union.size)
    // 「新增」= 角色判定行 − 旧尺行（旧尺是子集）；旧尺行数必须与官方同面读数一致
    expect(cj.legacyLines).toBe(legacyLines)
    expect(cj.newBeyondLegacy).toBe(cj.lines - legacyLines)
    // 非角色 `.id` 观察项**不并入**执行尺（也不许因不并入就消失）：它来自独立通道，
    // 且与 unknown 分类解耦（动态 `.id` 已不进 entries ⇒ 不能用 unknown 数反推）
    expect(cj.nonCharacterUnknownLines).toBeGreaterThan(0)
    expect(cj.nonCharacterUnknownLines).not.toBe(summary.unknown.lines - cj.reviewableUnknownLines)
  })

  it('renders the markdown report the task report consumes', () => {
    const first = reportIdentity()
    const md = formatMarkdown(first)
    expect(formatMarkdown(reportIdentity())).toBe(md)
    expect(md).toContain(`旧口径（正则，**已不作为棘轮判据**）：**${first.legacyLines}** 行`)
    expect(md).toContain(`**执行尺（AST 三形态，= \`AGENT_BRANCH_BASELINE\`）：${first.summary.lines} 行**`)
    expect(md).toContain(`旧尺之外的新增业务判定：**${first.summary.deltaVsLegacy.businessLinesBeyondLegacyRuler}** 行`)
    expect(md).toContain('## 纯身份定义（0 表达式 / 0 行）')
    expect(md).toContain('## ⚠ 数据面解析不到的身份字面量（1 个，只报不判，不进计数）')
    expect(md).toContain(`**角色判定合计 ${first.summary.characterJudgment.lines} 行**`)
    expect(md).toContain(`非角色 \`.id\` 比较（moveId/dataId/overrideId/rowId 族）`
      + `${first.summary.characterJudgment.nonCharacterUnknownLines} 条`)
    for (const entry of first.entries) expect(md).toContain(`${entry.file}:${entry.line}:${entry.column}`)
    for (const spot of first.blindSpots) expect(md).toContain(`${spot.file}:${spot.line}:${spot.column}`)
    // 观察项必须逐个露面（「不并入」不许退化成「看不见」）
    for (const e of first.nonCharacterIds) expect(md).toContain(`${e.file}:${e.line}:${e.column}`)
  })
})

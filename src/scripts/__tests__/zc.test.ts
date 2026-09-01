/**
 * zc（agent 专属语言与动作入口，scripts/zc.mjs）的护栏。
 *
 * 为什么值得测：这门语言的价值全在「解析器 = 唯一语法定义」这个约定上——
 * ① 解析器错一格，索引就静默漏事实（与 check-tokens 的「漏抓 = 护栏形同虚设」同理）；
 * ② 租约逻辑错一格，规则 13 的机器化就是假的（并行会话照样对撞）；
 * ③ 主体绑定错一格，会得出「某模块 0 测试覆盖」这类假结论（v0 真的踩过：
 *    agentIds: [AGENT_ID] 常量间接没解析 → 12 个模块被误报无覆盖）。
 */
import { describe, expect, it } from 'vitest'
import {
  CONFIDENCE,
  FACT_KINDS,
  applyClaim,
  applyRelease,
  buildModuleAgentIds,
  collectComments,
  collectSpecNotes,
  detectForeignWip,
  envelope,
  extractFacts,
  extractProvenance,
  findConflicts,
  formatFact,
  grammar,
  harvestRepo,
  isExpired,
  parseArgs,
  parseFactLine,
  parsePorcelain,
  resolveModuleAgentId,
  splitSentences,
  subjectFromPath,
  testsForSubject,
  stripCommentPrefix,
  resolveAnchor,
  scanAuthoredFacts,
  auditAuthoredFacts,
  driftQueue,
  recentlyOwnedPaths,
} from '../../../scripts/zc.mjs'

describe('L1 事实语法（parseFactLine / formatFact 互逆）', () => {
  it('四槽位齐全的行往返不变', () => {
    const line = '@fact agent:1411/c6 未建模: 蓄能炮弹不实现 | 据 用户@2026-08-30 | 验 yuzuha.test.ts | 信 确认'
    const f = parseFactLine(line)
    expect(f).toMatchObject({
      subject: 'agent:1411/c6', kind: '未建模', claim: '蓄能炮弹不实现',
      provenance: '用户@2026-08-30', verifier: 'yuzuha.test.ts', confidence: '确认',
    })
    expect(formatFact(f!)).toBe(line)
  })

  it('可选槽位缺省 → null，不编造', () => {
    const f = parseFactLine('@fact engine:decibel/保底4 口径: 缺口≤1500 补弹刀')
    expect(f?.provenance).toBeNull()
    expect(f?.verifier).toBeNull()
    expect(f?.confidence).toBeNull()
  })

  it('非法种类/非 @fact 行/非字符串 → null（不静默接受未知词汇）', () => {
    expect(parseFactLine('@fact agent:1411 瞎写: x')).toBeNull()
    expect(parseFactLine('普通注释一行')).toBeNull()
    expect(parseFactLine(null)).toBeNull()
    expect(parseFactLine('@fact agent:1411 口径:   ')).toBeNull()
  })

  it('未知置信度不落地（只接受既有标注体系的四档）', () => {
    expect(parseFactLine('@fact agent:1 口径: x | 信 差不多')?.confidence).toBeNull()
    expect(CONFIDENCE).toEqual(['确认', '高', '中', '低'])
    expect(FACT_KINDS).toContain('债')
  })

  it('grammar() 自述里列出全部种类与置信度（语法只有这一处定义）', () => {
    const g = grammar()
    for (const k of FACT_KINDS) expect(g).toContain(k)
    for (const c of CONFIDENCE) expect(g).toContain(c)
  })
})

describe('L2 抽取器（既有标注 → 事实）', () => {
  it('标记映射：debt/未建模/[已确认]/[猜测·中]/近似', () => {
    const cases: [string, string, string | null][] = [
      ['debt: 贡献挂柚叶槽位，与不参与结算有出入', '债', null],
      ['未建模项：影画2 长按追加突刺耗能机制', '未建模', null],
      ['[已确认] 激光附加250%攻击力火伤按招式触发挂行', '口径', '确认'],
      // 种类与置信度正交：这句既是「近似」又带 [猜测·中]，两个维度各记各的
      ['[猜测·中] 触发次数按满覆盖近似处理掉', '近似', '中'],
      ['[已确认] 该行倍率与倍率表一致无需回填', '口径', '确认'],
      ['[近似] 护盾值与格挡架势按整局总量处理', '近似', null],
    ]
    for (const [text, kind, conf] of cases) {
      const { facts } = extractFacts(text, 'agent:1411', 'src/specs/agents/1411.json')
      expect(facts[0]?.kind, text).toBe(kind)
      expect(facts[0]?.confidence ?? null, text).toBe(conf)
    }
  })

  it('无标记句进 unparsed（是「未标注」不是「丢弃」）', () => {
    const { facts, unparsed } = extractFacts('数据源：nanoka.cc zh raw JSON 已录入完毕', 'agent:1411', 'x.json')
    expect(facts).toHaveLength(0)
    expect(unparsed[0]?.text).toContain('数据源')
  })

  it('竖线被清洗 → 抽取结果必定可被自己的解析器读回（互逆闭合）', () => {
    const { facts } = extractFacts('实现口径：A | B | C 三段按顺序结算不重复', 'agent:1', 'x')
    const back = parseFactLine(formatFact(facts[0]))
    expect(back?.claim).toBe(facts[0].claim)
  })

  it('出处：用户裁决 + 日期 → 用户@日期；裸日期 → 日期；都没有 → null', () => {
    expect(extractProvenance('2026-08-30 口径（用户决断）：不实现')).toBe('用户@2026-08-30')
    expect(extractProvenance('实现口径 [2026-08-25 补录]')).toBe('2026-08-25')
    expect(extractProvenance('按满覆盖近似')).toBeNull()
  })

  it('句子切分：中文标点分句 + 丢弃过短碎片', () => {
    expect(splitSentences('太短；这是一句足够长的口径描述文字。另一句同样足够长的描述'))
      .toEqual(['这是一句足够长的口径描述文字', '另一句同样足够长的描述'])
  })
})

describe('L2 主体绑定（错一格就会得出假结论）', () => {
  it('spec 文件名 = agentId（规则 7）→ agent:<id>', () => {
    expect(subjectFromPath('src/specs/agents/1411.json')).toBe('agent:1411')
  })

  it('模块 agentId 三种写法都解析：字面量 / 常量间接 / 单数字段', () => {
    expect(resolveModuleAgentId("export const m = { agentIds: ['1411'], }")).toBe('1411')
    expect(resolveModuleAgentId("const AGENT_ID = '1371'\nexport const m = { agentIds: [AGENT_ID] }")).toBe('1371')
    expect(resolveModuleAgentId("const X: string = '1591'\nconst m = { agentIds: [X] }")).toBe('1591')
    expect(resolveModuleAgentId("export const m = { agentId: '1051' }")).toBe('1051')
  })

  it('解析不出时返回 null（不猜最像的，规则 15）', () => {
    expect(resolveModuleAgentId('export const m = { agentIds: [SOMETHING_ELSEWHERE] }')).toBeNull()
    expect(subjectFromPath('src/mechanics/agents/yixuan.ts')).toBe('module:yixuan')
    expect(subjectFromPath('src/mechanics/agents/yixuan.ts', { yixuan: '1371' })).toBe('agent:1371')
  })

  it('仓库现状：每个机制模块都能绑到 agentId（新模块写法超纲时本条会红）', () => {
    expect(buildModuleAgentIds().unresolved).toEqual([])
  })

  it('spec JSON 里任意深度的 note/notes 都会被收进来（口径藏在 gainRules 里过）', () => {
    const notes = collectSpecNotes({ notes: ['顶层'], resources: [{ gainRules: [{ note: '深层' }] }] })
    expect(notes).toEqual(['顶层', '深层'])
  })

  it('模块注释：块注释与行注释都收', () => {
    const c = collectComments('/** 头注释口径 */\nconst a = 1 // 行内口径\n')
    expect(c).toContain('头注释口径')
    expect(c).toContain('行内口径')
  })
})

describe('L3 租约（规则 13 的机器化）', () => {
  const now = 1_000_000
  const lease = (path: string, lane: string, at = now, ttlMs = 60_000) => ({ path, lane, at, ttlMs })

  it('过期判定按 TTL', () => {
    expect(isExpired(lease('a', 'x', now - 61_000), now)).toBe(true)
    expect(isExpired(lease('a', 'x', now - 59_000), now)).toBe(false)
  })

  it('冲突 = 他人未过期租约命中同路径或其目录前缀', () => {
    const leases = [lease('src/core', 'other'), lease('docs/a.md', 'other')]
    expect(findConflicts(leases, ['src/core/damage.ts'], 'me', now)).toHaveLength(1)
    expect(findConflicts(leases, ['src/views/x.vue'], 'me', now)).toHaveLength(0)
  })

  it('自己的租约不算冲突；过期的也不算', () => {
    expect(findConflicts([lease('a.ts', 'me')], ['a.ts'], 'me', now)).toHaveLength(0)
    expect(findConflicts([lease('a.ts', 'other', now - 999_999)], ['a.ts'], 'me', now)).toHaveLength(0)
  })

  it('claim 覆盖自己的旧租约、清掉过期租约、保留他人租约', () => {
    const before = [lease('a.ts', 'me', now - 30_000), lease('b.ts', 'other'), lease('c.ts', 'ghost', now - 999_999)]
    const after = applyClaim(before, ['a.ts'], 'me', 60_000, now)
    expect(after.filter(l => l.path === 'a.ts')).toHaveLength(1)
    expect(after.find(l => l.path === 'a.ts')!.at).toBe(now)
    expect(after.some(l => l.path === 'b.ts')).toBe(true)
    expect(after.some(l => l.path === 'c.ts')).toBe(false)
  })

  it('release 只放自己的；--all 放光自己的全部', () => {
    const before = [lease('a.ts', 'me'), lease('b.ts', 'me'), lease('c.ts', 'other')]
    expect(applyRelease(before, ['a.ts'], 'me').map(l => l.path)).toEqual(['b.ts', 'c.ts'])
    expect(applyRelease(before, '--all', 'me').map(l => l.path)).toEqual(['c.ts'])
  })

  it('疑似并行会话 = 已改动 + 无租约 + 近期 mtime（本工具的立项动机）', () => {
    const changed = ['x.ts', 'y.ts', 'z.ts']
    const leases = [lease('y.ts', 'me')]
    const mtimes = { 'x.ts': now - 60_000, 'y.ts': now - 60_000, 'z.ts': now - 60 * 60 * 1000 }
    expect(detectForeignWip(changed, leases, mtimes, now)).toEqual(['x.ts'])
  })

  it('自己 journal 里认领过的文件不算陌生 WIP（release 之后不该自己报自己）', () => {
    const changed = ['x.ts', 'w.ts']
    const mtimes = { 'x.ts': now - 60_000, 'w.ts': now - 60_000 }
    expect(detectForeignWip(changed, [], mtimes, now, undefined, ['x.ts'])).toEqual(['w.ts'])
  })

  it('journal 只认本车道、且只认时间窗内的认领', () => {
    const journal = [
      { lane: 'me', at: new Date(now - 60_000).toISOString(), changed: ['a.ts'] },
      { lane: 'other', at: new Date(now - 60_000).toISOString(), changed: ['b.ts'] },
      { lane: 'me', at: new Date(now - 48 * 3600_000).toISOString(), changed: ['c.ts'] },
    ]
    expect(recentlyOwnedPaths(journal, 'me', now)).toEqual(['a.ts'])
  })
})

describe('L3 CLI 契约（统一信封 / 参数）', () => {
  it('信封形状固定：ok/verb/data/next', () => {
    expect(envelope('status', true, { a: 1 })).toEqual({ ok: true, verb: 'status', data: { a: 1 }, next: null })
  })

  it('取值参数吃下一个 argv，布尔开关不吃', () => {
    const a = parseArgs(['src/a.ts', '--as', 'lane-1', '--json', '--ttl', '30'])
    expect(a.positional).toEqual(['src/a.ts'])
    expect(a.as).toBe('lane-1')
    expect(a.ttl).toBe('30')
    expect(a.json).toBe(true)
  })

  it('porcelain 解析出状态与路径（带引号的中文路径也要吃下）', () => {
    expect(parsePorcelain(' M src/a.ts\n?? "src/数据.json"')).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: '??', path: 'src/数据.json' },
    ])
  })
})

describe('仓库级：索引真的建得起来', () => {
  it('全仓抽取 → 事实数量级正确、主体全部绑到 agent、统计自洽', () => {
    const { facts, stats } = harvestRepo()
    expect(stats.facts).toBeGreaterThan(300)
    expect(stats.subjects).toBeGreaterThan(40)
    expect(stats.unresolvedModules).toBe(0)
    expect(facts.every(f => f.subject.startsWith('agent:'))).toBe(true)
    expect(facts.every(f => parseFactLine(formatFact(f)) !== null)).toBe(true)
    expect(stats.structuredRate).toBeGreaterThan(0)
    expect(stats.structuredRate).toBeLessThanOrEqual(1)
  })

  it('主体 → 测试覆盖：柚叶(1411) 至少被 yuzuha.test.ts 引用（verify:recording 同源判据）', () => {
    expect(testsForSubject('agent:1411').some(p => p.includes('yuzuha.test.ts'))).toBe(true)
    expect(testsForSubject('engine:decibel')).toEqual([])
  })
})
describe('L2.5 锚点：把口径钉在代码上（本层是「口径会不会悄悄过期」的机器答案）', () => {
  it('注释前缀剥离：// 与 * 与 # 开头都能露出 @fact', () => {
    expect(stripCommentPrefix('  // @fact a')).toBe('@fact a')
    expect(stripCommentPrefix(' * @fact a')).toBe('@fact a')
    expect(stripCommentPrefix('# @fact a')).toBe('@fact a')
  })

  it('锚槽位进出语法（据→验→锚→信 顺序固定，互逆）', () => {
    const line = '@fact engine:damage/乘区顺序 口径: 顺序即代码顺序 | 据 实测@2026-08-31 | 验 damage.test.ts | 锚 src/core/damage.ts#calcDirectDamage | 信 确认'
    const f = parseFactLine(line)
    expect(f?.anchor).toBe('src/core/damage.ts#calcDirectDamage')
    expect(formatFact(f!)).toBe(line)
  })

  it('未知槽位关键字被忽略而非炸掉（语法可向后扩展）', () => {
    expect(parseFactLine('@fact a:1 口径: x | 未来槽位 y')?.claim).toBe('x')
  })

  it('锚解析：文件级 / 符号级 / 断锚三态分明', () => {
    expect(resolveAnchor('src/core/damage.ts').ok).toBe(true)
    expect(resolveAnchor('src/core/damage.ts#calcDirectDamage')).toMatchObject({ ok: true, reason: 'symbol' })
    expect(resolveAnchor('src/core/damage.ts#不存在的符号')).toMatchObject({ ok: false, reason: 'symbol-missing' })
    expect(resolveAnchor('src/core/没这个文件.ts')).toMatchObject({ ok: false, reason: 'file-missing' })
    expect(resolveAnchor(null)).toMatchObject({ ok: false, reason: 'anchor-missing' })
  })

  it('符号命中三类写法：声明 / 对象键 / 测试标题', () => {
    // 声明与对象键在真实文件上验过；测试标题用本文件自证（describe 标题里有下面这个串）
    expect(resolveAnchor('scripts/check-guards.mjs#DEBT_SCAN_SELF_REFERENTIAL').ok).toBe(true)
    expect(resolveAnchor('src/scripts/__tests__/zc.test.ts#L2.5 锚点').ok).toBe(true)
  })

  it('语法模板行不算事实（自指问题第三次：语言的定义文件不该成为第一条违规）', () => {
    const authored = scanAuthoredFacts()
    expect(authored.every(a => !a.raw.includes('<主体>'))).toBe(true)
    expect(authored.length).toBeGreaterThan(0)
  })

  it('仓库现状：手写事实全部有据 + 锚得住（check-guards 判据 6 的同源断言）', () => {
    const { scanned, violations } = auditAuthoredFacts()
    expect(scanned.length).toBeGreaterThanOrEqual(4)
    expect(violations.map(v => v.file + ':' + v.line + ' ' + v.problem)).toEqual([])
  })

  it('复核队列条目结构完整（锚文件在「据」之后动过才进队，同日改动不进）', () => {
    for (const row of driftQueue()) {
      expect(row).toMatchObject({ subject: expect.any(String), anchor: expect.any(String), since: expect.any(String) })
      expect(Date.parse(row.touchedAt)).toBeGreaterThan(Date.parse(row.since))
    }
  })
})

describe('漂移队列：复核时间戳可让口径出队，但不改写原始裁决日期', () => {
  it('「据」里有多个日期时按最后一个（复核时间）算漂移', () => {
    const f = parseFactLine('@fact a:1 口径: x | 据 用户@2026-08-26·复核@2026-09-01 | 锚 scripts/zc.mjs#grammar')
    expect(f?.provenance).toBe('用户@2026-08-26·复核@2026-09-01')
    // 仓库现状：所有手写事实要么没漂移，要么已带复核戳
    for (const row of driftQueue()) {
      expect(Date.parse(row.touchedAt)).toBeGreaterThan(Date.parse(row.since))
    }
  })
})

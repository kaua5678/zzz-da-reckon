/**
 * 机器护栏的护栏（scripts/check-guards.mjs）。
 *
 * check-guards 本身挂在 check/verify 链首端，CI 已经会红；本文件补三层价值：
 * ① detector 对各种 stub 写法的判定（防正则漏抓/误抓——漏抓一条 = 护栏形同虚设）
 * ② 棘轮计数 / 禁跟踪过滤等纯函数逻辑
 * ③ 仓库级 runAllChecks 全绿（在 vitest 里给出定位到行的失败信息，不用等 CI）
 */
import { describe, expect, it } from 'vitest'
import {
  DEBT_REGISTRY,
  AGENT_BRANCH_BASELINE,
  CORE_AGENT_BRANCH_BASELINE,
  CORE_AGENT_BRANCH_FILES,
  EXHIBITION_LAYER_IMPORT_BASELINE,
  RATCHET_BURNDOWN,
  auditDocTable,
  computeBurndown,
  parseDocTable,
  countAgentIdBranchLinesInFiles,
  daysBetween,
  detectFetchStub,
  detectExhibitionLayerImport,
  countExhibitionLayerImports,
  fetchStubViolations,
  findForbiddenTracked,
  countAgentIdBranchLines,
  extractSettingIds,
  matchDebtRegistry,
  runAllChecks,
} from '../../../scripts/check-guards.mjs'

describe('detectFetchStub（直接操纵全局 fetch 的写法）', () => {
  it('抓全部四种 stub 形态', () => {
    expect(detectFetchStub(`vi.stubGlobal('fetch', mock)`)).toBe(true)
    expect(detectFetchStub(`vi.stubGlobal("fetch", mock)`)).toBe(true)
    expect(detectFetchStub('global.fetch = mock')).toBe(true)
    expect(detectFetchStub('globalThis.fetch = mock')).toBe(true)
    expect(detectFetchStub('(global as any).fetch = mock')).toBe(true)
  })

  it('放行合法路径（harness 消费者 / 普通调用）', () => {
    expect(detectFetchStub(`const { config } = await setupHarness(['1371'])`)).toBe(false)
    expect(detectFetchStub('mockStaticFetch(catalog)')).toBe(false)
    expect(detectFetchStub('await fetch(url)')).toBe(false)
    expect(detectFetchStub('vi.unstubAllGlobals()')).toBe(false)
  })
})

describe('fetchStubViolations（harness 本体豁免）', () => {
  it('harness.ts 是唯一合法实现，不计违规', () => {
    const files = [
      { path: 'src/test/harness.ts', content: `vi.stubGlobal('fetch', ...)` },
      { path: 'src/mechanics/__tests__/x.test.ts', content: `vi.stubGlobal('fetch', ...)` },
    ]
    expect(fetchStubViolations(files)).toEqual(['src/mechanics/__tests__/x.test.ts'])
  })
})

describe('countAgentIdBranchLines（按行计，与棘轮基线同口径）', () => {
  it('同一行两处出现只计一行（与 grep -c 语义一致）', () => {
    expect(countAgentIdBranchLines(`if (a.agentId === '1' || b.agentId === '2') {}`)).toBe(1)
    expect(countAgentIdBranchLines(`c.agentId !== '3'`)).toBe(1)
    expect(countAgentIdBranchLines(`const cfg = characters.find(c => c.agentId)`)).toBe(0)
  })
})

describe('findForbiddenTracked（工作状态 ≠ 项目知识）', () => {
  it('task-ledger / ledgers / .zcode / .freebuff / 未白名单的 .claude 文件都拒绝', () => {
    expect(findForbiddenTracked(['.claude/task-ledger.md'])).toEqual(['.claude/task-ledger.md'])
    expect(findForbiddenTracked(['.claude/ledgers/guards-task-ledger-20260830.md'])).toHaveLength(1)
    expect(findForbiddenTracked(['.zcode/plans/x.md'])).toHaveLength(1)
    expect(findForbiddenTracked(['.freebuff/project-id'])).toEqual(['.freebuff/project-id'])
    expect(findForbiddenTracked(['.claude/unknown.json'])).toHaveLength(1)
    expect(findForbiddenTracked(['.claude/settings.local.json'])).toEqual([])
    expect(findForbiddenTracked(['src/core/damage.ts'])).toEqual([])
  })
})

describe('detectExhibitionLayerImport（展示层禁越层 import 引擎/录入层）', () => {
  it('抓运行时 import / export-from / 动态 import 三种形态', () => {
    expect(detectExhibitionLayerImport(`import { calcPanel } from '@/core/panel'`)).toBe(true)
    expect(detectExhibitionLayerImport(`import { getAgentMechanic } from '@/mechanics'`)).toBe(true)
    expect(detectExhibitionLayerImport(`import { agentSpecs } from '@/specs/registry'`)).toBe(true)
    expect(detectExhibitionLayerImport(`export { sharpCritMultiplier } from '@/core/damage'`)).toBe(true)
    expect(detectExhibitionLayerImport(`const m = await import('@/core/damage')`)).toBe(true)
  })

  it('放行：import type / 注释 / 编排层 / 相对路径 / 深层业务模块', () => {
    expect(detectExhibitionLayerImport(`import type { AgentMechanicSpec } from '@/specs/types'`)).toBe(false)
    expect(detectExhibitionLayerImport(`  // import { x } from '@/core/damage'`)).toBe(false)
    expect(detectExhibitionLayerImport(`import { useResourceCalc } from '@/composables/useResourceCalc'`)).toBe(false)
    expect(detectExhibitionLayerImport(`import FinalPanel from './FinalPanel.vue'`)).toBe(false)
    expect(detectExhibitionLayerImport(`import { fmt } from '@/utils/format'`)).toBe(false)
    // '@/corex/...' 不是 @/core 子路径，不得误抓（前缀必须紧跟 / 或引号）
    expect(detectExhibitionLayerImport(`import { x } from '@/corex/y'`)).toBe(false)
  })

  it('按行计数（同一个 .vue 多处只算多行）', () => {
    const src = [
      `import { a } from '@/core/panel'`,
      `import type { T } from '@/core/panel'`,
      `import { b } from '@/mechanics'`,
    ].join('\n')
    expect(countExhibitionLayerImports(src)).toBe(2)
  })
})

describe('extractSettingIds（settings 块抽取）', () => {
  it('字符串字面量与常量引用两种形态都能抽', () => {
    const src = [
      'const FOO_SETTING = \'foo.bar\'',
      'const mechanic = {',
      '  settings: [',
      '    { id: \'baz.qux\', label: \'x\' },',
      '    { id: FOO_SETTING, label: \'y\' },',
      '  ],',
      '}',
    ].join('\n')
    expect(extractSettingIds(src)).toEqual(['baz.qux', 'foo.bar'])
  })

  it('无 settings 块返回空', () => {
    expect(extractSettingIds('const a = 1')).toEqual([])
  })
})

describe('matchDebtRegistry（注册表匹配：文件相同 + 关键词包含）', () => {
  it('未登记 / 已销号两侧都能判', () => {
    // 基准 = 真实 DEBT_REGISTRY：为每条注册条目生成命中标记 + 一条陌生项。
    // 断言与注册表内容解耦（不写字面量）：注册表增删/清空都不该让这条测试变红——
    // 2026-08-31 写死 3 时就被 gachaCost 的新登记撞红过一次；2026-09-03 注册表清空
    // 时「喂一条命中项 + 一条陌生项」的旧写法把命中项误判成未登记。
    const markers = [
      ...Object.keys(DEBT_REGISTRY).map((k) => {
        const i = k.indexOf(':')
        return { file: k.slice(0, i), text: k.slice(i + 1) }
      }),
      { file: 'src/other.ts', text: '全新未登记的债' },
    ]
    const { unregistered, cleared } = matchDebtRegistry(markers)
    expect(unregistered.map(m => m.file)).toEqual(['src/other.ts'])
    expect(cleared).toHaveLength(0)
  })
})

describe('countAgentIdBranchLinesInFiles（core 棘轮：规则 6 的引擎层延伸）', () => {
  it('按文件求和，口径与单文件计数一致', () => {
    const src = `if (c.agentId === '1051') {}\nif (x.agentId !== '1571') {}`
    expect(countAgentIdBranchLines(src)).toBe(2)
    // 真实仓库：core 两个文件的总和应等于冻结基线
    const total = countAgentIdBranchLinesInFiles(CORE_AGENT_BRANCH_FILES)
    expect(total).toBe(CORE_AGENT_BRANCH_BASELINE)
    expect(CORE_AGENT_BRANCH_FILES.length).toBeGreaterThan(0)
  })
})

describe('computeBurndown（棘轮 burn-down：防「冻结 = 永久豁免」）', () => {
  // 语义钉死：棘轮解决「不许变差」，burn-down 解决「什么时候变好」。四态必须互不串味。
  // ⚠ fixture 必须**从登记表派生**（不能硬编码条数/某个 id 的返回值）：2026-09-11 加第 3 条棘轮时，
  // 旧写法（非 agentId 的一律返回 23）把 core 条目也算成「已还 13」，三条断言同时假红。
  // ⚠ 2026-09-12 再修一次同族问题：agentId 棘轮 8→0 **清零**后，登记表首次出现
  //   frozen === target === 0 的**已完成**条目。原三条用例默认「每条棘轮都还没做完」，
  //   于是（a）未到期用例的 `done===false`、（b）stale 用例的 `every(stale)`、
  //   （c）还款用例拿 RATCHET_BURNDOWN[0]（现为零清条目）算 progress 全部假红。
  //   根因是**判据与用例都没建模「已完成」态**——故这里显式拆成两组：
  //   active（未做完，适用 stale/overdue/progress 语义）+ cleared（已清零，只报 done）。
  const atFrozen = (id: string) => RATCHET_BURNDOWN.find(e => e.id === id)!.frozen
  const measure = atFrozen
  /** 未完成的棘轮（stale/overdue/还款语义只对它们成立） */
  const activeEntries = RATCHET_BURNDOWN.filter(e => e.frozen > e.target)
  /** 已清零的棘轮（frozen === target；只应报 done，永不再被点名） */
  const clearedEntries = RATCHET_BURNDOWN.filter(e => e.frozen <= e.target)

  it('未到期：不报警（只在 due 前后才点名）', () => {
    for (const b of computeBurndown(measure, '2026-09-11')) {
      expect(b.stale).toBe(false)
      expect(b.overdue).toBe(false)
      expect(b.progress).toBe(0)
      // 清零条目此刻就该是 done；其余未完成
      expect(b.done).toBe(b.frozen <= b.target)
    }
  })

  it('到期且零进展 → stale（点名；这是本判据存在的唯一理由）', () => {
    const rows = computeBurndown(measure, '2028-01-15')  // 晚于登记表里最晚的 due
    expect(rows.length).toBeGreaterThan(0)
    expect(activeEntries.length).toBeGreaterThan(0)      // 前提：登记表里有未完成条目
    for (const r of rows) {
      expect(r.overdue).toBe(true)
      if (r.frozen > r.target) expect(r.stale).toBe(true)
    }
  })

  it('到期但已有进展 → overdue 而非 stale（有还款就不骂）', () => {
    // 取**未完成**的第一条当被试（不能盲取 RATCHET_BURNDOWN[0]：清零条目 frozen=0 → 还款量算不出来）。
    // 还款量相对 frozen 取 1/3，保证 0 < 已还 < frozen − target。
    const first = activeEntries[0]
    expect(first).toBeDefined()
    const paid = Math.max(1, Math.ceil(first.frozen / 3))
    const partial = (id: string) => (id === first.id ? first.frozen - paid : atFrozen(id))
    const rows = computeBurndown(partial, '2028-01-15')
    const agent = rows.find(r => r.id === first.id)!
    expect(agent.progress).toBe(paid)
    expect(agent.stale).toBe(false)
    expect(agent.overdue).toBe(true)
    expect(agent.remaining).toBe(agent.current - agent.target)
    // 其余**未完成**条目仍零进展 → stale（清零条目不算，它已 done）
    expect(rows.filter(r => r.id !== first.id && r.frozen > r.target).every(r => r.stale)).toBe(true)
  })

  it('清零 → done（不再进提醒）', () => {
    const rows = computeBurndown(() => 0, '2028-01-15')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.done)).toBe(true)
    expect(rows.every(r => r.remaining === 0)).toBe(true)
    expect(rows.every(r => !r.stale)).toBe(true)
  })

  it('★ 已清零的棘轮即使过了 due 也不再被点名（原判据 frozen>0 掩盖的缺陷）', () => {
    // 回归钉子：原式 `stale: overdue && progress <= 0` 在 frozen=0 & current=0 时算 progress=0
    // → 判 stale，而同一行 done 却是 true（自相矛盾：既已完成又被点名）。
    expect(clearedEntries.length).toBeGreaterThan(0)   // 前提：登记表里确有清零条目
    for (const r of computeBurndown(atFrozen, '2028-01-15')) {
      if (r.frozen <= r.target) {
        expect(r.done).toBe(true)
        expect(r.stale).toBe(false)
        expect(r.progress).toBe(0)
      }
    }
  })

  it('登记表本身自洽：frozen 与代码里的基线常量一致、due 可解析、target ≤ frozen', () => {
    expect(RATCHET_BURNDOWN.length).toBeGreaterThan(0)
    for (const e of RATCHET_BURNDOWN) {
      expect(Number.isFinite(Date.parse(e.due))).toBe(true)
      expect(e.target).toBeLessThanOrEqual(e.frozen)
      expect(e.plan.length).toBeGreaterThan(10) // 必须写「怎么降」，不能只留一个数字
    }
    // frozen 必须等于真实基线常量（防登记表与护栏脱钩变成死数据）
    const byId = (id: string) => RATCHET_BURNDOWN.find(e => e.id === id)!
    expect(byId('agentId 分支').frozen).toBe(AGENT_BRANCH_BASELINE)
    expect(byId('core agentId 分支').frozen).toBe(CORE_AGENT_BRANCH_BASELINE)
    expect(byId('展示层越层 import').frozen).toBe(EXHIBITION_LAYER_IMPORT_BASELINE)
  })

  it('daysBetween 计算正确（用于 dueSoon 提示）', () => {
    expect(daysBetween('2026-09-11', '2026-12-31')).toBe(111)
    expect(daysBetween('2026-12-31', '2026-12-31')).toBe(0)
  })
})

describe('auditDocTable（README §6 文档表 vs docs/ 实际文件）', () => {
  // 评审 P2-2：README 自述「共 11 份」+ 表尾「以本表为准（10 份）」+ docs/ 实有 13 份，
  // CI 只查 implementation-status 漂移 → 这类清单漂移不可见。表里没有的文档 = agent 找不到。
  it('parseDocTable：抽表格里的 docs/*.md 并读节标题份数自述', () => {
    const fake = [
      '## 6. 文档（3 份，其余在代码里）',
      '',
      '| `docs/A.md` | x |',
      '| `docs/B.md` | y |',
      '',
      '## 7. 下一节',
      '| `docs/SHOULD_NOT_APPEAR.md` | z |',
    ].join('\n')
    const r = parseDocTable(fake)
    expect(r.files).toEqual(['A.md', 'B.md'])
    expect(r.declaredCount).toBe(3)
    // 越界：下一节的表格不得被算进来
    expect(r.files).not.toContain('SHOULD_NOT_APPEAR.md')
  })

  it('parseDocTable：无 §6 时返回空（不崩）', () => {
    expect(parseDocTable('# 只有标题')).toEqual({ files: [], declaredCount: null })
  })

  it('仓库现状：表与实际双向一致且份数自述正确（判据 9 的同源断言）', () => {
    const r = auditDocTable()!
    expect(r.missing.map(f => 'docs/' + f)).toEqual([])
    expect(r.extra).toEqual([])
    expect(r.declaredCount).toBe(r.actualCount)
    expect(r.countMismatch).toBe(false)
  })
})

describe('仓库级自洽（真实扫描）', () => {
  // 条数是结构断言：新增/删除一条判据必须来这里显式改数字（防「悄悄少了一条护栏」）
  it('九条判据全绿（fetch-stub / agentId 棘轮 ' + AGENT_BRANCH_BASELINE + ' / core agentId 棘轮 ' + CORE_AGENT_BRANCH_BASELINE + ' / 工作区状态 / 展示层越层 ' + EXHIBITION_LAYER_IMPORT_BASELINE + ' / 滑块棘轮 / debt 注册表 / docs 表 / @fact 锚点）', () => {
    const { results, ok } = runAllChecks()
    if (!ok) console.log(results.flatMap(r => r.detail).join('\n'))
    expect(ok).toBe(true)
    expect(results).toHaveLength(9)
    expect(results.map(r => r.name.split(' ')[0])).toContain('@fact')
    expect(results.map(r => r.name.split(' ')[0])).toContain('exhibition-layer')
    // core 棘轮必须在列（规则 6 的引擎层延伸——此前 core 是豁免区）
    expect(results.some(r => r.name.startsWith('core agentId ratchet'))).toBe(true)
  })
})

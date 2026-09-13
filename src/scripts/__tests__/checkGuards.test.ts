/**
 * 机器护栏的护栏（scripts/check-guards.mjs）。
 *
 * check-guards 本身挂在 check/verify 链首端，CI 已经会红；本文件补三层价值：
 * ① detector 对各种 stub 写法的判定（防正则漏抓/误抓——漏抓一条 = 护栏形同虚设）
 * ② 棘轮计数 / 禁跟踪过滤等纯函数逻辑
 * ③ 仓库级 runAllChecks 全绿（在 vitest 里给出定位到行的失败信息，不用等 CI）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEBT_REGISTRY,
  AGENT_BRANCH_BASELINE,
  AGENT_BRANCH_DIR,
  AGENT_BRANCH_FILE,
  CORE_AGENT_BRANCH_BASELINE,
  CORE_AGENT_BRANCH_FILES,
  CORE_ROLE_IMPORT_BASELINE,
  EXHIBITION_LAYER_IMPORT_BASELINE,
  MANUAL_DENSITY_CEILINGS,
  RATCHET_BURNDOWN,
  auditDocTable,
  computeBurndown,
  parseDocTable,
  countAgentIdBranchLinesInFiles,
  countAgentBranchLines,
  listAgentBranchFiles,
  daysBetween,
  detectFetchStub,
  detectExhibitionLayerImport,
  countExhibitionLayerImports,
  fetchStubViolations,
  findForbiddenTracked,
  countAgentIdBranchLines,
  extractSettingIds,
  matchDebtRegistry,
  auditCatalogLevel60,
  countGuideSection4Lines,
  scanManualDensity,
  scanDocReviewTriggers,
  runAllChecks,
  // 判据 13：名词表三态对账
  NOUN_TRIAGE_FILE,
  NOUN_SOURCE_FILE,
  auditNounTriage,
  // 判据 14：死通道扫描
  DEAD_CHANNEL_ALLOWLIST,
  scanDeadOptionalProps,
  scanReadOnlyOptionalProps,
  scanDtsDrift,
  extractRuntimeExports,
  applyDeadChannelAllowlist,
  stripStringLiterals,
  stripCommentsAndStrings,
  // 判据 15：口径复核触发器
  CALIBER_TRIGGER_ALLOWLIST,
  scanCaliberTriggers,
} from '../../../scripts/check-guards.mjs'
// parseFactLine 的单一实现在 zc.mjs（规则 11）——判据 15 的「行尾追加不破坏解析」断言要直接用它
import { parseFactLine } from '../../../scripts/zc.mjs'

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

  it('★ 注释行不计（2026-09-12 收紧：口径不再惩罚写文档的人）', () => {
    // 事故形状：迁移时在注释里解释「原本是 findIndex(c => c.agentId === 'xxxx')」，
    // 被自己的计数器数成 1 处违规（代码其实已清零）——文档写得越清楚，基线越容易假红。
    expect(countAgentIdBranchLines(`// const x = c.agentId === '1'`)).toBe(0)
    expect(countAgentIdBranchLines(` * c.agentId !== '2'`)).toBe(0)
    expect(countAgentIdBranchLines(`/* if (c.agentId === '3') {} */`)).toBe(0)
    // 真代码仍计；注释与代码同行时按代码计（行首非注释标记）
    expect(countAgentIdBranchLines(`if (c.agentId === '4') {} // 注释`)).toBe(1)
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

describe('编排层度量范围（2026-09-12 口径纠正：单文件 → 入口 + resourceCalc/ 目录）', () => {
  // 为什么需要这组用例：原口径只量 useResourceCalc.ts 一个文件，而 #10 把代码搬进 resourceCalc/
  // ——特判随代码搬家即可「降基线」。实测标称 53→8 实为编排层全量 86→86（净 0）。
  // 这组用例把「度量面必须覆盖目录」钉死，防回归成单文件口径（那会让护栏奖励搬家而非清偿）。
  it('度量面 = 入口 + 目录内全部 .ts（不是只有入口一个文件）', () => {
    const files = listAgentBranchFiles()
    expect(files).toContain(AGENT_BRANCH_FILE)
    expect(files.length).toBeGreaterThan(1)                       // 若退回单文件口径，此断言即红
    for (const f of files.filter(f => f.includes(AGENT_BRANCH_DIR))) {
      expect(f.startsWith(AGENT_BRANCH_DIR)).toBe(true)
      expect(f.endsWith('.ts')).toBe(true)
    }
    // 目录内的执行域文件必须在册（这几个正是 #10 的落点，历史上曾是盲区）
    expect(files.some(f => f.endsWith('resourceCalc/convergence.ts'))).toBe(true)
    expect(files.some(f => f.endsWith('resourceCalc/helpers.ts'))).toBe(true)
    expect(files.some(f => f.endsWith('resourceCalc/damagePool.ts'))).toBe(true)
  })

  it('全量计数 == 登记表 frozen，且**严格大于**入口单文件计数（证明目录确实进了度量面）', () => {
    const total = countAgentBranchLines()
    expect(total).toBe(AGENT_BRANCH_BASELINE)
    expect(RATCHET_BURNDOWN.find(e => e.id === 'agentId 分支')!.frozen).toBe(AGENT_BRANCH_BASELINE)
    // 入口文件现已清零；若总计数等于入口计数，说明目录没被算进去（口径退回）→ 红
    const entryOnly = countAgentIdBranchLinesInFiles([AGENT_BRANCH_FILE])
    expect(total).toBeGreaterThan(entryOnly)
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

  it('★ 新增棘轮的 current 必须是「剩余工作量」而不是「当前红灯数」（2026-09-13 实测踩坑）', () => {
    // 判据 15（口径复核触发器）首版的 measure 写成 `scanCaliberTriggers().missing.length`：
    // 一旦存量登记进 CALIBER_TRIGGER_ALLOWLIST，missing 当场归零 ⇒ 8 条棘轮里这条
    // current=0 / done=true，**从提醒面直接消失**（冻结 82 条待补 = 装作已还清）。
    // 对「棘轮 = 存量豁免 + 新增即红」形态的判据，剩余量 = 红灯数 + 豁免清单长度。
    const zc = readFileSync(join(process.cwd(), 'scripts/zc.mjs'), 'utf8')
    expect(zc).toContain('CALIBER_TRIGGER_ALLOWLIST.length')
    expect(zc).toContain('g.scanCaliberTriggers(root).missing.length + g.CALIBER_TRIGGER_ALLOWLIST.length')
    // 死通道同款：剩余量 = 三段 allowlisted 之和（fresh 恒为 0 是"守得住"，不是"还完了"）
    expect(zc).toContain('applyDeadChannelAllowlist(g.scanDeadOptionalProps(root)).allowlisted.length')
  })

  it('★ 本轮新增的三条棘轮都登记了 due 与 plan（防「冻结 = 永久豁免」）', () => {
    for (const id of ['游戏语义口径复核触发器', '死通道豁免清单', '名词表未处理']) {
      const e = RATCHET_BURNDOWN.find(x => x.id === id)
      expect(e, `${id} 必须进 RATCHET_BURNDOWN`).toBeDefined()
      expect(e!.due).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(e!.plan.length, `${id} 的 plan 要写清「怎么降」`).toBeGreaterThan(20)
      expect(e!.file, `${id} 要写清基线在哪`).toBeTruthy()
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
    // ⚠ 不能用「登记表里当前是否有清零条目」当初提——那让用例依赖当天账面的巧合：
    //   2026-09-12 口径纠正把 frozen 从 0 调回 79 后，该前提立刻失效（本用例正是这么红的）。
    // 故改为**直接对已完成条目做的事实验证**：临时把任一条目的 measure 压到 target，
    // 无论登记表处于什么状态都应判 done 且不再 stale。
    for (const e of RATCHET_BURNDOWN) {
      const atTarget = (id: string) => (id === e.id ? e.target : atFrozen(id))
      const row = computeBurndown(atTarget, '2028-01-15').find(r => r.id === e.id)!
      expect(row.done).toBe(true)
      expect(row.stale).toBe(false)      // ← 原判据在此处误报
      expect(row.remaining).toBe(0)
      expect(row.progress).toBe(e.frozen - e.target)
    }
    // 附带：若登记表确有天然已清零的条目（frozen === target），恒等检查也必须成立
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
  it('十五条判据全绿（fetch-stub / agentId 棘轮 ' + AGENT_BRANCH_BASELINE + ' / core agentId 棘轮 ' + CORE_AGENT_BRANCH_BASELINE + ' / 工作区状态 / 展示层越层 ' + EXHIBITION_LAYER_IMPORT_BASELINE + ' / **core role-import ' + CORE_ROLE_IMPORT_BASELINE + '** / 滑块棘轮 / debt 注册表 / docs 表 / @fact 锚点 / catalog-raw 对账 / 手册密度棘轮 / **名词表三态 / 死通道 / 口径复核触发器**)', () => {
    const { results, ok } = runAllChecks()
    if (!ok) console.log(results.flatMap(r => r.detail).join('\n'))
    expect(ok).toBe(true)
    expect(results).toHaveLength(15)
    expect(results.map(r => r.name.split(' ')[0])).toContain('@fact')
    expect(results.map(r => r.name.split(' ')[0])).toContain('exhibition-layer')
    // core 棘轮必须在列（规则 6 的引擎层延伸——此前 core 是豁免区）
    expect(results.some(r => r.name.startsWith('core agentId ratchet'))).toBe(true)
    // 判据 12：core role-import 棘轮（2026-09-13 架构诊断新增）——agentId 字面量是**词法**判据，
    // 看不见「引擎静态 import 具体角色模块」这种更强耦合；本判据是它的语义补强面。
    expect(results.some(r => r.name.startsWith('core role-import ratchet'))).toBe(true)
    // 判据 10：catalog ↔ raw 对账（2026-09-12 新增，坑 40）
    expect(results.some(r => r.name.includes('catalog/raw level60 对账'))).toBe(true)
    // 判据 11：手册数字 id 密度棘轮（2026-09-12 任务卡第 1 步，防手册编年史化）
    expect(results.some(r => r.name.includes('手册密度棘轮'))).toBe(true)
    // 判据 13/14/15：「静默缺口」体检三件（2026-09-13）——共同点是**没有任何失败测试**：
    // 源数据在、代码也在，只是两者之间没有连线（机器不红 ⇒ 人不知道）。
    expect(results.some(r => r.name.includes('名词表三态对账'))).toBe(true)
    expect(results.some(r => r.name.includes('死通道扫描'))).toBe(true)
    expect(results.some(r => r.name.includes('口径复核触发器'))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 判据 13：名词表三态对账（防「数据在源里但没人消费」）
// ═══════════════════════════════════════════════════════════════════════════════

describe('auditNounTriage（判据 13：名词表三态）', () => {
  /** 造一个最小仓库：源名词表 + 三态对账文件（可指定 entries 覆盖） */
  const fixture = (source: Record<string, unknown>, entries: Record<string, unknown>) => {
    const root = mkdtempSync(join(tmpdir(), 'noun-'))
    mkdirSync(join(root, 'data/raw/nanoka_missing'), { recursive: true })
    mkdirSync(join(root, 'scripts/lib'), { recursive: true })
    writeFileSync(join(root, NOUN_SOURCE_FILE), JSON.stringify(source))
    writeFileSync(join(root, NOUN_TRIAGE_FILE), JSON.stringify({ entries }))
    return root
  }
  const SRC = { '2000002': { name: '[秽盾]', title: '秽盾', skill: '敌人情报' } }
  /** 断言非 null 后返回（这些用例的 root 都建了完整 fixture，null 只可能是判据回归） */
  const must = (x: ReturnType<typeof auditNounTriage>) => {
    expect(x).not.toBeNull()
    return x!
  }

  it('三态齐备且锚可解析 = 绿；unhandled 才红（挂账是合法处置）', () => {
    const root = fixture(SRC, {
      '2000002': { name: '[秽盾]', title: '秽盾', state: 'modeled', anchor: 'src/x.ts#foo', evidence: 'ok' },
    })
    // 锚解析注入：这个 fixture 里没有 src/x.ts，故用假 resolver 模拟「可解析」
    const okResolve = () => ({ ok: true, reason: 'symbol' })
    const r = must(auditNounTriage(root, okResolve))
    expect(r.ok).toBe(true)
    expect(r.unhandled).toEqual([])
  })

  it('★ unhandled = 红（两者皆无：零消费锚点 + 零登记）', () => {
    const root = fixture(SRC, {
      '2000002': { name: '[秽盾]', title: '秽盾', state: 'unhandled', evidence: '搜了 src/docs 零命中' },
    })
    const r = must(auditNounTriage(root, () => ({ ok: true, reason: 'symbol' })))
    expect(r.ok).toBe(false)
    expect(r.unhandled).toHaveLength(1)
    expect(r.unhandled[0]).toContain('秽盾')
  })

  it('deferred 必须带 registeredAt + since（挂账不是口头说说）', () => {
    const root = fixture(SRC, {
      '2000002': { name: '[秽盾]', title: '秽盾', state: 'deferred', evidence: '挂账' },
    })
    const r = must(auditNounTriage(root, () => ({ ok: true, reason: 'symbol' })))
    expect(r.ok).toBe(false)
    expect(r.noRegister).toHaveLength(1)
    // 补齐两项即绿
    const root2 = fixture(SRC, {
      '2000002': { name: '[秽盾]', title: '秽盾', state: 'deferred', registeredAt: 'docs/X.md:58', since: '2026-09-13', evidence: '挂账' },
    })
    expect(must(auditNounTriage(root2, () => ({ ok: true, reason: 'symbol' }))).ok).toBe(true)
  })

  it('★ modeled 的锚断了 = 红（同判据 6 哲学：断锚 = 口径已过期）', () => {
    const root = fixture(SRC, {
      '2000002': { name: '[秽盾]', title: '秽盾', state: 'modeled', anchor: 'src/renamed.ts#gone', evidence: 'ok' },
    })
    const r = must(auditNounTriage(root, () => ({ ok: false, reason: 'file-missing' })))
    expect(r.ok).toBe(false)
    expect(r.brokenAnchor).toHaveLength(1)
  })

  it('★ 键集合必须相等（源新增名词静默进来 = 红；多出的键也是红）', () => {
    const root = fixture({ ...SRC, '2000003': { name: '[控制技]', title: '控制技' } }, {
      '2000002': { name: '[秽盾]', state: 'deferred', registeredAt: 'docs/X.md:1', since: '2026-09-13', evidence: 'e' },
      '9999999': { name: '[不存在]', state: 'unhandled', evidence: 'e' },
    })
    const r = must(auditNounTriage(root, () => ({ ok: true, reason: 'symbol' })))
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['2000003'])   // 源里有但没人判
    expect(r.extra).toEqual(['9999999'])     // 判了但源里没有
  })

  it('state 只许三值 + 每条必须有 evidence', () => {
    const root = fixture(SRC, {
      '2000002': { name: '[秽盾]', state: '随便写', evidence: 'e' },
    })
    const r = must(auditNounTriage(root, () => ({ ok: true, reason: 'symbol' })))
    expect(r.badState).toHaveLength(1)
    const root2 = fixture(SRC, { '2000002': { name: '[秽盾]', state: 'unhandled' } })
    const r2 = must(auditNounTriage(root2, () => ({ ok: true, reason: 'symbol' })))
    expect(r2.noEvidence).toHaveLength(1)
  })

  it('文件缺失 → null（不判红，与判据 9/10 同风格：环境不全不误伤）', () => {
    const root = mkdtempSync(join(tmpdir(), 'noun-empty-'))
    expect(auditNounTriage(root, () => ({ ok: true, reason: 'symbol' }))).toBeNull()
  })

  it('仓库现状：68 条全部有着落（unhandled=0，每条 modeled 锚可解析）', () => {
    const r = must(auditNounTriage())
    // 条数 = 源文件键数（68；含 10000081 与 1000008 的重复条目——源如此，如实对账）
    expect(r.sourceKeys).toHaveLength(68)
    expect(r.unhandled).toEqual([])
    expect(r.brokenAnchor).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.extra).toEqual([])
    // 三态分布如实：modeled 27 / deferred 41（40 条 unhandled 按挂账处置后的终态）
    const states = Object.values(r.triage.entries!)
    expect(states.filter(e => e.state === 'modeled').length).toBeGreaterThanOrEqual(25)
    expect(states.filter(e => e.state === 'deferred').length).toBeGreaterThanOrEqual(40)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 判据 14：死通道扫描（A 零读零写 / B 只读不写 / C 手写 .d.mts 漂移）
// ═══════════════════════════════════════════════════════════════════════════════

describe('scanDeadOptionalProps（判据 14-A：goldLevel 模式）', () => {
  /** 造一个最小 src 树；files = { '<rel>': content } */
  const fixture = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'dead-'))
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      writeFileSync(join(root, rel), content)
    }
    return root
  }

  it('★ 零读零写 = 死（goldLevel 的形态：声明了、类型可选、没人传）', () => {
    const root = fixture({
      'src/composables/x.ts': [
        'export interface Opts {',
        '  goldLevel?: number',
        '  used?: number',
        '}',
        'export function f(o: Opts) { return o.used ?? 0 }',
      ].join('\n'),
    })
    const dead = scanDeadOptionalProps(root)
    expect(dead.map(d => d.name)).toEqual(['goldLevel'])
    // key 用 file+name（**不含行号**）：行号在文件一被编辑就漂，清单会变成一次性消耗品
    expect(dead[0].key).toBe('A|src/composables/x.ts goldLevel')
  })

  it('写入点算活（`goldLevel:` 出现在别处 = 有人传）', () => {
    const root = fixture({
      'src/composables/x.ts': ['export interface Opts {', '  goldLevel?: number', '}'].join('\n'),
      'src/composables/caller.ts': 'const o: Opts = { goldLevel: 3 }',
    })
    expect(scanDeadOptionalProps(root)).toEqual([])
  })

  it('读取点算活（`.goldLevel` 被读 = 通道在用）', () => {
    const root = fixture({
      'src/composables/x.ts': ['export interface Opts {', '  goldLevel?: number', '}'].join('\n'),
      'src/composables/caller.ts': 'const n = opts.goldLevel ?? 0',
    })
    expect(scanDeadOptionalProps(root)).toEqual([])
  })

  it('声明行自身不计写入（否则每个声明都自证活着 = 判据永远绿）', () => {
    const root = fixture({
      'src/core/y.ts': ['export interface Opts {', '  lonely?: string', '}'].join('\n'),
    })
    expect(scanDeadOptionalProps(root).map(d => d.name)).toEqual(['lonely'])
  })

  it('测试文件里的引用也算活（测试专用字段不是死通道）', () => {
    const root = fixture({
      'src/core/y.ts': ['export interface Opts {', '  onlyInTests?: string', '}'].join('\n'),
      'src/core/__tests__/y.test.ts': 'const o: Opts = { onlyInTests: "x" }',
    })
    expect(scanDeadOptionalProps(root)).toEqual([])
  })
})

describe('scanReadOnlyOptionalProps（判据 14-B：invincibleTime 模式）', () => {
  const fixture = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'ro-'))
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      writeFileSync(join(root, rel), content)
    }
    return root
  }

  it('★ 只读不写 = 通道空转（实现读 `?? 默认`，全仓零写入点）', () => {
    const root = fixture({
      'src/core/effectiveTime.ts': [
        'interface Cfg {',
        '  invincibleTime?: number',
        '}',
        'export function t(c: Cfg) { return 180 - (c.invincibleTime ?? 0) }',
      ].join('\n'),
    })
    const ro = scanReadOnlyOptionalProps(root)
    expect(ro.map(d => d.name)).toEqual(['invincibleTime'])
    expect(ro[0].reads).toBeGreaterThan(0)
    expect(ro[0].writes).toBe(0)
  })

  it('有写入点 = 不是空转（数据面给了值）', () => {
    const root = fixture({
      'src/core/x.ts': [
        'interface Cfg {',
        '  invincibleTime?: number',
        '}',
        'export function t(c: Cfg) { return c.invincibleTime ?? 0 }',
      ].join('\n'),
      'src/stores/s.ts': 'const cfg = { invincibleTime: 24 }',
    })
    expect(scanReadOnlyOptionalProps(root)).toEqual([])
  })

  it('零读零写不进 B 段（那是 A 段的判据，两段不重叠）', () => {
    const root = fixture({
      'src/core/x.ts': ['interface Cfg {', '  nobody?: number', '}'].join('\n'),
    })
    expect(scanReadOnlyOptionalProps(root)).toEqual([])
    expect(scanDeadOptionalProps(root).map(d => d.name)).toEqual(['nobody'])
  })

  // 2026-09-14 实测缺陷（false-green 面）：判据按**字段名文本**计数，
  // 于是「夹具里的示例串」也能当写入点。实测事故：并行车道新增 deadChannelLs.test.ts 里
  // 一行 `{ resistances: {} }` 的构造输入，让判据 14-B 当场 10→9（真实死通道
  // `B|src/composables/runArchiveImport.ts resistances` 被抹掉，反而报「豁免过期」而红）。
  // ⇒ 计数前必须去字符串字面量 + 注释（stripCommentsAndStrings）。
  it('★ 字符串字面量里的 `name:` 不算写入点（夹具串不该抹掉真实死通道）', () => {
    const root = fixture({
      'src/composables/runArchiveImport.ts': [
        'export interface ArchiveRoom {',
        '  resistances?: string[]',
        '}',
        'export function f(r: ArchiveRoom) { return Object.keys(r.resistances ?? {}).length }',
      ].join('\n'),
      // 测试夹具：这里的 `resistances: {}` 是**构造输入的字面量串**，不是写入点。
      // ⚠ 夹具串本身必须用单引号包（不能用嵌套模板串）——嵌套反引号会把去串正则的边界打乱。
      'src/composables/__tests__/fixture.test.ts': 'const src = \'export const enemy = { resistances: {} }\'\n',
    })
    const ro = scanReadOnlyOptionalProps(root)
    expect(ro.map(d => d.name)).toEqual(['resistances'])
    expect(ro[0].writes).toBe(0)
  })

  it('单引号/双引号串里的 `name:` 同样不算写入点', () => {
    const root = fixture({
      'src/core/x.ts': ['interface Cfg {', '  invincibleTime?: number', '}',
        'export function t(c: Cfg) { return c.invincibleTime ?? 0 }'].join('\n'),
      'src/core/helper.ts': "export const doc = 'invincibleTime: 24'\nexport const doc2 = \"invincibleTime: 30\"\n",
    })
    expect(scanReadOnlyOptionalProps(root).map(d => d.name)).toEqual(['invincibleTime'])
  })

  it('真写入点（对象字面量键）仍然算活——去字符串没有把判据去瘫', () => {
    const root = fixture({
      'src/core/x.ts': ['interface Cfg {', '  invincibleTime?: number', '}',
        'export function t(c: Cfg) { return c.invincibleTime ?? 0 }'].join('\n'),
      'src/core/real.ts': 'const cfg: Cfg = { invincibleTime: 24 }',
    })
    expect(scanReadOnlyOptionalProps(root)).toEqual([])
  })

  it('stripStringLiterals：模板串/单双引号串被抹平，代码本体不动', () => {
    expect(stripStringLiterals('const a = `x: 1`; const b = \'y: 2\'; const c = "z: 3"; const d = { k: 4 }'))
      .toBe('const a = ``; const b = \'\'; const c = ""; const d = { k: 4 }')
    // 转义引号不误伤
    expect(stripStringLiterals("const s = 'it\\'s: fine'")).toBe("const s = ''")
  })

  // T15 对抗审计的 #1 发现（本轮实测复核属实，同日修复）：注释里的 `name:` 同样算写入点 ⇒
  // **一条 TODO 注释就能把真死通道洗白**。这是唯一会因日常写 TODO 而静默失效的形态。
  it('★ 注释里的 `name:` 不算写入点（TODO 注释不该把真死通道洗白）', () => {
    const root = fixture({
      'src/core/effectiveTime.ts': [
        'interface Cfg {',
        '  blockSeconds?: number',
        '}',
        'export function t(c: Cfg) { return c.blockSeconds ?? 0 }',
      ].join('\n'),
      'src/core/notes.ts': [
        '// TODO: blockSeconds: 待接 frontBlockSeconds（这条注释曾把真死通道洗白）',
        '/* blockSeconds: 旧口径，保留兼容 */',
        'export const keep = 1',
      ].join('\n'),
    })
    const ro = scanReadOnlyOptionalProps(root)
    expect(ro.map(d => d.name)).toEqual(['blockSeconds'])
    expect(ro[0].writes).toBe(0)
  })

  it('块注释/行注释被剥，但真写入点与代码本体不受影响', () => {
    const stripped = stripCommentsAndStrings([
      '// inc: 1',
      '/* inc: 2 */',
      'const url = "https://a.b/inc: x"',
      'const real = { inc: 3 }',
      'const ratio = a / b // 不是注释符号误伤：2/3',
    ].join('\n'))
    // 注释里 2 处 + 字符串里 1 处被剥掉 ⇒ 只剩真写入点那 1 处
    expect(stripped.match(/(^|[\s{,(])inc\s*:(?!:)/gm) ?? []).toHaveLength(1)
    expect(stripped).toContain('const real = { inc: 3 }')  // 真写入点保留
    expect(stripped).toContain('const ratio = a / b')      // `2/3` 不被当成行注释
  })

  it('stripCommentsAndStrings：先剥注释再去串（反序会把真代码吞掉）', () => {
    // 注释里出现单引号：若先按引号去串，这行的引号会把「串」开在错误位置，吞掉后半段代码
    const s = stripCommentsAndStrings("// 说明：'未闭合的引号\nconst keep = 1")
    expect(s).toContain('const keep = 1')
  })
})

describe('scanDtsDrift / extractRuntimeExports（判据 14-C：TS2305 模式）', () => {
  const fixture = (dtsName: string, dtsBody: string, mjsBody: string) => {
    const root = mkdtempSync(join(tmpdir(), 'dts-'))
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', dtsName + '.d.mts'), dtsBody)
    writeFileSync(join(root, 'scripts', dtsName + '.mjs'), mjsBody)
    return root
  }

  it('★ 声明了但运行时没有 = TS2305（实测事故：CORE_ROLE_IMPORT_BASELINE）', () => {
    const root = fixture('m',
      'export declare const A: number\nexport declare const GHOST: number\n',
      'export const A = 1\n')
    const r = scanDtsDrift(root)
    expect(r.declaredNotExported.map(x => x.names[0])).toEqual(['GHOST'])
    expect(r.declaredNotExported[0].key).toBe('C|scripts/m.d.mts#GHOST')
  })

  it('★ 导出了但影子 API 没写 = TS 侧看不见（方向相反，同样报）', () => {
    const root = fixture('m',
      'export declare const A: number\n',
      'export const A = 1\nexport const UNDOCUMENTED = 2\n')
    const r = scanDtsDrift(root)
    expect(r.exportedNotDeclared.map(x => x.names[0])).toEqual(['UNDOCUMENTED'])
  })

  it('interface/type 是纯类型、不进运行时表 ⇒ 不算漂移', () => {
    const root = fixture('m',
      'export interface Opts { a: number }\nexport type T = string\nexport declare const A: number\n',
      'export const A = 1\n')
    const r = scanDtsDrift(root)
    expect(r.declaredNotExported).toEqual([])
    expect(r.exportedNotDeclared).toEqual([])
  })

  it('extractRuntimeExports 覆盖三种写法（声明 / export {} / re-export）', () => {
    expect(extractRuntimeExports([
      'export function f() {}',
      'export const A = 1',
      'export class C {}',
      'const x = 1, y = 2',
      'export { x, y as z }',
      "export { remote } from './other.mjs'",
      'export type OnlyType = string',
    ].join('\n'))).toEqual(['A', 'C', 'f', 'remote', 'x', 'z'])
  })

  it('仓库现状：六对手写 .d.mts 零漂移（本判据上线时一次补齐 16 个漏声明）', () => {
    const r = scanDtsDrift()
    expect(r.pairs.length).toBeGreaterThanOrEqual(6)
    expect(r.declaredNotExported).toEqual([])
    expect(r.exportedNotDeclared).toEqual([])
  })
})

describe('applyDeadChannelAllowlist（判据 14 的豁免与 burn-down）', () => {
  it('★ stale 只在同一段内计算（A 段清单不被 B 段调用误报过期）', () => {
    // 实测踩过：三段合并跑时拿 global key 列表比单段命中集 → A 段 13 条全被误报 expired
    const a = applyDeadChannelAllowlist(scanDeadOptionalProps())
    const b = applyDeadChannelAllowlist(scanReadOnlyOptionalProps())
    expect(a.stale).toEqual([])
    expect(b.stale).toEqual([])
  })

  it('已登记条目进 allowlisted、不进 fresh', () => {
    const key = Object.keys(DEAD_CHANNEL_ALLOWLIST)[0]
    const r = applyDeadChannelAllowlist([{ key, file: 'x', line: 1, name: 'n' }])
    expect(r.fresh).toEqual([])
    expect(r.allowlisted).toHaveLength(1)
  })

  it('未登记的候选进 fresh（= 红面）', () => {
    const r = applyDeadChannelAllowlist([{ key: 'A|nope.ts ghost', file: 'nope.ts', line: 1, name: 'ghost' }])
    expect(r.fresh).toHaveLength(1)
  })

  it('空候选集不产生 stale（不能因为「本段没扫到」把清单判过期）', () => {
    expect(applyDeadChannelAllowlist([]).stale).toEqual([])
  })

  it('每条豁免都必须写 why（防「为绿而登记」把判据变成橡皮图章）', () => {
    for (const [k, v] of Object.entries(DEAD_CHANNEL_ALLOWLIST)) {
      expect(v.since, k).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(v.due, k).toBeTruthy()
      expect(v.why, k).toBeTruthy()
    }
  })

  it('仓库现状：三类候选全部已登记（fresh 为空）', () => {
    const a = applyDeadChannelAllowlist(scanDeadOptionalProps())
    const b = applyDeadChannelAllowlist(scanReadOnlyOptionalProps())
    const d = scanDtsDrift()
    const c = applyDeadChannelAllowlist([...d.declaredNotExported, ...d.exportedNotDeclared])
    expect([...a.fresh, ...b.fresh, ...c.fresh]).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 判据 15：口径复核触发器强制（防「旧结论静默过期」）
// ═══════════════════════════════════════════════════════════════════════════════

describe('scanCaliberTriggers（判据 15：游戏语义口径必须挂 ⟳复核）', () => {
  /** 造一个最小仓库：一个带 @fact 的源文件 */
  const fixture = (body: string) => {
    const root = mkdtempSync(join(tmpdir(), 'cal-'))
    mkdirSync(join(root, 'src/core'), { recursive: true })
    writeFileSync(join(root, 'src/core/x.ts'), body)
    return root
  }
  const FACT = '// @fact engine:damage/乘区顺序 口径: 顺序 = 代码顺序 | 据 实测@2026-09-01 | 锚 src/core/x.ts#f | 信 确认'

  it('★ 游戏语义口径缺触发器 = 红面（missing）', () => {
    const root = fixture([FACT, 'export function f() {}'].join('\n'))
    const r = scanCaliberTriggers(root)
    expect(r.game).toHaveLength(1)
    expect(r.missing.map(m => m.subject)).toEqual(['engine:damage/乘区顺序'])
  })

  it('★ 紧邻下一行挂 ⟳复核 即绿（触发器的合法写法）', () => {
    const root = fixture([
      FACT,
      '// ⟳复核: 下个大版本后重对乘区顺序 | 到期 2026-12-31',
      'export function f() {}',
    ].join('\n'))
    const r = scanCaliberTriggers(root)
    expect(r.missing).toEqual([])
    expect(r.withTrigger).toHaveLength(1)
  })

  it('写在 @fact 行尾也认（同一行两种位置都合法）', () => {
    const root = fixture([FACT + ' ⟳复核: 复核乘区 | 到期 2026-12-31', 'export function f() {}'].join('\n'))
    expect(scanCaliberTriggers(root).missing).toEqual([])
  })

  it('只有 ⟳复核 没有到期日 = 缺（到期日才是机器判据，缺了就永远不提醒）', () => {
    const root = fixture([FACT, '// ⟳复核: 以后再看看', 'export function f() {}'].join('\n'))
    expect(scanCaliberTriggers(root).missing).toHaveLength(1)
  })

  it('★ 工程元口径豁免（engine:guards / engine:zc / ui: / utils/）——它们的复核靠守卫红', () => {
    const root = fixture([
      '// @fact engine:guards/自指豁免 口径: 扫描器自身含被扫模式属自指 | 据 实测@2026-09-01',
      '// @fact utils/format/localized 口径: nullish 链取值 | 据 终态核对@2026-09-12',
      'export function f() {}',
    ].join('\n'))
    expect(scanCaliberTriggers(root).game).toEqual([])
  })

  it('非口径/映射种类不强制（未建模/债/决 不挂日期 —— 债有自己的 DEBT_REGISTRY 到期动作）', () => {
    const root = fixture([
      '// @fact agent:1411/c6 未建模: 蓄能炮弹不实现 | 据 用户@2026-08-30',
      '// @fact engine:zc/语法 决: 语法只在解析器定义 | 据 用户@2026-08-31',
      'export function f() {}',
    ].join('\n'))
    expect(scanCaliberTriggers(root).game).toEqual([])
  })

  it('★ 行尾追加 ⟳复核 不破坏 parseFactLine（解析器只认 据/验/锚/信 槽位）', () => {
    const line = FACT + ' ⟳复核: 复核乘区顺序 | 到期 2026-12-31'
    const f = parseFactLine(line.replace(/^\/\/ /, ''))
    expect(f).not.toBeNull()
    expect(f!.subject).toBe('engine:damage/乘区顺序')
    expect(f!.claim).toBe('顺序 = 代码顺序')
    expect(f!.provenance).toBe('实测@2026-09-01')
  })

  it('豁免清单补上触发器后必须销号（stale = 漏删即红，棘轮只减不增）', () => {
    const key = CALIBER_TRIGGER_ALLOWLIST[0]
    const r = scanCaliberTriggers()
    // 仓库现状：清单里的条目全部仍命中（stale 为空）——补完一条要同步删一行
    expect(r.stale).toEqual([])
    expect(CALIBER_TRIGGER_ALLOWLIST).toContain(key)
  })

  it('仓库现状：新增的游戏语义口径没有裸奔（missing 为空 = 存量已全部登记待补）', () => {
    const r = scanCaliberTriggers()
    expect(r.missing).toEqual([])
    expect(r.stale).toEqual([])
    // 存量基线如实：82 条缺触发器（全部登记在 CALIBER_TRIGGER_ALLOWLIST 里 burn-down）+
    // 1 条已挂（本轮新挂的 effectiveTime「无敌≠秽盾」）= 83 条游戏语义口径。
    // 恒等式：missing 为空 ⇔ 每条缺触发器的口径都在豁免清单里（漏登记一条即红 = 新增口径不许裸奔）。
    expect(r.game.length).toBeGreaterThanOrEqual(80)
    expect(CALIBER_TRIGGER_ALLOWLIST.length).toBe(r.game.length)
    expect(r.withTrigger.length).toBeGreaterThanOrEqual(1)
  })

  it('★ 本轮新挂的触发器可被抓到（effectiveTime 的「无敌≠秽盾」= 判据 15 的首个真实用例）', () => {
    const r = scanCaliberTriggers()
    const hit = r.withTrigger.find(t => t.subject === 'engine:time/无敌≠秽盾')
    expect(hit, 'effectiveTime.ts 的 @fact engine:time/无敌≠秽盾 必须挂 ⟳复核').toBeTruthy()
    expect(hit!.file).toBe('src/core/effectiveTime.ts')
  })
})

describe('auditCatalogLevel60（判据 10：catalog ↔ raw 对账）', () => {
  // 2026-09-12 事故（坑 40）：导入脚本漏加满级突破加成 → 20 个角色的暴击被落成了
  // 全库通用裸基值 5/50。因为「大家都一样」肉眼不可见、也不让任何测试变红，必须靠机器对账。
  it('仓库现状：零差异（同源断言，与判据 10 用同一个 detector）', () => {
    const r = auditCatalogLevel60()!
    expect(r.violations).toEqual([])
    expect(r.compared).toBeGreaterThan(0)
    // 度量面必须含暴击两字段（漏任一条 = 事故可复发而不被拦）
    expect(r.fieldNames).toEqual(expect.arrayContaining(['critRate', 'critDmg']))
    // 容差/对照组（atkBase）不进判据——否则历史舍入噪声会长期挂红，逼人为变绿乱改口径
    expect(r.fieldNames).not.toContain('atkBase')
  })

  it('只比对有 raw 源的角色；无 raw / 无该字段的不算违规（防误报）', () => {
    const r = auditCatalogLevel60()!
    // 全库 62 角色里只有约 47 个有 raw；若把无 raw 的当违规，这里会瞬间爆炸
    const rawCount = readdirSync(join(process.cwd(), 'data/raw/nanoka_missing/full'))
      .filter((f: string) => /^\d+\.json$/.test(f)).length
    // 上限 = 有 raw 的角色 × 字段数（energyRegen 等规则对无数据角色会返回 undefined 跳过，
    // 故实际 compared ≤ 上限——断言「不超上限」而非硬编码总数，加规则时不必改数字）
    expect(r.compared).toBeGreaterThan(0)
    expect(r.compared).toBeLessThanOrEqual(rawCount * r.fieldNames.length)
    // 真正要防的误报：无 raw 的角色绝不能出现在违规里
    expect(r.violations).toEqual([])
  })
})

describe('scanManualDensity（判据 11：手册数字 id 密度棘轮，任务卡 2026-09-12）', () => {
  it('仓库现状：四份方法文档全部可测且在天花板内（超 = 判据红，本条 = 回归护栏本身）', () => {
    const d = scanManualDensity()
    expect(Object.keys(d).sort()).toEqual(Object.keys(MANUAL_DENSITY_CEILINGS).sort())
    for (const [file, v] of Object.entries(d)) {
      expect(v.density, file).not.toBeNull()
      expect(v.density!, `${file} 密度 ${v.density} 超天花板 ${v.ceiling}`).toBeLessThanOrEqual(v.ceiling)
    }
  })

  it('口径：按 \\b1\\d{3}\\b 命中次数计，排除 7 位 moveId / 5 位 prop / boss id；打包编年行按次数加权', () => {
    const root = mkdtempSync(join(tmpdir(), 'density-'))
    mkdirSync(join(root, 'docs'))
    // 每行一个用例：克拉蕾行 1 hit + 打包队名行 3 hits，其余行全部 0（边界排除验证）
    writeFileSync(join(root, 'docs/ENGINE_PIPELINE_GUIDE.md'), [
      '克拉蕾 1611 的口径',            // 1 hit
      'moveId 1611028 不吃倍率',       // 0（7 位连续数字，\b 不成立）
      '20101 暴击率突破 / 31201 精通',  // 0（5 位 prop id）
      'boss 40002 猎血清道夫',          // 0（boss id 不以 1 开头）
      'auto-1431-1481-1491 +39.4%',    // 3（打包编年行按次数计，这是口径的核心决定）
      '协议文字，不含任何 id',           // 0（分母摊薄 = 期望方向）
      '',                               // 尾行（split 产生，计入分母——口径稳定即可）
    ].join('\n'))
    const d = scanManualDensity(root)['docs/ENGINE_PIPELINE_GUIDE.md']
    expect(d.hits).toBe(4)
    expect(d.lines).toBe(7)
    expect(d.density).toBeCloseTo(4 / 7, 3)
    // 其余三份缺失 → density null（缺失不判红，与判据 10 同风格）
    expect(scanManualDensity(root)['docs/AGENT_RECORDING_SOP.md'].density).toBeNull()
  })

  it('burn-down：「手册 §4 行数」条目存在且度量 id 已接进 zc（漏接 measure 会静默 NaN → 点名失效）', () => {
    // 口径纠正 2026-09-12：还款面 = §4 行数（任务卡主口径 −40%）；密度只当判据 11 防变差天花板
    //（批量拆薄实测反效果：散文删得快于证据数字，密度 0.196→0.237 不降反升）
    const e = RATCHET_BURNDOWN.find(x => x.id === '手册 §4 行数')
    expect(e).toBeDefined()
    expect(e!.file).toBe('docs/ENGINE_PIPELINE_GUIDE.md')
    expect(e!.target).toBeLessThanOrEqual(e!.frozen)
    const cur = countGuideSection4Lines()
    expect(Number.isFinite(cur)).toBe(true)
    expect(cur).toBeLessThanOrEqual(e!.frozen)   // 棘轮语义：不许涨过冻结值
    // 原断言是 `cur >= target`（「未到期误报清零」），2026-09-13 实测发现它**惩罚超额还款**：
    // 工人把 §4 拆到 719 行（< target 804）、check-guards 本体 11/11 全绿，却因这条单测红，
    // 被迫回退到刚好 804。达标（≤target）即条目 done，继续降是纯收益，判据不该拦。
    // 真正的「误报清零」防护改为**结算要求**：低于 target 就必须把登记表结算掉（frozen/target
    // 同步下调到当前值），否则条目会一直挂着旧目标显示「已完成」。
    if (cur < e!.target) {
      expect(e!.frozen,
        `「手册 §4 行数」已超额达标（现 ${cur} 行 < target ${e!.target}）：请结算登记表——`
        + `frozen/target 同步下调到 ${cur}（棘轮只减不增），并在 plan 里记一句本轮到点。`).toBe(cur)
      expect(e!.target).toBe(cur)
    }
    // zc.mjs measured 映射以 id 为键（rule 11：口径实现在 check-guards，zc 只注入）
    const src = readFileSync(join(process.cwd(), 'scripts/zc.mjs'), 'utf8')
    expect(src).toContain(`'${e!.id}'`)
  })
})

describe('scanDocReviewTriggers（手册复核触发器，任务卡第 5 步：只报不红）', () => {
  it('抓「⟳复核: … | 到期 …」并按今天判逾期；容忍全角管道', () => {
    const root = mkdtempSync(join(tmpdir(), 'trig-'))
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs/ENGINE_PIPELINE_GUIDE.md'), [
      '19. 坑标题',
      '    ⟳复核: 正式服上线后重对数字 | 到期 2026-10-01',
      '    ⟳复核: 重构完成后确认口径仍成立 ｜ 到期 2099-01-01',
      '    普通行没有触发器',
      '',
    ].join('\n'))
    const rows = scanDocReviewTriggers(root, '2026-09-12')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ due: '2026-10-01', overdue: false, line: 2 })
    expect(rows[1]).toMatchObject({ due: '2099-01-01', overdue: false })
    expect(scanDocReviewTriggers(root, '2026-10-02')[0].overdue).toBe(true)
  })
  it('仓库现状：每条触发器都能被抓到（写了没被抓 = 格式错，静默失效）', () => {
    let marked = 0
    for (const rel of Object.keys(MANUAL_DENSITY_CEILINGS)) {
      try {
        for (const ln of readFileSync(join(process.cwd(), rel), 'utf8').split('\n')) {
          // 计数 = 带真日期的触发器行；§4 开头的约定说明行（示例占位 `<YYYY-MM-DD>`）不算账
          if (/⟳复核/.test(ln) && /到期\s*\d{4}-\d{2}-\d{2}/.test(ln)) marked++
        }
      } catch { /* 文档缺失由扫描器容忍 */ }
    }
    const found = scanDocReviewTriggers().length
    expect(found).toBeGreaterThanOrEqual(3)  // 坑 19/27/38 三条示范标记
    expect(found).toBe(marked)               // 可解析数 == 挂账数（漏一条 = 挂了个假账）
  })
})

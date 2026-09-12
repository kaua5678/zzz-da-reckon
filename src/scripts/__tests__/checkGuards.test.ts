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
  scanManualDensity,
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
  it('十一条判据全绿（fetch-stub / agentId 棘轮 ' + AGENT_BRANCH_BASELINE + ' / core agentId 棘轮 ' + CORE_AGENT_BRANCH_BASELINE + ' / 工作区状态 / 展示层越层 ' + EXHIBITION_LAYER_IMPORT_BASELINE + ' / 滑块棘轮 / debt 注册表 / docs 表 / @fact 锚点 / catalog-raw 对账 / 手册密度棘轮）', () => {
    const { results, ok } = runAllChecks()
    if (!ok) console.log(results.flatMap(r => r.detail).join('\n'))
    expect(ok).toBe(true)
    expect(results).toHaveLength(11)
    expect(results.map(r => r.name.split(' ')[0])).toContain('@fact')
    expect(results.map(r => r.name.split(' ')[0])).toContain('exhibition-layer')
    // core 棘轮必须在列（规则 6 的引擎层延伸——此前 core 是豁免区）
    expect(results.some(r => r.name.startsWith('core agentId ratchet'))).toBe(true)
    // 判据 10：catalog ↔ raw 对账（2026-09-12 新增，坑 40）
    expect(results.some(r => r.name.includes('catalog/raw level60 对账'))).toBe(true)
    // 判据 11：手册数字 id 密度棘轮（2026-09-12 任务卡第 1 步，防手册编年史化）
    expect(results.some(r => r.name.includes('手册密度棘轮'))).toBe(true)
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

  it('burn-down：手册密度条目存在且度量 id 可解析（漏接 measure 会静默 NaN → zc 点名失效）', () => {
    const e = RATCHET_BURNDOWN.find(x => x.id === '手册数字 id 密度')
    expect(e).toBeDefined()
    expect(e!.file).toBe('docs/ENGINE_PIPELINE_GUIDE.md')
    expect(e!.target).toBeLessThan(e!.frozen)
    // zc.mjs measured 映射以 id 为键（rule 11：口径实现在 check-guards，zc 只注入）
    const src = readFileSync(join(process.cwd(), 'scripts/zc.mjs'), 'utf8')
    expect(src).toContain(`'${e!.id}'`)
  })
})

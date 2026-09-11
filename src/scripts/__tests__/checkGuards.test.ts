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
  EXHIBITION_LAYER_IMPORT_BASELINE,
  RATCHET_BURNDOWN,
  computeBurndown,
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

describe('computeBurndown（棘轮 burn-down：防「冻结 = 永久豁免」）', () => {
  // 语义钉死：棘轮解决「不许变差」，burn-down 解决「什么时候变好」。四条状态必须互不串味。
  const measure = (id: string) => (id === 'agentId 分支' ? 53 : 23)

  it('未到期：不报警（只在 due 前后才点名）', () => {
    for (const b of computeBurndown(measure, '2026-09-11')) {
      expect(b.stale).toBe(false)
      expect(b.overdue).toBe(false)
      expect(b.done).toBe(false)
      expect(b.progress).toBe(0)
    }
  })

  it('到期且零进展 → stale（点名；这是本判据存在的唯一理由）', () => {
    const rows = computeBurndown(measure, '2027-01-15')
    expect(rows.every(r => r.stale)).toBe(true)
    expect(rows.every(r => r.overdue)).toBe(true)
  })

  it('到期但已有进展 → overdue 而非 stale（有还款就不骂）', () => {
    const rows = computeBurndown(id => (id === 'agentId 分支' ? 40 : 23), '2027-01-15')
    const agent = rows.find(r => r.id === 'agentId 分支')!
    expect(agent.progress).toBe(13)
    expect(agent.stale).toBe(false)
    expect(agent.overdue).toBe(true)
    expect(agent.remaining).toBe(40)
    // 零进展的那条仍 stale
    expect(rows.find(r => r.id !== 'agentId 分支')!.stale).toBe(true)
  })

  it('清零 → done（不再进提醒）', () => {
    const rows = computeBurndown(() => 0, '2027-01-15')
    expect(rows.every(r => r.done)).toBe(true)
    expect(rows.every(r => r.remaining === 0)).toBe(true)
    expect(rows.every(r => !r.stale)).toBe(true)
  })

  it('登记表本身自洽：frozen 与代码里的基线常量一致、due 可解析、target ≤ frozen', () => {
    expect(RATCHET_BURNDOWN.length).toBeGreaterThan(0)
    for (const e of RATCHET_BURNDOWN) {
      expect(Number.isFinite(Date.parse(e.due))).toBe(true)
      expect(e.target).toBeLessThanOrEqual(e.frozen)
      expect(e.plan.length).toBeGreaterThan(10) // 必须写「怎么降」，不能只留一个数字
    }
    // frozen 必须等于真实基线常量（防登记表与护栏脱钩变成死数据）
    const agentEntry = RATCHET_BURNDOWN.find(e => e.id === 'agentId 分支')!
    const layerEntry = RATCHET_BURNDOWN.find(e => e.id === '展示层越层 import')!
    expect(agentEntry.frozen).toBe(AGENT_BRANCH_BASELINE)
    expect(layerEntry.frozen).toBe(EXHIBITION_LAYER_IMPORT_BASELINE)
  })

  it('daysBetween 计算正确（用于 dueSoon 提示）', () => {
    expect(daysBetween('2026-09-11', '2026-12-31')).toBe(111)
    expect(daysBetween('2026-12-31', '2026-12-31')).toBe(0)
  })
})

describe('仓库级自洽（真实扫描）', () => {
  // 条数是结构断言：新增/删除一条判据必须来这里显式改数字（防「悄悄少了一条护栏」）
  it('七条判据全绿（fetch-stub 集合相等 / agentId 棘轮 ' + AGENT_BRANCH_BASELINE + ' / 工作区状态 / 滑块棘轮 / debt 注册表 / @fact 锚点 / 展示层越层棘轮 ' + EXHIBITION_LAYER_IMPORT_BASELINE + '）', () => {
    const { results, ok } = runAllChecks()
    if (!ok) console.log(results.flatMap(r => r.detail).join('\n'))
    expect(ok).toBe(true)
    expect(results).toHaveLength(7)
    expect(results.map(r => r.name.split(' ')[0])).toContain('@fact')
    expect(results.map(r => r.name.split(' ')[0])).toContain('exhibition-layer')
  })
})

/**
 * 队伍时间线（timeCharts 页 Chart 1 数据服务）测试：
 * - 版本时间线数据不变量（S 级实装节点齐全/有序、仪玄等关键角色节点正确）
 * - 基础金口径（限定 S 本体 + 限定音擎，常驻不计）
 * - 最优加金分配（预算钳制 / 单调不减 / 非限定槽位可换限定音擎）
 * - 队伍演变集成冒烟（候选池裁剪下：节点结构、成员实装 ≤ 节点、换人事件、现场恢复）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { isLimitedWEngine } from '@/composables/teamCompare'
import { setupHarness } from '@/test/harness'
import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf, nodesFrom, releaseNodeOf } from '@/data/versionTimeline'
import {
  SWAP_UPGRADE_UPLIFT_PCT,
  baseGoldOfTeam,
  classifySwapUplift,
  computeOptimalTeamAllocation,
  computeTeamTimeline,
  nextGoldCandidates,
} from '@/composables/teamTimeline'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'

const bossText = readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')
const bossData = JSON.parse(bossText) as BossPresetFile
const firstBoss = bossData.bosses[0]
const firstPhase = firstBoss.phases[0]

async function boot() {
  const h = await setupHarness([
    { agentId: '1371' },
    { agentId: '1311' },
    { agentId: '1071' },
  ])
  return h
}

describe('版本时间线数据不变量', () => {
  it('全部节点有序且 id 合法', () => {
    expect(VERSION_NODES.length).toBeGreaterThan(30)
    for (let i = 1; i < VERSION_NODES.length; i++) {
      expect(nodeIndexOf(VERSION_NODES[i].id)).toBe(i)
      expect(VERSION_NODES[i].date >= VERSION_NODES[i - 1].date).toBe(true)
    }
  })

  it('S 级实装节点：收录的角色都存在且不在「目录错标 S 的四星」清单里（潘引壶为用户口径特例）', async () => {
    const h = await boot()
    const catalog = useCatalogStore()
    // 历史 catalog 导入错标：妮可/苍角/露西 曾被标 S（已由 scripts/fix-agent-rarity.mjs 修为 A）。
    // 保留排除清单作为防御：即使 rarity 回归错标，时间线也不收录四星（限定金口径依赖 isLimitedAgent 的 rarity 判断）。
    // 唯一特例：潘引壶（1421，A 级）——贯穿拐演变路径必需，随仪玄 2.0-1 实装（用户口径）。
    const knownMislabeledA = new Set(['1031', '1131', '1151'])
    const ids = Object.keys(AGENT_RELEASE_NODE)
    for (const id of ids) {
      expect(catalog.getAgent(id), `目录缺角色 ${id}`).toBeDefined()
      expect(knownMislabeledA.has(id)).toBe(false)
      expect(releaseNodeOf(id)).toBeDefined()
    }
    // 每个目录 S 级角色（除错标四星）都应有实装节点 —— 防漏录
    const missing = catalog.displayAgents
      .filter(a => a.rarity === 'S')
      .filter(a => !knownMislabeledA.has(a.id))
      .filter(a => !releaseNodeOf(a.id))
      .map(a => a.id + a.name.zhCN)
    expect(missing).toEqual([])
    // 不收录四星（用户口径；潘引壶为唯一特例）
    for (const id of knownMislabeledA) expect(releaseNodeOf(id)).toBeNull()
    expect(releaseNodeOf('1421')).toBe('2.0-1') // 潘引壶（A 级特例）
  })

  it('仪玄及关键队友实装节点正确（用户口径：2.0上/2.0下/2.3卢/2.4琉/3.0诺）', () => {
    expect(releaseNodeOf('1371')).toBe('2.0-1') // 仪玄
    expect(releaseNodeOf('1391')).toBe('2.0-2') // 橘福福
    expect(releaseNodeOf('1451')).toBe('2.3-1') // 卢西娅
    expect(releaseNodeOf('1481')).toBe('2.4-1') // 琉音
    expect(releaseNodeOf('1571')).toBe('3.0-2') // 诺姆
    expect(nodesFrom('2.0-1').length).toBe(VERSION_NODES.length - nodeIndexOf('2.0-1'))
  })
})

describe('基础金与加金候选', () => {
  it('全限定 S 带专武 = 6 金；常驻 S 不计', async () => {
    await boot()
    const catalog = useCatalogStore()
    expect(baseGoldOfTeam(['1371', '1311', '1071'], catalog)).toBe(6) // 仪玄+耀嘉音+凯撒 全限定带专武
    expect(baseGoldOfTeam(['1371', '1021', '1311'], catalog)).toBe(4) // 猫又（常驻）本体/专武不计
  })

  it('加金候选：限定槽位出影画步，非限定槽位可出「换限定音擎」步', async () => {
    await boot()
    const catalog = useCatalogStore()
    const state = { cinemas: [0, 0, 0] as [number, number, number], wengineMods: [1, 1, 1] as [number, number, number], wEngines: ['', '', ''] as [string, string, string] }
    const cands = nextGoldCandidates(['1371', '1141', '1311'], state, catalog)
    expect(cands.some(c => c.kind === 'cinema')).toBe(true) // 限定槽位影画
    expect(cands.some(c => c.kind === 'wengine')).toBe(true) // 莱卡恩（常驻）槽位可换限定音擎
  })
})

describe('最优加金分配（computeOptimalTeamAllocation）', () => {
  it('预算低于基础金 → 钳制到基础金，0 步', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const alloc = computeOptimalTeamAllocation(calc, config, ['1371', '1311', '1071'], 3)
    expect(alloc.totalGold).toBe(6)
    expect(alloc.label).toContain('基础')
    expect(alloc.cinemas).toEqual([0, 0, 0])
    expect(alloc.wengineMods).toEqual([1, 1, 1])
  })

  // 贪婪求值逐金跑全管线，单跑 ~1.6s；全量并行负载下曾触顶 vitest 默认 5s（2026-08-23 观测）→ 显式放宽
  it('预算内逐金贪婪：总金数正确、伤害单调不减', { timeout: 30_000 }, async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const allocBase = computeOptimalTeamAllocation(calc, config, ['1371', '1311', '1071'], 6)
    const alloc8 = computeOptimalTeamAllocation(calc, config, ['1371', '1311', '1071'], 8)
    const alloc12 = computeOptimalTeamAllocation(calc, config, ['1371', '1311', '1071'], 12)
    expect(allocBase.totalGold).toBe(6)
    expect(alloc8.totalGold).toBe(8)
    expect(alloc12.totalGold).toBe(12)
    expect(alloc12.damage).toBeGreaterThanOrEqual(alloc8.damage)
    expect(alloc8.damage).toBeGreaterThanOrEqual(allocBase.damage)
    expect(alloc8.label).toContain('8金')
  })
})

describe('换人判定 classifySwapUplift（上位/平替单一事实源）', () => {
  it('提升 ≥ 阈值 → 上位；< 阈值 → 平替；prev≤0 防御性归平替', () => {
    expect(SWAP_UPGRADE_UPLIFT_PCT).toBe(10)
    expect(classifySwapUplift(100, 110)).toEqual({ kind: 'upgrade', pct: 10 }) // 恰好阈值
    expect(classifySwapUplift(100, 109.9)).toEqual({ kind: 'lateral', pct: 9.9 })
    expect(classifySwapUplift(100, 112.34)).toEqual({ kind: 'upgrade', pct: 12.3 }) // 1 位小数
    expect(classifySwapUplift(100, 100)).toEqual({ kind: 'lateral', pct: 0 })
    expect(classifySwapUplift(0, 999)).toEqual({ kind: 'lateral', pct: 0 })
    expect(classifySwapUplift(-1, 999)).toEqual({ kind: 'lateral', pct: 0 })
  })
})

describe('computeTeamTimeline 集成冒烟（候选池裁剪）', () => {
  it('节点结构 / 成员实装 ≤ 节点 / 换人事件 / 现场恢复', async () => {
    const h = await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const originalTeam = JSON.stringify(config.team)
    // 候选池：仪玄 + 其已知队友路线（耀嘉音/凯撒 → 橘福福 → 卢西娅 → 琉音 → 诺姆）+ 干扰项（朱鸢）
    const pool = ['1311', '1071', '1391', '1451', '1481', '1571', '1241']
    const res = await computeTeamTimeline(calc, {
      mainAgentId: '1371',
      boss: firstBoss as BossPreset,
      phase: firstPhase,
      budget: 6,
      candidatePool: pool,
    })
    // 节点数 = 主C实装节点起（默认剔除测试服占位节点）
    const expectedAxis = nodesFrom('2.0-1').filter(n => !(n.note ?? '').includes('测试服'))
    expect(res.nodes.length).toBe(expectedAxis.length)
    expect(res.nodes[0].nodeId).toBe('2.0-1')
    // 每节点成员实装 ≤ 该节点
    for (const n of res.nodes) {
      const at = nodeIndexOf(n.nodeId)
      for (const member of n.team) {
        expect(nodeIndexOf(releaseNodeOf(member)!)).toBeLessThanOrEqual(at)
      }
      expect(n.hpRatio).toBeGreaterThan(0)
      expect(n.totalGold).toBeGreaterThanOrEqual(6)
    }
    // 换人事件与节点队伍变化一致
    for (let i = 1; i < res.nodes.length; i++) {
      const prev = res.nodes[i - 1].team.join()
      const cur = res.nodes[i].team.join()
      if (prev !== cur) {
        expect(res.nodes[i].swappedIn).toBeDefined()
        expect(res.nodes[i].swappedOut).toBeDefined()
        expect(cur).toContain(res.nodes[i].swappedIn!)
        expect(prev).toContain(res.nodes[i].swappedOut!)
      } else {
        expect(res.nodes[i].swappedIn).toBeUndefined()
      }
    }
    // 无池内新角色实装的节点 → 队伍沿用上一节点
    for (let i = 1; i < res.nodes.length; i++) {
      const newHere = pool.filter(id => releaseNodeOf(id) === res.nodes[i].nodeId)
      if (newHere.length === 0) {
        expect(res.nodes[i].team).toEqual(res.nodes[i - 1].team)
      }
    }
    // 队伍结构约束（至多 1 击破）下的全对求值数
    const stunInPool = pool.filter(id => useCatalogStore().getAgent(id)?.specialty === 'stun').length
    const expectedPairs = pool.length * (pool.length - 1) / 2 - (stunInPool * (stunInPool - 1) / 2)
    expect(res.stats.teamsEvaluated).toBe(expectedPairs)
    // 换人判定自洽：有 swappedIn 必有 swapKind/swapUpliftPct 且与前后节点伤害一致；无换人则无判定字段
    for (let i = 0; i < res.nodes.length; i++) {
      const n = res.nodes[i]
      if (n.swappedIn) {
        expect(['upgrade', 'lateral']).toContain(n.swapKind)
        const expected = Math.round(((n.damage - res.nodes[i - 1].damage) / res.nodes[i - 1].damage) * 1000) / 10
        expect(n.swapUpliftPct).toBeCloseTo(expected, 6)
      } else {
        expect(n.swapKind).toBeUndefined()
        expect(n.swapUpliftPct).toBeUndefined()
      }
      // 实装未进队标注自洽：所列角色确实不在队伍里，且差距为负（平替/未上位）
      if (n.newAgentBench) {
        expect(n.newAgentBench.gapPct).toBeLessThan(0)
        expect(['lateral', 'worse']).toContain(n.newAgentBench.kind)
        for (const a of n.newAgentBench.agents) expect(n.team).not.toContain(a)
      }
    }
    // 换人事件与节点判定字段同步
    for (const ev of res.swapEvents) {
      const node = res.nodes.find(n => n.nodeId === ev.nodeId)!
      expect(ev.swappedIn).toBe(node.swappedIn)
      expect(ev.swapKind).toBe(node.swapKind)
      expect(ev.swapUpliftPct).toBe(node.swapUpliftPct)
    }
    // 多队并存强度种子：池内收敛组合全覆盖、起点在节点范围内、按伤害降序
    const seeds = res.strengthSeeds
    expect(seeds.length).toBeGreaterThan(0)
    const expectedPairKeys = new Set<string>()
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        expectedPairKeys.add(`1371,${[pool[i], pool[j]].sort().join(',')}`)
        expectedPairKeys.add(`1371,${pool[i]},${pool[j]}`)
        expectedPairKeys.add(`1371,${pool[j]},${pool[i]}`)
      }
    }
    for (const s of seeds) {
      expect(expectedPairKeys.has(s.key), `未知组合 ${s.key}`).toBe(true)
      expect(s.team[0]).toBe('1371')
      expect(s.startIndex).toBeGreaterThanOrEqual(0)
      expect(s.startIndex).toBeLessThan(res.nodes.length)
      expect(s.damage).toBeGreaterThan(0)
      expect(s.hpRatio).toBeGreaterThan(0)
      expect(s.shortLabel).toHaveLength(3)
    }
    for (let i = 1; i < seeds.length; i++) expect(seeds[i - 1].damage).toBeGreaterThanOrEqual(seeds[i].damage)
    // 现场恢复
    expect(JSON.stringify(config.team)).toBe(originalTeam)
  }, 120000)

  it('A 级特例潘引壶全链路：入队搜索、0 限定金（预算步数全给限定队友）、配装生效', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const originalTeam = JSON.stringify(config.team)
    // 池子只有凯撒 + 潘引壶（无排名敏感性）：仪玄+凯撒+潘引壶 基础金 = 仪(本体+专武)2 + 凯(本体+专武)2 + 潘(A级)0 = 4
    const pool = ['1071', '1421']
    const res = await computeTeamTimeline(calc, {
      mainAgentId: '1371',
      boss: firstBoss as BossPreset,
      phase: firstPhase,
      budget: 6,
      candidatePool: pool,
    })
    expect(res.nodes.length).toBeGreaterThan(0)
    const first = res.nodes[0]
    expect(first.team).toContain('1421')
    // 潘 0 命、不带限定音擎（A 级签名/同职业免费音擎）
    const panSlot = first.team.indexOf('1421')
    expect(first.state.cinemas[panSlot]).toBe(0)
    expect(isLimitedWEngine(first.state.wEngines[panSlot])).toBe(false)
    // 0 限定金口径：预算 6 = 基础 4 + 2 步全花在限定角色身上
    expect(first.totalGold).toBe(6)
    expect(first.goldLabel).toContain('6金')
    expect(JSON.stringify(config.team)).toBe(originalTeam)
  }, 120000)

  it('轻量默认档：不走最优加金（label 无「最优」、零贪婪求值），求值量级 = 池内组合数', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const originalTeam = JSON.stringify(config.team)
    const pool = ['1311', '1071', '1391'] // 3 候选 → C(3,2)=3 对
    const res = await computeTeamTimeline(calc, {
      mainAgentId: '1371',
      boss: firstBoss as BossPreset,
      phase: firstPhase,
      budget: 6,
      candidatePool: pool,
    })
    expect(res.stats.teamsEvaluated).toBe(3)
    expect(res.stats.goldEvaluations).toBe(0)
    for (const n of res.nodes) {
      expect(n.goldLabel).not.toContain('最优')
      expect(n.totalGold).toBeGreaterThanOrEqual(6)
      expect(n.damage).toBeGreaterThan(0)
    }
    expect(JSON.stringify(config.team)).toBe(originalTeam)
  }, 120000)

  it('全量档（autoBuild+optimalGold）：贪婪求值发生，预算花满到可达上限', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const originalTeam = JSON.stringify(config.team)
    const res = await computeTeamTimeline(calc, {
      mainAgentId: '1371',
      boss: firstBoss as BossPreset,
      phase: firstPhase,
      budget: 8,
      candidatePool: ['1311', '1071'],
      autoBuild: true,
      optimalGold: true,
    })
    expect(res.stats.goldEvaluations).toBeGreaterThan(0)
    expect(res.nodes.length).toBeGreaterThan(0)
    expect(res.nodes[0].totalGold).toBe(8) // 基础 6 + 2 步（影画候选充足）
    expect(res.nodes[0].damage).toBeGreaterThan(0)
    expect(JSON.stringify(config.team)).toBe(originalTeam)
  }, 120000)

  it('实装未进队判定：晚实装角色当期未进最优队 → 节点带 bench 标注（柚叶 2.1-1，实测差 12% 判未上位）', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const originalTeam = JSON.stringify(config.team)
    // 池子只有早期双队友 + 柚叶（2.1-1 实装）；柚叶打不过 仪玄+耀嘉音+凯撒 → bench
    const pool = ['1311', '1071', '1411']
    const res = await computeTeamTimeline(calc, {
      mainAgentId: '1371',
      boss: firstBoss as BossPreset,
      phase: firstPhase,
      budget: 6,
      candidatePool: pool,
    })
    const node = res.nodes.find(n => n.nodeId === '2.1-1')
    expect(node).toBeDefined()
    if (node!.team.includes('1411')) {
      // 打进最优队 → 不应有 bench 标注
      expect(node!.newAgentBench).toBeUndefined()
    } else {
      expect(node!.newAgentBench).toBeDefined()
      expect(node!.newAgentBench!.agents).toContain('1411')
      expect(node!.newAgentBench!.gapPct).toBeLessThan(0)
      expect(['lateral', 'worse']).toContain(node!.newAgentBench!.kind)
    }
    expect(JSON.stringify(config.team)).toBe(originalTeam)
  }, 120000)
})

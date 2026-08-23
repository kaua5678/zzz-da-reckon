/**
 * 队伍时间线（timeCharts 页数据服务）测试：
 * - 版本时间线数据不变量（S 级实装节点齐全/有序、仪玄等关键角色节点正确）
 * - 基础金口径（限定 S 本体 + 限定音擎，常驻不计）
 * - 最优加金分配（预算钳制 / 单调不减 / 非限定槽位可换限定音擎）
 * - 队伍演变集成冒烟（候选池裁剪下：节点结构、成员实装 ≤ 节点、换人事件、现场恢复）
 * - Chart 3：每期新角色 · 强队强度（行清单 / preset 预填 / 引擎建议 / 逐队配装求值）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { isLimitedWEngine, STANDARD_S_AGENT_IDS } from '@/composables/teamCompare'
import { setupHarness } from '@/test/harness'
import { AGENT_RELEASE_NODE, VERSION_NODES, nodeIndexOf, nodesFrom, releaseNodeOf } from '@/data/versionTimeline'
import {
  SWAP_UPGRADE_UPLIFT_PCT,
  baseGoldOfTeam,
  buildNewCharacterRows,
  classifySwapUplift,
  computeFilmSimulation,
  computeNewCharacterPoints,
  computeOptimalTeamAllocation,
  computeTeamTimeline,
  nextGoldCandidates,
  prefillStrongTeamsFromPresets,
} from '@/composables/teamTimeline'
import { teamPresets } from '@/data/teamPresets'
import { STRONG_TEAM_PRESETS } from '@/data/strongTeamPresets'
import { allocateTopUpFilm } from '@/data/filmEconomy'
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

// ========== Chart 3：每期新角色 · 强队强度 ==========

describe('Chart 3：每期新角色强队（buildNewCharacterRows / suggest / computeNewCharacterPoints / 预填）', () => {
  it('行清单：覆盖全部非 1.0 常驻 S 的收录角色（潘引壶特例含），每行实装节点 = 所在节点，测试服行带 note', () => {
    const rows = buildNewCharacterRows()
    const rowChars = new Set(rows.map(r => r.charId))
    // 覆盖 AGENT_RELEASE_NODE 中除 1.0 常驻 S 外的全部角色（常驻 S 不是当期新角色，用户口径）
    for (const id of Object.keys(AGENT_RELEASE_NODE)) {
      if (STANDARD_S_AGENT_IDS.has(id)) {
        expect(rowChars.has(id), `${id} 常驻 S 不应占行`).toBe(false)
      } else {
        expect(rowChars.has(id), `缺 ${id}`).toBe(true)
      }
    }
    // 每行归属其实装节点；行序 = 节点序
    for (const row of rows) {
      expect(releaseNodeOf(row.charId)).toBe(row.nodeId)
    }
    for (let i = 1; i < rows.length; i++) {
      expect(nodeIndexOf(rows[i].nodeId)).toBeGreaterThanOrEqual(nodeIndexOf(rows[i - 1].nodeId))
    }
    const testRow = rows.find(r => r.nodeId === '3.2-1')
    expect(testRow?.nodeNote).toBeDefined()
  })

  it('预填：用户口述预设优先，仓库 preset 补剩余（仪玄 = 仪青潘）', () => {
    const prefill = prefillStrongTeamsFromPresets()
    expect(prefill['1371']).toBeDefined()
    expect(new Set(prefill['1371']).size).toBe(3)
    expect(prefill['1371'][0]).toBe('1371')
    // 口述优先：仪玄 = 仪青潘（STRONG_TEAM_PRESETS），而非仓库 preset 的青衣/卢西娅变体
    expect(prefill['1371']).toEqual(STRONG_TEAM_PRESETS['1371'])
    // 仓库 preset 仍有（作为其他角色预填来源）
    expect(teamPresets.some(p => p.team[0] === '1371')).toBe(true)
  })

  it('口述强队清单（STRONG_TEAM_PRESETS）：18 队、每队 3 名不同角色且都在目录、键 = 当期新 S 角色', async () => {
    await boot()
    const catalog = useCatalogStore()
    const entries = Object.entries(STRONG_TEAM_PRESETS)
    expect(entries.length).toBe(18)
    for (const [charId, team] of entries) {
      // 键必须是 Chart 3 行（AGENT_RELEASE_NODE 收录）
      expect(releaseNodeOf(charId), `键 ${charId} 无实装节点`).not.toBeNull()
      // 队内 3 名不同角色且 catalog 都存在
      expect(new Set(team).size, `${charId} 队伍有重复成员`).toBe(3)
      for (const id of team) {
        expect(catalog.getAgent(id), `${charId} 队友 ${id} 不在目录`).toBeDefined()
      }
    }
    // 抽查关键口述队
    expect(STRONG_TEAM_PRESETS['1371']).toEqual(['1371', '1251', '1421']) // 2.0 仪青潘
    expect(STRONG_TEAM_PRESETS['1391']).toEqual(['1371', '1391', '1421']) // 下半 仪橘潘
    expect(STRONG_TEAM_PRESETS['1481']).toEqual(['1371', '1481', '1451']) // 2.4 琉音卡池 仪琉卢
    expect(STRONG_TEAM_PRESETS['1591']).toEqual(['1591', '1571', '1211']) // 希格莉德 诺姆丽娜
  })

  it('computeNewCharacterPoints：同角色多队各出一点；无效队（重复成员）跳过；现场恢复', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const originalTeam = JSON.stringify(config.team)
    const rows = [
      { nodeId: '2.0-1', nodeLabel: '2.0 上半', charId: '1371' },
      { nodeId: '1.4', nodeLabel: '1.4 合并', charId: '1091' },
      { nodeId: '2.3-1', nodeLabel: '2.3 上半', charId: '1451' },
    ]
    const teams: Record<string, [string, string, string][]> = {
      '1371': [
        ['1371', '1451', '1481'], // 仪玄+卢西娅+琉音（第 1 队）
        ['1371', '1251', '1421'], // 仪玄+青衣+潘引壶（第 2 队，同时间点多队展示）
      ],
      '1091': [['1091', '1141', '1131']], // 星见雅+莱卡恩+苍角
      '1451': [['1451', '1451', '1481']], // 重复成员 → 应跳过
    }
    const points = await computeNewCharacterPoints(calc, {
      rows,
      teams,
      boss: firstBoss as BossPreset,
      phase: firstPhase,
      budget: 6,
    })
    expect(points.length).toBe(3) // 仪玄 2 点 + 星见雅 1 点
    for (const p of points) {
      expect(p.hpRatio).toBeGreaterThan(0)
      expect(p.goldLabel).toContain('金')
    }
    const yixuanPts = points.filter(p => p.charId === '1371')
    expect(yixuanPts.length).toBe(2)
    expect(yixuanPts.map(p => p.teamIndex).sort()).toEqual([0, 1])
    expect(points.find(p => p.charId === '1451')).toBeUndefined()
    expect(JSON.stringify(config.team)).toBe(originalTeam)
  }, 120000)

  it('行清单排除 1.0 常驻 S（猫又/11号/珂蕾妲/莱卡恩/格莉丝/丽娜 无行），潘引壶特例保留', () => {
    const rows = buildNewCharacterRows()
    const rowChars = new Set(rows.map(r => r.charId))
    for (const std of ['1021', '1041', '1101', '1141', '1181', '1211']) {
      expect(rowChars.has(std), `${std} 常驻 S 不应占行`).toBe(false)
    }
    expect(rowChars.has('1191')).toBe(true) // 艾莲（1.0 限定期）
    expect(rowChars.has('1241')).toBe(true) // 朱鸢（1.0 下半）
    expect(rowChars.has('1421')).toBe(true) // 潘引壶（A 级特例）
  })
})

// ========== Chart 4：菲林经济模拟 ==========

describe('Chart 4：菲林经济模拟（computeFilmSimulation / 预算性价比）', () => {
  const axisOf = (boss: BossPreset) => {
    const phases = [...boss.phases].filter(p => p.begin).sort((a, b) => a.begin.localeCompare(b.begin))
    return phases.map((p, i) => ({ id: p.phaseId, label: `${i + 1}`, date: p.begin }))
  }
  const baseSim = {
    boss: firstBoss as BossPreset,
    axisNodes: [] as { id: string; label: string; date: string }[],
    periodViews: [] as never[],
    mainAgentId: '1371',
    // 用户口径候选池：青衣/潘引壶/橘福福/卢西娅/琉音（琉音换青衣、卢西娅换潘引壶）
    candidatePool: ['1251', '1421', '1391', '1451', '1481'],
    initialGold: 0,
    filmPerVersion: 15000,
    spendRatio: 0.8,
    budgetYuanPerVersion: 0,
  }

  it('prefill 空（主C 首次 UP 前无该 Boss 期）→ 0 点；起点 = 主C 首次 UP 之后', async () => {
    await boot()
    const calc = useResourceCalc()
    // 主C = 希格莉德（3.1-2，2026-08-19 实装）→ 恶名·死路屠夫 3.1 期之后的登场期才能算
    const bossWithLateMain = firstBoss as BossPreset
    const axis = axisOf(bossWithLateMain)
    const res = await computeFilmSimulation(calc, { ...baseSim, mainAgentId: '1591', axisNodes: axis })
    expect(res.points.length).toBeGreaterThan(0)
    for (const p of res.points) {
      // 每期都在主C 实装日之后
      expect(p.date.slice(0, 10) >= '2026-08-19').toBe(true)
    }
  }, 120000)

  it('主C 固定 + 队友随金数换最优：金数增长后队伍从 仪青潘 升级为更强组合（琉音/卢西娅换入）', async () => {
    await boot()
    const calc = useResourceCalc()
    const boss = firstBoss as BossPreset
    const axis = axisOf(boss)
    // 占比 1 + 高版本投入 + 目标期清空 → 金数拉满，必然发生换队
    const res = await computeFilmSimulation(calc, {
      ...baseSim,
      axisNodes: axis,
      initialGold: 4,
      spendRatio: 1,
      budgetYuanPerVersion: 68,
      targetPeriodId: axis[Math.floor(axis.length / 2)]?.id,
    })
    expect(res.points.length).toBeGreaterThan(0)
    const first = res.points[0]
    const last = res.points[res.points.length - 1]
    expect(first.team[0]).toBe('1371') // 主C 恒为仪玄
    expect(last.team[0]).toBe('1371')
    // 金数更高时若换了队，队伍不再是最便宜的 仪青潘（琉音/卢西娅 ≥2 金一名）
    if (last.totalGold > first.totalGold) {
      expect(last.team.join()).not.toBe(first.team.join())
      expect(last.team.includes('1481') || last.team.includes('1451')).toBe(true)
    }
    // 每点队伍主C 固定 + 基础金 ≤ 当前金数
    for (const p of res.points) {
      expect(p.team[0]).toBe('1371')
      expect(baseGoldOfTeam(p.team, useCatalogStore())).toBeLessThanOrEqual(p.totalGold)
      expect(p.hpRatio).toBeGreaterThan(0)
    }
  }, 240000)

  it('充值预算按性价比分配（allocateTopUpFilm）：月卡优先（110/元）→ 大月卡 → 直充', () => {
    expect(allocateTopUpFilm(0)).toBe(0)
    expect(allocateTopUpFilm(30)).toBe(3300)              // 1 月卡
    expect(allocateTopUpFilm(60)).toBe(6600)              // 2 月卡（封顶，覆盖全版本）
    expect(allocateTopUpFilm(98)).toBe(6600 + (98 - 60) * 10) // 2 月卡 ＞ 1 月卡+大月卡（贪心正确）
    expect(allocateTopUpFilm(128)).toBe(6600 + 2600)      // 2 月卡 + 大月卡（60+68）
    expect(allocateTopUpFilm(100)).toBe(6600 + (100 - 60) * 10) // 2 月卡 + 40 元直充
  })

  it('经济：占比 0 全存金数不变；占比 1 全花金数单调增长；现场恢复', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const originalTeam = JSON.stringify(config.team)
    const boss = firstBoss as BossPreset
    const axis = axisOf(boss)

    const save0 = await computeFilmSimulation(calc, { ...baseSim, axisNodes: axis, spendRatio: 0 })
    expect(save0.points.length).toBeGreaterThan(0)
    const g0 = save0.points[0].totalGold
    for (const p of save0.points) expect(p.totalGold).toBe(g0) // 全存 → 金数恒定

    const spend1 = await computeFilmSimulation(calc, { ...baseSim, axisNodes: axis, spendRatio: 1 })
    for (let i = 1; i < spend1.points.length; i++) {
      expect(spend1.points[i].totalGold).toBeGreaterThanOrEqual(spend1.points[i - 1].totalGold)
    }
    expect(spend1.points[spend1.points.length - 1].totalGold).toBeGreaterThanOrEqual(spend1.points[0].totalGold)
    expect(JSON.stringify(config.team)).toBe(originalTeam)
  }, 240000)
})


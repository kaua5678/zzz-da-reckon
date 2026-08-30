import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  applyAxisBinding,
  applyGoldSteps,
  baseGoldOf,
  buildGoldStepsFromConfig,
  computeAutoEnginePicks,
  DEFAULT_AUTO_ENGINE_POOL,
  computeDifficulty,
  computeOptimalGoldAllocations,
  computeTeamComparePoints,
  isLimitedAgent,
  isLimitedWEngine,
  resolveBuffEffect,
  resolveGoldLevel,
  teamGoldOf,
} from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase, PhaseBuffCard } from '@/types/bossPreset'
import type { GoldStep, TeamPreset } from '@/types/teamPreset'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

const TEST_PRESET: TeamPreset = {
  id: 'test-team',
  name: '测试队',
  team: ['1561', '1261', '1411'],
  goldSteps: [
    { label: '主C 1命', slot: 0, kind: 'cinema', value: 1 },
    { label: '主C 2命', slot: 0, kind: 'cinema', value: 2 },
    { label: '异常位 1命', slot: 1, kind: 'cinema', value: 1 },
  ],
  interactions: [
    { type: 'parry', count: 8 },
    { type: 'dodge', count: 4 },
    { type: 'quickAssist', count: 3 },
    { type: 'banyueGoldenParry', count: 5, weight: 1.5, label: '般岳金身弹刀' },
  ],
}

const res20 = { physical: 20, fire: 20, ice: 20, electric: 20, ether: 20, wind: 20 }
const FAKE_BOSS: BossPreset = {
  id: '40009',
  name: '异构·基塔布鲁',
  nameEn: 'Integrated - Girtablullu',
  aliases: [],
  icon: null,
  iconSource: null,
  isCriticalAssault: true,
  monster: { stunVuln: 1.5, stunTime: 12, name: '异构·基塔布鲁' },
  defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
  phases: [],
}
const FAKE_PHASE: BossPresetPhase = {
  phaseId: '690461',
  zoneKey: '69046201',
  version: '3.2',
  label: '3.2 · 2026-07-30',
  begin: '2026-07-30 04:00:00',
  modeType: 'critical_assault',
  stageName: '异构·基塔布鲁',
  stageNum: 1,
  level: 70,
  hp: 31900305,
  stunValue: 18933.95,
  defense: 953,
  bossAnomalyCoeff: 1.1,
  damageResistances: { ...res20 },
  stunResistances: { ...res20 },
  anomalyResistances: { ...res20 },
  weakness: [],
  resistance: [],
}

describe('teamCompare 金数/难度口径', () => {
  it('金数 = 总限定金（目标值钳制到队伍档位）；标准Steps 不占金', () => {
    // 无专武：baseGold = 3（3 限定角色本体）；目标 0 金 < 最低 → 钳制到 3 金（0 步）
    const g0 = applyGoldSteps(TEST_PRESET.goldSteps, 0, 3)
    expect(g0.cinemas).toEqual([0, 0, 0])
    expect(g0.wengineMods).toEqual([1, 1, 1])
    expect(g0.totalGold).toBe(3)
    expect(g0.label).toContain('3金')

    // 全队带专武：baseGold = 6；目标 6 金 → 0 步
    const g6 = applyGoldSteps(TEST_PRESET.goldSteps, 6, 6)
    expect(g6.totalGold).toBe(6)
    expect(g6.label).toContain('6金')

    // 目标 8 金 = baseGold 6 + 2 步（主C 1命→2命）
    const g8 = applyGoldSteps(TEST_PRESET.goldSteps, 8, 6)
    expect(g8.cinemas).toEqual([2, 0, 0])
    expect(g8.totalGold).toBe(8)
    expect(g8.label).toContain('8金')
  })

  it('钳制：选择大于预设最高 → 取最高（全部步数）；小于预设最低 → 取最低（0 步）', () => {
    // 目标 20 金 > 6 + 3 步 = 9 → 钳制到 9，应用全部 3 步
    const high = applyGoldSteps(TEST_PRESET.goldSteps, 20, 6)
    expect(high.totalGold).toBe(9)
    expect(high.cinemas).toEqual([2, 1, 0])
    expect(high.label).toContain('钳制')
    expect(resolveGoldLevel(TEST_PRESET.goldSteps, 20, 6)).toEqual({ totalGold: 9, stepsApplied: 3 })
    // 目标 2 金 < 6 → 钳制到 6，0 步
    const low = applyGoldSteps(TEST_PRESET.goldSteps, 2, 6)
    expect(low.totalGold).toBe(6)
    expect(low.cinemas).toEqual([0, 0, 0])
    expect(resolveGoldLevel(TEST_PRESET.goldSteps, 2, 6)).toEqual({ totalGold: 6, stepsApplied: 0 })
  })

  it('standardSteps：全量应用、不占限定金，label 带常驻明细', () => {
    const std: TeamPreset = {
      ...TEST_PRESET,
      standardSteps: [
        { label: '莱卡恩 1命', slot: 1, kind: 'cinema', value: 1 },
        { label: '莱卡恩 专武精炼2', slot: 1, kind: 'wengine', value: 2 },
      ],
    }
    const r = applyGoldSteps(std.goldSteps, 6, 6, std.standardSteps)
    expect(r.totalGold).toBe(6) // 常驻不占限定金
    expect(r.cinemas).toEqual([0, 1, 0])
    expect(r.wengineMods).toEqual([1, 2, 1])
    expect(r.standardLabel).toContain('莱卡恩 1命')
    expect(r.standardLabel).toContain('莱卡恩 专武精炼2')
  })

  it('常驻 S 角色/音擎不计限定金（莱卡恩本体+拘缚者 = 0 金）', async () => {
    const catalog = useCatalogStore()
    await catalog.load() // 稀有度断言须走真实 catalog（历史导入曾把 A 级错标 S）
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    expect(isLimitedAgent('1141')).toBe(false) // 莱卡恩 = 常驻 S
    expect(isLimitedAgent('1051')).toBe(true) // 伊德海莉 = 限定
    // A 级角色不计限定金（妮可/苍角/露西/潘引壶曾被导入脚本错标 S，已修复——防回归）
    expect(isLimitedAgent('1031')).toBe(false) // 妮可
    expect(isLimitedAgent('1131')).toBe(false) // 苍角
    expect(isLimitedAgent('1151')).toBe(false) // 露西
    expect(isLimitedAgent('1421')).toBe(false) // 潘引壶
    expect(isLimitedWEngine('14114')).toBe(false) // 拘缚者（莱卡恩专武）
    expect(isLimitedWEngine('14110')).toBe(false) // 燃狱齿轮（珂蕾妲专武，常驻）
    expect(isLimitedWEngine('14121')).toBe(false) // 啜泣摇篮（丽娜专武，常驻）
    expect(isLimitedWEngine('13019')).toBe(false) // 青漪灵鼎 = A 级音擎
    expect(isLimitedWEngine('14116')).toBe(true) // 焰心桂冠（莱特专武，限定）
    expect(isLimitedWEngine('14105')).toBe(true) // 海妖摇篮（伊德海莉专武）
    const preset: TeamPreset = { ...TEST_PRESET, team: ['1051', '1141', '1451'], wEngines: ['14105', '14114', '14145'] }
    expect(baseGoldOf(preset)).toBe(4) // 伊(1+1) + 莱卡恩(0+0) + 卢(1+1)
  })

  it('baseGoldOf：3 限定角色本体 + 限定专武数', () => {
    expect(baseGoldOf(TEST_PRESET)).toBe(3)
    expect(baseGoldOf({ ...TEST_PRESET, wEngines: ['14105', '', '14145'] })).toBe(5)
  })

  it('teamGoldOf：当前队伍配置 → 总限定金（本体+影画/精炼每级，常驻不计）', () => {
    // 伊德海莉+莱卡恩+卢西娅 全带专武：伊(1+1) + 莱(0+0) + 卢(1+1) = 4 基础
    const ids = ['1051', '1141', '1451']
    const wids = ['14105', '14114', '14145']
    // 0命1精 → 4 金
    expect(teamGoldOf(ids, wids, [0, 0, 0], [1, 1, 1])).toBe(4)
    // 212121 → 4 + (2+0+2) = 8
    expect(teamGoldOf(ids, wids, [2, 2, 2], [1, 1, 1])).toBe(8)
    // 莱卡恩影画/精炼不计（常驻）：影画 6/6/2 + 精炼 1/5/1 → 4 + (6+0+2) + 0 = 12
    expect(teamGoldOf(ids, wids, [6, 6, 2], [1, 5, 1])).toBe(12)
    // 空槽位/无常驻音擎不额外计
    expect(teamGoldOf(['1051', '', ''], ['14105', '', ''], [0, 0, 0], [1, 1, 1])).toBe(2)
  })

  it('buildGoldStepsFromConfig：限定进 goldSteps、常驻/A级进 standardSteps，按槽位展开且口径自洽', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    // 伊德海莉(限定)+莱卡恩(常驻)+卢西娅(限定)，影画 2/1/0、精炼 1/2/1
    const r = buildGoldStepsFromConfig(
      [
        { agentId: '1051', wEngineId: '14105' },
        { agentId: '1141', wEngineId: '14114' },
        { agentId: '1451', wEngineId: '14145' },
      ],
      [2, 1, 0],
      [1, 2, 1],
      ['14105', '14114', '14145'],
    )
    // 限定（伊德海莉影画 1/2命）进 goldSteps；常驻（莱卡恩 1命 + 拘缚者精炼2）进 standardSteps
    expect(r.goldSteps.map(s => `${s.kind}:${s.slot}:${s.value}`)).toEqual(['cinema:0:1', 'cinema:0:2'])
    expect(r.standardSteps.map(s => `${s.kind}:${s.slot}:${s.value}`)).toEqual(['cinema:1:1', 'wengine:1:2'])
    expect(r.goldSteps[0].label).toContain('伊德海莉 1命')
    expect(r.standardSteps[0].label).toContain('莱卡恩 1命')
    // 口径自洽：全部应用后 = 目标命座/精炼，且总限定金 = teamGoldOf
    const base = baseGoldOf({ id: 't', name: 't', team: ['1051', '1141', '1451'], wEngines: ['14105', '14114', '14145'], goldSteps: [], interactions: [] })
    expect(base).toBe(4)
    const g = applyGoldSteps(r.goldSteps, 99, base, r.standardSteps)
    expect(g.cinemas).toEqual([2, 1, 0])
    expect(g.wengineMods).toEqual([1, 2, 1])
    expect(g.totalGold).toBe(6)
    expect(teamGoldOf(['1051', '1141', '1451'], ['14105', '14114', '14145'], [2, 1, 0], [1, 2, 1])).toBe(6)
  })

  it('buildGoldStepsFromConfig：空槽位跳过、无音擎不写精炼步、A级角色进 standardSteps', () => {
    const r = buildGoldStepsFromConfig(
      [
        { agentId: '1051', wEngineId: '' },
        { agentId: '', wEngineId: '' },
        { agentId: '1181', wEngineId: '14118' }, // 格莉丝 = 常驻 S
      ],
      [3, 6, 2],
      [4, 5, 1],
    )
    // 槽位0：限定角色影画 1..3 进 goldSteps，无音擎 → 不写精炼步
    expect(r.goldSteps.map(s => `${s.kind}:${s.slot}:${s.value}`)).toEqual(['cinema:0:1', 'cinema:0:2', 'cinema:0:3'])
    // 槽位1 空 → 跳过；槽位2 常驻 → standardSteps
    expect(r.standardSteps.map(s => `${s.kind}:${s.slot}:${s.value}`)).toEqual(['cinema:2:1', 'cinema:2:2'])
  })

  it('applyGoldSteps：常驻音擎精炼不残留到获取步换上的限定专武（换装即回精炼1）', () => {
    const stdRefine: GoldStep[] = [{ label: '莱卡恩 拘缚者精炼2', slot: 1, kind: 'wengine', value: 2 }]
    // 莱卡恩槽位：standardSteps 给拘缚者精炼2，goldSteps 同槽位买焰心桂冠（本体）→ 精炼应回到 1
    const r = applyGoldSteps(
      [{ label: '莱卡恩 换焰心桂冠（本体）', slot: 1, kind: 'wengine', value: 1, wEngineId: '14116' }],
      5, // 目标金 = 基础4 + 1 步（买专武）
      4,
      stdRefine,
      ['14105', '14114', '14145'],
    )
    expect(r.totalGold).toBe(5)
    expect(r.wEngines[1]).toBe('14116')
    expect(r.wengineMods).toEqual([1, 1, 1]) // 回归：曾是 [1,2,1]（旧拘缚者精炼残留到新专武）
    // 对照：同槽位无获取步时，常驻精炼照常生效（既有口径不变）
    const r2 = applyGoldSteps([], 4, 4, stdRefine, ['14105', '14114', '14145'])
    expect(r2.wEngines[1]).toBe('14114')
    expect(r2.wengineMods).toEqual([1, 2, 1])
  })

  it('buildGoldStepsFromConfig：传 baseWEngineIds 后，基础音擎本就是限定专武时不重复写「本体」步（修复：保存预设时不会把 yidhari 队基础专武 14105 误判成升级步抬高基础金）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    // 当前配置 = 预设基础音擎（伊德海莉专武 14105 / 莱卡恩专武 14114 / 卢西娅专武 14145），无精炼
    const base = ['14105', '14114', '14145']
    const r = buildGoldStepsFromConfig(
      [
        { agentId: '1051', wEngineId: '14105' },
        { agentId: '1141', wEngineId: '14114' },
        { agentId: '1451', wEngineId: '14145' },
      ],
      [0, 0, 0],
      [1, 1, 1],
      base,
    )
    // 基础音擎已含专武本体 → 不应出现任何「本体（1金）」步
    expect(r.goldSteps).toEqual([])
    expect(r.standardSteps).toEqual([])

    // 真实升级：换成与基础不同的限定专武 → 写「本体」步（1 金）
    const up = buildGoldStepsFromConfig(
      [
        { agentId: '1051', wEngineId: '14116' }, // 焰心桂冠（莱特专武，限定，≠ 基础 14105）
        { agentId: '1141', wEngineId: '14114' },
        { agentId: '1451', wEngineId: '14145' },
      ],
      [0, 0, 0],
      [1, 1, 1],
      base,
    )
    expect(up.goldSteps.some(s => s.kind === 'wengine' && s.wEngineId === '14116')).toBe(true)
  })

  it('星徽·比利队预设：基础 3 金（3 限定角色本体、基础音擎常驻/A 不计金），4 金起逐步买专武', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const preset = teamPresets.find(p => p.id === 'billy-norma-lucia')
    expect(preset).toBeDefined()
    const p = preset!
    // 基础音擎 = 青漪灵鼎 13019(A) / 燃狱齿轮 14110(常驻S) / 啜泣摇篮 14121(常驻S)，均不计金
    expect(p.wEngines).toEqual(['13019', '14110', '14121'])
    expect(baseGoldOf(p)).toBe(3)
    // 4 金 = 3 基础 + 1 步（首项 = 比利专武本体 14153，限定），影画全 0
    const g4 = applyGoldSteps(p.goldSteps, 4, 3, p.standardSteps ?? [], p.wEngines ?? [])
    expect(g4.totalGold).toBe(4)
    expect(g4.cinemas).toEqual([0, 0, 0])
    expect(isLimitedWEngine(g4.wEngines[0])).toBe(true)
    // 6 金 = 3 基础 + 3 步（前 3 步都是专武本体：比利/卢西娅/诺姆），全队带专武、影画仍全 0
    const g6 = applyGoldSteps(p.goldSteps, 6, 3, p.standardSteps ?? [], p.wEngines ?? [])
    expect(g6.totalGold).toBe(6)
    expect(g6.cinemas).toEqual([0, 0, 0])
    expect(g6.wengineMods).toEqual([1, 1, 1])
    expect(g6.wEngines).toEqual(['14153', '14157', '14145'])
  })

  it('莱卡恩队预设：基础 4 金，6 金 = 章鱼1命 + 卢西娅1命（影画 1/0/1）', () => {
    const preset = teamPresets.find(p => p.id === 'yidhari-lycaon-lucia')
    expect(preset).toBeDefined()
    const p = preset!
    expect(baseGoldOf(p)).toBe(4)
    const r = applyGoldSteps(p.goldSteps, 6, 4, p.standardSteps)
    expect(r.totalGold).toBe(6)
    expect(r.cinemas).toEqual([1, 0, 1])
    expect(r.wengineMods).toEqual([1, 1, 1])
    expect(r.label).toContain('伊德海莉 1命')
    expect(r.label).toContain('卢西娅 1命')
  })

  it('伊德海莉限定队预设：全带限定专武 = 6 金基础（回归：若音擎漂移成常驻会使基础金变 4，8 金被展开成 4 步而出现 320101/050101 这类按专武口径像 10 金的配置）', () => {
    const liuyin = teamPresets.find(p => p.id === 'yidhari-liuyin-lucia')
    const norma = teamPresets.find(p => p.id === 'yidhari-norma-lucia')
    expect(liuyin).toBeDefined()
    expect(norma).toBeDefined()
    // 音擎须为各自限定专武（琉音=昨夜来电 14148 / 诺姆=首席跟班 14157 / 卢西娅=铸梦炉歌 14145）
    expect(liuyin!.wEngines).toEqual(['14105', '14148', '14145'])
    expect(norma!.wEngines).toEqual(['14105', '14157', '14145'])
    // 3 限定角色 + 3 限定专武 = 6 金基础（常驻音擎/角色不计金）
    expect(baseGoldOf(liuyin!)).toBe(6)
    expect(baseGoldOf(norma!)).toBe(6)
    // 8 金 = 6 基础 + 2 步（伊德海莉 1命 + 卢西娅 1命），影画 1/0/1、精炼全 1
    const r = applyGoldSteps(liuyin!.goldSteps, 8, 6, liuyin!.standardSteps ?? [])
    expect(r.totalGold).toBe(8)
    expect(r.cinemas).toEqual([1, 0, 1])
    expect(r.wengineMods).toEqual([1, 1, 1])
  })

  it('难度 = Σ(count × weight)，条目 weight 覆盖类型权重', () => {
    const { difficulty, detail } = computeDifficulty(TEST_PRESET.interactions)
    // 8×1.0 + 4×1.2 + 3×0.6 + 5×1.5 = 8 + 4.8 + 1.8 + 7.5 = 22.1
    expect(difficulty).toBeCloseTo(22.1, 2)
    expect(detail).toContain('弹刀8×1')
    expect(detail).toContain('般岳金身弹刀5×1.5')
    expect(detail).not.toContain('banyueGoldenParry')
  })

  it('interactions：tauntCancel 映射到 setTauntCancelCount（般岳后摇取消），weight 0 不计难度', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '', cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} }, parryCount: 0, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1 }
    config.team[1] = { ...config.team[0], slot: 1 }
    config.team[2] = { ...config.team[0], slot: 2 }
    const calc = useResourceCalc()
    const spy = vi.spyOn(config, 'setTauntCancelCount')
    const preset: TeamPreset = {
      id: 'taunt-test',
      name: '嘲讽测试队',
      team: TEST_PRESET.team,
      goldSteps: [],
      interactions: [
        { type: 'parry', count: 8 },
        { type: 'tauntCancel', count: 3, slot: 2 },
      ],
    }
    computeTeamComparePoints(calc, {
      presets: [preset],
      goldLevels: [0],
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
    })
    // 每次嘲讽取消一次失衡外连段末尾后摇 → 写入槽位 2
    expect(spy).toHaveBeenCalledWith(2, 3)
    // tauntCancel weight 0 → 不计难度（只有弹刀 8×1.0）
    const { difficulty, detail } = computeDifficulty(preset.interactions, preset.team)
    expect(difficulty).toBeCloseTo(8, 2)
    expect(detail).not.toContain('嘲讽')
    spy.mockRestore()
  })
})

describe('teamCompare 最优加金（≤12金贪婪）', () => {
  it('逐金选边际提升最大的可用步骤，预算精确、伤害单调不减、封顶 12 金', () => {
    const config = useConfigStore()
    // 队伍槽位（算法只用 agentId/wEngineId 判定限定；配合下方假伤害公式）
    config.team[0].agentId = '1051'; config.team[0].wEngineId = '14105' // 伊德海莉（限定）
    config.team[1].agentId = '1141'; config.team[1].wEngineId = '14114' // 莱卡恩（常驻）
    config.team[2].agentId = '1451'; config.team[2].wEngineId = '14145' // 卢西娅（限定）
    const preset: TeamPreset = {
      id: 'greedy-test', name: '贪婪测试',
      team: ['1051', '1141', '1451'],
      wEngines: ['14105', '14114', '14145'],
      goldSteps: [
        { label: '伊德海莉 1命', slot: 0, kind: 'cinema', value: 1 },
        { label: '伊德海莉 2命', slot: 0, kind: 'cinema', value: 2 },
        { label: '伊德海莉 3命', slot: 0, kind: 'cinema', value: 3 },
        { label: '卢西娅 1命', slot: 2, kind: 'cinema', value: 1 },
        { label: '卢西娅 2命', slot: 2, kind: 'cinema', value: 2 },
        { label: '伊德海莉 专武精炼2', slot: 0, kind: 'wengine', value: 2 },
      ],
      interactions: [],
    }
    // 假伤害：伊德海莉影画边际 50 > 卢西娅影画 49 > 伊德海莉精炼 10
    const calc = {
      teamTotalDamage: computed(() => {
        const c = config.team
        const c0 = c[0].agentId === '1051' ? c[0].cinemaLevel : 0
        const c2 = c[2].agentId === '1451' ? c[2].cinemaLevel : 0
        const m0 = c[0].agentId === '1051' ? c[0].wEngineModLevel : 1
        return 100 + 50 * c0 + 49 * c2 + 10 * (m0 - 1)
      }),
    } as unknown as ReturnType<typeof useResourceCalc>

    const base = baseGoldOf(preset) // 4 = 伊/卢 本体+专武，莱卡恩不计
    expect(base).toBe(4)
    const allocs = computeOptimalGoldAllocations(calc, config, preset, base)
    // 覆盖 base..base+6 步（6 个可用步骤后无候选，低于 12 金封顶）
    expect(allocs.map(a => a.totalGold)).toEqual([4, 5, 6, 7, 8, 9, 10])
    // 贪婪顺序 = 边际从大到小：伊1命 → 伊2命 → 伊3命 → 卢1命 → 卢2命 → 伊精炼2
    expect(allocs[1].label).toContain('伊德海莉 1命')
    expect(allocs[2].label).toContain('伊德海莉 2命')
    expect(allocs[3].label).toContain('伊德海莉 3命')
    expect(allocs[4].label).toContain('卢西娅 1命')
    expect(allocs[5].label).toContain('卢西娅 2命')
    expect(allocs[6].label).toContain('伊德海莉 专武精炼2')
    // 伤害单调不减 + 每档总金 = 基础 + 步数
    for (let i = 1; i < allocs.length; i++) {
      expect(allocs[i].damage).toBeGreaterThanOrEqual(allocs[i - 1].damage)
      expect(allocs[i].totalGold).toBe(base + i)
    }
  })

  it('贪婪：acquire 提交后该槽位精炼从 1 重算（常驻旧音擎的精炼不虚标到新专武）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // 伊德海莉+莱卡恩+卢西娅，莱卡恩槽位基础音擎 = 拘缚者（常驻）
    config.team[0].agentId = '1051'; config.team[0].wEngineId = '14105'
    config.team[1].agentId = '1141'; config.team[1].wEngineId = '14114'
    config.team[2].agentId = '1451'; config.team[2].wEngineId = '14145'
    const preset: TeamPreset = {
      id: 'acquire-reset-test', name: '换装重置精炼测试',
      team: ['1051', '1141', '1451'],
      wEngines: ['14105', '14114', '14145'],
      goldSteps: [
        { label: '莱卡恩 换焰心桂冠（本体）', slot: 1, kind: 'wengine', value: 1, wEngineId: '14116' },
        { label: '伊德海莉 1命', slot: 0, kind: 'cinema', value: 1 },
        { label: '卢西娅 1命', slot: 2, kind: 'cinema', value: 1 },
        { label: '焰心桂冠精炼2', slot: 1, kind: 'wengine', value: 2 },
        { label: '焰心桂冠精炼3', slot: 1, kind: 'wengine', value: 3 },
      ],
      standardSteps: [
        { label: '莱卡恩 拘缚者精炼2', slot: 1, kind: 'wengine', value: 2 },
      ],
      interactions: [],
    }
    // 假伤害：换焰心桂冠 +120，精炼每级 +8，伊/卢影画 +50/+49（买专武 > 影画 > 精炼）
    const calc = {
      teamTotalDamage: computed(() => {
        const c = config.team
        const m1 = c[1].wEngineModLevel
        return 100
          + (c[1].wEngineId === '14116' ? 120 : 0)
          + 8 * (m1 - 1)
          + 50 * c[0].cinemaLevel
          + 49 * c[2].cinemaLevel
      }),
    } as unknown as ReturnType<typeof useResourceCalc>

    const base = baseGoldOf(preset) // 4 = 伊/卢 本体+专武，莱卡恩与拘缚者不计
    expect(base).toBe(4)
    const allocs = computeOptimalGoldAllocations(calc, config, preset, base)
    // 5金=换专武、6金=伊1命、7金=卢1命、8金=精炼2、9金=精炼3（候选耗尽即止）
    expect(allocs.map(a => a.totalGold)).toEqual([4, 5, 6, 7, 8, 9])
    // 回归：换装档精炼必须回到 1（曾是 [1,2,1]——拘缚者精炼2 虚标到焰心桂冠上）
    expect(allocs[1].label).toContain('焰心桂冠')
    expect(allocs[1].wengineMods).toEqual([1, 1, 1])
    // 后续精炼逐级推进（8金=R2、9金=R3），而不是从残留的 2 直接跳 R3 少算 1 金
    expect(allocs[4].wengineMods).toEqual([1, 2, 1])
    expect(allocs[5].wengineMods).toEqual([1, 3, 1])
    // 伤害单调不减 + 每档总金 = 基础 + 步数
    for (let i = 1; i < allocs.length; i++) {
      expect(allocs[i].damage).toBeGreaterThanOrEqual(allocs[i - 1].damage)
      expect(allocs[i].totalGold).toBe(base + i)
    }
  })

  it('贪婪：低金档优先买专武本体（acquire 候选）—— 3 金基础无专武时 4 金买一把专武', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // 星徽·比利队口径：3 限定角色、基础音擎常驻/A（无专武）
    config.team[0].agentId = '1531'; config.team[0].wEngineId = '13019' // 比利（限定）+ A 音擎
    config.team[1].agentId = '1571'; config.team[1].wEngineId = '14110' // 诺姆（限定）+ 燃狱齿轮
    config.team[2].agentId = '1451'; config.team[2].wEngineId = '14121' // 卢西娅（限定）+ 啜泣摇篮
    const preset: TeamPreset = {
      id: 'billy-acquire-test', name: '比利买专武测试',
      team: ['1531', '1571', '1451'],
      wEngines: ['13019', '14110', '14121'],
      goldSteps: [
        { label: '星徽·比利 专武（本体）', slot: 0, kind: 'wengine', value: 1, wEngineId: '14153' },
        { label: '卢西娅 专武（本体）', slot: 2, kind: 'wengine', value: 1, wEngineId: '14145' },
        { label: '诺姆 专武（本体）', slot: 1, kind: 'wengine', value: 1, wEngineId: '14157' },
        { label: '星徽·比利 1命', slot: 0, kind: 'cinema', value: 1 },
        { label: '卢西娅 1命', slot: 2, kind: 'cinema', value: 1 },
        { label: '诺姆 1命', slot: 1, kind: 'cinema', value: 1 },
      ],
      interactions: [],
    }
    // 假伤害：带限定专武 +120（买专武是最大单步收益），影画每级 +10
    const calc = {
      teamTotalDamage: computed(() => {
        const c = config.team
        let dmg = 100
        for (let s = 0; s < 3; s++) {
          if (isLimitedWEngine(c[s].wEngineId)) dmg += 120
          dmg += 10 * c[s].cinemaLevel
        }
        return dmg
      }),
    } as unknown as ReturnType<typeof useResourceCalc>

    const base = baseGoldOf(preset) // 3 = 3 限定角色本体（基础音擎不计）
    expect(base).toBe(3)
    const allocs = computeOptimalGoldAllocations(calc, config, preset, base)
    // base=3，第一档升级（4金）应是「买专武本体」候选（用户诉求：000000 → 010000）
    expect(allocs[0].totalGold).toBe(3)
    expect(allocs[1].totalGold).toBe(4)
    expect(allocs[1].label).toContain('专武')
    expect(allocs[1].label).toContain('本体')
    // 4 金档：买到一把限定专武（本体），尚未点影画
    expect(isLimitedWEngine(allocs[1].wEngines[0]) || isLimitedWEngine(allocs[1].wEngines[1]) || isLimitedWEngine(allocs[1].wEngines[2])).toBe(true)
    expect(allocs[1].cinemas).toEqual([0, 0, 0])
  })
})

describe('teamCompare 批量计算', () => {
  it('产出 队伍×金数 个点，伤害>0，计算后现场恢复', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '', cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} }, parryCount: 0, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1 }
    config.team[1] = { ...config.team[0], slot: 1 }
    config.team[2] = { ...config.team[0], slot: 2 }

    const teamBefore = JSON.stringify(config.team)
    const enemyBefore = JSON.stringify(config.enemy)
    const calc = useResourceCalc()

    const points = computeTeamComparePoints(calc, {
      presets: [TEST_PRESET],
      goldLevels: [3, 4, 5, 6], // 目标总限定金：3(0步) ~ 6(3步)
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
    })

    expect(points.length).toBe(4)
    for (const p of points) {
      expect(p.damage).toBeGreaterThan(0)
      expect(p.hpRatio).toBeGreaterThan(0)
      expect(p.difficulty).toBeCloseTo(22.1, 1)
      expect(p.bossHp).toBe(31900305)
    }
    // 金数越高伤害越高（同队同难度，命座递增应单调不减）
    expect(points[3].damage).toBeGreaterThanOrEqual(points[0].damage)
    expect(points[3].cinemas).toEqual([2, 1, 0])

    // 现场恢复：队伍与敌人配置回到计算前
    expect(JSON.stringify(config.team)).toBe(teamBefore)
    expect(JSON.stringify(config.enemy)).toBe(enemyBefore)
  })

  it('最优加金模式：≤12金用贪婪分配（label 带「最优」），金数预算精确，伤害单调不减', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '', cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} }, parryCount: 0, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1 }
    config.team[1] = { ...config.team[0], slot: 1 }
    config.team[2] = { ...config.team[0], slot: 2 }
    const calc = useResourceCalc()
    // TEST_PRESET：3 限定无专武 → base 3，3 步 → 最多 6 金（≤12 全走最优）
    const points = computeTeamComparePoints(calc, {
      presets: [TEST_PRESET],
      goldLevels: [0, 4, 8, 12, 14], // 钳制后 3/4/6/6/6 → 去重 3/4/6
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
      optimalGold: true,
      // 本用例锁「金数预算精确」口径；TEST_PRESET 未声明 wEngines，自动下位会把精炼换成
      // 择优档（如常驻 R3 → [3,3,3]）——择优生效由「自动下位音擎」describe 单独覆盖
      autoEngine: false,
    })
    expect(points.map(p => p.goldCount)).toEqual([3, 4, 6])
    expect(points[0].goldLabel).toContain('基础')
    expect(points[1].goldLabel).toContain('最优')
    expect(points[2].goldLabel).toContain('最优')
    // 预算精确：总金 = 3 + 影画总和（全限定角色、精炼1 不占金）
    for (const p of points) {
      expect(p.cinemas[0] + p.cinemas[1] + p.cinemas[2]).toBe(p.goldCount - 3)
      expect(p.wengineMods).toEqual([1, 1, 1])
      expect(p.damage).toBeGreaterThan(0)
    }
    expect(points[2].damage).toBeGreaterThanOrEqual(points[1].damage)
    expect(points[1].damage).toBeGreaterThanOrEqual(points[0].damage)
  })

  it('minGold：难度门槛过滤——低于变体最低总限定金的档位不生成点（如 5嗔火10大 需琉音配置足够高）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '', cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} }, parryCount: 0, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1 }
    config.team[1] = { ...config.team[0], slot: 1 }
    config.team[2] = { ...config.team[0], slot: 2 }
    const calc = useResourceCalc()
    // TEST_PRESET 基础 3 金 + 3 步（最高 6 金）；minGold 5 → 只出 5/6 金档
    const points = computeTeamComparePoints(calc, {
      presets: [{ ...TEST_PRESET, id: 'test-min-gold', minGold: 5 }],
      goldLevels: [3, 4, 5, 6],
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
    })
    expect(points.map(p => p.goldCount)).toEqual([5, 6])
  })

  it('难度变体轴绑定：stunAxisPresetId 写入对应轴（plans 型 → stunAxisPlans），未绑定/绑错恢复快照轴状态', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    // 用户手动轴现场（快照基准）：一条手动轴 + 开关开
    config.stunAxes.splice(0, config.stunAxes.length, { name: '用户轴', actions: [{ slot: 0, moveId: '1471020', count: 1 }] })
    config.useStunAxis = true
    const snap = {
      stunAxes: JSON.parse(JSON.stringify(config.stunAxes)),
      stunAxisPlans: JSON.parse(JSON.stringify(config.stunAxisPlans)),
      useStunAxis: true,
    }
    // 绑定般琉通用（条件 plans 型预设）→ 写入 stunAxisPlans、手动轴让路
    const bound = applyAxisBinding(config, snap, { ...TEST_PRESET, stunAxisPresetId: 'preset-1471-1481-1451' })
    expect(bound).toBe(true)
    expect(config.stunAxisPlans.length).toBe(1)
    expect(config.stunAxes.length).toBe(0)
    expect(config.useStunAxis).toBe(true)
    // 未绑定 → 恢复快照（用户手动轴回归，绑定轴清空）
    expect(applyAxisBinding(config, snap, TEST_PRESET)).toBe(false)
    expect(config.stunAxisPlans.length).toBe(0)
    expect(config.stunAxes.length).toBe(1)
    // 绑定不存在的轴 id → 同恢复快照，不报错
    expect(applyAxisBinding(config, snap, { ...TEST_PRESET, stunAxisPresetId: 'no-such-axis' })).toBe(false)
    expect(config.stunAxes.length).toBe(1)
    expect(config.stunAxisPlans.length).toBe(0)
    // 批量计算走绑定且结束后现场恢复（stunAxisPlans 回到计算前）
    const plansBefore = JSON.stringify(config.stunAxisPlans)
    const calc = useResourceCalc()
    const points = computeTeamComparePoints(calc, {
      presets: [{ ...TEST_PRESET, id: 'test-axis-bind', stunAxisPresetId: 'preset-1471-1481-1451' }],
      goldLevels: [3],
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
    })
    expect(points.length).toBe(1)
    expect(JSON.stringify(config.stunAxisPlans)).toBe(plansBefore)
    expect(config.stunAxes.length).toBe(1)
  })

  it('buff：自动推荐取三张牌伤害最高，手动指定覆盖，现场恢复', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '', cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} }, parryCount: 0, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1 }
    config.team[1] = { ...config.team[0], slot: 1 }
    config.team[2] = { ...config.team[0], slot: 2 }
    const globalBefore = JSON.stringify(config.globalBuffs)
    const calc = useResourceCalc()

    const buffs: PhaseBuffCard[] = [
      { title: '强攻牌', testOnly: false, effects: [{ stat: 'atkPct', value: 10 }], unparsed: [] },
      { title: '暴伤牌', testOnly: false, effects: [{ stat: 'critDmg', value: 30 }], unparsed: [] },
      { title: '测试服牌', testOnly: true, effects: [{ stat: 'atkPct', value: 999 }], unparsed: [] },
    ]

    // 自动：推荐一张牌（testOnly 排除）
    const auto = computeTeamComparePoints(calc, {
      presets: [TEST_PRESET], goldLevels: [2], boss: FAKE_BOSS, phase: FAKE_PHASE, buffs,
    })
    expect(['强攻牌', '暴伤牌']).toContain(auto[0].buffTitle)
    expect(auto[0].buffTitle).not.toBe('测试服牌')

    // 手动：指定一张
    const manual = computeTeamComparePoints(calc, {
      presets: [TEST_PRESET], goldLevels: [2], boss: FAKE_BOSS, phase: FAKE_PHASE, buffs,
      manualBuffTitle: '暴伤牌',
    })
    expect(manual[0].buffTitle).toBe('暴伤牌')

    // 现场恢复：全局 buff 表回到计算前
    expect(JSON.stringify(config.globalBuffs)).toBe(globalBefore)
  })

  it('buff 自动推荐在 Boss 应用之后评估（排序基于所选期数敌人配置）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '', cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} }, parryCount: 0, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1 }
    config.team[1] = { ...config.team[0], slot: 1 }
    config.team[2] = { ...config.team[0], slot: 2 }
    // 假伤害：Boss 已应用 → 「后期牌」最优；未应用 → 「前期牌」最优。
    // 若推荐发生在 applyBossPreset 之前（回归），会选择「前期牌」。
    const hasCard = (title: string) => config.globalBuffs.some(b => b.name === title)
    const calc = {
      resourceResult: computed(() => null),
      teamTotalDamage: computed(() => {
        if (config.appliedBoss) return hasCard('后期牌') ? 50 : 10
        return hasCard('前期牌') ? 40 : 10
      }),
    } as unknown as ReturnType<typeof useResourceCalc>
    const buffs: PhaseBuffCard[] = [
      { title: '前期牌', testOnly: false, effects: [{ stat: 'atkPct', value: 10 }], unparsed: [] },
      { title: '后期牌', testOnly: false, effects: [{ stat: 'critDmg', value: 30 }], unparsed: [] },
    ]
    const points = computeTeamComparePoints(calc, {
      presets: [TEST_PRESET], goldLevels: [3], boss: FAKE_BOSS, phase: FAKE_PHASE, buffs,
    })
    expect(points.length).toBe(1)
    expect(points[0].buffTitle).toBe('后期牌')
  })

  it('buff 条件：特性限定/异常人数分档（resolveBuffEffect）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    // 测试队：1561(异常) 1261(异常) 1411(支援) —— 2 名异常
    const eff2: any = { stat: 'atkPct', value: 70, cond: { anomalyCount: [10, 70] } }
    expect(resolveBuffEffect(eff2, TEST_PRESET)).toMatchObject({ stat: 'atkPct', value: 10 })

    // 3 名异常 → 满编档
    const team3: TeamPreset = { ...TEST_PRESET, team: ['1561', '1261', '1171'] }
    expect(resolveBuffEffect(eff2, team3)).toMatchObject({ stat: 'atkPct', value: 70 })

    // 队伍无强攻 → 限定效果不生效
    const effSpec: any = { stat: 'critDmg', value: 30, cond: { specialty: '强攻' } }
    expect(resolveBuffEffect(effSpec, TEST_PRESET)).toBeNull()
  })
})

// ========== 自动下位音擎（装填池择优） ==========

/** 引擎评分假伤害：按各槽位音擎 id/精炼计分（与真实引擎解耦，只测择优口径） */
function engineScoreCalc(config: ReturnType<typeof useConfigStore>, score: (wId: string, mod: number, slot: number) => number) {
  return {
    resourceResult: computed(() => null),
    teamTotalDamage: computed(() =>
      100 + config.team.reduce((sum, c, s) => sum + score(c.wEngineId, c.wEngineModLevel, s), 0),
    ),
  } as unknown as ReturnType<typeof useResourceCalc>
}

describe('teamCompare 自动下位音擎（装填池择优）', () => {
  const emptySlot = { slot: 0, agentId: '', cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1, driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} }, parryCount: 0, blockCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1 }

  function setupTeam(rows: { slot: number; agentId: string; wEngineId?: string }[]) {
    const config = useConfigStore()
    for (let s = 0; s < 3; s++) {
      const row = rows.find(r => r.slot === s)
      config.team[s] = { ...emptySlot, slot: s, agentId: row?.agentId ?? '', wEngineId: row?.wEngineId ?? '' }
    }
    return config
  }

  it('生效测试：池内择优 + A 级默认精炼可调（改档伤害确实变）；池外候选不参与', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    // 打分：13019 每精炼级 +30，其余候选一律 +0 → 池含 13019 时必选它
    const config = setupTeam([{ slot: 0, agentId: '1531' }])
    const calc = engineScoreCalc(config, (wId, mod) => (wId === '13019' ? 30 * mod : 0))
    const preset: TeamPreset = { id: 'auto-a', name: '自动下位A', team: ['1531', '', ''], wEngines: ['', '', ''], goldSteps: [], interactions: [] }
    const run = (aMod: number, pool?: string[]) => computeTeamComparePoints(calc, {
      presets: [preset], goldLevels: [3], boss: FAKE_BOSS, phase: FAKE_PHASE,
      autoEngine: true, autoEngineMods: { aRank: aMod },
      ...(pool ? { autoEnginePool: pool } : {}),
    })
    // 显式池含 13019：择优 13019@R{aMod}；改默认精炼档 → 伤害随之变
    const POOL = ['13019']
    expect(run(5, POOL)[0].damage).toBe(100 + 150)
    expect(run(2, POOL)[0].damage).toBe(100 + 60)
    expect(run(5, POOL)[0].standardGoldLabel).toContain('自动下位')
    expect(run(2, POOL)[0].standardGoldLabel).toContain('R2')
    // 池不含 13019 → 只能在剩余候选里挑（全 0 分），证明「只在池内试算」
    expect(run(5, ['14110'])[0].damage).toBe(100)
    // 默认装填池 = 用户准信五件（击破：人为刀俎/燃狱齿轮，辅助：好斗的阿炮/逍遥游球/啜泣摇篮）
    expect(DEFAULT_AUTO_ENGINE_POOL).toEqual(['13005', '14110', '13115', '14002', '14121'])
    const defPick = computeAutoEnginePicks(calc, config, preset, {})[0]
    expect(defPick).toBeDefined()
    expect(DEFAULT_AUTO_ENGINE_POOL).toContain(defPick!.id)
  })

  it('限定候选可选：按本体 R1 参与择优并标 limited；未知 id 忽略；限定基础音擎的槽位不参与替换', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = setupTeam([
      { slot: 0, agentId: '1051', wEngineId: '14105' },
      { slot: 1, agentId: '1531' },
      { slot: 2, agentId: '1261' },
    ])
    const preset: TeamPreset = { id: 'auto-filter', name: '过滤测试', team: ['1051', '1531', '1261'], wEngines: ['14105', '', ''], goldSteps: [], interactions: [] }
    // 打分：14145（限定）本体 R1 +300 —— 有金就是金，赢了 13019@R4 的 120 分也应可选
    const calc = engineScoreCalc(config, wId => (wId === '14145' ? 300 : wId === '13019' ? 30 : 0))
    const picks = computeAutoEnginePicks(calc, config, preset, {
      autoEnginePool: ['99999', '14145', '13019'],
      autoEngineMods: { aRank: 4 },
    })
    expect(picks.map(p => p.slot)).toEqual([1, 2]) // slot0 带限定基础音擎（占金持有物）→ 不替换
    expect(picks.every(p => p.id === '14145')).toBe(true) // 300 分限定胜出；99999 未知 id 被忽略
    expect(picks.every(p => p.limited && p.mod === 1)).toBe(true) // 限定按本体 R1 参与并标记
    expect(picks[0].label).toContain('（限定）')
  })

  it('预设级 autoEngine：bySlot > byAgent(poolRef) > 整队池 > 页面池；mods 覆盖页面精炼', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = setupTeam([
      { slot: 0, agentId: '1531' },
      { slot: 1, agentId: '1481' },
      { slot: 2, agentId: '1451' },
    ])
    const preset: TeamPreset = {
      id: 'ae-schema', name: '下位池声明', team: ['1531', '1481', '1451'], wEngines: ['', '', ''],
      goldSteps: [], interactions: [],
      autoEngine: {
        pool: ['13005'],
        byAgent: { '1481': { poolRef: '琉音槽下位' } },
        bySlot: { '2': { pool: ['13115'] } },
        mods: { standard: 4 },
      },
    }
    // 并列打分 → 各层取池内第一件，直接验证「哪一层被用上」
    const calc = engineScoreCalc(config, () => 10)
    const picks = computeAutoEnginePicks(calc, config, preset, { autoEnginePool: ['14002'], autoEngineMods: { standard: 2 } })
    expect(picks.find(p => p.slot === 0)!.id).toBe('13005') // 整队池压过页面池
    expect(picks.find(p => p.slot === 1)!.id).toBe('14110') // byAgent poolRef → 琉音槽下位[燃狱齿轮]
    expect(picks.find(p => p.slot === 2)!.id).toBe('13115') // bySlot 压过 byAgent/整队
    expect(picks.find(p => p.slot === 1)!.mod).toBe(4) // preset.mods.standard=4 覆盖页面的 2
  })

  it('有金就是金：下位选中限定按本体计入总金；预算步买到专武顶掉下位后不再重复计', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = setupTeam([{ slot: 0, agentId: '1531' }, { slot: 1, agentId: '1571' }, { slot: 2, agentId: '1451' }])
    const preset: TeamPreset = {
      id: 'auto-gold', name: '下位限定计金', team: ['1531', '1571', '1451'], wEngines: ['', '', ''],
      goldSteps: [{ label: '星徽·比利 专武（本体）', slot: 0, kind: 'wengine', value: 1, wEngineId: '14153' }],
      interactions: [],
    }
    // 打分：任意限定 +300；13019 无分 → 两空槽都择优限定本体（各计 1 金）
    const calc = engineScoreCalc(config, wId => (isLimitedWEngine(wId) ? 300 : 0))
    const picks = computeAutoEnginePicks(calc, config, preset, { autoEnginePool: ['14153'] })
    expect(picks.filter(p => p.limited)).toHaveLength(3) // 三槽全空 → 全部择优限定本体
    const allocs = computeOptimalGoldAllocations(calc, config, preset, baseGoldOf(preset), picks)
    // base：预算 3 金（三限定角色本体）+ 3 件下位限定 = 总金 6
    expect(allocs[0].budgetGold).toBe(3)
    expect(allocs[0].totalGold).toBe(6)
    expect(allocs[0].label).toContain('含下位限定 3 金')
    // 预算 4 金买到 slot0 专武：该槽的金已含在预算步，不再双算 → 4 预算 + 2 件剩余下位限定 = 6
    const at4 = allocs.find(a => a.budgetGold === 4)!
    expect(at4.wEngines[0]).toBe('14153')
    expect(at4.totalGold).toBe(6)
    expect(at4.label).toContain('含下位限定 2 金')
  })

  it('最优路径集成：base 档穿下位择优，买到专武的槽位换回专武（精炼回 1），其余槽保持下位', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = setupTeam([{ slot: 0, agentId: '1531' }, { slot: 1, agentId: '1571' }, { slot: 2, agentId: '1451' }])
    const preset: TeamPreset = {
      id: 'auto-acquire', name: '买专武换回', team: ['1531', '1571', '1451'], wEngines: ['', '', ''],
      goldSteps: [
        { label: '星徽·比利 专武（本体）', slot: 0, kind: 'wengine', value: 1, wEngineId: '14153' },
        { label: '诺姆 专武（本体）', slot: 1, kind: 'wengine', value: 1, wEngineId: '14157' },
        { label: '星徽·比利 1命', slot: 0, kind: 'cinema', value: 1 },
      ],
      interactions: [],
    }
    // 打分：任意限定音擎每把 +300；13019 每精炼级 +30 → 三槽 base 全择优 13019@R5
    const calc = engineScoreCalc(config, (wId, mod) => (isLimitedWEngine(wId) ? 300 : wId === '13019' ? 30 * mod : 0))
    const picks = computeAutoEnginePicks(calc, config, preset, { autoEnginePool: ['13019'] })
    expect(picks.map(p => p.id)).toEqual(['13019', '13019', '13019'])
    const allocs = computeOptimalGoldAllocations(calc, config, preset, baseGoldOf(preset), picks)
    expect(allocs[0].wEngines).toEqual(['13019', '13019', '13019'])
    expect(allocs[0].wengineMods).toEqual([5, 5, 5])
    // 4 金：三个获取步并列 +150，贪婪取第一个（slot0）→ 换专武、精炼回 1；其余槽保持下位
    const at4 = allocs.find(a => a.totalGold === 4)!
    expect(at4.label).toContain('本体')
    expect(at4.wEngines[0]).toBe('14153')
    expect(at4.wengineMods[0]).toBe(1)
    expect(at4.wEngines[1]).toBe('13019')
    expect(at4.wengineMods[1]).toBe(5)
  })
})

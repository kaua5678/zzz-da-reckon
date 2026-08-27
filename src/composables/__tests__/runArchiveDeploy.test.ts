import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyDeployConfig, applyBossLayerBuffs, resolveBossApply } from '@/composables/runArchiveDeploy'
import type { DeployConfig } from '@/composables/runArchiveImport'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'

const bp = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossPresetFile
const presets = bp.bosses as BossPreset[]
const phaseViews = (bp.phaseViews ?? []) as PhaseView[]

/** 真实样例部署配置（铃依依_ 星见雅 6命5精 + 南宫羽 + 柚叶，对基塔布鲁·滞变畸兽 690431 期）。 */
const DEPLOY: DeployConfig = {
  supported: true,
  mode: 'Deadly Assault',
  team: [
    { slot: 0, agentId: '1091', cinemaLevel: 6, wEngineId: '14109', wEngineModLevel: 5 },
    { slot: 1, agentId: '1511', cinemaLevel: 6, wEngineId: '14151', wEngineModLevel: 5 },
    { slot: 2, agentId: '1411', cinemaLevel: 6, wEngineId: '14149', wEngineModLevel: 5 },
  ],
  boss: { presetId: '40008', name: '基塔布鲁·滞变畸兽', phaseId: '690431' },
  warnings: [],
}

describe('resolveBossApply', () => {
  it('按 presetId + phaseId 解析出预设/期相位/怪物/默认值/关卡 brief', () => {
    const r = resolveBossApply(DEPLOY.boss!, presets, phaseViews)
    expect(r?.preset.id).toBe('40008')
    expect(r?.phase.phaseId).toBe('690431')
    expect(r?.phase.hp).toBeGreaterThan(0)
    expect(r?.monster.stunVuln).toBeGreaterThan(0)
    expect(r?.defaults.battleTime).toBe(180)
  })

  it('phaseId 未收录 → null', () => {
    const r = resolveBossApply({ presetId: '40008', name: 'x', phaseId: '999999' }, presets, phaseViews)
    expect(r).toBeNull()
  })

  it('presetId 不存在 → null', () => {
    const r = resolveBossApply({ presetId: '40404', name: 'x', phaseId: '690431' }, presets, phaseViews)
    expect(r).toBeNull()
  })
})

describe('applyDeployConfig', () => {
  it('写队伍（命座/音擎/精炼）+ Boss 期相位（hp）+ 交互基准', async () => {
    const { config } = await setupHarness(['', '', ''])
    applyDeployConfig(config, DEPLOY, presets, phaseViews)

    expect(config.team.map((s) => s.agentId)).toEqual(['1091', '1511', '1411'])
    expect(config.team.map((s) => s.cinemaLevel)).toEqual([6, 6, 6])
    expect(config.team.map((s) => s.wEngineId)).toEqual(['14109', '14151', '14149'])
    expect(config.team.map((s) => s.wEngineModLevel)).toEqual([5, 5, 5])

    // 交互基准：通用（弹刀 6 / 闪反 10 / 快支 3 / 连携 1）
    expect(config.team.map((s) => s.parryCount)).toEqual([6, 6, 6])
    expect(config.team.map((s) => s.dodgeCounterCount)).toEqual([10, 10, 10])
    expect(config.team.map((s) => s.quickAssistCount)).toEqual([3, 3, 3])
    expect(config.team.map((s) => s.chainCountPerStun)).toEqual([1, 1, 1])

    // Boss：hp 等于 690431 期相位血量（分期数决定血量膨胀）
    const phase = presets.find((p) => p.id === '40008')?.phases.find((p) => p.phaseId === '690431')
    expect(phase).toBeTruthy()
    expect(config.enemy.hp).toBe(Math.round(phase!.hp))
  })

  it('空音擎槽位 → 保留自动推荐（不覆盖 wEngineId）', async () => {
    const { config } = await setupHarness(['', '', ''])
    const deploy: DeployConfig = {
      ...DEPLOY,
      team: [
        { slot: 0, agentId: '1091', cinemaLevel: 0, wEngineId: null, wEngineModLevel: 1 },
        { slot: 1, agentId: '1511', cinemaLevel: 0, wEngineId: null, wEngineModLevel: 1 },
        { slot: 2, agentId: '1411', cinemaLevel: 0, wEngineId: null, wEngineModLevel: 1 },
      ],
    }
    applyDeployConfig(config, deploy, presets, phaseViews)
    expect(config.team.map((s) => s.agentId)).toEqual(['1091', '1511', '1411'])
    // 空音擎不覆盖 → 走 applyTeamPreset 的专属音擎推荐（非空）
    expect(config.team.every((s) => s.wEngineId !== '')).toBe(true)
  })
})

describe('部署 → 资源池结果', () => {
  it('部署后产出资源池结果（三角色 + 总伤>0 + 失衡>0），供 UI 资源池卡片展示', async () => {
    const { config, catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    applyDeployConfig(config, DEPLOY, presets, phaseViews)

    const calc = useResourceCalc()
    expect(calc.resourceResult.value).not.toBeNull()
    expect(calc.resourceResult.value!.characters.length).toBe(3)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
    expect(calc.stunPoolResult.value?.stunCount ?? 0).toBeGreaterThan(0)
  })
})

describe('applyBossLayerBuffs', () => {
  it('写关卡固有 buff（前缀 layer-buff:），重复调用先清旧', async () => {
    const { config } = await setupHarness(['', '', ''])
    const brief = {
      presetId: '40008',
      monsterId: '40008',
      name: '基塔布鲁·滞变畸兽',
      weakness: [],
      resistance: [],
      hp: 0,
      stunValue: 0,
      defense: 0,
      level: 70,
      bossBuffs: [{ title: '', testOnly: false, effects: [{ stat: 'anomalyDmgBonus', value: 40 }], unparsed: [] }],
    }
    applyBossLayerBuffs(config, brief)
    const first = config.globalBuffs.filter((b) => String(b.id).startsWith('layer-buff:'))
    expect(first.length).toBe(1)
    expect(first[0].stat).toBe('anomalyDmgBonus')
    expect(first[0].value).toBe(40)

    applyBossLayerBuffs(config, brief)
    expect(config.globalBuffs.filter((b) => String(b.id).startsWith('layer-buff:')).length).toBe(1)
  })
})
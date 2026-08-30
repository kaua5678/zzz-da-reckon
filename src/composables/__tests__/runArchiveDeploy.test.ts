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

    // 交互基准（2026-08 修订）：弹刀不预设（保底4失衡/4喧响运行时反推），闪反/快支保留固定基准
    expect(config.team.map((s) => s.parryCount)).toEqual([0, 0, 0])
    expect(config.team.map((s) => s.dodgeCounterCount)).toEqual([10, 10, 10])
    expect(config.team.map((s) => s.quickAssistCount)).toEqual([3, 3, 3])
    expect(config.team.map((s) => s.chainCountPerStun)).toEqual([1, 1, 1])
    // 保底4喧响 + 自动轴开启（弹刀反推的两个驱动）
    expect(config.getMechanicSetting('guarantee.ultimate', 0)).toBe(1)
    expect(config.autoYidhariAxis).toBe(true)
    expect(config.stunAxes.length).toBe(0)
    expect(config.stunAxisPlans.length).toBe(0)

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
  }, 60000)
})

describe('applyDeployConfig 确定性（跨队不泄漏命座门控队友 buff）', () => {
  it('同一支队两次部署伤害一致（中间部署别队不残留 C1/C2 队友 buff）', async () => {
    const { config, catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const boss = { presetId: '30033', name: '秽息司祭', phaseId: '690431' }
    // 3 异常队（蕾米埃尔 1581 的 C1/C2 队友 buff 按命座门控，0 命应关闭）
    const aria: DeployConfig = {
      supported: true,
      mode: 'Deadly Assault',
      team: [
        { slot: 0, agentId: '1501', cinemaLevel: 0, wEngineId: null, wEngineModLevel: 1 },
        { slot: 1, agentId: '1561', cinemaLevel: 0, wEngineId: null, wEngineModLevel: 1 },
        { slot: 2, agentId: '1581', cinemaLevel: 0, wEngineId: null, wEngineModLevel: 1 },
      ],
      boss,
      warnings: [],
    }
    // 高命队（猫又 6 / 诺姆 2 / 丽娜 6）：残留命座会污染下一队
    const neko: DeployConfig = {
      supported: true,
      mode: 'Deadly Assault',
      team: [
        { slot: 0, agentId: '1021', cinemaLevel: 6, wEngineId: null, wEngineModLevel: 4 },
        { slot: 1, agentId: '1571', cinemaLevel: 2, wEngineId: null, wEngineModLevel: 1 },
        { slot: 2, agentId: '1211', cinemaLevel: 6, wEngineId: null, wEngineModLevel: 5 },
      ],
      boss,
      warnings: [],
    }

    applyDeployConfig(config, aria, presets, phaseViews)
    const d1 = calc.teamTotalDamage.value
    applyDeployConfig(config, neko, presets, phaseViews)
    void calc.teamTotalDamage.value // 触发 neko 计算，留下残留命座
    applyDeployConfig(config, aria, presets, phaseViews)
    const d2 = calc.teamTotalDamage.value

    // 相对误差 < 1e-6（bug 形态下 d2/d1 ≈ 1.317，蕾米埃尔 C1/C2 被错误开启）
    expect(Math.abs(d2 - d1) / d1).toBeLessThan(1e-6)
  }, 120000)
})

describe('保底4喧响 → 弹刀反推（通用）', () => {
  it('喧响不足时反推只给喧响弹刀补齐到 ≥4 终结技，且稳定收敛', async () => {
    const { config } = await setupHarness([
      { agentId: '1201', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.enemy.battleTime = 120

    // 基线：不勾保底4喧响 → 喧响不足以 4 终结技
    const calcBase = useResourceCalc()
    const baseUlt = calcBase.resourceResult.value!.characters.reduce((s, c) => s + (c.ultimateCount ?? 0), 0)
    expect(baseUlt).toBeLessThan(4)

    // 勾保底4喧响 → 反推只给喧响弹刀补齐，终结技 ≥ 4 且稳定收敛
    config.setMechanicSetting('guarantee.ultimate', 1)
    const calc = useResourceCalc()
    const res = calc.resourceResult.value!
    const ultSum = res.characters.reduce((s, c) => s + (c.ultimateCount ?? 0), 0)
    expect(ultSum).toBeGreaterThanOrEqual(4)
    expect(res.convergence?.outerExit).toBe('stable')
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
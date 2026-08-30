/**
 * 时间桶恒等式（2026-08 口径）：
 * - 每个角色的**前台**执行行（timeBucket ≠ 'backstage'）时间 ≡ 其账本（necessaryTime + basicAttackTime）
 *   ——由 resource.ts 折叠循环对其自家账本收敛保证（后台行如莱卡恩围猎蓄力不占共享轴）。
 * - 队伍对比页的超时校验只累计前台行：此前把后台行也求和，模块队普遍误报「超时」。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeTeamComparePoints } from '@/composables/teamCompare'
import { isFrontlineExecution } from '@/types/resource'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

const res20 = { physical: 20, fire: 20, ice: 20, electric: 20, ether: 20, wind: 20 }
const BOSS: BossPreset = {
  id: '40009', name: '异构·基塔布鲁', nameEn: 'x', aliases: [], icon: null, iconSource: null,
  isCriticalAssault: true,
  monster: { stunVuln: 1.5, stunTime: 12, name: 'x' },
  defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
  phases: [],
}
const PHASE: BossPresetPhase = {
  phaseId: 'p', zoneKey: 'z', version: '3.2', label: 'L', begin: '', modeType: 'critical_assault',
  stageName: 'x', stageNum: 1, level: 70, hp: 31900305, stunValue: 18933.95, defense: 953,
  bossAnomalyCoeff: 1.1,
  damageResistances: { ...res20 }, stunResistances: { ...res20 }, anomalyResistances: { ...res20 },
  weakness: [], resistance: [],
}

/** 伊德海莉+莱卡恩+卢西娅：模块行丰富的典型队伍（曾实测 Σ全部行 219.3s / 账本 180.0s） */
async function setupYidhariTeam() {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
  const config = useConfigStore()
  const team = ['1051', '1141', '1451']
  const engines = ['14105', '', '14145']
  const cinemas = [1, 0, 1]
  for (let s = 0; s < 3; s++) {
    config.setAgent(s, team[s])
    if (engines[s]) config.setWEngine(s, engines[s])
    config.setCinemaLevel(s, cinemas[s])
    config.setWEngineModLevel(s, 1)
  }
  config.applyBossPreset({ id: BOSS.id }, PHASE, BOSS.monster, BOSS.defaults)
  return calc_resource(calc())
  function calc() { return useResourceCalc() }
  function calc_resource(c: ReturnType<typeof useResourceCalc>) { return c }
}

describe('时间桶恒等式', () => {
  it('每个角色：前台执行行时间 ≡ 账本（necessary+basic），全队 ≤ 战斗时间；后台行被排除', async () => {
    const calc = await setupYidhariTeam()
    const rr = calc.resourceResult.value!
    let teamFrontline = 0
    let sawBackstage = false
    for (const ch of rr.characters) {
      const ta = ch.timeAllocation as any
      const front = ch.executions.filter(isFrontlineExecution)
      const backstage = ch.executions.filter(e => !isFrontlineExecution(e))
      const frontTime = front.reduce((a, e) => a + (e.totalTime ?? 0), 0)
      sawBackstage = sawBackstage || backstage.length > 0
      // 单向恒等式：不允许「未付费」的前台行（正向溢出）；负向 = 账本高估，折叠按设计不回收
      // （回收会让 necessary 变负、平A池膨胀），量化残差 ~1s 属合轴可覆盖（resource.ts 注释口径）
      expect(frontTime).toBeLessThanOrEqual(ta.necessaryTime + ta.basicAttackTime + 2)
      teamFrontline += frontTime
    }
    expect(sawBackstage).toBe(true) // 莱卡恩围猎蓄力/跟随行确实存在且被打成后台
    expect(teamFrontline).toBeLessThanOrEqual(180 + 1e-6)
    // 收敛健康度：折叠残差应接近 0（非静默耗尽上限）
    expect(rr.convergence?.timeBudgetResidualSeconds ?? 0).toBeLessThanOrEqual(2)
  })
})

describe('队伍对比超时判定（只累计前台行）', () => {
  it('伊德海莉+莱卡恩+卢西娅队：后台行不再计入 → 不再误报「超时」', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.setAgent(0, '1051'); config.setWEngine(0, '14105'); config.setCinemaLevel(0, 1)
    config.setAgent(1, '1141')
    config.setAgent(2, '1451'); config.setWEngine(2, '14145'); config.setCinemaLevel(2, 1)
    const calc = useResourceCalc()
    const points = computeTeamComparePoints(calc, {
      presets: [{
        id: 'ledger-team', name: '账本队', team: ['1051', '1141', '1451'],
        wEngines: ['14105', '', '14145'],
        goldSteps: [{ label: '伊德海莉 1命', slot: 0, kind: 'cinema', value: 1 }],
        interactions: [],
      }],
      goldLevels: [5],
      boss: BOSS,
      phase: PHASE,
      autoEngine: false,
    })
    expect(points.length).toBe(1)
    // 此前该配置 Σ全部执行行 219.3s > 180s 误报超时；莱卡恩围猎蓄力 32s 是后台活动
    expect(points[0].timeExceeded).toBe(false)
    expect(points[0].timeDetail).toContain('✓ 可行')
  })
})

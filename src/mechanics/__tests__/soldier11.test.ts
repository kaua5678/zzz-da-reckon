import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { soldier11Mechanic, patchSoldier11Executions } from '@/mechanics/agents/soldier11'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

function exec(moveId: string, category: string, count = 1): any {
  return { moveId, category, count }
}

function patchInput(cinema: number, executions: any[], state: any = {}, settings: Record<string, number> = {}) {
  const cfg: any = { battleTime: 180, soldier11CinemaLevel: cinema }
  for (const [k, v] of Object.entries(settings)) cfg[`setting:${k}`] = v
  return {
    cfg,
    state: { exSpecialCount: 0, chainCountTotal: 0, ultimateCount: 0, ...state } as any,
    executions,
  }
}

describe('「11号」（1041）patchExecutions：火力镇压增伤 / 影画2 / 影画6', () => {
  it('核心被动：火力镇压行 +70% dmgBonus，非火力镇压行不受影响', () => {
    const rows = [exec('1041002', 'basic'), exec('1041010', 'basic')]
    patchSoldier11Executions(patchInput(0, rows) as any)
    expect(rows[0].dmgBonus).toBe(70)
    expect(rows[1].dmgBonus ?? 0).toBe(0)
  })

  it('覆盖率滑块 50%：火力镇压增伤折算为 +35%', () => {
    const rows = [exec('1041004', 'basic')]
    patchSoldier11Executions(patchInput(0, rows, {}, { 'soldier11.fireSuppressCoverage': 0.5 }) as any)
    expect(rows[0].dmgBonus).toBe(35)
  })

  it('影画2 高温汇聚：2命时 basic/dodge 类行 +36%，0命不生效', () => {
    const rows0 = [exec('1041010', 'basic'), exec('1041050', 'dodge')]
    patchSoldier11Executions(patchInput(0, rows0) as any)
    expect(rows0[0].dmgBonus ?? 0).toBe(0)

    const rows2 = [exec('1041010', 'basic'), exec('1041050', 'dodge'), exec('1041030', 'special')]
    patchSoldier11Executions(patchInput(2, rows2) as any)
    expect(rows2[0].dmgBonus).toBe(36)
    expect(rows2[1].dmgBonus).toBe(36)
    expect(rows2[2].dmgBonus ?? 0).toBe(0)
  })

  it('影画6 炽热心流：充能可用比例折算 resIgnore（8层充能 vs 16次火力镇压 = 50% → 12.5%）', () => {
    const rows = [exec('1041002', 'basic', 16)]
    patchSoldier11Executions(patchInput(6, rows, { exSpecialCount: 1 }) as any)
    expect(rows[0].resIgnore).toBe(12.5)
  })

  it('影画6 充能充足：比例封顶 100% → 无视 25% 火抗', () => {
    const rows = [exec('1041002', 'basic', 4)]
    patchSoldier11Executions(patchInput(6, rows, { exSpecialCount: 1, ultimateCount: 1 }) as any)
    expect(rows[0].resIgnore).toBe(25)
  })

  it('防死数据：0命时影画6 resIgnore 恒为 0', () => {
    const rows = [exec('1041002', 'basic', 4)]
    patchSoldier11Executions(patchInput(0, rows, { exSpecialCount: 2 }) as any)
    expect(rows[0].resIgnore ?? 0).toBe(0)
  })
})

describe('「11号」快速火刀动作块与层数结算', () => {
  const fireKnifeInput = (state: Record<string, number>, cinema = 0) => ({
    cfg: { battleTime: 180, soldier11CinemaLevel: cinema },
    state: { exSpecialCount: 0, chainCountTotal: 0, ultimateCount: 0, basicAttackTime: 100, ...state } as any,
    executions: [] as any[],
  })

  it('层数结算：5 个窗口招（2强特+2连携+1终结）→ 层数预算封顶 2 套；爆炸行 = 2×6 层', () => {
    const input = fireKnifeInput({ exSpecialCount: 2, chainCountTotal: 2, ultimateCount: 1 })
    soldier11Mechanic.buildExecutions!(input as any)
    const rows = input.executions
    expect(rows.filter(r => r.moveId === '1041008')).toHaveLength(1)
    expect(rows.find(r => r.moveId === '1041008')!.count).toBe(2)
    expect(rows.find(r => r.moveId === '1041025')!.count).toBe(2)
    const boom = rows.find(r => r.moveId === '1041026')!
    expect(boom.count).toBe(2 * 6)
    expect(boom.actionTime).toBe(0)
    expect(boom.totalTime).toBe(0)
  })

  it('层数预算：0 发强特 → 无快速火刀行；2 发强特（无连携终结）→ 2 套', () => {
    const input = fireKnifeInput({ exSpecialCount: 0, chainCountTotal: 2, ultimateCount: 1 })
    soldier11Mechanic.buildExecutions!(input as any)
    expect(input.executions).toHaveLength(0)

    const input2 = fireKnifeInput({ exSpecialCount: 2, chainCountTotal: 0, ultimateCount: 0 })
    soldier11Mechanic.buildExecutions!(input2 as any)
    expect(input2.executions.find(r => r.moveId === '1041008')!.count).toBe(2)
    expect(input2.executions.find(r => r.moveId === '1041026')!.count).toBe(2 * 6)
  })

  it('爆炸行（1041026）在火力镇压集合内：核心被动 +70% 咬合', () => {
    const rows: any[] = [{ moveId: '1041026', category: 'basic', count: 6 }]
    patchSoldier11Executions(patchInput(0, rows) as any)
    expect(rows[0].dmgBonus).toBe(70)
  })

  it('combos 注册快速火刀动作块（轴编辑器可用）：A4+A5+爆炸×6，能耗 = 强特 80', () => {
    const combo = soldier11Mechanic.combos!['soldier11-fire-knife']
    expect(combo.energyCost).toBe(80)
    expect(combo.moves).toEqual([
      { moveId: '1041008', count: 1 },
      { moveId: '1041025', count: 1 },
      { moveId: '1041026', count: 6 },
    ])
  })
})

describe('「11号」applyPanel / buildCharConfig', () => {
  it('潜能·绝焰（最高档）：额外能力触发时暴伤 +48%，未触发为 0', () => {
    // 2026-09-17 round 20 R20-h1：燎原火伤块自 computePanelPhases 迁进本模块 applyPanel 后，
    // 该钩子读派发器直给的 `settings`（覆盖率滑块）。直接调用钩子的测试须补齐该入参
    // （派发点 computePanelPhases 恒传；同款 fixture 见 piper/hugo 测试）。断言值不变。
    const panelOn: any = { additionalAbilityActive: 1 }
    soldier11Mechanic.applyPanel!({ panel: panelOn, settings: {} } as any)
    expect(panelOn.critDmg).toBe(48)

    const panelOff: any = {}
    soldier11Mechanic.applyPanel!({ panel: panelOff, settings: {} } as any)
    expect(panelOff.critDmg ?? 0).toBe(0)
  })

  it('影画1 快速升温：1命注入整局回能 floor(180/50)×40 = 120，0命不注入', () => {
    const cfg1: any = { battleTime: 180 }
    soldier11Mechanic.buildCharConfig!({ cfg: cfg1, cinemaLevel: 1 } as any)
    expect(cfg1.initialEnergyGift).toBe(120)

    const cfg0: any = { battleTime: 180 }
    soldier11Mechanic.buildCharConfig!({ cfg: cfg0, cinemaLevel: 0 } as any)
    expect(cfg0.initialEnergyGift ?? 0).toBe(0)
  })
})

describe('「11号」额外能力·燎原全管线：同属性队友门控', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('本（1121，火属性）在队：燎原触发，火伤 +10% + 失衡增伤 22.5%，暴伤 +48', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1041', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1121', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const withMate = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(withMate.additionalAbilityActive).toBe(1)
    // 换掉同属性队友后的基线差分：火伤 32.5（10 + 22.5×默认满覆盖），暴伤 48（潜能最高档）
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const withoutMate = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(withMate.fireDmg - (withoutMate.fireDmg ?? 0)).toBe(32.5)
    expect(withMate.critDmg - withoutMate.critDmg).toBe(48)
  })

  it('防死数据：无同属性/同阵营队友时燎原不触发（fireDmg 只含驱动盘主属性）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1041', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any // 安比：电属性/狡兔屋，均不满足
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.additionalAbilityActive ?? 0).toBe(0)
    // 空队友槽位基线：与安比同队时火伤应完全一致（燎原未贡献）
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const baseline = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.fireDmg).toBe(baseline.fireDmg)
  })
})

describe('「11号」滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('soldier11.c2StackCoverage → 影画2普攻/闪反增伤差分（patchExecutions +36×覆盖率）', () => {
    const mk = (cov: number) => {
      const executions: any[] = [{ moveId: '1041001', category: 'basic', dmgBonus: 0 }]
      patchSoldier11Executions({
        cfg: { soldier11CinemaLevel: 2, 'setting:soldier11.c2StackCoverage': cov },
        state: {},
        executions,
      } as never)
      return executions[0].dmgBonus ?? 0
    }
    expect(mk(1)).toBeCloseTo(36, 5)
    expect(mk(0.5)).toBeCloseTo(18, 5)
    expect(mk(0)).toBe(0)
  })
})

describe('「11号」燎原火滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('soldier11.prairieFireStunCoverage → 攻击失衡敌人增伤差分（computePanelPhases 1041 分支）', async () => {
    // 火队友（1171 柏妮思）激活燎原额外能力
    const { catalog, config } = await setupHarness([{ agentId: '1041', cinemaLevel: 0 }, { agentId: '1171' }])
    const read = () => {
      const p = computePanelPhases(0, config, catalog)!.inCombat as any
      return p.fireDmg ?? 0
    }
    config.setMechanicSetting('soldier11.prairieFireStunCoverage', 1)
    const on = read()
    config.setMechanicSetting('soldier11.prairieFireStunCoverage', 0)
    const off = read()
    expect(on - off).toBeCloseTo(22.5, 1)
    expect(on).toBeGreaterThan(off)
  })
})

/**
 * §19.6-2 收口判据（R40）：**A45 循环行不占平A池那份时间**（不是艾莲式双计）。
 *
 * 背景：`f70a402` 修好艾莲 1191 —— 她的 `computeEllenCycle` 把平A池**解成**循环行
 * （`dashCount×dashTime + iceWaveCount×burstTime + sharkTime = basicAttackTime`，等式解出），
 * 而聚合行仍 = 池 ⇒ 同一段时间两份。R38 扫描出 8 个「模块 basic 类行 ≥ 20s 且聚合行 = 池」，
 * 7 个已判资源驱动合法；1041 是最后一个（含直接 `⌊basicAttackTime / CYCLE_TIME⌋` 项）。
 *
 * **实测判定 = 合法，不挤出**，两条独立证据：
 * ① **行时间走的是 estimate 钩子，不住在池里**：`estimateExSpecialTime` 把 `cycles × CYCLE_TIME`
 *    加进 `necessaryTime`（= 账本），池 = `预算 − 账本` ⇒ 池**已经**不含 A45 时间。
 *    恒等式 `necessaryTime + basicAttackTime == frontlineTime` 在 6 个预设队 + 单人 c0/c6 上逐位成立
 *    （**恒等**，非近似）；若 A45 真重复占用，该式会被撑破。
 * ② **cap 在真实配置里从不绑**（闸门实测）：`⌊pool / CYCLE_TIME⌋` 需 pool < `exTotal×CYCLE_TIME`，
 *    而绑定的充要条件是回能速率 > `exConsume / CYCLE_TIME` ≈ **49.8 能量/秒**，实测 1041 回能
 *    ≈ 4.8（c0）/ 5.5（c6）能量/秒 ⇒ 差 **9~10 倍**。6 预设队 + 单人 c0~c6 共 13 个配置**全部**
 *    绑在 `exTotal`（层数预算）这一项上，cap 余量最少 +6 轮。
 *
 * **反向验证（本用例的负控，实测过会红）**：把艾莲式 carve 注入 `buildExecutions`
 * （循环行时长从聚合行挤出，只改这一个自由度）⇒ 判据②断言
 * `|necessary + pool − frontline| < 1e-6` 立刻被撑破：6 预设队破 9.6~11.2s，单人 c0 破 17.7s
 * —— 因为 estimate 已经把 A45 计进账本，再挤出一次就是**二次减法**（净占用凭空蒸发）。
 * ⚠ 这正是「按 §19.6 字面『由 basicAttackTime 解出 ⇒ 必须挤出』照抄会做错」的形态：
 * 判据要看**行时间记在哪一侧**（estimate 账本 / 聚合行池），不是看式子里有没有 `basicAttackTime`。
 */
describe('「11号」A45 循环行不重复占用平A池（§19.6-2 收口判据）', () => {
  const CYCLE_TIME = 1.828 * 0.5 + 1.383 * 0.5

  it('守恒恒等式：necessaryTime + basicAttackTime == frontlineTime（实时引擎，逐位）', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3 && p.team.includes('1041'))
    expect(presets.length, '1041 预设队缺失——本判据的覆盖面归零，必须补样').toBeGreaterThan(0)
    const broken: string[] = []
    for (const p of presets) {
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = useResourceCalc().resourceResult.value
      const ch = rr?.characters.find(c => c.agentId === '1041')
      expect(ch, `${p.id} 无 1041 资源结果`).toBeTruthy()
      const { necessaryTime, basicAttackTime, frontlineTime } = ch!.timeAllocation
      const gap = necessaryTime + basicAttackTime - frontlineTime
      if (Math.abs(gap) > 1e-6) {
        broken.push(`${p.id} nec ${necessaryTime.toFixed(3)} + pool ${basicAttackTime.toFixed(3)} `
          + `= ${(necessaryTime + basicAttackTime).toFixed(3)} ≠ front ${frontlineTime.toFixed(3)}（差 ${gap.toFixed(3)}）`)
      }
    }
    expect(broken, [
      'A45 循环行重复占用平A池（艾莲式双计）—— 守恒被撑破：',
      ...broken.map(b => '  · ' + b),
      '修法见 f70a402（从 basic_attack 聚合行挤出循环行时长），但先确认 estimate 侧是否也已计入',
      '（都计入 ⇒ 挤出是二次减法，实测反而破守恒，见本 describe 头注释的反向验证）。',
    ].join('\n')).toEqual([])
  })

  it('cap 不绑：真实配置里绑定项恒为 exTotal（层数预算），cap 余量 ≥ 1 轮', async () => {
    const weak: string[] = []
    for (const [tag, team] of [
      ...teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3 && p.team.includes('1041'))
        .map(p => [p.id, p.team as string[]] as const),
      ['single-c0', ['1041']] as const,
      ['single-c6', ['1041']] as const,
    ] as ReadonlyArray<readonly [string, string[]]>) {
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      for (const [i, agentId] of team.entries()) config.setAgent(i, agentId)
      const rr = useResourceCalc().resourceResult.value
      const ch = rr?.characters.find(c => c.agentId === '1041')
      expect(ch, `${tag} 无 1041 资源结果`).toBeTruthy()
      const pool = ch!.timeAllocation.basicAttackTime
      const ex = Math.floor(ch!.exSpecialCount ?? 0)
      const windows = ex + Math.floor(ch!.chainCountTotal ?? 0) + Math.floor(ch!.ultimateCount ?? 0)
      const cap = Math.floor(pool / CYCLE_TIME)
      // 绑定项 = min 的胜出者。真实配置里必须是 exTotal 或 windows（计数/资源驱动），
      // 绝不能是 pool cap —— 后者意味着 A45 行数由平A池解出（艾莲式判据的前提）。
      if (cap <= Math.min(windows, ex)) {
        weak.push(`${tag} pool=${pool.toFixed(3)} ex=${ex} windows=${windows} cap=${cap} ⇒ cap 绑（§19.6-2 前提成立，须改判）`)
      }
    }
    expect(weak, [
      'A45 的 ⌊pool/CYCLE_TIME⌋ cap 在真实配置里绑上了 —— §19.6-2 的前提假设成立，',
      '判定须从「合法」改判为「艾莲式双计」，并按 f70a402 形态挤出 + 补齐归因：',
      ...weak.map(w => '  · ' + w),
    ].join('\n')).toEqual([])
  })

  it('保守阈值：cap 绑定需要回能 > exConsume/CYCLE ≫ 实测回能（结构性差距，非采样巧合）', async () => {
    await setupHarness([{ agentId: '1041', cinemaLevel: 0 }])
    const ch = useResourceCalc().resourceResult.value?.characters.find(c => c.agentId === '1041')
    expect(ch).toBeTruthy()
    const consume = ch!.exSpecialEnergyConsume ?? 80
    const rateNeeded = consume / CYCLE_TIME  // 能量/秒：把 ex 推到 pool/CYCLE 所需
    const rateActual = (ch!.derivedEnergy ?? 0) / 180
    // 实测 c0：49.83 vs 4.82 ⇒ 10.35×。留 3× 余量作为「结构性差距」的保守断言
    //（若将来真有 +400% 回能手段把它推近，这条会红 ⇒ 正是该复核 §19.6-2 的时候）。
    expect(rateNeeded / rateActual, `cap 绑定所需回能 ${rateNeeded.toFixed(2)} /s vs 实测 ${rateActual.toFixed(2)} /s`)
      .toBeGreaterThan(3)
  })
})

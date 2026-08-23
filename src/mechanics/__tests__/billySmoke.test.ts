import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const biliLiuAxisText = readFileSync(new URL('../../../src/data/stunAxisPresets/比琉通用.json', import.meta.url), 'utf8')

describe('星徽·比利全管线冒烟（1531）', () => {
  it('EX 链/决意/星辉/煊赫星辉在资源池中正常产出', async () => {
    // 队伍：星徽·比利(6命) + 青衣(击破，触发额外能力) + 赛斯(防护)
    const { config } = await setupHarness([
      { agentId: '1531', cinemaLevel: 6 },
      { agentId: '1251' },
      { agentId: '1271' },
    ])

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const billy = out!.characters.find(c => c.agentId === '1531')!
    expect(billy.exSpecialCount).toBeGreaterThan(0)

    // 主循环：动力压制+孤轮免费衔接（HP 预算自动算满）；付费强特默认抓地为主、摇曳低（rockingRatio 默认 0.1）
    expect(billy.billyChain).toBeTruthy()
    expect(billy.billyChain!.axisMode).toBe(false)
    expect(billy.billyChain!.chain).toBeGreaterThan(0) // 动力压制链 = HP 预算自动
    expect(billy.billyChain!.rocking).toBeLessThan(billy.billyChain!.traction)
    expect(billy.billyChain!.traction).toBeGreaterThan(0)

    // 执行计划：动力压制/孤轮（免费衔接）+ 抓地/摇曳（付费强特）
    const moveIds = new Set(billy.executions.map(e => e.moveId))
    expect(moveIds.has('1531006')).toBe(true)
    expect(moveIds.has('1531008')).toBe(true)
    expect(moveIds.has('1531009')).toBe(true)

    // 决意：2 点/秒 × 全战斗时间（接战状态 = 整场战斗，180×2=360）+ attack_data_0 招式命中 → 最高马力星光
    const determination = billy.specResources?.['billy_determination']
    expect(determination).toBeTruthy()
    expect(determination.totalGain).toBeGreaterThan(0)
    expect(determination.gains['billy_frontline_determination_gain']).toBeCloseTo(180 * 2, 5)
    expect(determination.gains['billy_attack_data_gain']).toBeGreaterThan(0)
    // C1 进场闪能：核心 60 + 影画1 60 = 120
    expect(billy.energySource.initialGift).toBe(120)
    // C6：骑士飞踢/最高马力星光 贯穿增伤 +18%（进贯穿增伤乘区 exec.sheerDmgBonus）；通用增伤区只含 星辉40+C2 50
    const c6Ult = billy.executions.find(e => e.moveId === '1531016')
    expect((c6Ult as any).sheerDmgBonus ?? 0).toBe(18)
    expect((c6Ult as any).dmgBonus ?? 0).toBe(90)
    // C2 涡轮增压（6命含 2 命）：buffed 孤轮执行带暴伤 +50%
    const turboExec = billy.executions.find(e => e.moveName?.includes('涡轮增压'))
    if (turboExec) {
      expect((turboExec as any).critDmgBonus ?? 0).toBeGreaterThanOrEqual(50)
    }
    const fullThrottleExec = billy.executions.find(e => e.moveId === '1531010')
    if (determination.spendCounts?.['billy_max_power_spend'] > 0) {
      expect(fullThrottleExec).toBeTruthy()
      expect(fullThrottleExec!.damageMultiplier).toBeGreaterThan(2000)
    }

    // 星辉（额外能力已触发）：2 层封顶 → 目标招式 dmgBonus +40（C6 再叠 +18）
    const star = billy.specResources?.['billy_star_glow']
    expect(star).toBeTruthy()
    const patched = billy.executions.filter(e => ['1531010', '1531015', '1531016', '1531009'].includes(e.moveId ?? ''))
    for (const exec of patched) {
      expect((exec as any).dmgBonus ?? 0).toBeGreaterThanOrEqual(40)
    }

    // 6命煊赫星辉附伤（有终结/星光载体）
    const radiant = billy.executions.find(e => e.moveId === '1531_c6_radiant')
    if (billy.ultimateCount > 0) {
      expect(radiant).toBeTruthy()
      expect(radiant!.damageMultiplier).toBeGreaterThan(0)
    }

    // 全队伤害为正
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('失衡轴模式：轴内动作按捏轴执行，轴外剩余闪能打抓地', async () => {
    const { config } = await setupHarness([
      { agentId: '1531' },
      { agentId: '1251' },
      { agentId: '1271' },
    ])
    // 轴内每窗捏一条「动力压制链」（combos 'billy-ex-chain' 展开成 动力压制+孤轮+摇曳）
    config.useStunAxis = true
    config.stunAxes = [
      {
        name: '轴1',
        count: 3,
        actions: [{ slot: 0, moveId: 'billy-ex-chain', count: 1 }],
        basicFillerSlot: 0,
      },
    ]
    // 锁窗（2026-08-23）：充足性约束（4b9ab22）会把裸默认配置的失衡窗口压到 0，本用例验证轴内捏轴接线，
    // 按「操作够就能打 N 次失衡」口径锁 3 窗（与命座提升率页同款机制），隔离约束保持原场景。
    config.enemy.stunCountLock = 3

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const billy = out!.characters.find(c => c.agentId === '1531')!
    expect(billy.billyChain).toBeTruthy()
    expect(billy.billyChain!.axisMode).toBe(true)
    // 轴内捏了 3 条链 → 动力压制/孤轮/摇曳 各 ≥1（窗口数不足则更少，但必须按轴产生）
    expect(billy.billyChain!.chain).toBeGreaterThanOrEqual(1)
    expect(billy.billyChain!.rocking).toBeGreaterThanOrEqual(1)
    // 轴外剩余闪能打抓地
    expect(billy.billyChain!.tractionOut).toBeGreaterThanOrEqual(0)
    expect(billy.executions.some(e => e.moveId === '1531009')).toBe(true)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('比琉通用轴（1531+1481+1451）：轴1×3 + 轴2×1 可正常计算', async () => {
    const { config } = await setupHarness([
      { agentId: '1531', cinemaLevel: 6 },
      { agentId: '1481' },
      { agentId: '1451' },
    ])
    const preset = JSON.parse(biliLiuAxisText)
    expect(preset.axes[0].count).toBe(3) // 常规轴 ×3
    expect(preset.axes[1].count).toBe(1) // 喧响不够双连携 ×1
    config.useStunAxis = true
    config.stunAxes.splice(0, config.stunAxes.length, ...preset.axes)

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const billy = out!.characters.find(c => c.agentId === '1531')!
    expect(billy.billyChain?.axisMode).toBe(true)
    // 轴内动作：抓地轮毂/最高马力星光/终结技（含转大）/连携 均出现在执行计划
    const moveIds = new Set(billy.executions.map(e => e.moveId))
    expect(moveIds.has('1531009')).toBe(true)
    expect(moveIds.has('1531010')).toBe(true)
    expect(moveIds.has('1531015')).toBe(true)
    expect(moveIds.has('1531016')).toBe(true)
    // 轴外剩余闪能仍打抓地
    expect(billy.billyChain!.tractionOut).toBeGreaterThanOrEqual(0)
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('比琉自动轴：队伍含 1531+1481 自动开启并选用「比琉通用」预设（轴1×3 + 轴2×1）', async () => {
    const { config } = await setupHarness([
      { agentId: '1531', cinemaLevel: 6 },
      { agentId: '1481' },
      { agentId: '1451' },
    ])
    // 不手动设置轴/开关：自动轴总开关默认开 → 应自动命中比琉预设并计算
    expect(config.useStunAxis).toBe(false)
    expect(config.stunAxes.length).toBe(0)

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const billy = out!.characters.find(c => c.agentId === '1531')!
    expect(billy.billyChain?.axisMode).toBe(true)
    const moveIds = new Set(billy.executions.map(e => e.moveId))
    expect(moveIds.has('1531009')).toBe(true) // 抓地（轴内）
    expect(moveIds.has('1531010')).toBe(true) // 最高马力星光（轴内）
    expect(moveIds.has('1531016')).toBe(true) // 终结（含转大）
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)

    // 手动捏轴后自动让路（autoBillyActive 关闭；手动轴模式照常开启）
    config.useStunAxis = true
    config.stunAxes.push({ name: '手动轴', actions: [] })
    const calc2 = useResourceCalc()
    expect(calc2.autoActive.value).toBe(false)
    expect(calc2.resourceResult.value!.characters.find(c => c.agentId === '1531')!.billyChain?.axisMode).toBe(true)
  })

  it('章鱼+比利双主C弱队：比琉预设不匹配，章鱼体系通配接管（用户口径：不精细服务弱队组合）', async () => {
    const { config } = await setupHarness([
      { agentId: '1051' },
      { agentId: '1531' },
      { agentId: '1481' },
    ])

    const calc = useResourceCalc()
    // 比琉通用 [1531,1481,*] 槽0=1051 不命中；章鱼体系 [1051,*,*] 通配命中（伊德海莉主C常规轴）
    expect(calc.autoPreset.value?.team[0]).toBe('1051')
    expect(calc.autoActive.value).toBe(true)
  })

  it('非命破队友与 0 命比利也能正常计算', async () => {
    const { config } = await setupHarness([
      { agentId: '1531' },
      { agentId: '1251' },
      { agentId: '1271' },
    ])

    const calc = useResourceCalc()
    const out = calc.resourceResult.value
    expect(out).not.toBeNull()
    const billy = out!.characters.find(c => c.agentId === '1531')!
    expect(billy.exSpecialCount).toBeGreaterThan(0)
    expect(billy.energySource.initialGift).toBe(60) // 0 命：进场闪能仅核心 60
    // 0 命：无煊赫星辉附伤
    expect(billy.executions.some(e => e.moveId === '1531_c6_radiant')).toBe(false)
    // 无 C6 增伤
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })
})

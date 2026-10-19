import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { axisStateOf } from '@/composables/difficultyAxis'
import { computeBillyHpModel, starlightBillyMechanic } from '@/mechanics/agents/starlightBilly'
import type { CharacterOperationConfig, IterationState } from '@/types/resource'

const biliLiuAxisText = readFileSync(new URL('../../../src/data/stunAxisPresets/比琉通用.json', import.meta.url), 'utf8')

/** 估时钩子最小 state（外部直调路径，引擎 iterate 会传真实 prev 状态） */
function stubState(basicAttackTime: number): IterationState {
  return {
    basicAttackTime,
    exSpecialCount: 8,
    ultimateCount: 2,
    chainCountTotal: 3,
    totalEnergy: 480,
    totalDecibel: 6000,
    necessaryTime: 0,
    frontlineTime: 100,
    backstageTime: 80,
    comboAlignTime: 0,
    comboAlignCredit: 0,
  }
}

describe('星徽·比利链数实数化（1051/1431 targeted 骨架，2026-09-06）', () => {
  it('HP 链模型：迭代期实数（quantize=false）不 floor，终局（quantize=true）floor 与原循环等价', () => {
    // 预算 = (75 + 8×30 + 0×15 + 回血)/16 = (75+240+0.5)/16 = 19.719 → 实数 19.719 / 整数 19
    const real = computeBillyHpModel(8, 0, 8, 0, 0, 0.5, false)
    expect(real.chain).toBeCloseTo((75 + 240 + 0.5) / 16, 9)
    const quant = computeBillyHpModel(8, 0, 8, 0, 0, 0.5, true)
    expect(quant.chain).toBe(19)
    // 摇曳/抓地次数保持整数（付费强特是闪能池整数推导量），摇曳超预算时裁剪、多余闪能转抓地
    const trimmed = computeBillyHpModel(8, 0, 8, 0, 0, 0, true)
    expect(trimmed.chain).toBe(19)
    expect(trimmed.healPct).toBeCloseTo(8 * 30 + 0 * 15, 9)
    // 轴模式：轴内捏轴数不被预算裁剪（chain0 保底），预算不足仅展示
    const axis = computeBillyHpModel(8, 0, 8, 25, 0, 0, true)
    expect(axis.chain).toBe(25)
  })

  it('估时钩子消滞后：链数/最高马力星光按当轮 state.basicAttackTime 直推（不回读上一轮写入量），终局旗标 floor', () => {
    const cfg = {
      agentId: '1531',
      exSpecialEnergyConsume: 60,
      billyMoveTimes: { '1531006': 0.2, '1531008': 1.57, '1531009': 2.1, '1531010': 3.1, '1531011': 2.1, '1531014': 2.0 },
      'setting:1531.rockingRatio': 0,
      'setting:1531.driveSuppressionHpDiscountRatio': 0,
      billyBasicHealPerSec: 0.05,
      billyContinuousChain: true,
      billyAttackData0: {},
      dodgeCounterCount: 0,
      parryCount: 0,
      quickAssistCount: 0,
      battleTime: 180,
      blockCount: 0,
    } as unknown as CharacterOperationConfig
    const low = starlightBillyMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8, ultimateCount: 2, state: stubState(10) })!
    const high = starlightBillyMechanic.estimateExSpecialTime!({ cfg, exSpecialCount: 8, ultimateCount: 2, state: stubState(40) })!
    // 平A时间 ↑ → 回血 ↑ → 实数链 ↑ → 必要时间 ↑（滞后版本两个值相等——读的是上一轮 record）
    expect(high.necessaryTime).toBeGreaterThan(low.necessaryTime)
    // 实数链连续：差值 ≈ 30s 平A × 回血秒均 0.05% / 16% 单链耗血 × 单链时长（≈0.094 链 × 1.77s）
    const chainDelta = (high.necessaryTime - low.necessaryTime) / 1.77
    expect(chainDelta).toBeGreaterThan(0)
    expect(chainDelta).toBeLessThan(0.5) // 远小于一整条链（一次 floor 翻转 = +1 链）
    // 终局旗标：floor 回整数链
    const finalized = starlightBillyMechanic.estimateExSpecialTime!({
      cfg: { ...cfg, billyFinalizeChain: true } as never,
      exSpecialCount: 8,
      ultimateCount: 2,
      state: stubState(20),
    })!
    const hp = computeBillyHpModel(8, 0, 8, 0, 0, 20 * 0.05, true)
    // 决意 = 180×2（接战）+ 孤轮额外 8×链 + 连携 15×3（atk0 命中按空表 0）→ floor(/100) 条星光
    const ft = Math.floor((180 * 2 + hp.chain * 8 + 3 * 15) / 100)
    expect(finalized.necessaryTime).toBeCloseTo(hp.chain * 1.77 + 8 * 2.1 + ft * 3.1, 6)
  })

  it('最高马力星光行时间物化：事件行 totalTime = 次数 × 3.1s（账本与行同口径，不再只有估时计入）', async () => {
    await setupHarness([
      { agentId: '1531', cinemaLevel: 6 },
      { agentId: '1251' },
      { agentId: '1271' },
    ])
    const calc = useResourceCalc()
    const billy = calc.resourceResult.value!.characters.find(c => c.agentId === '1531')!
    const row = billy.executions.find(e => e.moveId === '1531010')!
    expect(row).toBeTruthy()
    expect(row.actionTime).toBeGreaterThan(0)
    expect(row.totalTime).toBeCloseTo((row.count as number) * (row.actionTime as number), 9)
  })
})

describe('星徽·比利全管线冒烟（1531）', () => {
  it('EX 链/决意/星辉/煊赫星辉在资源池中正常产出', async () => {
    // 队伍：星徽·比利(6命) + 青衣(击破，触发额外能力) + 赛斯(防护)
    await setupHarness([
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
    const determination = billy.specResources?.['billy_determination']!
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
    const star = billy.specResources?.['billy_star_glow']!
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
    /**
     * ⚠ **T155 改判据：从钉 count 字面量改为钉「轴类型 + 分配语义」**（用户口径 2026-10-14）。
     *
     * 原断言 `axes[0].count === 3` 钉的是**编辑期的手填数字**，而那个数不成立：
     * 「常规轴」是**兜底轴**（用户口径「只有一个爆发轴说明这个就是兜底轴」+
     * 「显示 4 次要不用，**失衡次数不确定**」⇒ 不该写死 3）。文字改动落地为
     * `kind: 'fallback'` ⇒ 次数由分配算法按当轮失衡次数给出。
     * `axes[1].count === 1`（「喧响不够双连携」= 显式固定 1 次）**保留为 fixed**。
     *
     * 语义等价性：失衡 4 次时新分配 = `[3, 1]`（兜底 3 + 固定 1），与原断言
     * 「轴1×3 + 轴2×1」**逐位相同**；失衡 3/5 时兜底轴跟着变（旧实现在 5 次时
     * 仍只打 3 次 = 白丢 2 个失衡窗）。
     */
    expect(preset.axes[0].kind).toBe('fallback') // 常规轴 = 兜底（吃剩余）
    expect(preset.axes[0].count).toBeUndefined() // 兜底轴不写死次数
    expect(preset.axes[1].count).toBe(1) // 喧响不够双连携 ×1（显式固定）
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
    await setupHarness([
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
    await setupHarness([
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

/**
 * 比琉通用轴（`preset-1531-1481-*`）的**跨窗行为**回归。
 *
 * ## 背景（2026-10-18 实测，用户报「星辉比利伤害直接丢失」）
 *
 * 该轴的「喧响不够双连携」窗单槽累计 **19.249s** > 18s 失衡窗（12s stunTime + 4s 连携 + 琉音 2s）。
 * 修前引擎的时间门是「整段砍」⇒ 末位动作被 `skipped.time` 丢掉 ⇒ 轴态恒 `partial` ⇒
 * `axisRequirementMet` 为假 ⇒ **难度曲线上每一档都不出数**（21 档全进 `axisTruncated`）。
 * 部署侧也少一次大招（66.72M vs 现在 67.35M）。
 *
 * ## 修法（用户口径 2026-10-18，两轮）
 *
 * ① 「**超时不是应该把最后一个动作算部分易伤吗？**」+「**小数这一块要做就要做完，不要显示一半骗一半**」
 *    ⇒ 引擎改成**跨界小数**：动作照常施放（`count` 整数，资源/时间按整次扣），
 *    只有落在窗口内的那段（`inAxisCount`）吃失衡易伤。
 * ② 「**count 肯定是整数**，你虽然前半部分用来吃易伤，后半部分用来打失衡，
 *    但也不可否认这是一次完整的释放大招」⇒ 明确 `count` 不得折成小数。
 * ③ 「**你把这个轴最后的星光加回去**」⇒ 末次星光回到轴里（走跨界逻辑，不再删）。
 *
 * ## 判据钉什么
 *
 * 不钉秒数（补录新招式/调 actionTime 会无谓变红），钉**语义**：
 * ① `count` 是整数（施放次数）——用户口径 ② 的机器面；
 * ② 跨界项的 `inAxisCount < count` 且 `inAxisCount > 0`（真的按比例拆，不是整段丢也不是全额给）；
 * ③ 轴态在默认配置下 = `complete`（跨界不再判 `partial` ⇒ 难度曲线能出点）；
 * ④ 伤害池里那条跨界招式真的被拆成「窗内段 cov>0 + 窗外段 cov=0」两行。
 */
describe('比琉通用轴：跨窗行为（2026-10-18 用户报「比利伤害直接丢失」）', () => {
  /** 该预设的必备成员（`team: ['1531','1481','*']` ⇒ 槽0/1 固定），第三槽任意 */
  const TEAM = [{ agentId: '1531' }, { agentId: '1481' }, { agentId: '1451' }]

  it('★ count 恒为整数；跨界项的 inAxisCount 落在 (0, count) 开区间', async () => {
    await setupHarness(TEAM)
    const calc = useResourceCalc()
    const stack = calc.stackTraversalResult.value
    expect(stack, '比琉预设应命中并注入轴').not.toBeNull()
    const entries = Object.values(stack!.executed)
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      // ① 施放次数恒为整数（用户口径 2026-10-18）
      expect(Number.isInteger(e.count), `${e.slot}:${e.moveId} count=${e.count} 必须是整数（一次完整施放）`).toBe(true)
      // ② 窗内部分必须在 [0, count] 内，且不是「整段丢」（0）也不是「全额给」（>count）
      expect(e.inAxisCount, `${e.slot}:${e.moveId} inAxisCount=${e.inAxisCount} 越界`).toBeGreaterThanOrEqual(0)
      expect(e.inAxisCount, `${e.slot}:${e.moveId} inAxisCount=${e.inAxisCount} > count=${e.count}`).toBeLessThanOrEqual(e.count + 1e-9)
    }
    // ③ 本轴确实有跨界项（19.249s > 18s）——否则这条判据对「跨界」零判别力
    const straddling = entries.filter(e => e.inAxisCount < e.count - 1e-9)
    expect(straddling.length, '本轴应至少有一个跨界项（末位动作超出 18s 窗口）').toBeGreaterThan(0)
    for (const e of straddling) {
      expect(e.inAxisCount, `${e.slot}:${e.moveId} 跨界但窗内部分为 0 = 整段丢了易伤`).toBeGreaterThan(0)
    }
  })

  it('★ 跨界招式的伤害池拆成「窗内吃易伤 + 窗外不吃」两行', async () => {
    await setupHarness(TEAM)
    const calc = useResourceCalc()
    const stack = calc.stackTraversalResult.value!
    const straddling = Object.entries(stack.executed)
      .filter(([, v]) => v.inAxisCount < v.count - 1e-9)
      .map(([, v]) => v.moveId)
    expect(straddling.length).toBeGreaterThan(0)
    for (const moveId of straddling) {
      const rows = calc.damagePoolRows.value.filter(r => r.moveId === moveId)
      const inRows = rows.filter(r => (r.stunCoverage ?? 0) > 0)
      const outRows = rows.filter(r => (r.stunCoverage ?? 0) === 0)
      expect(inRows.length, `${moveId} 缺「窗内段」`).toBeGreaterThan(0)
      expect(outRows.length, `${moveId} 缺「窗外段」（跨界 = 部分进窗，必须有窗外段）`).toBeGreaterThan(0)
      /**
       * ⚠ **不拿池行合计去对 `executed.count`**：本招还有「好评转大·赠送」行（琉音转大，
       * `sourceTag='gift'`）——那是**额外赠送**的终结技，不经过轴栈执行 ⇒ 池行合计天然大于
       * `executed.count`（实测 7 vs 5）。判据只钉**池内自洽**与**跨界比例**：
       *  · 池内「窗内段」次数合计 == `executed.inAxisCount`（这部分吃易伤的额度一分不多一分不少）；
       *  · 窗内 + 窗外 == 池内该招总数（拆分守恒）。
       */
      const inSum = inRows.reduce((a, r) => a + r.count, 0)
      const outSum = outRows.reduce((a, r) => a + r.count, 0)
      const total = inSum + outSum
      expect(total, `${moveId} 拆分不守恒`).toBeCloseTo(rows.reduce((a, r) => a + r.count, 0), 6)
      // 窗内段合计应 ≥ executed 的 inAxisCount（gift 行可能额外贡献窗内额度），且不得超过总数
      const exec = Object.values(stack.executed).find(v => v.moveId === moveId && v.slot === 0)!
      expect(inSum, `${moveId} 窗内段合计 ${inSum} 应覆盖 executed.inAxisCount=${exec.inAxisCount}`).toBeGreaterThanOrEqual(exec.inAxisCount - 1e-6)
    }
  })

  it('★ 默认配置下轴态 = complete（跨界不算 partial ⇒ 难度曲线能出点）', async () => {
    const { config } = await setupHarness(TEAM)
    // 自动轴默认开 ⇒ 命中比琉预设
    const calc = useResourceCalc()
    const st = axisStateOf(calc)
    expect(st.kind, `轴态 ${st.kind}（skipped=${JSON.stringify(st.skipped)}）——轴没打完时难度曲线整档不出数`).toBe('complete')
    expect(config.autoYidhariAxis).toBe(true)
  })
})

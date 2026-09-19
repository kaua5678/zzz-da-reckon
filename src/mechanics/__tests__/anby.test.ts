import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  computeAnbyParallelCircuitEnergy,
  computeAnbyC4ChargeEnergy,
  ANBY_C2_EX_STUN,
  ANBY_C2_LIGHTNING_DMG,
  ANBY_C6_CHARGE_DMG,
  ANBY_CORE_STUN_BONUS,
} from '../agents/anby'

describe('安比（1011）并联电路/电荷传导 纯函数', () => {
  it('并联电路：min(闪反次数, floor(t/5)) × 7.2', () => {
    // 180s → floor(180/5)=36 上限；闪反 10 次 → 10×7.2=72
    expect(computeAnbyParallelCircuitEnergy(10, 180)).toBeCloseTo(72)
    // 闪反 40 次 → 被 36 上限钳制
    expect(computeAnbyParallelCircuitEnergy(40, 180)).toBeCloseTo(36 * 7.2)
  })

  it('电荷传导：3 + min(6, floor(能量效率/12)×2)', () => {
    expect(computeAnbyC4ChargeEnergy(0)).toBe(3)
    expect(computeAnbyC4ChargeEnergy(12)).toBe(5)
    expect(computeAnbyC4ChargeEnergy(36)).toBe(9) // 3 + min(6, 6) = 9
    expect(computeAnbyC4ChargeEnergy(100)).toBe(9) // 封顶 +6
  })
})

describe('安比（1011）波动电压/影画2 招式限定（patchExecutions）', () => {
  // ⚠ 2026-09-17 用户裁决（契约 data/recordings/1011.json）：波动电压是**招式限定**——
  // 原文「安比在[普通攻击]第三段后发动[普通攻击：落雷]、[特殊技]或[强化特殊技]时，招式造成的
  // 失衡值提升64%」。旧断言把 `basic_attack` 聚合行也算作吃 +64% 的载体（旧值 64），
  // 那是**过范围**（伏特速攻 #1~#4 不在原文名单里）⇒ 现改为断 落雷/特殊技/强特 三条 + 聚合行 0。
  it('核心被动波动电压：落雷/特殊技/强特 失衡 +64；平A聚合行与伏特速攻段不吃', async () => {
    await setupHarness([
      { agentId: '1011', cinemaLevel: 0, dodgeCounterCount: 6, parryCount: 10 },
      { agentId: '1381' }, // 零号·安比（电，同属性 → 触发并联电路）
      { agentId: '1211' }, // 丽娜（电，同属性）
    ])
    const calc = useResourceCalc()
    const anby = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
    const ex = anby.executions.find(e => e.moveId === '1011007')
    const basic = anby.executions.find(e => e.moveId === 'basic_attack')
    expect(ex).toBeTruthy()
    expect(basic).toBeTruthy()
    expect(ex!.stunBuildUpBonus ?? 0).toBe(ANBY_CORE_STUN_BONUS)
    // 旧值 64（聚合行整体）→ 新值 0：聚合行已降级为时间/回能载体，且不在原文招式名单内
    expect(basic!.stunBuildUpBonus ?? 0).toBe(0)
    // 伏特速攻 #1~#4（分段行）同样不吃
    for (const id of ['1011001', '1011002', '1011003', '1011004']) {
      const seg = anby.executions.find(e => e.moveId === id)
      expect(seg, `${id} 分段行应存在`).toBeTruthy()
      expect(seg!.stunBuildUpBonus ?? 0, `${id} 不该吃波动电压`).toBe(0)
    }
  })

  it('影画2：0 命无增伤，2 命落雷伤害 +30×覆盖 / 强特失衡 +10×(1-覆盖)', async () => {
    await setupHarness([
      { agentId: '1011', cinemaLevel: 0, dodgeCounterCount: 6 },
      { agentId: '1381' },
      { agentId: '1211' }, // 丽娜（电，同属性）
    ])
    let calc = useResourceCalc()
    const c0 = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
    const lightning0 = c0.executions.find(e => e.moveId === '1011005')
    expect((lightning0?.dmgBonus ?? 0)).toBe(0)

    await setupHarness([
      { agentId: '1011', cinemaLevel: 2, dodgeCounterCount: 6 },
      { agentId: '1381' },
      { agentId: '1211' },
    ])
    calc = useResourceCalc()
    const c2 = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
    // 旧断言读 basic_attack 聚合行（旧值 >0）→ 现读**落雷分段行**：影画2 原文限定「[普通攻击：落雷]
    // 命中…伤害提升30%」，挂在聚合行上会连伏特速攻一起加成（过范围）。
    // 默认覆盖率 0.5 → 30 × 0.5 = +15
    const lightning2 = c2.executions.find(e => e.moveId === '1011005')
    expect(lightning2).toBeTruthy()
    expect(lightning2!.dmgBonus ?? 0).toBeCloseTo(ANBY_C2_LIGHTNING_DMG * 0.5, 5)
    // 聚合行不吃（旧值 >0）
    expect(c2.executions.find(e => e.moveId === 'basic_attack')!.dmgBonus ?? 0).toBe(0)
  })
})

describe('安比（1011）普攻元素分段（原文口径，用户 2026-09-17 裁决②）', () => {
  /**
   * ★ **本条补的是一个已实测的判据缺口**（2026-09-18 round 23 契约批的证伪结论）：
   * 裁决②落地后，把 1011001/2/3 的元素**翻回 electric** ⇒ 58 个提及 1011 的测试文件（794 例）
   * 全绿 + `timeGolden` 全绿 + 探针伤害**逐位不变**。根因：`timeGolden.diffEntry` 把**纯 dmg
   * 差异归 info 不判红**（该文件头自陈的盲区），而 1011 单独跑时元素只进伤害、不改时间账。
   * ⇒ 该机制此前**没有任何判据能发现回退**。本条就是那个缺失的判据。
   *
   * 原文（`data/raw/nanoka_missing/full/1011.json` basic 段）：
   * 「向前方进行至多四段的斩击，**前三段**造成物理伤害，**第四段**造成电属性伤害」；
   * 落雷「造成电属性伤害」；冲刺攻击「造成物理伤害」。
   *
   * ⚠ 断言读的是**真管线**的伤害池行（`calc.damagePoolRows`），不是 catalog 字段——
   * 只有这样才能同时抓住「catalog 被改回去」与「模块把 element 写死」两种回退
   * （契约批实测：模块侧 `pushAnbyBasicSegment` 写死 `element:'electric'` 同样 794 例全绿）。
   */
  it('真管线：伏特速攻 #1~#3 物理 / #4 电 / 落雷电（伤害池行 element）', async () => {
    await setupHarness([
      { agentId: '1011', cinemaLevel: 0 },
      { agentId: '1381' },
      { agentId: '1211' },
    ])
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value as { moveId?: string; element?: string }[]
    const elementsOf = (moveId: string) =>
      [...new Set(rows.filter(r => r.moveId === moveId).map(r => String(r.element)))].sort()
    // 前三段：物理（旧值 electric —— 导入器把角色元素铺满每招）
    expect(elementsOf('1011001'), '伏特速攻 #1').toEqual(['physical'])
    expect(elementsOf('1011002'), '伏特速攻 #2').toEqual(['physical'])
    expect(elementsOf('1011003'), '伏特速攻 #3').toEqual(['physical'])
    // 第四段与落雷：电
    expect(elementsOf('1011004'), '伏特速攻 #4').toEqual(['electric'])
    expect(elementsOf('1011005'), '落雷').toEqual(['electric'])
    // ⚠ 冲刺攻击（1011008）**不在执行计划里**（无独立行）⇒ 伤害池无其行，本测试无法覆盖它。
    // 这是**已知通道缺口**（与「平A池不区分冲刺段」同源，见 `anby.ts#computeAnbyChargeConsumed`
    // 头注释），不是本测试的疏漏。它的 catalog 元素由 `scripts/patch-move-elements.mjs` 覆盖
    // （该脚本的 delta 表里 1011008 electric→physical 有记录），但**没有真管线判据**。
    // 至少要有伤害行落进池子，否则上面的断言会因「空数组」假绿
    expect(rows.filter(r => r.moveId === '1011001').length, '分段行必须真的进伤害池').toBeGreaterThan(0)
    // 反向哨兵：若模块把 element 写死成 electric（契约批实测过的回退形态），上面 #1~#3 会红。
  })
})

describe('安比滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  // ⚠ 2026-09-20 round 48 管理员AA 分诊：本用例**旧版是直调 `patchExecutions` 并手写
  // `cfg: { anbyCinemaLevel: 2, anbyC2StunCoverage: cov }`** —— 它手工填了一个**生产代码从不写入**
  // 的字段，于是"滑块生效"被证明成了假象：真管线里 `buildAnbyCharConfig` 不写 `anbyC2StunCoverage`，
  // `patchAnbyExecutions` 的 `?? 0.5` 永远生效 ⇒ 滑块在 UI 上可拖但**恒等 0.5**
  // （实测滑块 0 与 1 的落雷 `dmgBonus` 都是 15）。修法 = 走真管线断言，让"手写 cfg"再也不能
  // 掩盖断链：滑块值必须经 `setting:` 通道流到执行行。
  it('anby.c2StunCoverage 经真管线生效：滑块 0 → 落雷 +0 / 强特失衡 +10；滑块 1 → +30 / +0', async () => {
    const team = () => [
      { agentId: '1011', cinemaLevel: 2, dodgeCounterCount: 6 },
      { agentId: '1381' }, // 零号·安比（电，同属性 → 触发并联电路）
      { agentId: '1211' }, // 丽娜（电，同属性）
    ]
    const readRows = async (cov: number) => {
      const { config } = await setupHarness(team())
      for (const buff of config.globalBuffs) buff.enabled = false // 剔除队伍 buff 干扰
      config.setMechanicSetting('anby.c2StunCoverage', cov)
      const calc = useResourceCalc()
      const anby = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
      const lightning = anby.executions.find(e => e.moveId === '1011005')!   // 落雷（影画2 增伤载体）
      const exSpecial = anby.executions.find(e => e.moveId === '1011007')!   // 强特（互补项载体）
      return {
        lightningDmg: lightning.dmgBonus ?? 0,
        exStun: (exSpecial.stunBuildUpBonus ?? 0) - ANBY_CORE_STUN_BONUS, // 扣除波动电压 +64 本底
      }
    }
    const off = await readRows(0)
    const on = await readRows(1)
    // 落雷增伤随覆盖率 0→1：+0 → +30
    expect(off.lightningDmg, '滑块=0 时落雷不该吃影画2 增伤').toBeCloseTo(0, 1)
    expect(on.lightningDmg, '滑块=1 时落雷吃满 +30').toBeCloseTo(ANBY_C2_LIGHTNING_DMG, 1)
    // 强特失衡互补：+10 → +0
    expect(off.exStun, '滑块=0 时强特吃满互补 +10').toBeCloseTo(ANBY_C2_EX_STUN, 1)
    expect(on.exStun, '滑块=1 时强特不吃互补').toBeCloseTo(0, 1)
    // 半覆盖 = 线性折算（证明滑块是按比例进算式，而不是 0/1 开关）
    const half = await readRows(0.5)
    expect(half.lightningDmg).toBeCloseTo(ANBY_C2_LIGHTNING_DMG * 0.5, 1)
    expect(half.exStun).toBeCloseTo(ANBY_C2_EX_STUN * 0.5, 1)
  })
})

describe('安比影画6 充能电场（执行级，2026-09-17 用户裁决③）', () => {
  // ⚠ 旧口径 = **面板级**全局 +45（`applyPanel` 里 `panel.dmgBonus += 45`），旧断言读
  // `calc.panels.value[0].dmgBonus === 45`。用户裁决原文「发动[强化特殊技]时…消耗1层充能，
  // 使**当前招式**造成的伤害提升45%」⇒ 只有消耗了充能的**命中行**吃 +45，面板级会让强特/终结/
  // 连携/异常全部吃满（过范围）。旧断言已随之失效（面板 dmgBonus 现为 0），改为执行级断言。
  it('执行级：C6 平A分段行吃 +45（按消耗次数），C0 不吃；面板 dmgBonus 不再 +45', async () => {
    const { config } = await setupHarness([
      { agentId: '1011', cinemaLevel: 6, dodgeCounterCount: 6 },
      { agentId: '1381' },
      { agentId: '1211' },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false // 剔除队伍 buff 干扰，只看充能贡献
    const calc = useResourceCalc()
    void calc.damagePoolRows.value // 触发 calcOutput
    // 面板级不再 +45（旧值 45）
    expect(calc.panels.value?.[0]?.dmgBonus ?? 0).toBe(0)
    const anby = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
    const charged = anby.executions.filter(e => (e.dmgBonus ?? 0) >= ANBY_C6_CHARGE_DMG)
    expect(charged.length, 'C6 应有吃充能的命中行').toBeGreaterThan(0)
    // 吃充能的行必须**只**是平A分段（#1~#4/落雷）——强特/终结/连携/闪反/支援都不该吃
    for (const e of charged) {
      expect(['1011001', '1011002', '1011003', '1011004', '1011005'], `${e.moveId} 不该吃充能`).toContain(e.moveId)
    }
    // 消耗次数 = Σ 吃充能行的 count，封顶 min(8×强特次数, 平A命中数)。
    // ⚠ 不能读 `cfg.anbyBasicChargedHits`——`materializeRows` 对 cfg 快照/恢复（该写入被丢弃），
    //   且这里是 CharacterResourceResult 不是 cfg。直接数行才是真判据。
    const chargedHits = charged.reduce((sum, e) => sum + (e.count ?? 0), 0)
    const totalHits = anby.executions
      .filter(e => ['1011001', '1011002', '1011003', '1011004', '1011005'].includes(e.moveId ?? ''))
      .reduce((sum, e) => sum + (e.count ?? 0), 0)
    expect(chargedHits).toBeGreaterThan(0)
    expect(chargedHits).toBeLessThanOrEqual(totalHits)
    // 强特 9 次 × 8 层 = 72 层预算 > 平A命中数 ⇒ 本配装下**全部**平A命中都吃充能
    expect(chargedHits).toBe(totalHits)
  })

  it('C0 不吃充能（执行级门控）', async () => {
    await setupHarness([
      { agentId: '1011', cinemaLevel: 0, dodgeCounterCount: 6 },
      { agentId: '1381' },
      { agentId: '1211' },
    ])
    const calc = useResourceCalc()
    const anby = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
    for (const e of anby.executions) {
      expect(e.dmgBonus ?? 0, `${e.moveId} C0 不该有充能增伤`).toBe(0)
    }
  })
})

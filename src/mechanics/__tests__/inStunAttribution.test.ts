/**
 * 失衡内异常系统 v2.1（2026-08-24）：异常事件接入失衡轴——
 * ①时间线门槛推广：axisActive 即算（不限定南宫羽），非轴模式保持 null；
 * ②异放/极性紊乱 dominant 归因：轴模式取时间线实际活跃元素（替换全局覆盖率近似），
 *   次数守恒不丢；③南宫羽颤音自动层数注入通道不受门槛推广影响。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

type TeamSpec = Array<{ agentId: string; cinemaLevel?: number }>

async function setupTeam(team: TeamSpec, opts: { axis?: boolean } = {}) {
  const { config, catalog } = await setupHarness(team)
  if (opts.axis) {
    config.useStunAxis = true
    // 轴内动作跨两属性：南宫羽地雷撞#3（以太 1511006）+ 格莉丝强特（电 1181005）
    config.stunAxes = [{
      name: '归因测试轴',
      count: 3,
      // 次数按阈值表设计：以太 1511006 每击 686.8（5 击过第一管 3000）、电 1181005 每击 194.1
      // （16 击过管）——两元素各触发一次
      actions: [
        { slot: 0, moveId: '1511006', count: 6 },
        { slot: 1, moveId: '1181005', count: 18 },
      ],
      basicFillerSlot: 0,
    }]
  }
  const calc = useResourceCalc()
  return { config, catalog, calc }
}

describe('失衡内异常时间线门槛推广（v2.1）', () => {
  it('无南宫羽的异常队伍：轴模式有摘要，非轴模式为 null', async () => {
    const axisOn = await setupTeam([{ agentId: '1181' }, { agentId: '1371' }], { axis: true })
    const st = axisOn.calc.inStunAnomalyState.value
    expect(st, '轴模式+有积蓄贡献时摘要必须存在').not.toBeNull()
    expect(st!.windows).toBeGreaterThan(0)
    const axisOff = await setupTeam([{ agentId: '1181' }, { agentId: '1371' }], { axis: false })
    expect(axisOff.calc.inStunAnomalyState.value).toBeNull()
  })

  it('双属性轴：摘要含两个元素的活跃覆盖', async () => {
    const { calc } = await setupTeam([{ agentId: '1511' }, { agentId: '1181' }], { axis: true })
    const st = calc.inStunAnomalyState.value!
    expect(st.elements.length).toBeGreaterThanOrEqual(2)
    for (const el of st.elements) {
      expect(el.triggerCount).toBeGreaterThanOrEqual(0)
      expect(el.avgCoverage).toBeGreaterThanOrEqual(0)
      expect(el.avgCoverage).toBeLessThanOrEqual(1)
    }
  })
})

describe('异常事件 dominant 归因走失衡内时间线（v2.1）', () => {
  it('异放：轴模式下行元素 ∈ 时间线活跃元素集，且次数守恒', async () => {
    const { calc } = await setupTeam([{ agentId: '1511' }, { agentId: '1181' }], { axis: true })
    const st = calc.inStunAnomalyState.value!
    const els = new Set(st.elements.map(e => e.element))
    expect(els.size).toBeGreaterThan(0)
    const releases = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.agentId === '1511')
    const eventCount = (calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .anomalyEventExecutions ?? [])
      .filter(e => e.eventType === 'release')
      .reduce((s, e) => s + Math.max(0, Math.floor(e.count)), 0)
    expect(releases.reduce((s, r) => s + r.count, 0)).toBe(eventCount)
    for (const r of releases) {
      expect(els.has(r.element), `异放元素 ${r.element} 不在失衡内活跃元素集 ${[...els]}`).toBe(true)
    }
  })

  it('极性紊乱：轴模式下行元素 ∈ 时间线活跃元素集', async () => {
    const { calc } = await setupTeam([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }], { axis: true })
    const st = calc.inStunAnomalyState.value!
    if ((calc.anomalyPoolResult.value?.disorderDamage?.avgDamage ?? 0) <= 0 || st.elements.length === 0) return
    const els = new Set(st.elements.map(e => e.element))
    const polar = calc.damagePoolRows.value.filter(r => r.type === '极性紊乱' && r.agentId === '1511')
    expect(polar.length).toBeGreaterThan(0)
    for (const r of polar) {
      expect(els.has(r.element), `极性紊乱元素 ${r.element} 不在失衡内活跃元素集`).toBe(true)
    }
  })

  it('南宫羽颤音自动层数吃轴内真实触发：2 触发/窗 → 层数2，C2 倍率 450×(1+35%×2)=765%', async () => {
    const { calc } = await setupTeam([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }], { axis: true })
    const ev = (calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_vibrato_release')
    expect(ev).toBeTruthy()
    // 轴内以太+电各触发一次 → 平均每窗 2 次 → 自动层数 min(4, floor(2))=2（非轴满层4=1080%，见 nangongSmoke）
    expect(ev!.fields).toContain('vibratoStacks=2')
    expect(ev!.fields).toContain('releaseMultiplier=765')
  })
})

describe('Boss 异常状态轴：极性紊乱按触发时刻状态归因（v2.2）', () => {
  it('双属性错峰触发：极性紊乱次数按状态段时占拆分（代表窗 3 取样 → 以太段 1、电段 2 → 总 9 次拆 3/6）', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.useStunAxis = true
    // 以太地雷撞 @0s 触发（第5击过管），电强特 @8s 才开始积蓄（第16击过管）
    // → 状态链 以太[0,8) → 电[8,窗尾)；紊乱替换链 电→…不影响消费端「当时状态」归因
    config.stunAxes = [{
      name: '点时归因轴',
      count: 3,
      actions: [
        { slot: 0, moveId: '1511006', count: 6, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 8 },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const boss = calc.bossAnomalyState.value!
    expect(boss.stateChainsPerWindow[0].map(s => s.element)).toEqual(['ether', 'electric'])
    // 替换型紊乱点：电替换以太 @8s，归因取被替换的原状态（以太）
    expect(boss.disorders).toEqual([{ windowIndex: 0, time: 8, element: 'ether' }])
    // 总次数守恒（事件侧收敛后的实际失衡次数为准）。
    // 代表窗取样（D=22s、n=3）：t≈3.7 落以太段、11 落电段[8,18)、18.3 落电过期后的空档
    // → 回退触发者自身元素（南宫羽=以太）→ 以太:电 = 2:1 → 6 次拆 4/2
    const evPolar = (calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_polar_disorder')!
    const polar = calc.damagePoolRows.value.filter(r => r.type === '极性紊乱' && r.agentId === '1511')
    expect(polar.reduce((s, r) => s + r.count, 0)).toBe(evPolar.count)
    const byEl = new Map(polar.map(r => [r.element, r.count]))
    expect(byEl.get('ether')).toBe(Math.round((evPolar.count / 3) * 2))
    expect(byEl.get('electric')).toBe(evPolar.count - Math.round((evPolar.count / 3) * 2))
  })

  it('异放同口径：无手动分配时按状态段取样归因', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.useStunAxis = true
    config.stunAxes = [{
      name: '点时归因轴',
      count: 3,
      actions: [
        { slot: 0, moveId: '1511006', count: 6, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 8 },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    // 颤音异放次数=收敛后失衡数×覆盖 → 代表窗取样 1 点 @D/2≈11s 落电段[8,18) → 全部归电
    const evRel = (calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_vibrato_release')!
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.id.includes('nangong_vibrato_release'))
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(evRel.count)
    expect(rel.length).toBeGreaterThan(0)
    for (const r of rel) expect(r.element).toBe('electric')
  })

  it('手动 releaseShare 覆盖点时归因：回落权重路径且次数守恒', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.useStunAxis = true
    config.stunAxes = [{
      name: '手动覆盖轴',
      count: 3,
      actions: [
        { slot: 0, moveId: '1511006', count: 6, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 8 },
      ],
      basicFillerSlot: 0,
    }]
    // 手动：电全拿、以太不给 → 检测到任一链上元素有覆盖即走权重路径
    config.setMechanicSetting('nangong.releaseShare:electric', 1)
    config.setMechanicSetting('nangong.releaseShare:ether', 0)
    const calc = useResourceCalc()
    const evRel = (calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_vibrato_release')!
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.id.includes('nangong_vibrato_release'))
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(evRel.count)
    expect(rel.filter(r => r.element === 'ether').reduce((s, r) => s + r.count, 0)).toBe(0)
  })

  it('进窗初始状态可指定（v2 需求②）：entryElement 参与替换循环，紊乱归因取初始状态', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.useStunAxis = true
    config.setMechanicSetting('boss.entryAnomaly', 1) // 火
    config.stunAxes = [{
      name: '进窗状态轴',
      count: 3,
      actions: [
        { slot: 0, moveId: '1511006', count: 6, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 8 },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const boss = calc.bossAnomalyState.value!
    // 开场火 @0s 被以太替换、@8s 电再替换以太 → 紊乱归因链 火→以太
    expect(boss.disorders.map(d => d.element)).toEqual(['fire', 'ether'])
    // 零长开场段被丢弃，可见链仍为 以太→电
    expect(boss.stateChainsPerWindow[0].map(s => s.element)).toEqual(['ether', 'electric'])
  })
})

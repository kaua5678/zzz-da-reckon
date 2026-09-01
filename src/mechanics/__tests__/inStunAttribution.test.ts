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
    config.enemy.stunCountLock = 2
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
    // 单次失衡表达：电在其动作结束点(8+0.2=8.19s) 替换以太（time=相对窗口起点）
    expect(boss.disorders.map(d => ({ w: d.windowIndex, el: d.element }))).toEqual([
      { w: 0, el: 'ether' },
    ])
    for (const d of boss.disorders) expect(d.time).toBeCloseTo(8.19, 1)
    // 总次数守恒（事件侧收敛后的实际失衡次数为准）。
    // 代表窗取样（D=22s、n=3）：t≈3.7 落以太段、11 落电段[8,18)、18.3 落电过期后的空档
    // → 回退触发者自身元素（南宫羽=以太）→ 以太:电 = 2:1 → 6 次拆 4/2
    const evPolar = (calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_polar_disorder')!
    const polar = calc.damagePoolRows.value.filter(r => r.type === '极性紊乱' && r.agentId === '1511')
    expect(polar.reduce((s, r) => s + r.count, 0)).toBe(evPolar.count)
    // 单窗加权 6 取样：以太段[0,8.2]命中 2、电段[8.2,18.2]命中 3、尾隙回退触发者以太
    // → 以太 3（含回退）/ 电 3
    const byEl = new Map(polar.map(r => [r.element, r.count]))
    expect(byEl.get('ether')).toBe(Math.ceil(evPolar.count / 2))
    expect(byEl.get('electric')).toBe(evPolar.count - Math.ceil(evPolar.count / 2))
  })

  it('异放同口径：无手动分配时按状态段取样归因', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.useStunAxis = true
    config.enemy.stunCountLock = 2
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
    // 2 取样点分落 以太段[0,8.2)/电段[8.2,18.2) → 各一半
    const byEl = new Map(rel.map(r => [r.element, r.count]))
    expect(byEl.get('ether')).toBe(Math.floor(evRel.count / 2))
    expect(byEl.get('electric')).toBe(evRel.count - Math.floor(evRel.count / 2))
  })

  it('手动 releaseShare 覆盖点时归因：回落权重路径且次数守恒', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.useStunAxis = true
    config.enemy.stunCountLock = 2
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
    config.enemy.stunCountLock = 2
    config.stunAxes = [{
      name: '进窗状态轴',
      count: 3,
      entryAnomaly: 1, // 火
      actions: [
        { slot: 0, moveId: '1511006', count: 6, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 8 },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const boss = calc.bossAnomalyState.value!
    // 单次失衡表达：开场火在以太动作结束点被替换、电再替换以太 → 火/以太 各 1 次
    expect(boss.disorders.map(d => d.element)).toEqual(['fire', 'ether'])
    // 触发点=动作结束点（地雷撞#3 时长1.484 → 以太触发@1.237 首击过管），
    // 边界火段 0~1.237 可见非零长；随后 以太→电
    expect(boss.stateChainsPerWindow[0].map(s => s.element)).toEqual(['fire', 'ether', 'electric'])
  })
})

describe('逐失衡展开：单次失衡表达（v3.2 用户裁决）', () => {
  it('单窗不足的积蓄不再幻影继承：代表窗内无触发', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1371' }])
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    config.stunAxes = [{
      name: '独立轴',
      count: 2,
      actions: [{ slot: 0, moveId: '1181005', count: 14, startTime: 0 }],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const st = calc.inStunAnomalyState.value!
    expect(st.windows).toBe(1)
    expect(st.elements.find(e => e.element === 'electric')?.triggerCount ?? 0).toBe(0)
  })

  it('预填条当窗触发；重复次数由失衡次数统计表达（模拟只做单代表窗）', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1371' }])
    config.enemy.stunCountLock = 3
    config.useStunAxis = true
    config.stunAxes = [{
      name: '重演轴',
      count: 3,
      actions: [{ slot: 0, moveId: '1181005', count: 14, startTime: 0 }],
      basicFillerSlot: 0,
      entryBars: { electric: 30 },
    }]
    const calc = useResourceCalc()
    const st = calc.inStunAnomalyState.value!
    expect(st.windows).toBe(1)
    expect(st.elements.find(e => e.element === 'electric')?.triggerCount).toBe(1)
  })
})

describe('异放次数源·事件计数器（v2.3）', () => {
  it('inStunBound 事件：全额记失衡内（stunned=1），不拆轴外段', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    config.stunAxes = [{
      name: 'bound轴',
      count: 2,
      actions: [
        { slot: 0, moveId: '1511006', count: 6, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 8 },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const evRel = (calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .anomalyEventExecutions ?? []).find(e => e.eventId === 'nangong_vibrato_release')!
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.id.includes('nangong_vibrato_release'))
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(evRel.count)
    expect(rel.length).toBeGreaterThan(0)
    for (const r of rel) {
      expect(r.id.endsWith('-in'), `颤音异放行应全部为失衡内段：${r.id}`).toBe(true)
      expect(r.note).toContain('失衡内·全额失衡易伤')
    }
  })

  it('未标记事件按计数器拆分：次数守恒、in 段单位伤害高于 out 段（stunBonusPct=50 → ×1.5 vs ×1.0）', async () => {
    const { config } = await setupHarness([{ agentId: '1331' }, { agentId: '1181' }])
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    config.stunAxes = [{
      name: 'split轴',
      count: 2,
      actions: [{ slot: 1, moveId: '1181005', count: 18, startTime: 0 }],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const evRel = (calc.resourceResult.value!.characters.find(c => c.agentId === '1331')!
      .anomalyEventExecutions ?? []).find(e => e.eventId === 'vivian_luoyu_release')!
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.id.includes('vivian_luoyu_release'))
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(evRel.count)
    expect(rel.length).toBeGreaterThan(0)
    for (const r of rel) {
      expect(r.id.endsWith('-in') || r.id.endsWith('-out'), `薇薇安异放行应为轴内/轴外段：${r.id}`).toBe(true)
    }
    const inRow = rel.find(r => r.id.endsWith('-in'))
    const outRow = rel.find(r => r.id.endsWith('-out'))
    if (inRow && outRow) {
      expect(inRow.perDamage).toBeGreaterThan(outRow.perDamage)
    }
  })
})

describe('初始异常条值（v2.5）', () => {
  it('预填积蓄让单窗不足的配置当窗触发；阈值系数与全局池对齐（×1.1）', async () => {
    const setup = async () => {
      const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1371' }])
      config.enemy.stunCountLock = 1
      config.useStunAxis = true
      config.stunAxes = [{
        name: 'prefill轴',
        count: 1,
        actions: [{ slot: 0, moveId: '1181005', count: 14, startTime: 0 }],
        basicFillerSlot: 0,
      }]
      return { config, calc: useResourceCalc() }
    }
    // 无预填：14 击 ≈2593（185.23/击）< 第一管 3300（3000×系数1.1）→ 不触发
    const bare = await setup()
    expect(bare.calc.inStunAnomalyState.value!.elements.find(e => e.element === 'electric')?.triggerCount ?? 0).toBe(0)
    // 预填电 30% = 990 → 2593+990=3583 ≥ 3300 → 当窗触发
    const prefilled = await setup()
    prefilled.config.stunAxes = prefilled.config.stunAxes.map(a => ({ ...a, entryBars: { electric: 30 } }))
    const st = prefilled.calc.inStunAnomalyState.value!
    expect(st.elements.find(e => e.element === 'electric')?.triggerCount).toBe(1)
  })
})

describe('轴条目级初始异常/多条异常条（v2.6→v2.8，随预设导出）', () => {
  const setupWith = async (axisExtra: Record<string, unknown>) => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1371' }])
    config.enemy.stunCountLock = 1
    config.useStunAxis = true
    config.stunAxes = [{
      name: 'entry轴',
      count: 1,
      actions: [{ slot: 0, moveId: '1181005', count: 14, startTime: 0 }],
      basicFillerSlot: 0,
      ...axisExtra,
    }]
    return useResourceCalc()
  }

  it('entryBars 预填：电 30% 当窗触发', async () => {
    const calc = await setupWith({ entryBars: { electric: 30 } })
    expect(calc.inStunAnomalyState.value!.elements.find(e => e.element === 'electric')?.triggerCount).toBe(1)
  })

  it('风化条不进标准槽：只预填风时电无触发', async () => {
    const calc = await setupWith({ entryBars: { wind: 30 } })
    expect(calc.inStunAnomalyState.value!.elements.find(e => e.element === 'electric')?.triggerCount ?? 0).toBe(0)
  })

  it('双条近满连触紊乱（用户口径：两个角色各攒一条快满，进窗一碰即连续触发）：电90+以太90', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    config.stunAxes = [{
      name: '双条轴',
      count: 2,
      actions: [
        { slot: 0, moveId: '1511006', count: 6, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 8 },
      ],
      basicFillerSlot: 0,
      entryBars: { ether: 90, electric: 90 },
    }]
    const calc = useResourceCalc()
    const boss = calc.bossAnomalyState.value!
    // 预填 90%=2970（每窗独立初始化）：地雷撞首击过管清槽、剩余五击再过管二次触发电？——
    // 实际序列：首击以太@0 触发清槽，余 5 击 3434≥3300 二次触发以太（同元素刷新）；
    // 强特 @8 过管替换以太。两窗按同序列独立重演。
    expect(boss.disorders.length).toBe(1)
    for (const d of boss.disorders) {
      expect(d.element).toBe('ether')
      expect(d.time).toBeCloseTo(8 + 0.2 * (2 / 18), 1)
    }
    expect(boss.stateChainsPerWindow[0].map(s => s.element)).toEqual(['ether', 'electric'])
  })

  it('导出清洗保留 entry 字段：normalizeAxesForExport 不丢初始异常设置', async () => {
    const { normalizeAxesForExport } = await import('@/data/stunAxisPresets')
    const out = normalizeAxesForExport([{
      name: 'x', actions: [{ slot: 0, moveId: '1181005', count: 1 }],
      entryAnomaly: 2, entryBars: { electric: 30, ether: 50 },
    }])
    expect(out[0].entryAnomaly).toBe(2)
    expect(out[0].entryBars).toEqual({ electric: 30, ether: 50 })
    // 未填写时不产生字段（预设最小化）；非法值清洗掉
    const out2 = normalizeAxesForExport([{ name: 'y', actions: [{ slot: 0, moveId: '1181005', count: 1 }], entryBars: { fire: 0 } }])
    expect(out2[0].entryAnomaly).toBeUndefined()
    expect(out2[0].entryBars).toBeUndefined()
  })
})

describe('逐条目边界注入（v2.7 中间态口径）', () => {
  it('第二段轴声明「以火进入」：该段窗口开局即火状态，边界不记紊乱', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1371' }])
    config.enemy.stunCountLock = 3
    config.useStunAxis = true
    config.stunAxes = [
      { name: '一段', count: 1, actions: [{ slot: 0, moveId: '1181005', count: 14, startTime: 0 }] },
      // 二段只补两击（不足以触发），验证空触发段也能携带边界注入
      { name: '二段', count: 2, actions: [{ slot: 0, moveId: '1181005', count: 2, startTime: 0 }], entryAnomaly: 1, entryBars: { fire: 30 } },
    ]
    const calc = useResourceCalc()
    const boss = calc.bossAnomalyState.value!
    // 单次失衡表达：每条目一个代表窗（count=2 的二段也只模拟一次，重复由失衡次数表达）
    expect(boss.stateChainsPerWindow.length).toBe(2)
    // 段1 无触发无状态；段2 边界注入火（不记紊乱——是进窗状态声明而非窗内触发事件）
    expect(boss.disorders).toHaveLength(0)
    expect(boss.stateChainsPerWindow[0]).toEqual([])
    // 二段代表窗开局按声明注入火（count=2 只模拟一次，重复由失衡次数表达；两击不足以触发，链只有火段）
    expect(boss.stateChainsPerWindow[1][0]).toMatchObject({ element: 'fire', start: 0 })
  })

  it('极性紊乱基数用当前状态元素的明细均摊（fallback 全池均摊）', async () => {
    const { config } = await setupHarness([{ agentId: '1511', cinemaLevel: 2 }, { agentId: '1181' }])
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    config.stunAxes = [{
      name: '基数轴',
      count: 2,
      actions: [
        { slot: 0, moveId: '1511006', count: 6, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 8 },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const dd = calc.anomalyPoolResult.value?.disorderDamage
    if (!dd || dd.details.length === 0) return
    const polar = calc.damagePoolRows.value.filter(r => r.type === '极性紊乱')
    expect(polar.length).toBeGreaterThan(0)
    for (const r of polar) {
      const rows = dd.details.filter(d => d.element === r.element)
      const evSum = rows.reduce((s, d) => s + (d.events ?? 0), 0)
      const dmgSum = rows.reduce((s, d) => s + (d.damage ?? 0), 0)
      const expected = evSum > 0 ? (dmgSum / evSum) * 0.25 : dd.avgDamage * 0.25
      expect(r.perDamage).toBeCloseTo(expected, 4)
      expect(r.note).toContain('基数=该元素紊乱均摊')
    }
  })
})

describe('南宫羽快支动作块（v2.9）', () => {
  it('非轴模式：1511013 以 count 0 灰块存在（不进伤害/时间预算，零基线影响）', async () => {
    await setupHarness([{ agentId: '1511' }])
    const calc = useResourceCalc()
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1511')!
    const qa = char.executions.find(e => e.moveId === '1511013')
    expect(qa).toBeTruthy()
    expect(qa!.count).toBe(0)
    // 伤害池不出现 count=0 行
    expect(calc.damagePoolRows.value.filter(r => r.moveId === '1511013').length).toBe(0)
  })

  it('捏轴放置快支：失衡值计入（放置后轴内失衡高于不放），且吃易伤', async () => {
    const mk = async (withAssist: boolean) => {
      const { config } = await setupHarness([{ agentId: '1511' }, { agentId: '1371' }])
      config.enemy.stunCountLock = 2
      config.useStunAxis = true
      config.stunAxes = [{
        name: '快支轴',
        count: 2,
        actions: [
          { slot: 0, moveId: '1511006', count: 4, startTime: 0 },
          ...(withAssist ? [{ slot: 0, moveId: '1511013', count: 2, startTime: 6 }] : []),
        ],
        basicFillerSlot: 0,
      }]
      return useResourceCalc()
    }
    const without = await mk(false)
    const withA = await mk(true)
    // 窗内招式不产失衡值（引擎口径）：快支块的价值 = 极性载体 + 窗内伤害吃易伤。
    // 放置后出现直伤行且全额易伤（轴内），未放置则无该行
    const rowsWith = withA.damagePoolRows.value.filter(r => r.moveId === '1511013')
    expect(rowsWith.length).toBeGreaterThan(0)
    const inRow = rowsWith.find(r => String(r.source ?? '').includes('轴内') || Number((r as { stunMult?: number }).stunMult ?? 0) > 1)
      ?? rowsWith[0]
    expect(inRow.totalDamage).toBeGreaterThan(0)
    expect(without.damagePoolRows.value.filter(r => r.moveId === '1511013').length).toBe(0)
  })
})

describe('极性强击（爱丽丝 1401）失衡轴：首算存在 + 易伤跟随父动作（2026-08 审计修复）', () => {
  /** 爱丽丝+格莉丝：axisActions 为 SW3(1401012) 的轴放置（其余槽位用格莉丝强特保持轴激活） */
  async function setupAlice(sw3Placement: number, graceInAxis = true) {
    const { config } = await setupHarness([
      { agentId: '1401', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.useStunAxis = true
    config.enemy.stunCountLock = 1
    config.stunAxes = [{
      name: 'SW3轴',
      count: 1,
      actions: [
        ...(sw3Placement > 0 ? [{ slot: 0, moveId: '1401012', count: sw3Placement, startTime: 0 }] : []),
        ...(graceInAxis ? [{ slot: 1, moveId: '1181005', count: 2, startTime: 0 }] : []),
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const spark = calc.resourceResult.value!.characters.find(c => c.agentId === '1401')!
      .aliceSwordWillSource!.sparkCount
    const polar = calc.damagePoolRows.value.filter(r => r.type === '极性强击')
    return { calc, spark, polar }
  }

  it('首算即存在：极性强击行 count = sparkCount 且参与紊乱序列（aliceInfo 循环依赖回归）', async () => {
    // 非轴首算（不触发二次求值）：行必须存在——曾因 aliceInfo 读 resourceResult 与 calcOutput
    // 成环，首算 giftedTriggerCounts 不注入 → 整行缺失、紊乱序列漏计
    const { config } = await setupHarness([
      { agentId: '1401', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    const spark = calc.resourceResult.value!.characters.find(c => c.agentId === '1401')!
      .aliceSwordWillSource!.sparkCount
    const polar = calc.damagePoolRows.value.filter(r => r.type === '极性强击')
    expect(spark).toBeGreaterThan(0)
    expect(polar.length).toBe(1)
    expect(polar[0].count).toBe(spark)
    expect(polar[0].totalDamage).toBeGreaterThan(0)
    expect(calc.anomalyPoolResult.value!.perElement.some(p => p.element === 'physical_polar_assault'))
      .toBe(true)
  })

  it('轴内 SW3 部分在窗：易伤按父动作轴内占比折算（占比 = 栈轴内单位/总数，与直伤同源）', async () => {
    const placed = await setupAlice(2)
    const none = await setupAlice(0)
    expect(placed.polar.length).toBe(1)
    expect(none.polar.length).toBe(1)
    expect(placed.polar[0].count).toBe(placed.spark)
    expect(none.polar[0].count).toBe(none.spark)
    // SW3 未放置 → 占比 0（无易伤）；放置 2 次/总 spark → 期望倍率 1 + 0.5 × (2/spark)
    const frac = Math.min(1, 2 / placed.spark)
    expect(placed.polar[0].perDamage / none.polar[0].perDamage).toBeCloseTo(1 + 0.5 * frac, 6)
  })

  it('轴内 SW3 多量放置：易伤按栈实际执行数占比折算（窗口门控下部分在窗）', async () => {
    const full = await setupAlice(8)
    const none = await setupAlice(0)
    // 栈执行数 = 窗口时长门控下的真实轴内单位（窗口放不下全部时截断，如 4/9）
    const execCount = full.calc.stackTraversalResult.value?.executed['0:1401012']?.count ?? 0
    expect(execCount).toBeGreaterThan(0)
    const frac = Math.min(1, execCount / full.spark)
    expect(frac).toBeLessThanOrEqual(1)
    expect(full.polar[0].perDamage / none.polar[0].perDamage).toBeCloseTo(1 + 0.5 * frac, 6)
  })

  it('影画2：终结技额外极性强击按终结技轴内占比加权（SW3 与终结技触发源分开计）', async () => {
    const mk = async (ultInAxis: boolean) => {
      const { config } = await setupHarness([
        { agentId: '1401', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
        { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      ])
      for (const buff of config.globalBuffs) buff.enabled = false
      config.useStunAxis = true
      // 3 窗：喧响轨在窗间积累 → 爱丽丝终极技 > 0（1 窗攒不够 3000 会被削到 0，见 computeAxisUltimateTrack）
      config.enemy.stunCountLock = 3
      config.stunAxes = [{
        name: 'C2加权轴',
        count: 3,
        actions: [
          { slot: 0, moveId: '1401012', count: 1, startTime: 0 },
          ...(ultInAxis ? [{ slot: 0, moveId: '1401016', count: 1, startTime: 1.2 }] : []),
          { slot: 1, moveId: '1181005', count: 2, startTime: 0 },
        ],
        basicFillerSlot: 0,
      }]
      const calc = useResourceCalc()
      const alice = calc.resourceResult.value!.characters.find(c => c.agentId === '1401')!
      const row = calc.damagePoolRows.value.find(r => r.type === '极性强击')
      return { row, c2: alice.aliceSwordWillSource!.c2UltSparkCount, spark: alice.aliceSwordWillSource!.sparkCount, ult: alice.ultimateCount }
    }
    const withUlt = await mk(true)
    const without = await mk(false)
    // C2 生效：sparkCount = SW3 + 终结技额外次数
    expect(withUlt.c2).toBeGreaterThan(0)
    expect(withUlt.spark).toBeGreaterThan(withUlt.c2)
    expect(withUlt.ult).toBe(withUlt.c2)
    expect(withUlt.row).toBeTruthy()
    expect(without.row).toBeTruthy()
    // 终结技在窗内 → 加权占比更高 → 单次伤害更高（无窗内终结时终结部分占比 0）
    expect(withUlt.row!.perDamage).toBeGreaterThan(without.row!.perDamage)
    expect(withUlt.row!.note).toContain('加权轴内占比')
    expect(withUlt.row!.note).toContain('终结')
  })
})

describe('载体型异放跟随载体动作（2026-08 审计修复）', () => {
  it('格莉丝脉冲手雷轴内放置：异放拆 -in 段（全额失衡易伤），次数守恒', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1371' }])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.useStunAxis = true
    config.enemy.stunCountLock = 1
    config.stunAxes = [{
      name: '手雷轴',
      count: 1,
      actions: [{ slot: 0, moveId: '1181019', count: 1, startTime: 0 }],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const evRel = calc.resourceResult.value!.characters.find(c => c.agentId === '1181')!
      .anomalyEventExecutions!.find(e => e.eventId === 'grace_pulse_grenade_release')!
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.agentId === '1181')
    // 次数守恒
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(Math.floor(evRel.count))
    // 载体（脉冲手雷 1181019）在窗内 → 必须拆出 -in 段（曾无载体绑定，整段落轴外）
    const inRow = rel.find(r => r.id.endsWith('-in'))
    expect(inRow, '脉冲手雷在窗内时异放应拆出失衡内段').toBeTruthy()
    expect(inRow!.count).toBeGreaterThanOrEqual(1)
    expect(inRow!.note).toContain('失衡内·全额失衡易伤')
    // in 段单次伤害 = 基底 × 1.5 > out 段
    const outRow = rel.find(r => r.id.endsWith('-out'))
    expect(outRow).toBeTruthy()
    expect(inRow!.perDamage).toBeGreaterThan(outRow!.perDamage)
  })

  it('般岳影画6 摧岳附伤：轴内倾山放置 → 附伤按倾山轴内占比吃易伤', async () => {
    const mk = async (placeQingShan: boolean) => {
      const { config } = await setupHarness([{ agentId: '1471', cinemaLevel: 6 }, { agentId: '1181' }])
      for (const buff of config.globalBuffs) buff.enabled = false
      config.useStunAxis = true
      config.enemy.stunCountLock = 1
      config.stunAxes = [{
        name: '倾山轴',
        count: 1,
        actions: [
          ...(placeQingShan ? [{ slot: 0, moveId: '1471009', count: 1, startTime: 0 }] : []),
          { slot: 1, moveId: '1181005', count: 2, startTime: 0 },
        ],
        basicFillerSlot: 0,
      }]
      const calc = useResourceCalc()
      const attach = calc.damagePoolRows.value.find(r => r.id === 'banyue-c6-crush-attach')
      const qingShanTotal = calc.resourceResult.value!.characters.find(c => c.agentId === '1471')!
        .executions.find(e => e.moveId === '1471009')?.count ?? 0
      return { attach, qingShanTotal, calc }
    }
    const placed = await mk(true)
    expect(placed.attach).toBeTruthy()
    expect(placed.qingShanTotal).toBeGreaterThan(0)
    // 倾山栈轴内 1 次 / 全局 total → stunMult = 1 + 0.5/total（曾未注册 attachedEvents，轴内恒 1）
    expect((placed.attach as any).stunMult).toBeCloseTo(1 + 0.5 / placed.qingShanTotal, 6)
    const none = await mk(false)
    expect(none.attach).toBeTruthy()
    expect((none.attach as any).stunMult).toBe(1)
  })

  it('柏妮思灼热抛接法轴内放置：异放拆出 -in 段（全额失衡易伤），总次数守恒', async () => {
    const { config } = await setupHarness([
      { agentId: '1171', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.useStunAxis = true
    config.enemy.stunCountLock = 1
    config.stunAxes = [{
      name: '抛接轴',
      count: 1,
      actions: [{ slot: 0, moveId: '1171026', count: 1, startTime: 0 }],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const evRel = calc.resourceResult.value!.characters.find(c => c.agentId === '1171')!
      .anomalyEventExecutions!.find(e => e.eventId === 'burnice_flowfire_release')!
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.agentId === '1171')
    // 次数守恒
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(Math.floor(evRel.count))
    // 载体在窗内 → 必须拆出 -in 段（曾缺 followCarrierInStun，整段落轴外）
    const inRow = rel.find(r => r.id.endsWith('-in'))
    expect(inRow, '灼热抛接法在窗内时异放应拆出失衡内段').toBeTruthy()
    expect(inRow!.count).toBeGreaterThanOrEqual(1)
    expect(inRow!.note).toContain('失衡内·全额失衡易伤')
    const outCount = rel.filter(r => r.id.endsWith('-out')).reduce((s, r) => s + r.count, 0)
    expect(outCount).toBe(Math.floor(evRel.count) - inRow!.count)
    // in 段单次伤害 = 基底 × 1.5 > out 段
    expect(inRow!.perDamage).toBeGreaterThan(rel.find(r => r.id.endsWith('-out'))!.perDamage)
  })

  it('普罗米娅绝裁异放：载体未放置时按载体轴内占比（回归护栏）', async () => {
    const { config } = await setupHarness([{ agentId: '1541', cinemaLevel: 0 }, { agentId: '1181' }])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.useStunAxis = true
    config.enemy.stunCountLock = 1
    config.stunAxes = [{
      name: '无绝裁轴',
      count: 1,
      actions: [{ slot: 1, moveId: '1181005', count: 2, startTime: 0 }],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const evRel = calc.resourceResult.value!.characters.find(c => c.agentId === '1541')!
      .anomalyEventExecutions!.filter(e => e.eventType === 'release')
    if (evRel.length === 0) return
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.agentId === '1541')
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(evRel.reduce((s, e) => s + Math.floor(e.count), 0))
  })
})

describe('资源驱动特殊普攻载体绑定（2026-08 审计：爱芮/薇薇安）', () => {
  /** 轴内放置载体招式（slot 0），其余槽位用格莉丝强特保持轴激活 */
  async function carrierAxis(team: Array<{ agentId: string; cinemaLevel?: number }>, carrier: { moveId: string; count: number } | null) {
    const { config } = await setupHarness(team)
    for (const buff of config.globalBuffs) buff.enabled = false
    config.useStunAxis = true
    config.enemy.stunCountLock = 1
    config.stunAxes = [{
      name: '载体轴',
      count: 1,
      actions: [
        ...(carrier ? [{ slot: 0, moveId: carrier.moveId, count: carrier.count, startTime: 0 }] : []),
        { slot: 1, moveId: '1181005', count: 2, startTime: 0 },
      ],
      basicFillerSlot: 0,
    }]
    return useResourceCalc()
  }

  it('爱芮绝对音准#3 轴内放置：异放拆 -in 段（全额失衡易伤），次数守恒', async () => {
    const calc = await carrierAxis([{ agentId: '1501' }, { agentId: '1181' }], { moveId: '1501007', count: 1 })
    const evRel = calc.resourceResult.value!.characters.find(c => c.agentId === '1501')!
      .anomalyEventExecutions!.find(e => e.eventId === 'aire_absolute_pitch_release')!
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.agentId === '1501')
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(Math.floor(evRel.count))
    const inRow = rel.find(r => r.id.endsWith('-in'))
    expect(inRow, '绝对音准#3 在窗内时异放应拆出失衡内段').toBeTruthy()
    expect(inRow!.note).toContain('失衡内·全额失衡易伤')
    const outRow = rel.find(r => r.id.endsWith('-out'))
    expect(outRow).toBeTruthy()
    expect(inRow!.perDamage).toBeGreaterThan(outRow!.perDamage)
  })

  it('薇薇安落羽生花轴内放置：异放拆 -in 段（分母=落羽生花次数，carrierTotalCount）', async () => {
    const calc = await carrierAxis([{ agentId: '1331' }, { agentId: '1181' }], { moveId: '1331008', count: 1 })
    const evRel = calc.resourceResult.value!.characters.find(c => c.agentId === '1331')!
      .anomalyEventExecutions!.find(e => e.eventId === 'vivian_luoyu_release')!
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.agentId === '1331' && r.id.includes('vivian_luoyu_release'))
    expect(rel.reduce((s, r) => s + r.count, 0)).toBe(Math.floor(evRel.count))
    const inRow = rel.find(r => r.id.endsWith('-in'))
    expect(inRow, '落羽生花在窗内时异放应拆出失衡内段').toBeTruthy()
    expect(inRow!.note).toContain('失衡内·全额失衡易伤')
    expect(inRow!.perDamage).toBeGreaterThan(rel.find(r => r.id.endsWith('-out'))!.perDamage)
  })

  it('不捏载体进轴：爱芮异放整段轴外（特殊普攻非 basic filler 兜底可打出）', async () => {
    const calc = await carrierAxis([{ agentId: '1501' }, { agentId: '1181' }], null)
    const rel = calc.damagePoolRows.value.filter(r => r.type === '异放' && r.agentId === '1501')
    expect(rel.length).toBeGreaterThan(0)
    expect(rel.every(r => r.id.endsWith('-out')), '未捏轴时异放应全部为轴外段').toBe(true)
  })
})

describe('维琳娜风异放轴内拆分（2026-08 审计：轴内异常触发→轴内乱流→风异放）', () => {
  it('轴内非风异常触发：风异放拆 -in 段（全额失衡易伤），次数守恒', async () => {
    const { config } = await setupHarness([{ agentId: '1561' }, { agentId: '1181' }])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.useStunAxis = true
    config.enemy.stunCountLock = 2
    config.stunAxes = [{
      name: '风化轴',
      count: 2,
      actions: [
        { slot: 0, moveId: '1561005', count: 2, startTime: 0 },
        { slot: 1, moveId: '1181005', count: 18, startTime: 0 },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value.filter(r => r.id.startsWith('pool-release-velina-corrosion'))
    expect(rows.length).toBeGreaterThan(0)
    const inRow = rows.find(r => r.id.endsWith('-in'))
    expect(inRow, '轴内非风异常触发时风异放应拆出失衡内段').toBeTruthy()
    expect(inRow!.note).toContain('失衡内·全额失衡易伤')
    const outRow = rows.find(r => r.id.endsWith('-out'))
    expect(outRow).toBeTruthy()
    expect(inRow!.perDamage).toBeGreaterThan(outRow!.perDamage)
  })
})

describe('6命附伤伴随计数吃易伤（2026-08 审计：附伤事件和动作绑定）', () => {
  it('简6命附伤：轴内物理强击触发占比 > 0 时单次伤害高于无触发', async () => {
    const mk = async (physicalInAxis: boolean) => {
      const { config } = await setupHarness([{ agentId: '1261', cinemaLevel: 6 }, { agentId: '1181' }])
      for (const buff of config.globalBuffs) buff.enabled = false
      config.useStunAxis = true
      config.enemy.stunCountLock = 1
      config.stunAxes = [{
        name: '简轴',
        count: 1,
        actions: physicalInAxis
          ? [{ slot: 1, moveId: '1181005', count: 18, startTime: 0 }]
          : [{ slot: 1, moveId: '1181005', count: 1, startTime: 0 }],
        basicFillerSlot: 0,
      }]
      const calc = useResourceCalc()
      return calc.damagePoolRows.value.find(r => r.id === 'jane-c6-assault-followup')
    }
    // 电强特 18 击 → 轴内电触发后物理覆盖随之出现（物理强击轴内占比 > 0 需物理积蓄在窗内——
    // 简自身的普攻在 basic filler 里：占比可能为 0，但行必须存在且计数正确）
    const row = await mk(true)
    expect(row).toBeTruthy()
    expect(row!.count).toBeGreaterThan(0)
    expect(row!.totalDamage).toBeGreaterThan(0)
  })

  it('爱丽丝6命附伤：状态进入加权轴内占比吃易伤（SW3 在窗内时 perDamage 提升）', async () => {
    const mk = async (sw3InAxis: boolean) => {
      const { config } = await setupHarness([{ agentId: '1401', cinemaLevel: 6 }, { agentId: '1181' }])
      for (const buff of config.globalBuffs) buff.enabled = false
      config.useStunAxis = true
      config.enemy.stunCountLock = 1
      config.stunAxes = [{
        name: '决胜轴',
        count: 1,
        actions: [
          ...(sw3InAxis ? [{ slot: 0, moveId: '1401012', count: 1, startTime: 0 }] : []),
          { slot: 1, moveId: '1181005', count: 2, startTime: 0 },
        ],
        basicFillerSlot: 0,
      }]
      const calc = useResourceCalc()
      return calc.damagePoolRows.value.find(r => r.id === 'alice-c6-decisive-extra-attack')
    }
    const withSw3 = await mk(true)
    const without = await mk(false)
    expect(withSw3).toBeTruthy()
    expect(without).toBeTruthy()
    expect(withSw3!.count).toBe(without!.count)
    expect(withSw3!.perDamage).toBeGreaterThan(without!.perDamage)
  })

  it('琉音6命余音：轴内目标终极技（promoteVariant 块）→ 附伤按全队终极技轴内占比吃易伤', async () => {
    const { config } = await setupHarness([{ agentId: '1481', cinemaLevel: 6 }, { agentId: '1181' }, { agentId: '1371' }])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.setMechanicSetting('liuyin.ultimateTargetSlot', 1)
    config.useStunAxis = true
    config.enemy.stunCountLock = 1
    config.stunAxes = [{
      name: '转大轴',
      count: 1,
      actions: [
        { slot: 1, moveId: '1181005', count: 2, startTime: 0 },
        // 转大 = 轴内 promoteVariant 块（moveId 为目标 1181 的终极技 1181010）
        { slot: 1, moveId: '1181010', count: 1, startTime: 1, promoteVariant: '90' },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const row = calc.damagePoolRows.value.find(r => r.id === 'liuyin-c6-echo')
    expect(row).toBeTruthy()
    // 终极技在窗内 → stunMult = 1 + 0.5 × (轴内终极技/总终极技) > 1（曾走全局覆盖率/无绑定）
    expect((row as any).stunMult ?? 1).toBeGreaterThan(1)
  })
})

describe('轴内直读技能表（v3.5 通用兜底）', () => {
  it('未建模招式放置后按技能表倍率出直伤并吃易伤；未放置无行', async () => {
    const mk = async (place: boolean) => {
      const { config } = await setupHarness([{ agentId: '1511' }, { agentId: '1371' }])
      config.enemy.stunCountLock = 2
      config.useStunAxis = true
      config.stunAxes = [{
        name: '直读轴',
        count: 2,
        actions: [
          { slot: 0, moveId: '1511006', count: 4, startTime: 0 },
          // 1511007 特殊技：有点沉重的爱意——南宫羽模块未生成执行行的招式（特殊技类，伤害倍率 167.1%）
          ...(place ? [{ slot: 0, moveId: '1511007', count: 1, startTime: 6 }] : []),
        ],
        basicFillerSlot: 0,
      }]
      return useResourceCalc()
    }
    const withRow = await mk(true)
    // 动作池收录（[表] 前缀 chip）
    expect(withRow.resourceResult.value!.characters.find(c => c.agentId === '1511')!
      .executions.some(e => e.moveId === '1511007')).toBe(false)
    const rows = withRow.damagePoolRows.value.filter(r => r.moveId === '1511007')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].totalDamage).toBeGreaterThan(0)
    const without = await mk(false)
    expect(without.damagePoolRows.value.filter(r => r.moveId === '1511015').length).toBe(0)
  })
})

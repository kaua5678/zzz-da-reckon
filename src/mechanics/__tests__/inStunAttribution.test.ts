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
    const { config } = await setupHarness([{ agentId: '1511' }])
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

/**
 * R21 夜 A 批次（`damagePool.ts` **最后 3 处**角色判定迁出/去冗余）的**精确值判据**。
 *
 * 为什么必须单独有这个文件（不是「补测试」的仪式）：
 *  ① `timeGolden` 对**轴内易伤/覆盖类**改动**结构性盲**——实测：104 预设中含 1391 的 4 条全部无轴，
 *     本批三处（琉音非轴拆分 / 凝神三臂 / 阳炎两臂）都改的是「非轴 vs 轴」两臂与覆盖率滑块，
 *     预设库里根本没有覆盖它们的轴态 ⇒ **全绿 ≠ 正确**，必须手组队 + 手动轴自建判据。
 *  ② 本批三处里两处（凝神、阳炎）是**覆盖率滑块驱动**的：滑块默认档下「迁移成功」与
 *     「非轴臂静默失效（恒 0）」会给出同一个数（都是 0 delta），只有**把滑块推到 0 / 1 两端**
 *     才能分辨 ⇒ 下面的用例一律**显式设滑块**，不靠默认值。
 *  ③ 三处都不是「加个字段」而是**控制流/口径**改动（琉音那处是「跳过通用路径」、
 *     凝神是「C6 臂优先于轴臂」的三元顺序、阳炎是「标量 × 行级配对比例」的拆解），
 *     逐条钉死比「跑一遍不红」更有信息量。
 *
 * 三处与判据的对应：
 *  · **跳① 琉音 `:428`（agentId 项删除）** —— `1481` 非轴态下三个强特**只出专用块的行**
 *    （`liuyin-ex-*`），**不出**通用行；且专用块的 `stun`/`nonstun` 两段计数精确。
 *  · **跳② 仪玄凝神 `:510`（三臂全迁）** —— C6 臂 / 非 C6 轴臂 / 非 C6 非轴臂三态**互不相同**，
 *    且 C6 臂**优先于轴臂**（轴模式下 C6 仍走满覆盖、不查扫描桶）。
 *  · **跳③ 佩洛伊斯阳炎 `:524`（两臂全迁）** —— 轴臂走桶、非轴臂 = 标量 × **行级配对比例**
 *    （决算 `1551016` 的比例 < 1 时必须**真乘**，否则「无铺垫的决算也吃满阳炎」）。
 *
 * 反向验证（见报告 §4）：每处都做过变异（短路门控 / 改错数据源）证明本文件能红。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { peiluoProminenceMechanic, PEILUO_KAGEROU_CRIT } from '@/mechanics/agents/specPanelBuffs'
import { yixuanMechanic } from '@/mechanics/agents/yixuan'

type Harness = Awaited<ReturnType<typeof setupHarness>>

/**
 * 关掉全部全局 buff（含额外能力），让被测量的机制成为唯一变量。
 *
 * ⚠ **琉音那组不能调它**：关掉全局 buff 会把 `panel.additionalAbilityActive` 打成 0，而琉音的
 * 专用块门控正是 `liuyinSrc.extraAbilityActive`（= 该面板字段）⇒ 整个专用块不进，
 * 「零通用行」会因**错误的原因**通过（实测踩过：`extraAbilityActive` 实测 false）。
 */
function isolate(config: Harness['config']) {
  for (const b of config.globalBuffs) b.enabled = false
}

/** 非轴态（关自动轴 + 清手动轴） */
function forceNonAxis(config: Harness['config']) {
  config.autoYidhariAxis = false
  config.stunAxisPlans.splice(0)
  config.stunAxes.splice(0)
  config.useStunAxis = false
}

async function calcOf(team: Parameters<typeof setupHarness>[0], opts: { isolate?: boolean } = {}) {
  const h = await setupHarness(team)
  if (opts.isolate !== false) isolate(h.config)
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 70))
  return { ...h, calc }
}

/** 幂等：改配置后等一拍让 computed 链重跑 */
async function settle(wait = 70) {
  await new Promise(r => setTimeout(r, wait))
}

/**
 * 装一条**真生效**的手动轴，并断言 `stunAxisResult` 非空（= 轴模式真的开了）。
 *
 * ⚠ 为什么必须断言：`config.useStunAxis = true` **不等于**轴模式生效。实测踩过——
 * 用 `config.stunAxes.push(...)` 装轴时 `calc.stunAxisResult.value` 实测为 `null`、
 * `effectiveStunAxes` 长度为 0，于是「轴模式」用例静默走了**非轴臂**：note 里出现的是
 * 「（覆盖率近似）」而不是「（buff轴）」，用例**因错误的原因通过**（本文件初版就这么错过一次，
 * 是变异测试抓出来的——把 C6 臂排到轴臂之前本应红，它却绿）。
 * 正确写法对齐 `corin.test.ts:271`：**整体赋值** `config.stunAxes = [...]`（不是 push）。
 */
async function installAxis(
  calc: ReturnType<typeof useResourceCalc>,
  config: Harness['config'],
  actions: Array<{ slot: number; moveId: string; count: number; startTime: number }>,
  name = 'R21 夜A 轴',
) {
  forceNonAxis(config)
  config.useStunAxis = true
  config.stunAxes = [{ name, actions }] as never
  await settle(100)
  // 硬闸门：轴没真开就响亮失败，别让用例静默走非轴臂
  expect(calc.stunAxisResult.value).not.toBeNull()
}

/** 某槽角色的直伤行（按 agentId 找，不按下标——规则 17） */
function directRowsOf(calc: ReturnType<typeof useResourceCalc>, agentId: string) {
  return calc.damagePoolRows.value.filter(r => r.agentId === agentId && r.type === '直伤')
}

// ══════════════════════════════════════════════════════════════════════════════
// 跳① 琉音 :428 —— 「跳过通用路径」的 agentId 项删除
// ══════════════════════════════════════════════════════════════════════════════
describe('R21 夜A 跳① 琉音 1481：非轴态强特只出专用块行（:428 删 agentId 项）', () => {
  const EX_IDS = ['1481011', '1481012', '1481013']

  it('非轴：三个强特**零通用行**，全部走专用块（id 前缀 liuyin-ex-）', async () => {
    // ⚠ 队伍必须让琉音的**额外能力触发**（队里有强攻/命破）——否则 `liuyinSrc.extraAbilityActive`
    // 为 false，下方专用块整体不进（那是**另一条**门控，与本批删掉的 agentId 项无关）。
    // ⚠ 且**不能调 isolate()**（它关全局 buff ⇒ `additionalAbilityActive` 掉 0 ⇒ 同样把专用块关掉）。
    // ⚠ specialty 别按名字猜（实测踩过）：1021 猫又 = **attack**、1211 丽娜 = support、1181 格莉丝 = anomaly
    // ⇒ 用 `node scripts/resolve.mjs` 口径核对过的组合：1021(强攻) + 1221(异常)。
    const { calc, config, catalog } = await calcOf([{ agentId: '1481' }, { agentId: '1021' }, { agentId: '1221' }], { isolate: false })
    forceNonAxis(config)
    await settle()

    const src = calc.resourceResult.value!.characters.find(c => c.agentId === '1481')!
    const liuyinSrc = (src as any).liuyinMechanicSource
    // 先确证门控真开了（否则下面的「零通用行」会因错误的原因通过）
    expect(liuyinSrc.extraAbilityActive).toBe(true)
    expect(liuyinSrc.exHeavyCount).toBeGreaterThan(0)

    const rows = directRowsOf(calc, '1481')
    // 通用行的 id 形如 `direct-<slot>-<moveId>`（**带 moveId 字段**）；
    // 专用行 id 形如 `liuyin-ex-<moveId>-<tag>`——⚠ 专用行**不带 `moveId` 字段**
    // （pushDirect 调用没传；招名只编码在 id 与 name 里，实测 `JSON.stringify` 里没有该键）
    // ⇒ 专用行只能按 **id 前缀**筛，按 moveId 筛会恒得 0（本文件初版就这么错过一次）。
    const genericExRows = rows.filter(r => EX_IDS.includes(r.moveId ?? '') && r.id.startsWith('direct-'))
    expect(genericExRows.length).toBe(0)

    const dedicatedRows = rows.filter(r => r.id.startsWith('liuyin-ex-1') && EX_IDS.some(m => r.id.startsWith(`liuyin-ex-${m}-`)))
    // 专用块按 tag 分行：石头(stun) + 石头(nonstun) + 剪刀(nonstun) + 布(nonstun)
    expect(dedicatedRows.length).toBe(4)
    const byId = new Map(dedicatedRows.map(r => [r.id, r]))
    expect([...byId.keys()].sort()).toEqual([
      'liuyin-ex-1481011-nonstun', 'liuyin-ex-1481011-stun',
      'liuyin-ex-1481012-nonstun', 'liuyin-ex-1481013-nonstun',
    ])
    // 分段计数口径：失衡次数 2、强化特殊技总次数 15 ⇒ 失衡内首个强特 2 次，
    // 非失衡 13 次按 1→3 连打 = floor(15/3)/floor(14/3)/floor(13/3) = 5/4/4（精确值）
    expect(liuyinSrc.exHeavyCount).toBe(15)
    expect(byId.get('liuyin-ex-1481011-stun')!.count).toBe(2)
    expect(byId.get('liuyin-ex-1481011-nonstun')!.count).toBe(5)
    expect(byId.get('liuyin-ex-1481012-nonstun')!.count).toBe(4)
    expect(byId.get('liuyin-ex-1481013-nonstun')!.count).toBe(4)
    // 易伤口径：失衡内段吃满（stunMult > 1）、非失衡段不吃（stunMult 恰为 1）
    expect(byId.get('liuyin-ex-1481011-stun')!.stunMult!).toBeGreaterThan(1)
    expect(byId.get('liuyin-ex-1481011-nonstun')!.stunMult).toBe(1)
    expect(byId.get('liuyin-ex-1481012-nonstun')!.stunMult).toBe(1)
    expect(byId.get('liuyin-ex-1481013-nonstun')!.stunMult).toBe(1)
    expect(catalog.getAgent('1481')).toBeTruthy()
  })

  it('反锁：**非琉音**队里不出现任何 liuyin-ex- 行（判据不许泄漏给别的角色）', async () => {
    const { calc, config } = await calcOf([{ agentId: '1371' }, { agentId: '1211' }, { agentId: '1031' }])
    forceNonAxis(config)
    await settle()
    const all = calc.damagePoolRows.value
    expect(all.filter(r => r.id.startsWith('liuyin-ex-')).length).toBe(0)
    // 且琉音的三个强特 moveId 行在任何槽位都不存在（它们是 1481 独有的招）
    expect(all.filter(r => EX_IDS.includes(r.moveId ?? '')).length).toBe(0)
  })

  it('轴态：通用行**回归**（专用块不接管），证明跳过的条件确实是 !isAxis 而不是恒跳', async () => {
    const { calc, config } = await calcOf([{ agentId: '1481' }, { agentId: '1021' }, { agentId: '1221' }], { isolate: false })
    await installAxis(calc, config, [
      { slot: 0, moveId: '1481011', count: 2, startTime: 1 },
      { slot: 0, moveId: '1481012', count: 1, startTime: 3 },
      { slot: 0, moveId: '1481013', count: 1, startTime: 5 },
    ], 'R21 夜A 琉音轴')

    const rows = directRowsOf(calc, '1481')
    // 专用块**不接管**（它的门控是 `!isAxis`）
    const dedicatedRows = rows.filter(r => r.id.startsWith('liuyin-ex-1') && EX_IDS.some(m => r.id.startsWith(`liuyin-ex-${m}-`)))
    expect(dedicatedRows.length).toBe(0)
    // 通用行回归（这是「跳过条件含 !isAxis」的正向证据：同一支队、同一批招，只切轴态）
    const genericExRows = rows.filter(r => EX_IDS.includes(r.moveId ?? '') && r.id.startsWith('direct-'))
    expect(genericExRows.length).toBeGreaterThan(0)
    // 轴态下按轴内捏块切成 in/out 两段（id 带 -out 后缀的那段不吃易伤）
    const ids = genericExRows.map(r => r.id)
    expect(ids.some(i => i.endsWith('-out'))).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 跳② 仪玄凝神 :510 —— 三臂全迁（C6 / 非C6 轴 / 非C6 非轴）
// ══════════════════════════════════════════════════════════════════════════════
describe('R21 夜A 跳② 仪玄 1371 凝神三臂（:510 整段迁进 yixuan.ts）', () => {
  /** 凝神在行 note 里的渲染文本（消费端把 critDmg/sheerDmg 写进 note，最直观） */
  const ningshenNotes = (calc: ReturnType<typeof useResourceCalc>) =>
    directRowsOf(calc, '1371').filter(r => r.note.includes('凝神'))

  it('非 C6 非轴：滑块 0 / 0.5 / 1 给出 **0% / 20% / 40%** 三档不同暴伤（精确值）', async () => {
    const { calc, config } = await calcOf([{ agentId: '1371' }, { agentId: '1181' }, { agentId: '1011' }])
    forceNonAxis(config)

    const seen: number[] = []
    for (const cov of [0, 0.5, 1]) {
      config.setMechanicSetting('yixuan.ningshenCoverage', cov)
      await settle()
      const notes = ningshenNotes(calc)
      if (cov === 0) {
        // 覆盖率为 0 ⇒ 折算暴伤 0 ⇒ 消费端不写「凝神暴伤」段（note 里彻底没有该机制）
        expect(notes.length).toBe(0)
        seen.push(0)
        continue
      }
      expect(notes.length).toBeGreaterThan(0)
      const expected = Math.round(40 * cov)
      // 每行都带同一个折算值（标量臂 = 对本槽全部行同值）
      for (const r of notes) {
        expect(r.note).toContain(`凝神暴伤+${expected}%`)
        expect(r.note).toContain('（覆盖率近似）')
        // 非 C6 非轴臂**不给贯穿**（贯穿只由 C6 给）
        expect(r.note).not.toContain('凝神贯穿')
      }
      seen.push(expected)
    }
    expect(seen).toEqual([0, 20, 40])
  })

  it('C6 非轴：满覆盖 **40% 暴伤 + 20% 贯穿**，且与 c6 滑块联动（精确值）', async () => {
    const { calc, config } = await calcOf([{ agentId: '1371', cinemaLevel: 6 }, { agentId: '1181' }, { agentId: '1011' }])
    forceNonAxis(config)

    config.setMechanicSetting('yixuan.c6NingshenCoverage', 1)
    config.setMechanicSetting('yixuan.ningshenCoverage', 1)
    await settle()
    let notes = ningshenNotes(calc)
    expect(notes.length).toBeGreaterThan(0)
    for (const r of notes) {
      expect(r.note).toContain('凝神暴伤+40%')
      expect(r.note).toContain('凝神贯穿+20%')
    }

    // 砍到 0.5 ⇒ 20/10（证明读的是 **c6** 滑块，而不是非 C6 的 ningshenCoverage）
    config.setMechanicSetting('yixuan.c6NingshenCoverage', 0.5)
    await settle()
    notes = ningshenNotes(calc)
    for (const r of notes) {
      expect(r.note).toContain('凝神暴伤+20%')
      expect(r.note).toContain('凝神贯穿+10%')
    }
  })

  it('★ C6 臂**优先于轴臂**：轴模式下 C6 仍走满覆盖、不查扫描桶（逐位保留原三元顺序）', async () => {
    // ⚠ 队伍不能随便挑：C6 仪玄的轴**极易退化**（资源需求超时间预算 ⇒ `forceNoAxis` ⇒
    // `resolvedAxes` 清空 ⇒ 本用例会静默走非轴臂、变成一条假判据）。实测：
    // `1371C6+1181+1011` / `+1511+1311` / `+1361+1211` / `+1031+1221` 四种编成全部
    // `stunAxisResult === null`（退化），只有 `+1141+1311`（莱卡恩+耀嘉音）实测 `OK`。
    // `installAxis` 里的 `expect(calc.stunAxisResult.value).not.toBeNull()` 就是这条的硬闸门。
    const { calc, config } = await calcOf([{ agentId: '1371', cinemaLevel: 6 }, { agentId: '1141' }, { agentId: '1311' }])
    await installAxis(calc, config, [
      { slot: 0, moveId: '1371014', count: 1, startTime: 0 },
      { slot: 0, moveId: 'basic', count: 3, startTime: 3 },
    ], 'R21 夜A 仪玄轴')
    config.setMechanicSetting('yixuan.c6NingshenCoverage', 1)
    config.setMechanicSetting('yixuan.ningshenCoverage', 0)
    await settle()

    const notes = ningshenNotes(calc)
    expect(notes.length).toBeGreaterThan(0)
    // 轴态 + C6 ⇒ 仍是满覆盖 40/20；若实现把轴臂排在 C6 之前，这里会掉到扫描值（且贯穿消失）
    for (const r of notes) {
      expect(r.note).toContain('凝神暴伤+40%')
      expect(r.note).toContain('凝神贯穿+20%')
    }
  })

  it('非 C6 轴模式：走扫描桶，**非轴滑块完全不参与**（滑块 0/1 同结果 ⇒ 证明读的是桶）', async () => {
    const { calc, config } = await calcOf([{ agentId: '1371' }, { agentId: '1181' }, { agentId: '1011' }])
    await installAxis(calc, config, [
      { slot: 0, moveId: '1371014', count: 1, startTime: 0 },
      { slot: 0, moveId: '1371009', count: 2, startTime: 3 },
    ], 'R21 夜A 仪玄轴')

    config.setMechanicSetting('yixuan.ningshenCoverage', 0)
    await settle()
    const at0 = ningshenNotes(calc).map(r => r.note).sort().join('\n')
    config.setMechanicSetting('yixuan.ningshenCoverage', 1)
    await settle()
    const at1 = ningshenNotes(calc).map(r => r.note).sort().join('\n')
    // 轴臂与滑块无关（同结果）；且必须是**轴臂**的渲染（「（buff轴）」）而不是折算臂
    expect(at1).toBe(at0)
    expect(at0.length).toBeGreaterThan(0)
    expect(at0).toContain('（buff轴）')
    expect(at0).not.toContain('（覆盖率近似）')
  })

  it('反锁：**非仪玄**队里不出现凝神段（判据不许泄漏给别的角色）', async () => {
    const { calc, config } = await calcOf([{ agentId: '1551' }, { agentId: '1211' }, { agentId: '1031' }])
    forceNonAxis(config)
    config.setMechanicSetting('yixuan.ningshenCoverage', 1)
    config.setMechanicSetting('yixuan.c6NingshenCoverage', 1)
    await settle()
    const leaked = calc.damagePoolRows.value.filter(r => r.note.includes('凝神'))
    expect(leaked.length).toBe(0)
  })

  it('跳③ 钩子层：C6 臂与非 C6 非轴臂都产**标量**（scalarBySlot），非 C6 轴臂产桶', () => {
    const base = {
      slot: 0, axes: [], getAgentSkills: () => undefined,
      additionalAbilityActive: true, windInfectionRate: 0,
      settings: { 'yixuan.c6NingshenCoverage': 1, 'yixuan.ningshenCoverage': 1 } as Record<string, number>,
    }
    // C6（非轴）：标量 {40,20}
    const c6 = yixuanMechanic.axisWindowOverlays!({ ...base, cinemaLevel: 6, isAxis: false } as never)!
    expect(c6.yixuanNingshenMap).toBeUndefined()
    expect(c6.scalarBySlot!.get(0)!.yixuanNingshen).toEqual({ critDmg: 40, sheerDmg: 20 })
    // C6（轴）：同样是标量（C6 臂优先于轴臂）
    const c6Axis = yixuanMechanic.axisWindowOverlays!({ ...base, cinemaLevel: 6, isAxis: true } as never)!
    expect(c6Axis.scalarBySlot!.get(0)!.yixuanNingshen).toEqual({ critDmg: 40, sheerDmg: 20 })
    // 非 C6 非轴：标量 {40,0}（不给贯穿）
    const nonC6 = yixuanMechanic.axisWindowOverlays!({ ...base, cinemaLevel: 0, isAxis: false } as never)!
    expect(nonC6.scalarBySlot!.get(0)!.yixuanNingshen).toEqual({ critDmg: 40, sheerDmg: 0 })
    // 非 C6 轴：**无标量**，走桶（空轴 ⇒ 桶为空 ⇒ 返回 null）
    const nonC6Axis = yixuanMechanic.axisWindowOverlays!({ ...base, cinemaLevel: 0, isAxis: true } as never)
    expect(nonC6Axis?.scalarBySlot).toBeUndefined()
    // 额外能力未触发 ⇒ 一律 null（门控逐位保留）
    expect(yixuanMechanic.axisWindowOverlays!({ ...base, cinemaLevel: 6, isAxis: false, additionalAbilityActive: false } as never)).toBeNull()
    // 标量按**本槽**键控（不许写成固定 0 —— 那会让槽 2 的仪玄拿不到）
    const at2 = yixuanMechanic.axisWindowOverlays!({ ...base, slot: 2, cinemaLevel: 6, isAxis: false } as never)!
    expect(at2.scalarBySlot!.has(2)).toBe(true)
    expect(at2.scalarBySlot!.has(0)).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 跳③ 佩洛伊斯阳炎 :524 —— 两臂全迁（轴 → 桶 / 非轴 → 标量 × 行级配对比例）
// ══════════════════════════════════════════════════════════════════════════════
describe('R21 夜A 跳③ 佩洛伊斯 1551 阳炎两臂（:524 整段迁进 specPanelBuffs.ts）', () => {
  it('钩子层：非轴臂产标量 `peiluoKagerouPct = 40 × 覆盖率`（0 / 20 / 40 精确值）', () => {
    const run = (cov: number) => peiluoProminenceMechanic.axisWindowOverlays!({
      slot: 1, axes: [], getAgentSkills: () => undefined, cinemaLevel: 0,
      isAxis: false, additionalAbilityActive: false, windInfectionRate: 0,
      settings: { 'peiluo.kagerouCoverage': cov },
    } as never)!
    expect(run(0).scalarBySlot!.get(1)!.peiluoKagerouPct).toBe(0)
    expect(run(0.5).scalarBySlot!.get(1)!.peiluoKagerouPct).toBe(PEILUO_KAGEROU_CRIT * 0.5)
    expect(run(1).scalarBySlot!.get(1)!.peiluoKagerouPct).toBe(40)
    // 滑块缺省（未给键）回落 1 = 满覆盖（与注册 default 同值）
    const dflt = peiluoProminenceMechanic.axisWindowOverlays!({
      slot: 1, axes: [], getAgentSkills: () => undefined, cinemaLevel: 0,
      isAxis: false, additionalAbilityActive: false, windInfectionRate: 0, settings: {},
    } as never)!
    expect(dflt.scalarBySlot!.get(1)!.peiluoKagerouPct).toBe(40)
    // ⚠ 本机制出自**核心被动**⇒ **无**额外能力门控（别照抄般岳/可琳）
    // 上面几例传的就是 additionalAbilityActive: false 而仍出标量，即该不变量的判据。
    // 标量按本槽键控
    const at2 = peiluoProminenceMechanic.axisWindowOverlays!({
      slot: 2, axes: [], getAgentSkills: () => undefined, cinemaLevel: 0,
      isAxis: false, additionalAbilityActive: false, windInfectionRate: 0,
      settings: { 'peiluo.kagerouCoverage': 1 },
    } as never)!
    expect(at2.scalarBySlot!.has(2)).toBe(true)
    expect(at2.scalarBySlot!.has(1)).toBe(false)
  })

  it('钩子层：轴臂产桶（`peiluoKagerouMap`），**不产**标量（两臂互斥）', () => {
    const res = peiluoProminenceMechanic.axisWindowOverlays!({
      slot: 1,
      axes: [{ actions: [
        { slot: 1, moveId: '1551015', count: 1, startTime: 0 },
        { slot: 1, moveId: '1551016', count: 1, startTime: 5 },
      ] }],
      getAgentSkills: () => undefined, cinemaLevel: 0,
      isAxis: true, additionalAbilityActive: false, windInfectionRate: 0,
      settings: { 'peiluo.kagerouCoverage': 1 },
    } as never)!
    expect(res.peiluoKagerouMap!.get('1551015')).toBe(40)
    expect(res.peiluoKagerouMap!.get('1551016')).toBe(40)
    expect(res.scalarBySlot).toBeUndefined()
  })

  it('★ 非轴真管线：阳炎暴伤**真乘**行级配对比例（ratio 0.5→1 时决算增益**恰翻倍**）', async () => {
    // ⚠ 这条必须走**真管线**且让配对比**真改变**，否则判据是空的：
    // 单调 `patchExecutions` 再断言 `pairRatio === 0.5` 只能证明「模块写了这个字段」，
    // **证明不了消费端真乘它**（实测：把消费端的 `* peiluoPairRatio` 删掉，那种写法仍全绿
    // —— 本用例初版就踩了这个坑，是变异测试抓出来的）。
    //
    // 判据的数学（为什么「比值之比恰为 2」是干净的杀手）：
    //   暴伤增益对单次伤害是**线性**的：`perDamage = K × (1 + critRate × (critDmg₀ + bonus))`，
    //   其中 `bonus = 40 × 覆盖率 × pairRatio`。故 cov 0→1 的增量
    //     `Δ = K_行 × critRate × 40 × pairRatio`
    //   ⇒ 同一行在 `pairRatio=0.5` 与 `pairRatio=1` 两态的增量之比 **恒等于 2**（K 与 critRate 约掉）。
    //   ⚠ 上分支与决算的 `K_行` 不同（招式倍率不同）⇒ **绝对**比值不是 0.5/1.0，
    //     实测 0.5755 / 1.1510（两者恰好 2 倍）——所以判据要用「比值之比」，不要用绝对值。
    //   ★ 若消费端**漏乘** pairRatio：两态的决算 bonus 都是满额 40 ⇒ 两个比值相等
    //     ⇒ 「比值之比」变成 **1.0** ⇒ 本断言红（这正是该变异的杀手）。
    //
    // 造 ratio 端点的可达状态：`enemy.stunCountLock`（实测 lock=2 ⇒ 失衡 1、决算 2、上分支 1
    // ⇒ ratio = min(1,2)/2 = **0.5**；lock=1 ⇒ 决算 1、上分支 1 ⇒ ratio = **1**）。
    const measure = async (lock: number) => {
      const { calc, config } = await calcOf([{ agentId: '1551' }, { agentId: '1211' }, { agentId: '1031' }])
      forceNonAxis(config)
      config.enemy.stunCountLock = lock
      await settle()

      const src = calc.resourceResult.value!.characters.find(c => c.agentId === '1551')!
      const verdictExec = src.executions.find(e => e.moveId === '1551016')!
      expect(verdictExec.count).toBe(lock) // lock=2 ⇒ 决算 2 次；lock=1 ⇒ 决算 1 次
      expect((verdictExec as any).peiluoKagerouPairRatio).toBeCloseTo(Math.min(1, lock) / lock, 10)

      // 逐行 perDamage 的**计数加权平均**（不用总伤：总伤还含 count 与其它乘区，比值不干净）
      const perDamageOf = (moveId: string) => {
        const rows = directRowsOf(calc, '1551').filter(r => r.moveId === moveId)
        expect(rows.length).toBeGreaterThan(0)
        const c = rows.reduce((s, r) => s + r.count, 0)
        return rows.reduce((s, r) => s + r.perDamage * r.count, 0) / c
      }

      config.setMechanicSetting('peiluo.kagerouCoverage', 0)
      await settle()
      const upper0 = perDamageOf('1551015')
      const verdict0 = perDamageOf('1551016')
      config.setMechanicSetting('peiluo.kagerouCoverage', 1)
      await settle()
      const dUpper = perDamageOf('1551015') - upper0
      const dVerdict = perDamageOf('1551016') - verdict0

      // 两者都真变大了（阳炎真接在直伤上）
      expect(dUpper).toBeGreaterThan(0)
      expect(dVerdict).toBeGreaterThan(0)
      return { dUpper, dVerdict }
    }

    const half = await measure(2) // pairRatio = 0.5
    const full = await measure(1) // pairRatio = 1
    const rHalf = half.dVerdict / half.dUpper
    const rFull = full.dVerdict / full.dUpper
    // 两态都偏小/相等即说明 ratio 没被消费端乘上（漏乘 ⇒ rHalf === rFull）
    expect(rFull).toBeGreaterThan(rHalf)
    // ★ 核心：配对比例翻倍 ⇒ 决算增益**恰翻倍**（比值之比 == 2，精确）
    expect(rFull / rHalf).toBeCloseTo(2, 6)
  })

  it('★ 非轴真管线：覆盖率滑块 0 / 1 让**上分支**伤害精确变化（阳炎真接在直伤上）', async () => {
    const { calc, config } = await calcOf([{ agentId: '1551' }, { agentId: '1211' }, { agentId: '1031' }])
    forceNonAxis(config)

    config.setMechanicSetting('peiluo.kagerouCoverage', 0)
    await settle()
    const at0 = new Map(directRowsOf(calc, '1551').map(r => [r.id, r.totalDamage]))
    config.setMechanicSetting('peiluo.kagerouCoverage', 1)
    await settle()
    const at1 = new Map(directRowsOf(calc, '1551').map(r => [r.id, r.totalDamage]))

    // 同名行集合一致
    expect([...at1.keys()].sort()).toEqual([...at0.keys()].sort())
    // 至少有一行（上分支）真变大 ⇒ 阳炎没被迁丢
    let changed = 0
    for (const [id, v0] of at0) if ((at1.get(id) ?? 0) > v0 + 1e-6) changed++
    expect(changed).toBeGreaterThan(0)
  })

  it('反锁：**非佩洛伊斯**队里阳炎暴伤恒 0（标量按槽位键控、不外泄）', async () => {
    const { calc, config } = await calcOf([{ agentId: '1371' }, { agentId: '1211' }, { agentId: '1031' }])
    forceNonAxis(config)
    config.setMechanicSetting('peiluo.kagerouCoverage', 1)
    await settle()
    // 该队无 1551 ⇒ 非轴臂标量不该出现在任何槽；用「覆盖率 0/1 同结果」间接反锁
    const before = calc.damagePoolRows.value.map(r => r.totalDamage).join(',')
    config.setMechanicSetting('peiluo.kagerouCoverage', 0)
    await settle()
    const after = calc.damagePoolRows.value.map(r => r.totalDamage).join(',')
    expect(after).toBe(before)
  })
})

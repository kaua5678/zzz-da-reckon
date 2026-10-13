import { describe, expect, it } from 'vitest'
import {
  buildBossHpCurve, buildEnvLanes, deriveVersionAxis, project3d, versionGridOf, zGridOf, type VersionLane,
} from '@/composables/difficultyCurve3d'

const names: Record<string, string> = { '1431': '叶瞬光', '1371': '仪玄', '1481': '琉音', '1491': '柳', '1311': '耀嘉音', '1341': '丽娜' }
const nameOf = (id: string) => names[id] ?? id

describe('难度曲线 3D · 版本轴推导（用户 2026-09-19：在变化的那个角色做默认版本号）', () => {
  it('相同主 C、不同击破手 ⇒ 版本槽 = 击破位（槽 1），道序按 agentId 升序', () => {
    const axis = deriveVersionAxis([
      { presetId: 'a', name: '叶+柳+耀', team: ['1431', '1491', '1311'] },
      { presetId: 'b', name: '叶+琉+耀', team: ['1431', '1481', '1311'] },
    ], {}, nameOf)
    expect(axis.varyingSlots).toEqual([1])
    expect(axis.defaultSlot).toBe(1)
    expect(axis.ambiguous).toBe(false)
    expect(axis.lanes.map(l => [l.presetId, l.label, l.y])).toEqual([['b', '琉音', 0], ['a', '柳', 1]])
  })

  it('相同击破手、不同版本主 C ⇒ 版本槽 = 主 C 位（槽 0）', () => {
    const axis = deriveVersionAxis([
      { presetId: 'x', name: '仪玄队', team: ['1371', '1481', '1311'] },
      { presetId: 'y', name: '叶瞬光队', team: ['1431', '1481', '1311'] },
    ], {}, nameOf)
    expect(axis.defaultSlot).toBe(0)
    expect(axis.lanes.map(l => l.label)).toEqual(['仪玄', '叶瞬光'])
  })

  it('多个槽位在变 ⇒ ambiguous，缺省取变化最多的槽；overrides 逐队改版本角色', () => {
    const teams = [
      { presetId: 'p', name: 'p', team: ['1431', '1481', '1311'] },
      { presetId: 'q', name: 'q', team: ['1431', '1491', '1341'] },
      { presetId: 'r', name: 'r', team: ['1371', '1491', '1311'] },
    ]
    const axis = deriveVersionAxis(teams, {}, nameOf)
    expect(axis.ambiguous).toBe(true)
    expect(axis.varyingSlots).toEqual([0, 1, 2])
    // 槽 0 两种、槽 1 两种、槽 2 两种 ⇒ 并列取靠前的槽 0
    expect(axis.defaultSlot).toBe(0)
    const withOverride = deriveVersionAxis(teams, { r: 2 }, nameOf)
    expect(withOverride.lanes.find(l => l.presetId === 'r')!.label).toBe('耀嘉音')
    // 同一版本角色出现在多支队时标签追加其余成员消歧，且全体唯一
    const labels = withOverride.lanes.map(l => l.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.some(l => l.startsWith('叶瞬光（'))).toBe(true)
  })

  it('★ 并列最多变化时优先「版本号解析得出来」的槽（否则整轴回退、血量剖面画不出）', () => {
    // 实测场景（默认选中的席德两队）：槽 1（妮可/希希芙）与槽 2（希希芙/千夏）各变 2 个 agent，
    // 槽 1 里的妮可是四星（releaseIndexOf → null），槽 2 两人都有版本节点。
    const idx: Record<string, number> = { '1521': 31, '1491': 25 }
    const releaseIndexOf = (id: string) => idx[id] ?? null
    const teams = [
      { presetId: 'a', name: '席德+妮可+希希芙', team: ['1461', '1031', '1521'] },
      { presetId: 'b', name: '席德+希希芙+千夏', team: ['1461', '1521', '1491'] },
    ]
    expect(deriveVersionAxis(teams, {}, nameOf, () => null).defaultSlot).toBe(1) // 无解析器 ⇒ 退回槽位号
    const axis = deriveVersionAxis(teams, {}, nameOf, releaseIndexOf)
    expect(axis.varyingSlots).toEqual([1, 2])
    expect(axis.defaultSlot).toBe(2)   // 槽 2 能解析出 2 个版本节点 ⇒ 它才是有信息量的那个
    expect(axis.gapped).toBe(true)     // 因而整轴仍然留空档（旧的「取靠前槽」在这里会 gapped=false）
    // 槽 1 仍可由用户逐队改回去（口径没被删，只是缺省更聪明）
    const forced = deriveVersionAxis(teams, { a: 1, b: 1 }, nameOf, releaseIndexOf)
    expect(forced.gapped).toBe(false)
  })

  it('单队 / 全同 ⇒ 无变化槽，缺省槽 0，一条道', () => {
    const axis = deriveVersionAxis([{ presetId: 'only', name: 'only', team: ['1431', '1481', '1311'] }], {}, nameOf)
    expect(axis.varyingSlots).toEqual([])
    expect(axis.defaultSlot).toBe(0)
    expect(axis.lanes).toHaveLength(1)
    expect(axis.lanes[0]!.label).toBe('叶瞬光')
  })

  it('⑤ 道位按首次 UP 版本节点序号留空档（用户 2026-09-19）；未收录/同点回退等距', () => {
    // 模拟版本节点表：1481=8、1491=4、1431=9、9999 未收录（三节点 4/8/9 ⇒ 留空档时的中点 = 4/5 = 0.8 ≠ 等距 0.5）
    const idx: Record<string, number> = { '1481': 8, '1491': 4, '1431': 9 }
    const releaseIndexOf = (id: string) => idx[id] ?? null
    const teams = [
      { presetId: 'a', name: '叶+柳+耀', team: ['1431', '1491', '1311'] },
      { presetId: 'b', name: '叶+琉+耀', team: ['1431', '1481', '1311'] },
    ]
    // 两队道位 = 节点间距归一：柳 4 → 0，琉音 8 → 1（两端；，中间空节点无声但真实在轴上）
    const axis2 = deriveVersionAxis(teams, {}, nameOf, releaseIndexOf)
    expect(axis2.gapped).toBe(true)
    // 道序仍按 agentId 数值升序（1481 < 1491），但道**位置**按节点序号
    expect(axis2.lanes.map(l => [l.agentId, l.versionIndex, l.frac])).toEqual([
      ['1481', 8, 1],
      ['1491', 4, 0],
    ])
    // 三队同版本对面时按真实间距：柳 4 → 0、琉音 8 → 0.8、叶 9 → 1——0.8 ≠ 等距的 0.5，
    // 正是「留空档」与「一前一后贴着」的可观测差
    const axis3 = deriveVersionAxis([
      ...teams,
      { presetId: 'c', name: '仪+琉+耀', team: ['1431', '1481', '1311'] },
      { presetId: 'd', name: '叶主C', team: ['1431', '1311', '1491'] },
    ], { c: 0, d: 0 }, nameOf, releaseIndexOf)
    expect(axis3.gapped).toBe(true)
    const byId = Object.fromEntries(axis3.lanes.map(l => [l.presetId, l.frac]))
    expect(byId['a']).toBe(0)          // 柳 4 = 最小
    expect(byId['b']).toBeCloseTo(0.8) // 琉音 8 = (8−4)/(9−4)；等距是 0.5，0.8 只能来自节点间距
    expect(byId['c']).toBe(1)          // 叶 9 = 最大
    expect(byId['d']).toBe(1)          // 叶 9 = 最大
    // 未收录角色混进 ⇒ 全轴回退等距（不让猜的间距污染真间距）。
    // ⚠ 这两支队在槽 0、槽 1 上变化数相同，而槽 0 的 A 队掺了未收录角色 ⇒ **缺省槽会挑槽 1**
    //   （2026-10-13 的「并列优先能解析的槽」），故这里显式把两队都钉回槽 0 再验回退
    const axisU = deriveVersionAxis([
      { presetId: 'a', name: 'A', team: ['9999', '1491', '1311'] },
      { presetId: 'b', name: 'B', team: ['1431', '1481', '1311'] },
    ], { a: 0, b: 0 }, nameOf, releaseIndexOf)
    expect(axisU.gapped).toBe(false)
    expect(axisU.lanes.map(l => l.frac)).toEqual([0, 1])
    // 不同节点不足 2 个（同版本角色）⇒ 等距回退，不是叠在一条道上
    const axisS = deriveVersionAxis(teams, {}, nameOf, () => 7)
    expect(axisS.gapped).toBe(false)
    expect(axisS.lanes.map(l => l.frac)).toEqual([0, 1])
  })
})

describe('② buildBossHpCurve：血量剖面覆盖道位区间内的**每个版本**（用户 2026-10-13 修复）', () => {
  const lane = (i: number, frac: number, versionIndex: number | null): VersionLane =>
    ({ presetId: `p${i}`, name: `p${i}`, slot: 0, agentId: `a${i}`, label: `a${i}`, y: i, frac, versionIndex })
  const nodeVersion: Record<number, string> = { 0: '2.0', 3: '2.2', 5: '2.3', 9: '2.7' }
  const phases = [
    { version: '2.0', hp: 100, modeType: 'defense' },
    { version: '2.0', hp: 140, modeType: 'defense' },   // 同版本两期 ⇒ 平均 120、样本 2
    { version: '2.2', hp: 160, modeType: 'defense' },   // ⚠ 没有队落在 2.2：区间内的中间版本，必须出现
    { version: '2.3', hp: 200, modeType: 'defense' },
    { version: '2.7', hp: 900, modeType: 'defense' },   // 区间外（道位最大只到 5）⇒ 不该出现
    { version: '2.0', hp: 999, modeType: 'critical_assault' }, // 模式过滤：不进 defense 桶
  ]

  it('区间内每个有记录的版本都出点（含没有队落在上面的中间版本），区间外的不出', () => {
    const pts = buildBossHpCurve([lane(0, 0, 0), lane(1, 1, 5)], phases, 'defense', i => nodeVersion[i] ?? null)
    // frac = 节点序号在 [0,5] 上的归一：2.0→0、2.2→0.6、2.3→1
    expect(pts).toEqual([
      { frac: 0, value: 120, version: '2.0', samples: 2 },
      { frac: 0.6, value: 160, version: '2.2', samples: 1 },
      { frac: 1, value: 200, version: '2.3', samples: 1 },
    ])
    // ★ 旧口径（只取道位所在版本）在这组输入下只会得到 2.0 与 2.3 两个点、剖面成为一根斜线；
    //   中间版本存在 = 「表现出曲线」与「只取单一血量取值」的可观测差（本次修复的判据）
    expect(pts.length).toBeGreaterThan(2)
  })

  it('道位未解析 / 区间不足 2 个不同节点 / 全被模式过滤 ⇒ 空数组（页面注明「无血量记录」）', () => {
    expect(buildBossHpCurve([lane(0, 0, 0), lane(1, 0.5, null)], phases, 'defense', i => nodeVersion[i] ?? null)).toEqual([])
    expect(buildBossHpCurve([lane(0, 0, 5), lane(1, 1, 5)], phases, 'defense', i => nodeVersion[i] ?? null)).toEqual([])
    expect(buildBossHpCurve([lane(0, 0, 0), lane(1, 1, 5)], [], 'defense', i => nodeVersion[i] ?? null)).toEqual([])
    // 模式过滤后仍有记录（critical_assault 只有 2.0）
    expect(buildBossHpCurve([lane(0, 0, 0), lane(1, 1, 5)], phases, 'critical_assault', i => nodeVersion[i] ?? null))
      .toEqual([{ frac: 0, value: 999, version: '2.0', samples: 1 }])
  })

  it('区间内该 Boss 没上岗的版本跳过，折线跨空档直连（不插值）', () => {
    const gaps = [{ version: '2.0', hp: 100, modeType: 'defense' }, { version: '2.3', hp: 200, modeType: 'defense' }]
    const pts = buildBossHpCurve([lane(0, 0, 0), lane(1, 1, 5)], gaps, 'defense', i => nodeVersion[i] ?? null)
    expect(pts.map(p => p.version)).toEqual(['2.0', '2.3'])
    expect(pts.map(p => p.frac)).toEqual([0, 1])
  })
})

describe('④ buildEnvLanes：环境模式的道表（用户 2026-10-13；★ 修复「不出图」）', () => {
  // 选中 Boss 只在这些期上岗（实测同版本 3 期里通常只上 1~2 期）
  const periods = [
    { id: 'a1', label: '3.2 第1期', version: '3.2', begin: '2026-09-09' },
    { id: 'a2', label: '3.2 第2期', version: '3.2', begin: '2026-09-25' },
    { id: 'b1', label: '3.3 第1期', version: '3.3', begin: '2026-09-30' },
  ]
  const lane = (presetId: string, agentId: string): VersionLane =>
    ({ presetId, name: presetId, slot: 0, agentId, label: agentId, y: 0, versionIndex: 0, frac: 0 })

  it('★ 实装早于轴起点 ⇒ 全部上岗期都出道（角色不会过期；这是「不出图」的根因）', () => {
    /**
     * 实机场景：默认席德队实装 2.2，而默认 Boss 熔狱行赭只出现在 3.2/3.3。
     * 旧实现取「该队**版本内**的期」⇒ 2.2 的期 ∩ 3.2/3.3 的期 = 空 ⇒ 0 条道 ⇒ 整张图卡消失。
     * 正确读法：「首次 UP 日期」是**下界**，从那天起该 Boss 上岗的每一期都能打。
     */
    const out = buildEnvLanes([lane('t', 'ZIDE')], periods, {
      versionOf: () => '2.2', dateOf: () => '2025-09-04',
    })
    expect(out.map(l => l.periodId)).toEqual(['a1', 'a2', 'b1'])
  })

  it('实装落在期中 ⇒ 只出道实装之后（含该期）的那些期', () => {
    const out = buildEnvLanes([lane('t', 'MID')], periods, {
      versionOf: () => '3.2', dateOf: () => '2026-09-25',
    })
    expect(out.map(l => l.periodId)).toEqual(['a2', 'b1'])
  })

  it('实装晚于轴内全部期（未来角色）⇒ 该队不出道（空数组，不塞假数据）', () => {
    expect(buildEnvLanes([lane('t', 'FUTURE')], periods, {
      versionOf: () => '9.9', dateOf: () => '2030-01-01',
    })).toEqual([])
  })

  it('日期查不到 ⇒ 退回版本号比较（版本号单调，可数值比较）', () => {
    const out = buildEnvLanes([lane('t', 'FOUR')], periods, { versionOf: () => '3.2', dateOf: () => null })
    expect(out.map(l => l.periodId)).toEqual(['a1', 'a2', 'b1'])
    // 3.3 ⇒ 只剩 b1
    expect(buildEnvLanes([lane('t', 'FOUR')], periods, { versionOf: () => '3.3', dateOf: () => null })
      .map(l => l.periodId)).toEqual(['b1'])
  })

  it('日期与版本号都没有 ⇒ 不出道；空期轴 ⇒ 空数组', () => {
    expect(buildEnvLanes([lane('t', 'X')], periods, { versionOf: () => null, dateOf: () => null })).toEqual([])
    expect(buildEnvLanes([lane('t', 'X')], [], { versionOf: () => '2.0', dateOf: () => '2024-01-01' })).toEqual([])
  })

  it('多队各按自己的实装时点出道（同图里既有全程可打的、也有中途加入的）', () => {
    const out = buildEnvLanes([lane('t1', 'A'), lane('t2', 'B')], periods, {
      versionOf: () => null,
      dateOf: id => (id === 'A' ? '2024-07-04' : '2026-09-30'),
    })
    expect(out).toEqual([
      { presetId: 't1', periodId: 'a1' }, { presetId: 't1', periodId: 'a2' }, { presetId: 't1', periodId: 'b1' },
      { presetId: 't2', periodId: 'b1' },
    ])
  })
})

describe('难度曲线 3D · 刻度网格（缺省密度；相机可覆盖）', () => {
  it('versionGridOf：道数 ≤ 上限时逐道一行；超过则抽稀但恒含末道', () => {
    expect(versionGridOf(0)).toEqual([])
    expect(versionGridOf(3)).toEqual([0, 1, 2])
    expect(versionGridOf(3, { all: true })).toEqual([0, 1, 2])
    const many = versionGridOf(30)
    expect(many[0]).toBe(0)
    expect(many[many.length - 1]).toBe(29)
    expect(many.length).toBeLessThan(30)
  })

  it('zGridOf：0 起底含端点；血量% 轴 5 档（100% 落在网格上），侧视加密到 4 档', () => {
    expect(zGridOf(100)).toEqual([0, 20, 40, 60, 80, 100])
    expect(zGridOf(250)).toEqual([0, 50, 100, 150, 200, 250])
    // ★ 50 的整数倍保证击杀线 100% 正好落在网格线上（ratioMax 是 50 的倍数）
    expect(zGridOf(250)).toContain(100)
    expect(zGridOf(250, { dense: true })).toEqual([0, 62.5, 125, 187.5, 250])
    expect(zGridOf(0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })
})

describe('难度曲线 3D · 投影', () => {
  it('俯视 90° 时高度不影响屏幕坐标；平视 0° 时深度不影响屏幕 y；远处深度更大', () => {
    const top = project3d(0.2, 0.3, 0.9, { yaw: 0, pitch: 90, zoom: 1 })
    const top0 = project3d(0.2, 0.3, 0.0, { yaw: 0, pitch: 90, zoom: 1 })
    expect(top.sx).toBeCloseTo(top0.sx, 9)
    expect(top.sy).toBeCloseTo(top0.sy, 9)
    const near = project3d(0.5, 0, 0.5, { yaw: 0, pitch: 30, zoom: 1 })
    const far = project3d(0.5, 1, 0.5, { yaw: 0, pitch: 30, zoom: 1 })
    expect(far.depth).toBeGreaterThan(near.depth)
    expect(far.sy).toBeLessThan(near.sy)
    const flat = project3d(0.5, 0, 0.5, { yaw: 0, pitch: 0, zoom: 1 })
    const flatFar = project3d(0.5, 1, 0.5, { yaw: 0, pitch: 0, zoom: 1 })
    expect(flat.sy).toBeCloseTo(flatFar.sy, 9)
  })
})

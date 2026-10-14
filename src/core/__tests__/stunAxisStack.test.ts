import { describe, expect, it } from 'vitest'
import { calcStunAxisStack, allocateAxisWindows } from '@/core/stunAxisStack'

// 伊琉 0命爆发轴：连携(0) → 终结技(喧响3000)×2 → 溯寒追碾(0)×2 → 极寒重碾(60闪能)×2 → 下砸(0) → 平A(0)
const stack = [
  { slot: 0, moveId: '1051025', count: 1, actionTime: 2.517, energyCost: 0, decibelCost: 0 },
  { slot: 0, moveId: '1051016', count: 2, actionTime: 1.766, energyCost: 0, decibelCost: 3000 },
  { slot: 0, moveId: '1051011', count: 2, actionTime: 0.95, energyCost: 0, decibelCost: 0 },
  { slot: 0, moveId: '1051012', count: 2, actionTime: 2.6, energyCost: 60, decibelCost: 0 },
  { slot: 0, moveId: '1051007', count: 1, actionTime: 1.2917, energyCost: 0, decibelCost: 0 },
  { slot: 0, moveId: '1051003', count: 1, actionTime: 1.55, energyCost: 0, decibelCost: 0 },
]

/**
 * 轴窗口分配（用户口径 2026-10-14）：
 * > 「**末尾优先**，**双转大（尽量打的类别）看情况放 0-1 个**，**其余兜底**。」
 * > 「如果只有一个轴那意思就是每次失衡都打这个。如果有收尾轴那意思是最后打收尾轴，
 * >   其他时候打上一个普通轴。」
 *
 * 四阶段：① tail 先占 1 窗（末尾优先）② fixed 按 count ③ bestEffort 有富余给 1
 * ④ fallback 末条吃剩余。**旧实现的缺陷**：count 缺省者吃光剩余（无论在第几位）⇒
 * 后面的显式轴全被压成 0（`[None,1,1]`+4 曾得 `[4,0,0]`，用户口径 `[2,1,1]`）。
 */
describe('allocateAxisWindows', () => {
  it('① 末尾优先：tail 先占 1 窗，fallback 吃剩余', () => {
    // 仪琉：常规(兜底) + 尾段(收尾) ⇒ 失衡 4 = 常规3 + 尾段1（用户口径；旧实现 [4,0]）
    const axes = [{ kind: 'fallback' as const }, { kind: 'tail' as const }]
    expect(allocateAxisWindows(axes, 4)).toEqual([3, 1])
    expect(allocateAxisWindows(axes, 3)).toEqual([2, 1])
    expect(allocateAxisWindows(axes, 5)).toEqual([4, 1])
  })

  it('② 双转大（bestEffort）看情况放 0-1 个，其余兜底', () => {
    // 5火10大：循环(兜底) + 双转大(尽量打) + 末尾(收尾)
    const axes = [{ kind: 'fallback' as const }, { kind: 'bestEffort' as const }, { kind: 'tail' as const }]
    expect(allocateAxisWindows(axes, 4)).toEqual([2, 1, 1])  // 用户口径
    expect(allocateAxisWindows(axes, 3)).toEqual([1, 1, 1])
    expect(allocateAxisWindows(axes, 5)).toEqual([3, 1, 1])
    // 富余不足时 bestEffort 得 0（「看情况」的 0 侧）
    expect(allocateAxisWindows(axes, 1)).toEqual([0, 0, 1])
    expect(allocateAxisWindows(axes, 2)).toEqual([0, 1, 1])
  })

  it('③ 单轴 = 兜底轴（吃满），不写死次数', () => {
    // 用户口径：「只有一个爆发轴说明这个就是兜底轴」+「显示 4 次不要用，失衡次数不确定」
    for (const stun of [1, 3, 4, 5, 7]) {
      expect(allocateAxisWindows([{ kind: 'fallback' as const }], stun)).toEqual([stun])
    }
  })

  it('④ 显式 fixed 次数优先于 bestEffort，且不超剩余', () => {
    const axes = [{ kind: 'fixed' as const, count: 3 }, { kind: 'fixed' as const, count: 1 }]
    expect(allocateAxisWindows(axes, 4)).toEqual([3, 1])
    expect(allocateAxisWindows(axes, 2)).toEqual([2, 0])   // 第二个固定轴被剩余量截断
    expect(allocateAxisWindows(axes, 0)).toEqual([0, 0])
  })

  it('⑤ 多条 fallback：只有**最后一条**吃剩余（末条兜底，旧实现给了首条）', () => {
    const axes = [{ kind: 'fallback' as const }, { kind: 'fallback' as const }]
    expect(allocateAxisWindows(axes, 4)).toEqual([0, 4])
    // 与类型注释「多条轴时按顺序分配，末条兜底」一致（旧实现与文档自相矛盾）
  })

  it('⑧ 升级轴（bestEffort）按**资源**判定：够就给、不够就放过（T157 用户口径）', () => {
    /**
     * 用户 2026-10-14 把「谁先拿窗」讲成**通用优先级**：
     * > 「不用局限于 2 条轴，把 2 条轴先后判定修改为**优先级判断**，这样就可以有**无限多的轴**。
     * >    **末尾指定了一次所以最优先**，**升级轴说是尽量打，有资源就优先，没有就放过，所以优先级第二**。
     * >    **第三就是兜底了**」
     * ⇒ 本用例锁「优先级 + 资源」两件事：三段式、末尾恒占 1、升级轴看好评、兜底吃剩余。
     */
    // 5火10大 的形态：循环(兜底, 每窗 60 好评) / 双转大(尽量打, 每窗 120) / 末尾(收尾, 每窗 150)
    const axes = [
      { kind: 'fallback' as const, actions: [{ promoteVariant: '60', count: 1 }] },
      { kind: 'bestEffort' as const, actions: [{ promoteVariant: '60', count: 2 }] },
      { kind: 'tail' as const, actions: [{ promoteVariant: '60', count: 1 }, { promoteVariant: '90', count: 1 }] },
    ]
    // 好评不足 ⇒ 升级轴放过、兜底吃剩余（[3,0,1] = 普通3 + 收尾1）
    expect(allocateAxisWindows(axes, 4, { goodReview: 0 })).toEqual([3, 0, 1])
    expect(allocateAxisWindows(axes, 4, { goodReview: 60 })).toEqual([3, 0, 1])
    // 好评够（≥120）⇒ 升级轴拿到 1 窗 ⇒ **[2,1,1]** = 用户描述的「普通×2 + 三大×1 + 收尾×1」
    expect(allocateAxisWindows(axes, 4, { goodReview: 150 })).toEqual([2, 1, 1])
    expect(allocateAxisWindows(axes, 4, { goodReview: 900 })).toEqual([2, 1, 1])
    // 不传资源 ⇒ 退回旧语义（纯按剩余窗数：有富余就给 1）——保证既有调用方逐位不变
    expect(allocateAxisWindows(axes, 4)).toEqual([2, 1, 1])
    // 末尾优先不受资源影响：好评 0 也照占 1 窗
    expect(allocateAxisWindows(axes, 1, { goodReview: 0 })).toEqual([0, 0, 1])
  })

  it('⑥ 反空洞：Σ 分配恒等于失衡次数（每个窗口都必须有归属轴）', () => {
    const cases: { kind: 'fallback' | 'tail' | 'bestEffort' | 'fixed'; count?: number }[][] = [
      [{ kind: 'fallback' }],
      [{ kind: 'fallback' }, { kind: 'tail' }],
      [{ kind: 'fallback' }, { kind: 'bestEffort' }, { kind: 'tail' }],
      [{ kind: 'tail' }, { kind: 'tail' }, { kind: 'fallback' }],
      [{ kind: 'fixed', count: 2 }, { kind: 'fallback' }],
    ]
    for (const axes of cases) {
      for (const stun of [0, 1, 2, 3, 4, 5, 6, 9]) {
        for (const res of [undefined, { goodReview: 0 }, { goodReview: 300 }]) {
          const w = allocateAxisWindows(axes, stun, res)
          expect(w.reduce((a, b) => a + b, 0), `${JSON.stringify(axes)} stun=${stun} res=${JSON.stringify(res)} ⇒ ${JSON.stringify(w)}`).toBe(stun)
        }
        const w = allocateAxisWindows(axes, stun)
        expect(w.reduce((a, b) => a + b, 0), `${JSON.stringify(axes)} stun=${stun} ⇒ ${JSON.stringify(w)}`).toBe(stun)
        expect(w.every(x => x >= 0 && Number.isInteger(x))).toBe(true)
      }
    }
  })

  it('⑦ 缺省推断（兼容存量未标 kind 的数据）：count≥1 ⇒ fixed，否则 fallback', () => {
    // 旧数据 `[缺省, 1, 1]`：首条缺省按 fallback ⇒ 得到用户口径 [2,1,1]（而非旧的 [4,0,0]）
    expect(allocateAxisWindows([{}, { count: 1 }, { count: 1 }], 4)).toEqual([2, 1, 1])
    // count:0 是历史编辑失误 ⇒ 按 fallback 处理（不再当「打 0 次」）
    expect(allocateAxisWindows([{ count: 0 }, { count: 1 }], 4)).toEqual([3, 1])
  })

  it('legacy: allocates exact counts then 兜底 eats the remainder', () => {
    // 爆发轴 count=4 → 4 窗口，经济轴无 count → 兜底吃剩余
    const axes = [{ count: 4 }, { count: undefined }]
    expect(allocateAxisWindows(axes, 6)).toEqual([4, 2])
    expect(allocateAxisWindows(axes, 4)).toEqual([4, 0])
    expect(allocateAxisWindows(axes, 2)).toEqual([2, 0])
  })

  it('weighted 连携/转大 across heterogeneous axes (爆发1连携/末尾爆发2连携)', () => {
    // 复刻 0章-琉：爆发轴 1 连携 ×4 窗口，经济轴 2 连携 ×(stunCount-4) 窗口
    const winAlloc = allocateAxisWindows([{ count: 4 }, {}], 6)
    expect(winAlloc).toEqual([4, 2])
    const chainTotal = 1 * winAlloc[0] + 2 * winAlloc[1]
    expect(chainTotal).toBe(8) // 4×1 + 2×2，而非简单相加 (1+2)×6=18
  })
})

describe('calcStunAxisStack', () => {
  it('full resources = burst axis (whole stack executes per window)', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 3,
      windowDuration: 16,
      energyBySlot: { 0: 360 },
      decibelBySlot: { 0: 18000 },
    })
    expect(r.executed['0:1051012'].count).toBe(6)
    expect(r.executed['0:1051016'].count).toBe(6)
    expect(r.executed['0:1051025'].count).toBe(3)
    expect(r.skipped).toHaveLength(0)
    expect(r.windowsUsed).toBe(3)
  })

  it('闪能不足 → 超出总量的强特被**去掉**（用户口径 2026-09-08：通用规则，耗资源招式从总量里拿）', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 3,
      windowDuration: 16,
      energyBySlot: { 0: 180 }, // 只够 3 次强特（60/次；轴里 6 次）
      decibelBySlot: { 0: 18000 },
    })
    expect(r.executed['0:1051012'].count).toBe(3)
    expect(r.skipped.filter(s => s.moveId === '1051012' && s.reason === 'energy')).toHaveLength(3)
    expect(r.energyUsed).toBe(180)
  })

  it('喧响不足 → 超出总量的终结技被**去掉**（用户口径 2026-09-08：轴从总量里挑招式）', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 3,
      windowDuration: 16,
      energyBySlot: { 0: 360 },
      decibelBySlot: { 0: 3000 }, // 只够 1 次大招（轴里 6 次）
    })
    // 只执行得起的 1 次；其余 5 次跳过（旧口径「只提示不跳过」会把 6 次全计入 → 实测 4 次大招被算成 4 次）
    expect(r.executed['0:1051016']?.count ?? 0).toBe(1)
    expect(r.skipped.filter(s => s.moveId === '1051016' && s.reason === 'decibel')).toHaveLength(5)
    expect(r.decibelUsed).toBe(3000)
  })

  it('short window stops at overflow (超窗口停，后面动作舍弃)', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 1,
      windowDuration: 8,
      energyBySlot: { 0: 360 },
      decibelBySlot: { 0: 18000 },
    })
    expect(r.executed['0:1051012']?.count ?? 0).toBe(0)
    expect(r.skipped.some(s => s.reason === 'time')).toBe(true)
  })

  it('合轴：各槽位时间独立，互不挤占（琉音并行）', () => {
    const twoSlot = [
      ...stack,
      { slot: 1, moveId: '1481011', count: 1, actionTime: 0.617, energyCost: 0, decibelCost: 0 },
      { slot: 1, moveId: '1481009', count: 1, actionTime: 0.9, energyCost: 0, decibelCost: 0 },
    ]
    const r = calcStunAxisStack({
      axes: [{ actions: twoSlot }],
      stunCount: 1,
      windowDuration: 16,
      energyBySlot: { 0: 360, 1: 100 },
      decibelBySlot: { 0: 18000, 1: 0 },
    })
    // 伊德海莉槽位堆到≈16s仍打满，琉音槽位(1.5s)并行也打满，互不影响
    expect(r.executed['0:1051012'].count).toBe(2)
    expect(r.executed['1:1481011'].count).toBe(1)
    expect(r.executed['1:1481009'].count).toBe(1)
  })

  it('每轴可指定不同兜底平A槽位（basicFillBySlot 按槽位汇总）', () => {
    const r = calcStunAxisStack({
      axes: [
        { actions: [{ slot: 0, moveId: 'm0', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0 }], count: 1, basicFillerSlot: 0 },
        { actions: [{ slot: 1, moveId: 'm1', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0 }], count: 1, basicFillerSlot: 1 },
      ],
      stunCount: 2,
      windowDuration: 10,
      energyBySlot: {},
      decibelBySlot: {},
    })
    expect(r.basicFillSeconds).toBe(16) // 每窗口 8s × 2
    expect(r.basicFillBySlot[0]).toBe(8)
    expect(r.basicFillBySlot[1]).toBe(8)
  })
})


describe('窗口终结动作（佩洛伊斯决算）截断', () => {
  const base = {
    stunCount: 1,
    windowDuration: 12,
    energyBySlot: { 0: 1000 },
    decibelBySlot: { 0: 10000 },
  }

  it('决算无视时间阀门：失衡最后一刻放出也执行（锁定失衡吃满易伤）', () => {
    const r = calcStunAxisStack({
      ...base,
      axes: [{
        actions: [
          // 槽位时间已排到 11s，决算 3s 放不下（11+3>12）——普通动作会被时间门控跳过，决算豁免
          { slot: 0, moveId: 'ex1', count: 1, actionTime: 11, energyCost: 40, decibelCost: 0, startTime: 0 },
          { slot: 0, moveId: '1551016', count: 1, actionTime: 3, energyCost: 0, decibelCost: 2000, startTime: 0, endsStunWindow: true },
        ],
      }],
    })
    expect(r.executed['0:1551016'].count).toBe(1)
    expect(r.skipped.some(k => k.moveId === '1551016')).toBe(false)
  })

  it('决算做完清空剩余失衡时间：平A填充为 0', () => {
    const r = calcStunAxisStack({
      ...base,
      axes: [{
        actions: [
          { slot: 0, moveId: 'ex1', count: 1, actionTime: 2, energyCost: 40, decibelCost: 0, startTime: 0 },
          { slot: 0, moveId: '1551016', count: 1, actionTime: 3, energyCost: 0, decibelCost: 2000, startTime: 4, endsStunWindow: true },
        ],
        basicFillerSlot: 0,
      }],
    })
    expect(r.executed['0:1551016'].count).toBe(1)
    expect(r.basicFillSeconds).toBe(0) // 剩余时间被清空，可填充平A为 0
  })

  it('防回归：无决算窗口照常填充（fill = 窗口 − 最后动作结束）', () => {
    const r = calcStunAxisStack({
      ...base,
      axes: [{
        actions: [
          { slot: 0, moveId: 'ex1', count: 1, actionTime: 2, energyCost: 40, decibelCost: 0, startTime: 0 },
          { slot: 0, moveId: 'ult', count: 1, actionTime: 3, energyCost: 0, decibelCost: 2000, startTime: 4 },
        ],
        basicFillerSlot: 0,
      }],
    })
    expect(r.basicFillSeconds).toBe(12 - 7)
  })

  it('多窗口：每个含决算的窗口都不填平A', () => {
    const r = calcStunAxisStack({
      ...base,
      stunCount: 3,
      axes: [{
        actions: [
          { slot: 0, moveId: '1551016', count: 1, actionTime: 3, energyCost: 0, decibelCost: 2000, startTime: 6, endsStunWindow: true },
        ],
        basicFillerSlot: 0,
      }],
    })
    expect(r.basicFillSeconds).toBe(0)
  })
})

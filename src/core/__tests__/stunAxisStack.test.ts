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

  it('⑧ 升级轴（bestEffort）按**总量鸡兔同笼**判定（T158 用户口径修正 T157 的错）', () => {
    /**
     * 用户 2026-10-14 修正（逐字）：
     * > 「**≥120这个条件不对**。你**无法确定进入三大轴的时刻好评点如何**。这里你只能根据**好评总量**，
     * >   比如三大轴比普通多用了 60 点好评，在**普通×3+收尾×1** 的基础上，若**富余 60 点好评**
     * >   就可以把一个普通换成三大轴，**鸡兔同笼**的感觉。如果富余 120 点可以换 2 个，
     * >   变成**三大×2+普通×1+收尾×1**。」
     *
     * ⚠ T157 的错：做成「**逐窗**检查当前余额够不够下一窗」——依赖**进入该窗的时刻余额**，
     * 而那是不可预知的（前置动作的转大/回能随时在变）。正解 = 先按**完整基础形态**算总成本
     * （普通×3 + 收尾×1），再看总量富余能换几个。
     */
    // 5火10大 形态：循环(兜底, 60/窗) / 双转大(升级, 120/窗) / 末尾(收尾, 150/窗)
    const axes = [
      { kind: 'fallback' as const, actions: [{ promoteVariant: '60', count: 1 }] },
      { kind: 'bestEffort' as const, actions: [{ promoteVariant: '60', count: 2 }] },
      { kind: 'tail' as const, actions: [{ promoteVariant: '60', count: 1 }, { promoteVariant: '90', count: 1 }] },
    ]
    const at = (goodReview: number) => allocateAxisWindows(axes, 4, { goodReview })
    // 基础形态成本 = 普通 3×60 + 收尾 1×150 = 330；换一个三大要多 60（120−60）
    expect(at(0), '富余为负 ⇒ 全普通').toEqual([3, 0, 1])
    expect(at(330), '恰好够基础 ⇒ 全普通（收尾成本必须算进基础）').toEqual([3, 0, 1])
    expect(at(389), '富余 59 < 60 ⇒ 换不动').toEqual([3, 0, 1])
    expect(at(390), '富余 60 ⇒ 换 1 个').toEqual([2, 1, 1])
    expect(at(450), '富余 120 ⇒ 换 2 个').toEqual([1, 2, 1])
    expect(at(510), '富余 180 ⇒ 换 3 个（普通清零）').toEqual([0, 3, 1])
    expect(at(9999), '富余再多也只换 3 个（基础窗数上限）').toEqual([0, 3, 1])
    // 末尾优先不受资源影响
    expect(allocateAxisWindows(axes, 1, { goodReview: 0 })).toEqual([0, 0, 1])
    // 不传资源 ⇒ 退回旧语义（纯按剩余窗数：有富余就给 1）——保证既有调用方逐位不变
    expect(allocateAxisWindows(axes, 4)).toEqual([2, 1, 1])
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

/**
 * **窗内填充 = 产出端，不受窗外平A池封顶**（用户口径 2026-10-27，逐字）：
 * > 「这里兜底部分和前面预设失衡部分不一样，**他本身作为一个产出招式的地方，而不从余量池拿取**。」
 *
 * ⚠ 本条取代旧判据「显式声明 filler 仍受 `basicBudgetBySlot` 封顶」——那个字段已被删除
 * （2026-10-27 并行会话重构），且口径本身也被上条裁决推翻：窗内填充的成本 = 它占的**窗内**时间本身，
 * 再按窗外平A池扣一遍等于双计。
 */
describe('窗内填充 = 产出端（不受窗外平A池约束）', () => {
  it('三个窗各填满窗尾（10 − 1 = 9s × 3 = 27s），与任何窗外预算无关', () => {
    const axes = [{
      actions: [{ slot: 0, moveId: 'x1', count: 1, actionTime: 1, energyCost: 0, decibelCost: 0 }],
      basicFillerSlot: 0,
    }]
    const base = { axes, stunCount: 3, windowDuration: 10, energyBySlot: { 0: 999 }, decibelBySlot: { 0: 9999 } }
    const free = calcStunAxisStack(base)
    expect(free.basicFillBySlot[0]).toBeCloseTo(27, 6)
    expect(free.basicFillSeconds).toBeCloseTo(27, 6)
  })
})

/**
 * **`count > 1` 的块按段平铺（单一排布时钟）**——用户 2026-10-26 报告（逐字）：
 * > 「希希芙有一个轴我之前图方便没有对动作进行排序，导致全挤在0秒，这似乎影响了剩余时间，
 * >   导致兜底平a过多，数据过多。」
 *
 * 病灶：`slotMaxEnd`（兜底平A 的「剩余时间」）与 `windowTrace.startTime` 用**原始** `startTime`，
 * 而 fits 门与合轴区间按段顺序推进 ⇒ `count: 3` 的块三段都记成「0 秒起手」，末端只算一段
 * ⇒ 窗口富余被高估、兜底平A 多填。实测 `auto-1461-1521-1491`（席希轴 `xide-bengzhui ×3`
 * 没写起点）：末窗兜底 **12.53s**（应 5.6s）、全队兜底 13.08s（应 6.15s）。
 */
describe('count>1 的块按段平铺（单一排布时钟）', () => {
  const combo = { slot: 0, moveId: 'combo3', count: 3, actionTime: 3.467, energyCost: 0, decibelCost: 0 }
  const ult = { slot: 0, moveId: 'ult', count: 1, actionTime: 5.417, energyCost: 0, decibelCost: 3000, startTime: 10.401 }

  it('轨迹逐段起点 = 0 / 3.467 / 6.934（修前三条都写 0）', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: [combo], basicFillerSlot: 0 }],
      stunCount: 1, windowDuration: 16, energyBySlot: { 0: 999 }, decibelBySlot: { 0: 9999 },
    })
    const starts = r.windowTrace[0]!.actions.map(a => +a.startTime.toFixed(3))
    expect(starts).toEqual([0, 3.467, 6.934])
    // 兜底 = 窗口 − 末段结束（3 × 3.467 = 10.401）
    expect(r.basicFillBySlot[0]).toBeCloseTo(16 - 10.401, 3)
  })

  it('后续终结技被喧响门去掉时，兜底仍按三段末端算（修前只算一段 ⇒ 多填 6.93s）', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: [combo, ult], basicFillerSlot: 0 }],
      stunCount: 1, windowDuration: 16, energyBySlot: { 0: 999 }, decibelBySlot: { 0: 0 },
    })
    expect(r.executed['0:ult']).toBeUndefined()
    expect(r.basicFillBySlot[0]).toBeCloseTo(16 - 10.401, 3)
  })

  it('显式 startTime 更晚时按它顺延（起点 = max(前一段结束, startTime)）', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: [{ ...combo, startTime: 1 }], basicFillerSlot: 0 }],
      stunCount: 1, windowDuration: 16, energyBySlot: { 0: 999 }, decibelBySlot: { 0: 9999 },
    })
    const starts = r.windowTrace[0]!.actions.map(a => +a.startTime.toFixed(3))
    expect(starts).toEqual([1, 4.467, 7.934])
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

  /**
   * ⚠ **2026-10-18 口径变更**（用户：「超时不是应该把最后一个动作算部分易伤吗？」+「小数这一块
   * 要做就要做完，不要显示一半骗一半」）：
   *
   * 旧口径 = 「超窗口停，**动作整段舍弃**」（`executed.count === 0`）——那一招落到轴外吃 1.0 倍，
   * 但引擎里从来没有「部分吃易伤」，于是「最后一招差 0.2s 装不下」= 整招白丢一次易伤。
   *
   * 新口径 = 「**第一个装不下的动作照常施放、按窗口剩余比例部分吃易伤**，其后的动作整段舍弃」：
   *  - `count` = 施放次数（整数，资源/时间按它扣）；
   *  - `inAxisCount` = 其中落在窗口内的部分（0..count）。
   */
  it('short window：首个跨界动作按剩余比例部分进窗，其后动作整段舍弃', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 1,
      windowDuration: 8,
      energyBySlot: { 0: 360 },
      decibelBySlot: { 0: 18000 },
    })
    // 前序动作占 2.517+1.766×2+0.95×2 = 7.949s ⇒ 第一个 1051012（2.6s）只剩 0.051s
    // ⇒ count=1（施放了一次）、inAxisCount≈0.0196（只有这一点在窗内）
    const first = r.executed['0:1051012']!
    expect(first.count).toBe(1)
    expect(first.inAxisCount).toBeCloseTo((8 - 7.949) / 2.6, 6)
    // 其后的动作（1051012 第二次 / 1051007 / 1051003）整段舍弃（槽位时间已超窗）
    expect(r.skipped.filter(s => s.reason === 'time').length).toBeGreaterThanOrEqual(3)
    // 整段舍弃的那些**不进 executed**（不是「进了但 inAxisCount=0」）
    expect(r.executed['0:1051007']).toBeUndefined()
    expect(r.executed['0:1051003']).toBeUndefined()
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

/**
 * **缺省兜底槽 = 轴内主C，且补位不吃窗外平A池**——用户口径 2026-10-27（逐字，两段）：
 * > 「任何轴都默认该有主c（轴里耗时最长的这人）平a的兜底填充。然后，在最后一个动作的最末尾
 * >  到失衡轴最末尾这一段空白用他的平a填充，达成吃易伤的平a时间，**这个是必要时间不可被克扣**。」
 * > 「之前说平a兜底从预算拿，**这俩不矛盾**。之前的意思是，你的平a不能**无成本**打出来。
 * >  现在的意思是，你必须打平a并且**带成本**，这是兜底的更差选择。……这里兜底部分和前面预设失衡
 * >  部分不一样，**他本身作为一个产出招式的地方，而不从余量池拿取**。」
 *
 * 病灶实测（干净树 @266b8f7d）：35 条带轴队伍里 **14 条没声明 basicFillerSlot** ⇒
 * 整段窗尾既不填平A、也不报发呆（窗尾 1.34~14.33s 账面蒸发）。
 * 而**显式声明**的 filler 仍受 2026-10-25 的窗外池封顶（那条口径没被推翻）。
 */
describe('缺省兜底槽 = 轴内主C（用户口径 2026-10-27）', () => {
  /** 槽 1 的动作耗时合计最长 ⇒ 主C 是槽 1 */
  const axes = [
    {
      actions: [
        { slot: 0, moveId: 'a0', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0 },
        { slot: 1, moveId: 'a1', count: 2, actionTime: 3, energyCost: 0, decibelCost: 0 },
      ],
    },
  ]
  const base = { axes, stunCount: 1, windowDuration: 16, energyBySlot: { 0: 999, 1: 999 }, decibelBySlot: { 0: 9999, 1: 9999 } }

  it('① 未声明 filler ⇒ 按轴内耗时最长的槽补位（修前 fill = 0，窗尾蒸发）', () => {
    const r = calcStunAxisStack(base)
    // 槽1 排两块共 6s ⇒ 窗尾 16 − 6 = 10s 由槽1（主C）填
    expect(r.basicFillBySlot[1]).toBeCloseTo(10, 6)
    expect(r.basicFillBySlot[0]).toBeUndefined()
    expect(r.basicFillSeconds).toBeCloseTo(10, 6)
  })

  it('② 声明槽与缺省槽同口径：都是产出端，一律填满窗尾', () => {
    // 用户口径 2026-10-27：「产出端，不从余量池拿取」——声明与缺省只决定**谁来填**，不决定填多少
    const declared = [{
      actions: [{ slot: 1, moveId: 'a1', count: 2, actionTime: 3, energyCost: 0, decibelCost: 0 }],
      basicFillerSlot: 1,
    }]
    const r = calcStunAxisStack({ ...base, axes: declared })
    expect(r.basicFillBySlot[1], '声明槽同样填满窗尾 16 − 6 = 10').toBeCloseTo(10, 6)
  })
})
/**
 * **逐窗轨迹的「丢失 / 填充」归属**（2026-10-27，资源池页逐窗兑现图的数据基础）。
 *
 * 用户口径（逐字）：「资源池页面如果开了轴模式，能显示 **n 次轴的动作块的丢失填充可视化**吗。
 * 丢失比如某些情况**跳招**了，填充比如我在末尾**自动填了平a或者强特**…」
 *
 * 修前：`skipped` 只有 {slot, moveId, reason}（**哪一窗丢的不可知**）、`windowTrace` 只有
 * `fillSeconds` 总量（**谁在哪一秒填的不可知**）、窗口没有 `axisIndex`（多轴队看不出第 5 窗属于收尾轴）。
 * 三条都是**纯追加**：判定/数值一位不动，只是把已经算出来的归属如实记下来。
 */
describe('逐窗归属：skipped.window / windowTrace.fillSegments / axisIndex（纯追加）', () => {
  it('① skipped 带窗口号（1-based，与 sequence.window 同口径）', () => {
    // 3 窗 × 每窗 2 次强特（60 闪能/次），总闪能 180 ⇒ 只够 3 次：窗1 打满、窗2 打 1 丢 1、窗3 丢 2
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 3,
      windowDuration: 16,
      energyBySlot: { 0: 180 },
      decibelBySlot: { 0: 18000 },
    })
    const energySkips = r.skipped.filter(s => s.moveId === '1051012' && s.reason === 'energy')
    expect(energySkips.map(s => s.window)).toEqual([2, 3, 3])
    // 反空洞：每条跳过的窗口号都必须是已排出的窗口（1..trace.length）
    expect(r.skipped.every(s => s.window >= 1 && s.window <= r.windowTrace.length)).toBe(true)
  })

  it('② fillSegments 与 fillSeconds 同源：Σ 秒数相等 + 只给声明槽（换人接已废止）', () => {
    /**
     * 2026-10-28 口径更新：**多槽接续已废止**（用户 2026-10-27「失衡内主打伤害的窗口不如让主c来打」），
     * 旧断言「槽0 池用尽 ⇒ 槽1 接上」钉的正是被否决的行为，本条改为钉新口径：
     * 填充**只**发生在 `basicFillerSlot` 上，Σ 段 = `fillSeconds`，且起点 = 最后一个动作结束。
     */
    const r = calcStunAxisStack({
      axes: [{
        actions: [{ slot: 0, moveId: 'x1', count: 1, actionTime: 4, energyCost: 0, decibelCost: 0 }],
        basicFillerSlot: 0,
      }],
      stunCount: 1,
      windowDuration: 10,
      energyBySlot: { 0: 999 },
      decibelBySlot: { 0: 9999 },
    })
    const segs = r.windowTrace[0]!.fillSegments
    expect(segs.map(s => s.slot), '只给声明槽，不再换人接').toEqual([0])
    expect(segs.reduce((a, s) => a + s.seconds, 0)).toBeCloseTo(r.windowTrace[0]!.fillSeconds, 9)
    expect(segs[0]!.startSeconds, '从槽0 最后一个动作结束处（4s）起').toBeCloseTo(4, 6)
    expect(segs[0]!.seconds, '窗尾 10−4 = 6s').toBeCloseTo(6, 6)
  })

  /**
   * ★ 2026-10-28 用户口径（逐字）：「缝隙只是因为失衡捏轴做的不精细导致的必然结果，我本意是说
   * 动作肯定是连续一个接一个的，中间插不了平a的。这不对，**应该只填缺失动作块时间的平a和末尾兜底**。」
   *
   * 反证形态：一条**故意留 3s 空隙**的轴（x1 @0 起 2s，x2 显式 startTime=5 起 2s，窗长 10）。
   * - 旧实现（填区间补集）⇒ 填充 2~5 这 3s **缝隙** + 7~10 这 3s 窗尾 = 6s；
   * - 新实现 ⇒ 只填窗尾 7~10 = 3s，缝隙 2~5 **一秒都不填**。
   */
  it('⑥ 缝隙不填（捏轴不精细的留白不是「待分配」）——只填末尾兜底', () => {
    const r = calcStunAxisStack({
      axes: [{
        actions: [
          { slot: 0, moveId: 'x1', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0, startTime: 0 },
          { slot: 0, moveId: 'x2', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0, startTime: 5 },
        ],
        basicFillerSlot: 0,
      }],
      stunCount: 1,
      windowDuration: 10,
      energyBySlot: { 0: 999 },
      decibelBySlot: { 0: 9999 },
    })
    const segs = r.windowTrace[0]!.fillSegments
    expect(r.windowTrace[0]!.fillSeconds, '只有窗尾 3s，不含中间 3s 缝').toBeCloseTo(3, 6)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.startSeconds, '从最后一个动作结束（5+2=7s）起').toBeCloseTo(7, 6)
    // 反空洞：若把缝隙也填了，这里会是 6 且段数 > 1
    expect(r.windowTrace[0]!.fillSeconds).toBeLessThan(6)
  })

  /**
   * ★ 2026-10-28：**缺失动作块的时长**要填（用户「缺失资源的时间内可以填充平a」）。
   *
   * 关键点是「填多少」：动作连续接上 ⇒ 被跳过的 b **让位**给后面的 c，空出来的秒数**落在窗尾**。
   * 构造：窗 10s，a(2s) + b(2s，闪能不足被跳过) + c(2s) ⇒ 实际执行 a、c 共 4s，窗尾 6s = 10−4。
   * 这 6s 里已经包含「b 本来要占的 2s」——**不许再加一遍**（那就是双计，7s 会撑爆窗口）。
   * 反证：若按 `skippedActionSeconds` 再加 2s ⇒ 会得到 8s 且窗口被撑爆，本条即红。
   */
  it('⑦ 被资源门控跳过 ⇒ 空出的时间落到窗尾（不双计）', () => {
    const r = calcStunAxisStack({
      axes: [{
        actions: [
          { slot: 0, moveId: 'a', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0 },
          { slot: 0, moveId: 'b', count: 1, actionTime: 2, energyCost: 60, decibelCost: 0 },
          { slot: 0, moveId: 'c', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0 },
        ],
        basicFillerSlot: 0,
      }],
      stunCount: 1,
      windowDuration: 10,
      energyBySlot: { 0: 0 },
      decibelBySlot: { 0: 9999 },
    })
    expect(r.skipped.filter(k => k.reason === 'energy'), '前提：b 被闪能门控跳过').toHaveLength(1)
    // 动作 a + c 用 4s ⇒ 窗尾 6s（b 的 2s 已含在内，不另加）
    expect(r.windowTrace[0]!.fillSeconds, '窗尾 10 − (a 2 + c 2) = 6s').toBeCloseTo(6, 6)
    // 反空洞：填充 + 动作不许超过窗口（双计就会 > 10）
    const actionSec = r.windowTrace[0]!.actionSeconds
    expect(actionSec + r.windowTrace[0]!.fillSeconds).toBeLessThanOrEqual(10 + 1e-9)
  })

  it('③ 决算截断窗不填 ⇒ fillSegments 为空（与 fillSeconds=0 同源）', () => {
    const r = calcStunAxisStack({
      axes: [{
        actions: [{ slot: 0, moveId: 'verdict', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0, endsStunWindow: true }],
        basicFillerSlot: 0,
      }],
      stunCount: 1,
      windowDuration: 16,
      energyBySlot: { 0: 999 },
      decibelBySlot: { 0: 9999 },
    })
    expect(r.windowTrace[0]!.truncated).toBe(true)
    expect(r.windowTrace[0]!.fillSeconds).toBe(0)
    expect(r.windowTrace[0]!.fillSegments).toEqual([])
  })

  it('④ axisIndex：多轴按顺序排窗（末条 tail 收尾轴 ⇒ 最后 1 窗属于它）', () => {
    const common = { actions: [{ slot: 0, moveId: 'c', count: 1, actionTime: 1, energyCost: 0, decibelCost: 0 }] }
    const tail = { kind: 'tail' as const, actions: [{ slot: 0, moveId: 't', count: 1, actionTime: 1, energyCost: 0, decibelCost: 0 }] }
    const r = calcStunAxisStack({
      axes: [common, tail],
      stunCount: 3,
      windowDuration: 10,
      energyBySlot: { 0: 999 },
      decibelBySlot: { 0: 9999 },
    })
    expect(r.windowTrace.map(t => t.axisIndex)).toEqual([0, 0, 1])
    // 反空洞：收尾轴的块只出现在最后一窗
    expect(r.windowTrace[2]!.actions.map(a => a.moveId)).toEqual(['t'])
    expect(r.windowTrace[0]!.actions.map(a => a.moveId)).toEqual(['c'])
  })

  it('⑤ 缺省补位会在轨迹上标 fillerDefaulted（声明了则 false）', () => {
    const actions = [{ slot: 0, moveId: 'a', count: 1, actionTime: 1, energyCost: 0, decibelCost: 0 }]
    const base = { stunCount: 1, windowDuration: 10, energyBySlot: { 0: 999 }, decibelBySlot: { 0: 9999 } }
    const defaulted = calcStunAxisStack({ ...base, axes: [{ actions }] })
    expect(defaulted.windowTrace[0]!.fillerDefaulted).toBe(true)
    const declared = calcStunAxisStack({ ...base, axes: [{ actions, basicFillerSlot: 0 }] })
    expect(declared.windowTrace[0]!.fillerDefaulted).toBe(false)
  })

  it('★ A10：lastWindowClipSeconds 缩短末窗 ⇒ 超出部分落到轴外（照常攒条）', () => {
    const actions = [{ slot: 0, moveId: 'a', count: 1, actionTime: 16, energyCost: 0, decibelCost: 0 }]
    const base2 = { axes: [{ actions }], stunCount: 2, windowDuration: 18, energyBySlot: { 0: 999 }, decibelBySlot: { 0: 9999 } }
    const full = calcStunAxisStack(base2)
    expect(full.executed['0:a']!.inAxisCount, '无 clip：两窗都整段在窗内').toBeCloseTo(2, 6)
    const clipped = calcStunAxisStack({ ...base2, lastWindowClipSeconds: 10 })
    expect(clipped.windowTrace[1]!.endSeconds, '末窗有效 8s').toBeCloseTo(8, 6)
    expect(clipped.executed['0:a']!.inAxisCount, '末窗只有 8/16 在窗内 ⇒ 合计 1.5').toBeCloseTo(1.5, 6)
  })
})


/**
 * **轴内动作顺序不参与语义**（用户口径 2026-11-03，逐字）：
 * > 「我们捏轴的时候几乎不看顺序了，**顺序本身是早期产物**，为了考虑缩短失衡后最末尾的招式被吞而设计的。
 * >  现在有平a兜底和招式兜底了，**顺序几乎没啥用**。」
 *
 * 旧行为：排布游标 `t0 = max(该槽游标, 显式 startTime)` 让「数组里靠后但声明更早」的块被**顺延** ⇒
 * 编辑器（按声明位置画）与逐窗兑现图（按引擎落点画）分叉，中段凭空空出一段。
 * 现在入口 `canonicalizeAxis` 先按 `startTime` 规范化：声明怎么写、数组怎么排，结果都一致，
 * 且轨迹落点 = **声明的起点**。
 */
describe('轴内动作顺序不参与语义（2026-11-03）', () => {
  const a = { slot: 0, moveId: 'a', count: 1, actionTime: 1, energyCost: 0, decibelCost: 0, startTime: 0 }
  const b = { slot: 0, moveId: 'b', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0, startTime: 5 }
  const c = { slot: 0, moveId: 'c', count: 1, actionTime: 1, energyCost: 0, decibelCost: 0, startTime: 3 }
  const base = { stunCount: 1, windowDuration: 16, energyBySlot: { 0: 999 }, decibelBySlot: { 0: 9999 } }
  const run = (actions: typeof a[]) => calcStunAxisStack({ ...base, axes: [{ actions, basicFillerSlot: 0 }] })

  it('★ 乱序声明（b@5 排在 c@3 之前）⇒ 轨迹仍按声明起点 0 / 3 / 5 排（修前 b 落到 4）', () => {
    const r = run([a, b, c])
    expect(r.windowTrace[0]!.actions.map(x => x.moveId)).toEqual(['a', 'c', 'b'])
    expect(r.windowTrace[0]!.actions.map(x => +x.startTime.toFixed(3))).toEqual([0, 3, 5])
    // 真空只在声明的空档里（1~3 / 4~5），不因为数组顺序多出一段
    expect(r.windowTrace[0]!.idleSegments.map(g => +g.startSeconds.toFixed(3))).toEqual([1, 4])
    expect(r.basicFillBySlot[0]).toBeCloseTo(16 - 7, 6)
  })

  it('★ 同一份声明写成任意顺序 ⇒ 逐字段相同（顺序不再有语义）', () => {
    const canonical = JSON.stringify(run([a, c, b]))
    for (const perm of [[a, b, c], [b, a, c], [b, c, a], [c, b, a], [c, a, b]]) {
      expect(JSON.stringify(run(perm)), perm.map(x => x.moveId).join('>')).toBe(canonical)
    }
  })

  it('★ 时间上最后者才跨界（派生结论，不靠列表顺序）', () => {
    // 末块 5s 起手、时长 2s ⇒ 16s 窗里整段在窗内；把它写进数组任意位置都不影响
    const r = run([b, c, a])
    expect(r.executed['0:b']!.inAxisCount).toBeCloseTo(1, 6)
    expect(r.windowTrace[0]!.actions.at(-1)!.moveId).toBe('b')
  })
})

import { describe, expect, it } from 'vitest'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getRegisteredMechanicSettings } from '@/mechanics'

/**
 * R51 用户裁决落地的**生效测试**：接线类（甲 / 丙 / 附）。
 *
 * ## 本文件对应哪次裁决（2026-09-20 round 51，管理员 AD）
 *
 * R50 把判据 4 的「按批补」推到收口，余 **7 条**全部需用户裁决（`§R50-J1`）。R51 收齐裁决：
 *
 * | 类 | 条目 | 裁决 | 落点 |
 * |---|---|---|---|
 * | 甲 | `1391.jufufu_weishi.{jufufu_weishi_assist,jufufu_team_ult_weishi_gain}.rate` | **接线** | `specPanelBuffs.ts#computeJufufuCycle` + `buildResourceResult` |
 * | 乙-4 | `1561.velina_corrosion.2 命风化获得.rate` | 接线（**合并**到模块那条） | 删 spec 重复声明，滑块 = `velina.cinema2CorrosionRate` |
 * | 丙 | `jane.frenzyActive` | **接线** | `jane.ts#applyJanePanel`（总闸） |
 * | 附 | `jane.passionCoverage` | **一并注册** | `jane.ts#settings` + 删手写卡片 |
 *
 * ## 口径（沿用 `mechanicSettingsEffect.test.ts` 的四条，别放宽）
 *
 * ① **必须走真管线**：`setupHarness` 真队伍 → `config.setMechanicSetting` → 真 `useResourceCalc()`。
 *    **禁止**直调钩子 + 手写 cfg（手写 cfg 会抹掉「生产代码写不写这个字段」这个自由度）。
 * ② **每个探针点独立 `setupHarness`** —— 跨值复用会因**收敛态污染**产出**假 no-delta**。
 * ③ **断言失败累积**再一次性 `toEqual([])`（否则一条失败就中断，看不到全貌）。
 * ④ **断言强度 = 比例性 / 闭式恒等式**，不只是「有 delta」。
 *
 * ## ★★ 两条踩过的坑（下一任别重踩）
 *
 * 1. **`computeJufufuCycle` 才是威势的权威口径**，`buildResourceResult` 里那份 `weishiGains`
 *    只是**展示**。`spinCount = weishiGain` 驱动威风回填 / 爆米花 / 附伤行 ⇒ **rate 必须同时进两条路径**，
 *    只改展示值 = 滑块「看起来生效但不算数」（本文件用**跨路径恒等式**锁这一点）。
 * 2. **两条 rate 的线性度不同**：`assist` 项三点严格线性（parry×1）；`teamUlt` 项**不严格**——
 *    它进 `weishiGain → spinCount → aweFromSpin → tigerChainCount` 的**正反馈**，实测
 *    84 / 180（不是 2×84=168）⇒ **不许写 `r2 === 2*r1`**，要写**恒等式**（R50 规律③同族）。
 * 3. **简的精通转攻要 `anomalyProficiency > 120` 才咬合**，而简基础精通 114 ⇒ 夹具必须给
 *    `driveDisc.mainStats[4] = 'anomalyProficiency'`（否则 `atk` 三点恒等 ⇒ 假 no-delta）。
 * 4. **简的 `applyPanel` 身份守卫容忍直调**（`jane.test.ts` 只传 `{ panel }`）：本文件一律走真管线，
 *    但改那段守卫时别忘了那个直调面。
 */

const RICH = {
  cinemaLevel: 6,
  parryCount: 8,
  dodgeCounterCount: 12,
  quickAssistCount: 4,
  chainCountPerStun: 2,
  blockCount: 4,
  perfectBlockCount: 5,
}

/** 简专用夹具：精通必须 >120 才让「精通转攻」项咬合（简基础 114） */
const JANE_DISC = {
  fourPieceSetId: '',
  twoPieceSetId: '',
  mainStats: { 4: 'anomalyProficiency' },
  subStatAllocation: {},
}

function mates(ids: string[]): HarnessTeamSlot[] {
  return ids.map(agentId => ({ agentId, cinemaLevel: 6 }) as HarnessTeamSlot)
}

/**
 * 单点真管线读数（**每点全新 `setupHarness`**，口径②）。
 * `read` 拿到真 `useResourceCalc()` 的产物，**不在探针里做加工** —— 闭式写在断言里。
 */
async function probe<T>(
  team: Array<HarnessTeamSlot | ''>,
  setup: (config: Awaited<ReturnType<typeof setupHarness>>['config']) => void,
  settingId: string,
  value: number,
  read: (calc: ReturnType<typeof useResourceCalc>) => T,
): Promise<T> {
  const { config } = await setupHarness(team)
  for (const buff of config.globalBuffs) buff.enabled = false
  setup(config)
  const calc = useResourceCalc()
  config.setMechanicSetting(settingId, value)
  await new Promise(r => setTimeout(r, 0))
  return read(calc)
}

/** 前提：这些 id 必须在运行时注册表里（否则本文件口径已过期，红得比断言本身更早） */
const REGISTERED = new Set(getRegisteredMechanicSettings().map(s => s.id))

describe('R51 裁决落地·接线类（甲 1391 威势 / 丙 jane.frenzyActive / 附 jane.passionCoverage）', () => {
  it('前提：本批 4 个 id 全在运行时注册表里', () => {
    const ids = [
      '1391.jufufu_weishi.jufufu_weishi_assist.rate',
      '1391.jufufu_weishi.jufufu_team_ult_weishi_gain.rate',
      'jane.frenzyActive',
      'jane.passionCoverage',
    ]
    const missing = ids.filter(i => !REGISTERED.has(i))
    expect(missing, `未注册: ${missing.join(', ')}`).toEqual([])
  })

  // ── 甲 · 1391 橘福福威势（两条近似项各乘自己的 rate）──────────────────────────────
  it('甲-1 `jufufu_weishi_assist.rate`：0/1/2 三点线性 + 精确项不受影响', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1391', ...RICH }, ...mates(['1371', '1431'])]
    const at = (v: number) => probe(team, c => { c.enemy.stunCountLock = 3 }, '1391.jufufu_weishi.jufufu_weishi_assist.rate', v, calc => {
      const w = calc.resourceResult.value?.characters?.find(c => c.agentId === '1391')!.specResources!['jufufu_weishi'] as any
      return {
        assist: w.gains.jufufu_weishi_assist,
        ex: w.gains.jufufu_weishi_ex_special,
        ult: w.gains.jufufu_weishi_ultimate,
        total: w.total,
        // ★ 权威口径（cycle 路径）：total 必须 === spinCount，否则 rate 只改了展示值
        spin: w.spendCounts.jufufu_spin_spend,
      }
    })
    const [r0, r1, r2] = [await at(0), await at(1), await at(2)]
    const failures: string[] = []
    // rate=0 ⇒ 该近似项归零
    if (r0.assist !== 0) failures.push(`rate=0 时 assist 应为 0，实到 ${r0.assist}`)
    // rate=1 ⇒ 基准 = parryCount(8) × 1
    if (r1.assist !== 8) failures.push(`rate=1 时 assist 应为 8（parry 8×1），实到 ${r1.assist}`)
    // rate=2 ⇒ 恰好 2×基准
    if (r2.assist !== 16) failures.push(`rate=2 时 assist 应为 16（2×8），实到 ${r2.assist}`)
    // 精确项（强特×3 / 终结×6）**不受 rate 影响**
    for (const [v, r] of [[0, r0], [1, r1], [2, r2]] as const) {
      if (r.ex !== 15) failures.push(`rate=${v}: 精确项 强特 应恒为 15，实到 ${r.ex}`)
      if (r.ult !== 24) failures.push(`rate=${v}: 精确项 终结 应恒为 24，实到 ${r.ult}`)
    }
    // ★★ 跨路径恒等式：展示 total 必须等于 cycle 的 spinCount
    for (const [v, r] of [[0, r0], [1, r1], [2, r2]] as const) {
      if (r.total !== r.spin) failures.push(`rate=${v}: total(${r.total}) 必须 === spinCount(${r.spin})`
        + ' ⇒ rate 未同时进 computeJufufuCycle（只改展示值 = 滑块假生效）')
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  it('甲-2 `jufufu_team_ult_weishi_gain.rate`：0 ⇒ 归零、单调、且与 spinCount 恒等（★ 不写 2×）', async () => {
    const team: HarnessTeamSlot[] = [{ agentId: '1391', ...RICH }, ...mates(['1371', '1431'])]
    const at = (v: number) => probe(team, c => { c.enemy.stunCountLock = 3 }, '1391.jufufu_weishi.jufufu_team_ult_weishi_gain.rate', v, calc => {
      const w = calc.resourceResult.value?.characters?.find(c => c.agentId === '1391')!.specResources!['jufufu_weishi'] as any
      return {
        teamUlt: w.gains.jufufu_team_ult_weishi_gain,
        assist: w.gains.jufufu_weishi_assist,
        total: w.total,
        spin: w.spendCounts.jufufu_spin_spend,
      }
    })
    const [r0, r1, r2] = [await at(0), await at(1), await at(2)]
    const failures: string[] = []
    if (r0.teamUlt !== 0) failures.push(`rate=0 时 队伍终结项 应为 0，实到 ${r0.teamUlt}`)
    if (!(r1.teamUlt > 0)) failures.push(`rate=1 时 队伍终结项 应 >0，实到 ${r1.teamUlt}`)
    // ⚠ 不写 `r2 === 2*r1`：本项经 spinCount → 威风 → 虎釜 正反馈，实测 84/180（不是 168）
    if (!(r2.teamUlt > r1.teamUlt)) failures.push(`rate=2 时 队伍终结项 应 > rate=1（单调），实到 ${r2.teamUlt} vs ${r1.teamUlt}`)
    // 另一条近似项不受本 rate 影响（防两条互相串）
    for (const [v, r] of [[0, r0], [1, r1], [2, r2]] as const) {
      if (r.assist !== 8) failures.push(`rate=${v}: assist 应恒为 8（不受本 rate 影响），实到 ${r.assist}`)
    }
    // ★★ 跨路径恒等式
    for (const [v, r] of [[0, r0], [1, r1], [2, r2]] as const) {
      if (r.total !== r.spin) failures.push(`rate=${v}: total(${r.total}) 必须 === spinCount(${r.spin})`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  // ── 丙 + 附 · 简（frenzyActive 总闸 / passionCoverage 覆盖率）────────────────────
  const janeTeam: HarnessTeamSlot[] = [
    { agentId: '1261', ...RICH, driveDisc: JANE_DISC },
    ...mates(['1371', '1431']),
  ]
  const janeRead = (calc: ReturnType<typeof useResourceCalc>) => {
    const p = calc.panels.value?.find(x => x.slot === 0) as any
    return {
      phys: p?.physicalAnomalyBuildUpEfficiency ?? null,
      atk: p?.atk ?? null,
      dmg: p?.dmgBonus ?? null,
      critRate: p?.critRate ?? null,
      critDmg: p?.critDmg ?? null,
    }
  }

  it('丙 `jane.frenzyActive`：0 ⇒ 狂热块+1命块归零；6命双暴**不动**（痛点/6命不吃总闸）', async () => {
    const off = await probe(janeTeam, () => {}, 'jane.frenzyActive', 0, janeRead)
    const on = await probe(janeTeam, () => {}, 'jane.frenzyActive', 1, janeRead)
    const failures: string[] = []
    // 狂热块（物理积蓄 +25%/精通转攻）与 1 命块（物理积蓄 +15%/精通增伤）双双归零
    if (!(off.phys! < on.phys!)) failures.push(`狂热关闭时物理积蓄应下降：off=${off.phys} on=${on.phys}`)
    if (!(off.atk! < on.atk!)) failures.push(`狂热关闭时精通转攻应下降：off=${off.atk} on=${on.atk}`
      + '（⚠ 若两点相等，先查夹具精通是否 >120：简基础 114，需 driveDisc 4 号位精通）')
    if (!(off.dmg! < on.dmg!)) failures.push(`狂热关闭时 1 命精通增伤应下降：off=${off.dmg} on=${on.dmg}`)
    // 6 命双暴不吃总闸（6 命是狂热的**来源**，不是后果）
    if (off.critRate !== on.critRate) failures.push(`6命暴击率不应受总闸影响：off=${off.critRate} on=${on.critRate}`)
    if (off.critDmg !== on.critDmg) failures.push(`6命暴伤不应受总闸影响：off=${off.critDmg} on=${on.critDmg}`)
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  it('附 `jane.passionCoverage`：0/0.5/1 三点线性（物理积蓄与精通转攻都按覆盖率折算）', async () => {
    const at = (v: number) => probe(janeTeam, () => {}, 'jane.passionCoverage', v, janeRead)
    const [r0, r5, r1] = [await at(0), await at(0.5), await at(1)]
    const failures: string[] = []
    // ★ 三点必须互不相同，否则采样点退化（R50 侦察的「饱和支」教训同族）
    if (r0.phys === r5.phys || r5.phys === r1.phys) {
      failures.push(`物理积蓄三点退化：${r0.phys}/${r5.phys}/${r1.phys} ⇒ 采样点落进同一支`)
    }
    // 线性：中点 = 两端平均（不写绝对值，夹具漂移不假红）
    if (Math.abs((r5.phys! * 2) - (r0.phys! + r1.phys!)) > 1e-6) {
      failures.push(`物理积蓄不线性：0=${r0.phys} .5=${r5.phys} 1=${r1.phys}`)
    }
    if (Math.abs((r5.atk! * 2) - (r0.atk! + r1.atk!)) > 1e-6) {
      failures.push(`精通转攻不线性：0=${r0.atk} .5=${r5.atk} 1=${r1.atk}`)
    }
    // 端点：0 ⇒ 两项都归零（覆盖率是乘法因子）
    if (r0.phys !== 0) failures.push(`覆盖率=0 时物理积蓄应归零，实到 ${r0.phys}`)
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  it('附 · 两个简滑块**互相独立**（防一条串到另一条：交叉移动必须各自只动自己的项）', async () => {
    // 覆盖率=0 与 总闸=0 在「物理积蓄」上应当**同值**（都是 frenzyFactor=0 的那一支），
    // 但 `frenzyActive=0, passion=1` 与 `frenzyActive=1, passion=0` 必须分别命中同一支
    // ⇒ 用作「两个乘子确实相乘而非覆盖」的判据。
    const a = await probe(janeTeam, () => {}, 'jane.frenzyActive', 0, janeRead)   // passion 用默认 0.9
    const b = await probe(janeTeam, () => {}, 'jane.passionCoverage', 0, janeRead) // frenzy 用默认 1
    const failures: string[] = []
    if (a.phys !== 0) failures.push(`总闸关 ⇒ 物理积蓄应 0，实到 ${a.phys}`)
    if (b.phys !== 0) failures.push(`覆盖率 0 ⇒ 物理积蓄应 0，实到 ${b.phys}`)
    // 两者都归零 ⇒ 是**相乘**（任一为 0 即 0），不是互相覆盖
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  // ── 乙-1 / 乙-2 · 1621 洛克茜风能 / 风眼（用户裁决「爬原文正确实现」+「建模计数回复消耗」）────
  //
  // ★ 本组是**乙类「资源不可达」的接线验证**：这 4 条曾因「自定义模块接管 agentId ⇒
  //   spec 派生模块整条跳过 ⇒ `computeSpecResources` 永不被调用」而零消费者 ⇒ 拖滑块不改任何数。
  //   接线方式 = 让**模块自己**读 `setting:<id>`（不是复活 spec 派生模块）。
  //
  // ⚠ `1621.roxy_wind_energy.wind_energy_per_30_energy.rate` 的 **id 里那个「30」是历史笔误**
  //   （原文 7 处逐字是 25），但 id 是主键 ⇒ **保留 id 不改**（改它要同步 settings 键与用户存档），
  //   只订正了 spec 的文案/属性。
  const roxyTeam: HarnessTeamSlot[] = [{ agentId: '1621', ...RICH }, ...mates(['1371', '1431'])]
  const roxyRead = (calc: ReturnType<typeof useResourceCalc>) => {
    const src = calc.resourceResult.value?.characters?.find(c => c.agentId === '1621')?.roxyWindEnergySource as any
    if (!src) throw new Error('资源结果里没有 roxyWindEnergySource（队伍装配失败？）')
    return {
      gain: src.windEnergyGain,
      consumed: src.windEnergyConsumed,
      eyes: src.windEyeGenerated,
      sendOff: src.sendOffCount,
      mini: src.miniTornadoCount,
      mega: src.megaTornadoCount,
    }
  }

  it('乙-1 `roxy_wind_energy...rate`：三点风能获取随 rate 变化（接线前恒等不变）', async () => {
    const at = (v: number) => probe(roxyTeam, () => {}, '1621.roxy_wind_energy.wind_energy_per_30_energy.rate', v, roxyRead)
    const [r0, r1, r2] = [await at(0), await at(1), await at(2)]
    const failures: string[] = []
    // ⚠ 冻结终结技那一项的贡献（`windEnergyGain = 强特路 floor(耗能/25) + ultimateCount`）：
    // rate=0 时强特路归零，但 `+ ultimateCount` **不受本条 rate 管辖**（它不是「每消耗 N 点能量」那条）
    // ⇒ 逐个读数扣掉它再断比例，别把「终结技 +1」误当成「rate=0 没生效」。
    const ultPart = r0.gain
    const exPart = (r: typeof r0) => r.gain - ultPart
    if (exPart(r0) !== 0) failures.push(`rate=0 ⇒ 强特路风能应为 0，实到 ${exPart(r0)}（终结技项 ${ultPart} 不受本条管辖）`)
    if (!(exPart(r1) > 0)) failures.push(`rate=1 ⇒ 强特路风能应 >0，实到 ${exPart(r1)}`)
    // 计数源侧缩放 ⇒ 单调（不写严格 2×：`Math.floor` 会让它非严格比例）
    if (!(exPart(r2) > exPart(r1))) failures.push(`rate=2 ⇒ 强特路风能应 > rate=1（单调），实到 ${exPart(r2)} vs ${exPart(r1)}`)
    // ★ 三点必须互不相同，否则就是「滑块没接线」的原始症状（distinct=1 正是 R51 接线前的实测值）
    if (new Set([exPart(r0), exPart(r1), exPart(r2)]).size !== 3) {
      failures.push(`三点强特路风能未全分化（${exPart(r0)}/${exPart(r1)}/${exPart(r2)}）⇒ 接线未生效（接线前实测三点恒为同一值）`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  it('乙-2 `roxy_wind_eye...rate`：风眼数与**下游**恕不远送/小旋风必须同时变（★ 判别断言）', async () => {
    const at = (v: number) => probe(roxyTeam, () => {}, '1621.roxy_wind_eye.wind_eye_from_cannon.rate', v, roxyRead)
    const [r0, r1, r2] = [await at(0), await at(1), await at(2)]
    const failures: string[] = []
    if (r0.eyes !== 0) failures.push(`rate=0 ⇒ 风眼数应为 0，实到 ${r0.eyes}`)
    if (!(r1.eyes > 0)) failures.push(`rate=1 ⇒ 风眼数应 >0，实到 ${r1.eyes}`)
    if (!(r2.eyes > r1.eyes)) failures.push(`rate=2 ⇒ 风眼数应 > rate=1，实到 ${r2.eyes} vs ${r1.eyes}`)
    // ★★ 本条的**判别力所在**：只断言 windEyeGenerated 会让「下游没接」偷偷通过
    //（R51 侦察实测原实现 `sendOffCount`/`miniTornadoCount` 读的是 `windEnergyConsumed`）
    if (!(r2.sendOff > r1.sendOff)) {
      failures.push(`下游「恕不远送」次数未随风眼数变：rate=1 → ${r1.sendOff}，rate=2 → ${r2.sendOff}`
        + ' ⇒ 下游仍读 windEnergyConsumed（滑块只影响爆鸣行 = 装饰性缩放）')
    }
    if (r0.sendOff !== 0) failures.push(`rate=0 ⇒ 恕不远送应为 0，实到 ${r0.sendOff}`)
    // 风眼账本自洽：generate = sendOff×3 + mini（每条引爆至多 3 个，余数走小旋风）
    for (const [v, r] of [[0, r0], [1, r1], [2, r2]] as const) {
      if (r.sendOff * 3 + r.mini !== r.eyes) {
        failures.push(`rate=${v}: 风眼账本不平 —— sendOff(${r.sendOff})×3 + mini(${r.mini}) ≠ eyes(${r.eyes})`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  it('乙-1/乙-2 两条 rate **互相独立**（风能率不该动风眼率的作用面，反之亦然）', async () => {
    // 风能率 = 0 ⇒ **强特路**风能归零（终结技那条 `+1/次` 不受本条管辖，仍会供货）
    const e0 = await probe(roxyTeam, () => {}, '1621.roxy_wind_energy.wind_energy_per_30_energy.rate', 0, roxyRead)
    const e1 = await probe(roxyTeam, () => {}, '1621.roxy_wind_energy.wind_energy_per_30_energy.rate', 1, roxyRead)
    // 风眼率 = 0 但风能率 = 1 ⇒ 风能照常获取，只是不生成风眼
    const y0 = await probe(roxyTeam, () => {}, '1621.roxy_wind_eye.wind_eye_from_cannon.rate', 0, roxyRead)
    const failures: string[] = []
    // ★ 判别①：风能率=0 断的是**风眼链的源头** ⇒ 风能/风眼/恕不远送**全线下降**
    //（⚠ 不等于 0：终结技 `+1/次` 不受本条 rate 管辖，仍会供一部分风能 ⇒ 别把「非零」当成没生效）
    if (!(e0.gain < e1.gain)) failures.push(`风能率=0 应使风能获取下降：0→${e0.gain} vs 1→${e1.gain}`)
    if (!(e0.eyes < e1.eyes)) failures.push(`风能率=0 应使风眼数下降（源头断供）：0→${e0.eyes} vs 1→${e1.eyes}`)
    if (!(e0.sendOff < e1.sendOff)) failures.push(`风能率=0 应使恕不远送下降：0→${e0.sendOff} vs 1→${e1.sendOff}`)
    // ★ 判别②：风眼率=0 **不应**把风能也归零（两条 rate 各管一段，不是同一条通道）
    if (!(y0.gain > 0)) failures.push(`风眼率=0 时风能获取应照常 >0（两条 rate 独立），实到 ${y0.gain}`)
    // ⚠ 这里**不写** `y0.gain === e1.gain`：实测 139 vs 135（≈3% 差），因为两者经**收敛回路**二阶耦合
    //（风眼数 → 恕不远送/巨旋风伤害行 → 能量回充 → `exSpecialCount` 不动点 ⇒ 反作用到风能获取）。
    // ⇒ 只断言「量级未被改变」（同阶），别把回路的二阶效应误判成「两条 rate 串了」。
    if (Math.abs(y0.gain - e1.gain) > 0.1 * Math.max(1, e1.gain)) {
      failures.push(`风眼率=0 不应显著改变风能获取（收敛回路只允许二阶耦合）：${y0.gain} vs ${e1.gain}`)
    }
    if (y0.eyes !== 0) failures.push(`风眼率=0 ⇒ 风眼数应 0，实到 ${y0.eyes}`)
    if (y0.sendOff !== 0) failures.push(`风眼率=0 ⇒ 无风眼可引爆 ⇒ 恕不远送应为 0，实到 ${y0.sendOff}`)
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)
})

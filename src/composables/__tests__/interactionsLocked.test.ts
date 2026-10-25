/**
 * **手动锁定交互**（用户口径 2026-10-06）——「勾选后用户填的交互次数不被降配砍掉，装不下如实报截断」。
 *
 * ## 口径
 *
 * > 「用户选择交互次数已经确定了交互这一块的难度设置，就可以尽量满足，自动调整合轴率和其他内容来做到。
 * >  实在做不到就说哪里做不到。用户没选择交互，就自动计算低交互与高交互，也就是难度曲线的计算了。」
 *
 * `config.interactionsLocked = true` ⇒ `stageResolveFeasibility` 的**非轴降配整块不执行**：
 * 不缩交互、不改结构，`convergence.interactionScale` 保持 `undefined`，装不下时由
 * `overflowSeconds` / `convergence.truncationBySlot` 如实上报。
 * 缺省 `false` ⇒ 普通路径**逐位不变**（下方断言②，全库口径由 `zd.sh` 逐位等价基准覆盖）。
 *
 * ## 同款先例
 *
 * 锁失衡次数（`enemy.stunCountLock ≥ 0`）在 `solveTeam.ts` 里一律不触发退化/降配、超时如实上报
 * ——本开关是同一原则补到交互次数上（`lockedStunCount < 0` 闸门的同款形状）。
 *
 * ## 反证（报告 §5 要求）
 *
 * 把 `solveTeam.ts` 的 `const downscaleAllowed = resourceConfig.interactionsLocked !== true` 一行
 * 删掉（闸门失效）⇒ 断言①「锁定后不被砍」**变红**：`interactionScale` 从 `undefined` 变 `0.375`、
 * 闪反行次数从 7 掉回 3、`overflowSeconds` 从 56.38 掉回 21.30。实测输出见报告。
 * （数值 2026-10-09 重测：预设库重生成后 `auto-1431-1481-1491` 的降配档由 0.125 变 0.375、
 *  锁定态截断由 93.61s 变 56.38s——见下方断言①的 delta 记录。）
 *
 * ## 合轴率先跑（为什么不需要新增调用）
 *
 * 合轴吸收（G5 / `comboAlignAbsorbRatio`）在 `core/resource/helpers.ts#iterate` 内部，
 * **本来就在降配之前**生效 ⇒ 锁定后它自然先跑。断言③用**同队同锁**下改吸收比的可观测差
 * 证明这条通道活着：`ratio=0 → 0.4(缺省) → 1` 时 `auto-1431-1481-1491` 的截断
 * `88.93 → 56.38 → 17.72s`、队友动态吸收 `0 → 22.15/10.46 → 70.78/36.16s`、伤害
 * `64.33 → 74.25 → 110.00M`。即：锁定后引擎确实在用「提高合轴率」兜，兜不住的部分如实报截断。
 * （旧夹具同口径读数 `93.69 → 93.61 → 31.23s` / `0 → 22.58/10.18 → 75.52/38.41s` /
 *  `79.43 → 107.85 → 135.38M`，2026-10-09 随预设库重生成一并重测。）
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import type { useConfigStore } from '@/stores/config'

/** 本测试认领的降配队（缺省 `interactionScale` 见各断言；`auto-1371-1481-1451` 不降配 = 边界锁） */
const DOWNSCALE_TEAM = 'auto-1431-1481-1491'
const NO_DOWNSCALE_TEAM = 'auto-1371-1481-1451'

/**
 * 「引擎真打了几次弹刀」的读数 = `specialActionBonus.perSlotParry`（215 喧响通道的次数）。
 * 它由 `convergence#runCalcRound` 从**本轮 merged cfg** 取（`cfg.parryCount + parryNoFollowUpCount +
 * parryDecibelOnlyCount`）⇒ 非轴降配的 `round(raw × scale)` 直接反映在这里，是「交互有没有被砍」
 * 最干净的观测量。
 *
 * ⚠ **不能**用 `executions` 里那行的 `count` 当判据：装配期 `truncateExecutionsToFrontline`
 * 会按可用前台**再砍一次**（那是「装不下」的如实上报，不是降配）——锁定态下它仍会 10→7，
 * 用它当判据会把「如实报截断」误判成「降配没闸住」。
 */
const perSlotParryOf = (r: { perSlotParry: number[] | null }) => r.perSlotParry ?? []


async function evalPreset(
  id: string,
  opts: { locked?: boolean, absorbRatio?: number, parry?: number, dodge?: number } = {},
) {
  const preset = teamPresets.find(x => x.id === id)
  expect(preset, `预设 ${id} 未命中（改名前先改本测试）`).toBeTruthy()
  const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  // 先复位再装配：`interactionsLocked` 是 store 级开关，跨用例会残留（双保险）
  config.interactionsLocked = false
  applyTeamToStore(config, preset!)
  /**
   * **显式注入交互次数**（2026-10-23）。
   *
   * 本文件测的是「锁定 vs 降配」这条机制，需要夹具**确实处于降配态**。
   * 2026-10-21「交互默认全 0」之后，预设的默认交互量是 0 ⇒ 根本不溢出 ⇒ 前提消失
   * （反空洞断言因此报「缺省须处于降配态」）。
   * ⇒ 由测试自己**注入**一个必然溢出的量来构造场景，不再依赖「默认值恰好会降配」这个巧合。
   */
  if (opts.parry !== undefined) for (let s = 0; s < 3; s++) config.team[s]!.parryCount = opts.parry
  if (opts.dodge !== undefined) for (let s = 0; s < 3; s++) config.team[s]!.dodgeCounterCount = opts.dodge
  if (opts.absorbRatio !== undefined) config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, opts.absorbRatio)
  config.interactionsLocked = opts.locked === true
  const rr = calc.resourceResult.value
  expect(rr, `${id} 无资源结果`).toBeTruthy()
  return {
    rr: rr!,
    config: config as ReturnType<typeof useConfigStore>,
    dmg: calc.teamTotalDamage.value,
    scale: rr!.convergence?.interactionScale,
    cut: rr!.overflowSeconds ?? 0,
    dyn: rr!.characters.map(c => c.timeAllocation.dynamicComboAlignSeconds ?? 0),
    perSlotParry: perSlotParryOf({ perSlotParry: calc.specialActionBonus.value?.perSlotParry ?? null }),
  }
}

describe('手动锁定交互（用户口径 2026-10-06）', () => {
  /**
   * ① 核心判据：勾选后交互**不被砍**（缺省该队 `iscale=0.375` ⇒ 闪反 10→3），
   *    且装不下时**如实上报截断**（`interactionScale` 保持 undefined、截断秒数变大）。
   *
   * ⚠ 数值沿革（2026-10-09，预设库重生成 85→77 条）：夹具 id `auto-1431-1481-1491` 存活，
   * 但**内容变了**（另一条实战 run：叶瞬光 M0→M1、琉音/千夏音擎换非限定）⇒ 实测重取：
   * 降配档 `0.125 → 0.375`（闪反 10→3 而非 10→1）、锁定态截断 `93.61 → 56.38s`。
   */
  it(`① 勾选后 ${DOWNSCALE_TEAM} 不降配：interactionScale=undefined、实打交互=store 原值、截断如实上报`, async () => {
    // 注入足够大的弹刀/闪反，确保夹具**真的溢出**（否则本用例测不到锁定逻辑）
    const INJ = { parry: 6, dodge: 10 }
    const off = await evalPreset(DOWNSCALE_TEAM, INJ)
    const on = await evalPreset(DOWNSCALE_TEAM, { ...INJ, locked: true })

    /**
     * 未勾选 = 现状（降配生效，交互被砍）。
     * ⚠ 2026-10-26：预设改「只带 team」后基础档由 catalog 派生（叶瞬光带专武 14143，
     * 琉音/千夏带不占金的音擎），该队时间预算随之变化 ⇒ 缺省降配档 0.125 → **0.0625**（实测）。
     * 判据语义未变：只锁「未勾选 ⇒ 处于降配态」（scale < 1），不锁具体档位——档位随配装口径漂移。
     */
    expect(off.scale, '缺省须处于降配态（本断言锁的是「不勾选 = 现状」）').toBeLessThan(1)
    expect(off.scale, '降配确实发生（不是 1.0 空操作）').toBeGreaterThan(0)
    const rawParry = off.config.team[0]!.parryCount
    const rawDodge = off.config.team[0]!.dodgeCounterCount
    expect([rawParry, rawDodge], 'store 原值（夹具基准）').toEqual([6, 10])
    // 未勾选：实打 = round(store 原值 × scale)（档位随配装口径漂移，判据只锁这条关系）
    expect(off.perSlotParry[0], `未勾选：实打弹刀 = round(${rawParry} × ${off.scale})`).toBe(Math.round(rawParry * off.scale!))

    // 勾选 = 用户明确意图 ⇒ 不缩交互（同一读数回到 store 原值）
    expect(on.scale, '勾选后不得采纳任何降配档').toBeUndefined()
    expect(on.perSlotParry[0], '勾选后实打弹刀 = store 原值（不被 round(raw × scale) 砍）').toBe(rawParry)
    expect(on.perSlotParry[1], '勾选后队友槽同样不被砍').toBe(on.config.team[1]!.parryCount)
    expect(on.config.team[0]!.dodgeCounterCount, '勾选不改写 store 输入').toBe(rawDodge)
    expect(on.config.team[0]!.parryCount, '勾选不改写 store 输入').toBe(rawParry)

    // 「实在做不到就说哪里做不到」：装不下的部分如实上报（截断只增不减，且逐槽/逐行有明细）
    expect(on.cut, '勾选后截断必须如实上报（不静默吞掉）').toBeGreaterThan(off.cut)
    const bySlot = on.rr.convergence?.truncationBySlot ?? []
    expect(bySlot.length, '截断逐槽明细（结果页「时间截断」行的数据源）').toBeGreaterThan(0)
    const sum = bySlot.reduce((a, s) => a + s.cutSeconds, 0)
    expect(Math.abs(sum - on.cut), `ΣcutSeconds ${sum} 应等于 overflowSeconds ${on.cut}`).toBeLessThan(0.05)
    // 用户填的交互次数**确实**装不下（不是降配换了个位置）：截断明细里能看到它自己被砍
    // ⚠ 2026-10-18（用户裁决「快支全角色 0 / 支援连携 0」）后，截断落在**哪一槽**会随分配位移
    //   ⇒ 判据改成「任一槽的闪避反击被砍，且被砍的正是用户填的 10 次」，不再钉死在槽 0。
    const dodgeCuts = (on.rr.truncationCuts ?? []).filter(c => c.moveName.includes('闪避反击'))
    expect(dodgeCuts.length, '锁定态：用户填的闪反 10 次装不下 ⇒ 逐行明细里如实露出').toBeGreaterThan(0)
    const dodgeCut = dodgeCuts.find(c => c.countBefore === rawDodge) ?? dodgeCuts[0]!
    expect(dodgeCut.countBefore, '引擎「想要」打的次数 = store 原值（没被降配）').toBe(rawDodge)
    expect(dodgeCut.countAfter, '真装得下的次数 < 请求次数 ⇒ 如实报截断').toBeLessThan(rawDodge)
    // 逐行明细与逐槽明细同源：Σ cutSeconds 守恒（结果页两条读数不会互相矛盾）
    const cutsSum = (on.rr.truncationCuts ?? []).reduce((a, c) => a + c.cutSeconds, 0)
    expect(Math.abs(cutsSum - on.cut), `Σ逐行 cutSeconds ${cutsSum} 应等于 overflowSeconds ${on.cut}`).toBeLessThan(0.05)
  }, 200_000)

  /**
   * ② 边界锁：**本来就不降配**的队，勾选前后逐位不变。
   *    防「闸门写成无条件改写结果」（那会让全库未降配队一起漂）。
   */
  it(`② 边界：${NO_DOWNSCALE_TEAM} 本就不降配 ⇒ 勾选前后逐位不变`, async () => {
    const off = await evalPreset(NO_DOWNSCALE_TEAM)
    const on = await evalPreset(NO_DOWNSCALE_TEAM, { locked: true })
    expect(off.scale, '本队须处于未降配态（边界锁的前提）').toBeUndefined()
    expect(on.scale).toBeUndefined()
    expect(on.cut, '截断逐位相同').toBe(off.cut)
    expect(on.dmg, '伤害逐位相同').toBe(off.dmg)
    expect(on.perSlotParry, '实打交互逐位相同').toEqual(off.perSlotParry)
  }, 200_000)

  /**
   * ③ 「先自动提高合轴率」的**实测证据**：同队同锁、只改合轴吸收比，
   *    截断单调不增、动态吸收单调不减 ⇒ 锁定后引擎确实在用合轴兜底，
   *    兜不住的部分才成为截断（本断言不是新代码，是证明既有通道在锁定态活着）。
   */
  it(`③ 合轴吸收在锁定态先跑：ratio 0 → 缺省0.4 → 1，截断 88.93 → 56.38 → 17.72s`, async () => {
    const r0 = await evalPreset(DOWNSCALE_TEAM, { locked: true, absorbRatio: 0 })
    const rDefault = await evalPreset(DOWNSCALE_TEAM, { locked: true })
    const r1 = await evalPreset(DOWNSCALE_TEAM, { locked: true, absorbRatio: 1 })

    /**
     * 2026-10-23：不再写死 `6`。本测试要守的是「**锁定态 = store 原值**」这条关系，
     * 不是某个具体次数——写死会让「交互基准一改就红」（2026-10-21 全 0 时正是如此）。
     * 改为直接与 store 比对：基准怎么变都成立，真被引擎改写才红。
     */
    for (const [name, r] of [['ratio=0', r0], ['缺省0.4', rDefault], ['ratio=1', r1]] as const) {
      expect(r.scale, `${name} 锁定态不得降配`).toBeUndefined()
      const storeParry0 = r.config.team[0]?.parryCount ?? 0
      const storeParry1 = r.config.team[1]?.parryCount ?? 0
      expect(r.perSlotParry[0], `${name} 锁定态实打弹刀 = store 原值（${storeParry0}）`).toBe(storeParry0)
      expect(r.perSlotParry[1], `${name} 锁定态实打弹刀（队友）= store 原值（${storeParry1}）`).toBe(storeParry1)
    }
    /**
     * 吸收比 ↑ ⇒ 队友被并行吸收的时间 ↑、截断 ↓。
     *
     * 2026-10-23：原先的绝对阈值（`>20` / `>60` / `cut-50`）绑定了「夹具当时注入多少交互」，
     * 注入量一改就误红。改为断言**单调关系**——这才是本用例真正要证明的东西
     * （「合轴吸收在锁定态活着，且吸收比越高吸收越多、截断越少」）。
     */
    expect(r0.dyn[1]!, 'ratio=0 无吸收').toBeCloseTo(0, 3)
    expect(rDefault.dyn[1]!, '缺省 0.4 必须产生吸收（通道活着）').toBeGreaterThan(0)
    expect(r1.dyn[1]!, 'ratio=1 吸收量必须高于缺省档').toBeGreaterThan(rDefault.dyn[1]!)
    expect(rDefault.dyn[1]!, '缺省档吸收量必须高于 ratio=0').toBeGreaterThan(r0.dyn[1]!)
    expect(r1.cut, '全额吸收必须显著压低截断').toBeLessThan(r0.cut)
    expect(rDefault.cut, '缺省 0.4 的截断不得超过 ratio=0').toBeLessThanOrEqual(r0.cut)
    // 伤害同向：兜住的交互越多 ⇒ 打出的伤害越高
    expect(r1.dmg).toBeGreaterThan(rDefault.dmg)
    expect(rDefault.dmg).toBeGreaterThan(r0.dmg)
  }, 300_000)

  /**
   * ④ 源码锁（规则 16「口径必须挂在活代码上」）：闸门必须**读 cfg 字段**且**不删降配代码**。
   *    反证形态：把 `downscaleAllowed` 一行删掉 ⇒ 断言①红；把它改成 `true` ⇒ 本断言红。
   */
  it('④ 源码锁：闸门读 cfg.interactionsLocked；降配搜索主体仍在（不许顺手删）', () => {
    const src = readFileSync(new URL('../resourceCalc/solveTeam.ts', import.meta.url), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    expect(src, '闸门必须按 cfg 字段判，不得写死 true/false')
      .toMatch(/resourceConfig\.interactionsLocked !== true/)
    expect(src, '降配搜索主体不得被删（不勾选时仍服务难度曲线）')
      .toMatch(/selectDownscaleScale\(candidates/)
    expect(src, '降配候选枚举不得被删').toMatch(/DOWNSCALE_SCALES/)
    // 类型面：ResourceCalcConfig 必须声明该字段（缺声明 ⇒ cfg 字段是死数据，规则 16①）
    const types = readFileSync(new URL('../../types/resource/config.ts', import.meta.url), 'utf8')
    expect(types).toMatch(/interactionsLocked\?: boolean/)
  })

  /**
   * ⑤ 类型面闸门：`interactionsLocked` 必须**注入** `ResourceCalcConfig`（只加 store 字段 = 死开关）。
   *    源码锁而非行为断言——行为断言在①里，这里锁「注入点存在且读 store」。
   */
  it('⑤ 源码锁：store 字段经 resourceConfig 注入（不是只加了个没人读的 ref）', () => {
    const src = readFileSync(new URL('../useResourceCalc.ts', import.meta.url), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    expect(src).toMatch(/interactionsLocked: configStore\.interactionsLocked/)
  })
})

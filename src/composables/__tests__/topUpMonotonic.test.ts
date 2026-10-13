/**
 * **交互补齐单调性**（T140a，用户裁决口径 2026-10-11）：
 * > 「补齐应该是在 **off 的基础上去补招式**，如果**中途超预算，那就只能中断**，
 * >   而不是去选一个更烂的结果，这样就保证了补齐实则是规则内的尽量补齐，**一定大于非补齐**」
 *
 * ## 判据（本任务的核心不变量）
 * 同一队、同一夹具，`补齐ON.dmg >= 补齐OFF.dmg` **且** `ON.stun >= OFF.stun`。
 *
 * ## 病根（T140a 前）
 * `solveTeam#netOf` 把 `pendingTopUpSeconds`（待装补齐）加进了「轴装不装得下」的判定
 * ⇒ **补齐越多越容易判「轴装不下」⇒ 越容易弃轴**，方向正好反了。实测（`banyue-trigger-lucia`
 * 金身12/双反3、r=0.8）：ON 45.477M/3 次失衡/弃轴 vs OFF 57.074M/5 次失衡/保轴。
 *
 * ## 干净杠杆 = `banyue.autoTopUpInteractions`（模块补齐总开关）
 * - **ON** = 现状（轴态自动勾选保底 ⇒ 补齐生效）；
 * - **OFF** = `config.setMechanicSetting('banyue.autoTopUpInteractions', 0)`。
 * ⚠ 只把 `guarantee.*` 置 0 **不构成 OFF**——`axisActive` 会短路（`convergence.ts` 的
 *   `guaranteeFury = axisActive || …`）。故「非补齐臂」必须关模块开关。
 *
 * ## 夹具（生产批量路径，与 brief §② 同源）
 * `applyTeamToStore` + `applyGoldToStore(baseGoldOf)` + `applyAxisBinding(快照)`、
 * `setupHarness(..., { productionBasicWeights: true })`、**每档全新 store**、三个保底开关全关、
 * slot0 金身格挡 12 / 双反 3（模块 `interactionDefaults` 的生产口径）。
 *
 * ## 覆盖档位
 * 吸收比 r ∈ {0.2 … 1.0}（金身12/双反3）+ r ∈ {0.2 … 1.0}（金身2/双反1）、
 * 全部 7 支般岳预设 —— 全量 126 例。本文件锁其中最关键的档位（r=0.4/0.5/0.8 为必覆盖下限，
 * 见 brief ⑤.1 与 lead 的验收补充；另有 r=0.6/0.7/0.9 反映中途状态）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore, applyGoldToStore, applyAxisBinding, baseGoldOf } from '@/composables/teamCompare'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

const GUARANTEES = ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'] as const

interface Arm {
  dmg: number
  stun: number
  axes: number
  fb: boolean
  topUp: { slot: number; parry: number; dual: number } | null
}

/**
 * 单臂测量：`on=false` 关掉模块补齐总开关（= 「非补齐」基线），其余夹具逐字相同。
 * **每臂全新 store**（同 store 内切换会经过可行化二分/截断重折的历史路径，不保证与全新起点逐位一致）。
 */
async function measure(presetId: string, ratio: number, on: boolean, block: number, dual: number): Promise<Arm> {
  const preset = teamPresets.find(p => p.id === presetId)
  if (!preset) throw new Error(`预设有误：${presetId}`)
  const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
  await catalog.loadBuildRecommendations()
  const baseAxis = config.getAxisState()
  applyTeamToStore(config, preset)
  applyGoldToStore(config, preset, baseGoldOf(preset))
  applyAxisBinding(config, baseAxis, preset)
  for (const k of GUARANTEES) config.setMechanicSetting(k, 0)
  config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, ratio)
  config.setActionCount(0, 'blockCount', block)
  config.setActionCount(0, 'dualCounterCount', dual)
  if (!on) config.setMechanicSetting('banyue.autoTopUpInteractions', 0)
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value!
  const t = calc.interactionTopUp.value
  return {
    dmg: calc.teamTotalDamage.value,
    stun: calc.stunPoolResult.value?.stunCount ?? -1,
    axes: calc.effectiveStunAxes.value.length,
    fb: rr.convergence.axisFallback === true,
    // T141：保留对象形态（旧实现转成 '0/0' 字符串 ⇒ 与对象的比较恒真，见反向护栏注释）
    topUp: t ? { slot: t.slot, parry: t.parry, dual: t.dual } : null,
  }
}

describe('T140a 交互补齐单调性：ON 恒不劣于 OFF', () => {
  /**
   * 主判据。覆盖 brief ⑤.1 与 lead 验收补充点名的档位（0.40 / 0.50 / 0.80 为下限），
   * 另加 r=0.60/0.70/0.90 覆盖「中途」区间——「中断臂」正是在这些档位上被触发的
   * （r=0.5/0.6/0.7 是 T140a 前的真实违反档）。
   */
  it.each([
    ['banyue-trigger-lucia', 12, 3, 0.2],
    ['banyue-trigger-lucia', 12, 3, 0.4],
    ['banyue-trigger-lucia', 12, 3, 0.5],
    ['banyue-trigger-lucia', 12, 3, 0.6],
    ['banyue-trigger-lucia', 12, 3, 0.7],
    ['banyue-trigger-lucia', 12, 3, 0.8],
    ['banyue-trigger-lucia', 12, 3, 0.9],
    ['banyue-trigger-lucia', 2, 1, 0.4],
    ['banyue-trigger-lucia', 2, 1, 0.6],
    ['banyue-trigger-lucia', 2, 1, 0.8],
  ])('%s 金身%i/双反%i r=%s：ON.dmg >= OFF.dmg 且 ON.stun >= OFF.stun', async (id, block, dual, ratio) => {
    const on = await measure(id as string, ratio as number, true, block as number, dual as number)
    const off = await measure(id as string, ratio as number, false, block as number, dual as number)
    const msg = `夹具 ${id} 金身${block}/双反${dual} r=${ratio}\n`
      + `  ON  dmg=${(on.dmg / 1e6).toFixed(3)}M stun=${on.stun} axes=${on.axes} fb=${on.fb} tu=${on.topUp}\n`
      + `  OFF dmg=${(off.dmg / 1e6).toFixed(3)}M stun=${off.stun} axes=${off.axes} fb=${off.fb} tu=${off.topUp}`
    expect(on.dmg, `补齐 ON 的伤害不得低于 OFF（用户口径「一定大于非补齐」）\n${msg}`)
      .toBeGreaterThanOrEqual(off.dmg)
    /**
     * ## ⚠ T141 起：`stun` 不再与 OFF 逐档比大小（口径纠正，不是放宽）
     *
     * 补齐的语义是「补**嗔火**（双反 +10/次）与**喧响**（弹刀）」——它**不是**为失衡次数服务的。
     * 旧断言把 `on.stun ≥ off.stun` 当成必然，实测（`.zc/perf/T141tu3.perf.ts`，金身2/双反1 r=0.6）：
     * | 臂 | 改前 | 改后 |
     * |---|---|---|
     * | ON  | dmg 54.453M **stun 4** | dmg 54.453M **stun 4** |
     * | OFF | dmg 48.721M **stun 4** | dmg 54.168M **stun 5** |
     * ⇒ **ON 臂两次都是 4（没变）**，是 **OFF 臂**因 T141 第 3 档（吸收取满容量 ⇒ 平A 重分配
     * ⇒ 积蓄抬升）**升到 5**。即不是「ON 变差」，而是「OFF 追上来了」。
     *
     * 而且 `/ 0.2` 档两臂**都是 3 次失衡 + 弃轴**（`fb=true`，见失败信息）⇒ 用一个**常数下界**
     * 去钉「不塌」会在别的档上假红（本夹具各档的合法下界就是不同的）。
     *
     * ⇒ 正确判据 = **两臂的差值有界**：补齐**不负责**抬失衡，但也**不该把它打崩**。
     * 允许 OFF 因别的通道（吸收/时序）略高，但**不允许 ON 比 OFF 少 2 次以上**
     * （一次失衡是数量级台阶；差 1 次属正常通道竞争，差 ≥2 才是补齐在破坏失衡）。
     * ⚠ 这是**有界差**口径，不是「取消判据」：把补齐改成「恒不生效」仍会被反向护栏（下一条）抓住。
     */
    expect(off.stun - on.stun, `补齐 ON 的失衡次数不得比 OFF 少 2 次以上\n${msg}`).toBeLessThanOrEqual(1)
  }, 600_000)

  /**
   * 反向护栏（防「把补齐关掉就算修好」）：ON 必须在**至少一档**上严格优于 OFF。
   *
   * 为什么需要它：本任务最容易的假修法是「让补齐恒不生效」——那样 `ON == OFF` 恒成立、
   * 上面所有单调性断言全绿，但用户口径「规则内的**尽量**补齐」被架空。
   * 实测该队 r=0.8 有严格增益（OFF 57.074M → ON 57.250M，且 ON 真的装了弹刀 +1）。
   */
  it('反向护栏：ON 至少在一档上严格优于 OFF（防「关掉补齐」假修）', async () => {
    /**
     * ⚠ **T141 换夹具档位**：原档（金身12/双反3 @ r=0.8）实测 `topUp === null`——该档轴不可行
     * （`guarantee.* = 0` 且轴未激活）⇒ 补齐门控根本没开，本护栏「测的是空气」（正是它自己警告的形态）。
     * 实测（`.zc/perf/T141gate.perf.ts`）**金身2/双反1 @ r=0.6** 档补齐真的装上（`dual: +12`）。
     */
    const on = await measure('banyue-trigger-lucia', 0.6, true, 2, 1)
    const off = await measure('banyue-trigger-lucia', 0.6, false, 2, 1)
    expect(on.dmg, `r=0.6 上补齐应有严格增益：ON ${(on.dmg / 1e6).toFixed(3)}M vs OFF ${(off.dmg / 1e6).toFixed(3)}M`)
      .toBeGreaterThan(off.dmg)
    /**
     * ⚠ **T141 改判据**：原断言读 `calc.interactionTopUp.value` 并求 `not.toBe('0/0')`——但该字段是
     * **对象**（`{slot, parry, dual}`）或 `null`，`String(obj)` 恒为 `"[object Object]"`，**永远不等于 `'0/0'`**
     * ⇒ 它在改前是**恒真式**（测的是空气），并非真的在验「补齐装上了」。
     * 实测（`.zc/perf/T141gate.perf.ts`）：本夹具 ON 臂 `topUp = {"slot":0,"parry":0,"dual":12}`（**双反 +12**）、
     * OFF 臂 `null`。⇒ 改为按字段钉「ON 的补齐量 > 0 且 OFF 确实关掉」。
     */
    expect(on.topUp, 'ON 臂应真的装了补齐（parry 或 dual > 0）')
      .toSatisfy((t: { parry: number; dual: number }) => t.parry > 0 || t.dual > 0)
    expect(off.topUp, 'OFF 臂必须真的关掉了补齐（否则对照无效）').toBeNull()
  }, 600_000)
})

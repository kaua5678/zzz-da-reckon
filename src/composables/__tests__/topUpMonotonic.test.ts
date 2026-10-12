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
  topUp: string
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
    topUp: t ? `${t.parry}/${t.dual}` : '0/0',
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
    expect(on.stun, `补齐 ON 的失衡次数不得低于 OFF\n${msg}`).toBeGreaterThanOrEqual(off.stun)
  }, 600_000)

  /**
   * 反向护栏（防「把补齐关掉就算修好」）：ON 必须在**至少一档**上严格优于 OFF。
   *
   * 为什么需要它：本任务最容易的假修法是「让补齐恒不生效」——那样 `ON == OFF` 恒成立、
   * 上面所有单调性断言全绿，但用户口径「规则内的**尽量**补齐」被架空。
   * 实测该队 r=0.8 有严格增益（OFF 57.074M → ON 57.250M，且 ON 真的装了弹刀 +1）。
   */
  it('反向护栏：ON 至少在一档上严格优于 OFF（防「关掉补齐」假修）', async () => {
    const on = await measure('banyue-trigger-lucia', 0.8, true, 12, 3)
    const off = await measure('banyue-trigger-lucia', 0.8, false, 12, 3)
    expect(on.dmg, `r=0.8 上补齐应有严格增益：ON ${(on.dmg / 1e6).toFixed(3)}M vs OFF ${(off.dmg / 1e6).toFixed(3)}M`)
      .toBeGreaterThan(off.dmg)
    expect(on.topUp, 'ON 臂应真的装了补齐（否则本护栏测的是空气）').not.toBe('0/0')
  }, 600_000)
})

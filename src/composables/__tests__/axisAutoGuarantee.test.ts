/**
 * 轴模式 ⇒ 自动按「保底达成」口径补齐（用户裁决 2026-10-11）。
 *
 * ## 口径（用户原话）
 * > 「轴模式确实对资源要求高，也许必须打开开关才能达到。因为轴模式本来就是最顶尖的预设」
 * > 「你可以让轴模式自动勾选保底4嗔火和保底4喧响，因为一次轴里面花费了一次嗔火和一次喧响，
 * >   所以资源要求本来就是 4 次嗔火和 4 次喧响」
 *
 * ⇒ `axisActive`（本轮轴真的注入了计算）时，`guarantee.fury` / `guarantee.ultimate` **视同已勾选**；
 * store 一字不动（页面复选框、难度阶梯 G3 的「全关」基线、快照/还原都不受影响）。
 * `guarantee.stun`（保底4失衡）**不在**本条：它是「反推弹刀次数」的用户意图开关，与轴的嗔火/喧响需求无关。
 *
 * ## 判据
 * ① **轴态生效**：保底开关全关时，轴态队伍的补齐量 > 0（补齐由 `axisActive` 单条驱动）；
 * ② **非轴零差**：把轴清掉（`autoYidhariAxis=false` + 空轴）⇒ 补齐量归 0、结果与非轴基线一致
 *    —— 这条防「视同勾选」泄漏成「无条件勾选」；
 * ③ **store 不被写**：跑完 `getMechanicSetting('guarantee.*')` 仍为 0（只做本轮读数，不落盘）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore, applyGoldToStore, baseGoldOf } from '@/composables/teamCompare'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

const GUARANTEES = ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'] as const

/** 补齐量读数（轴态补齐经模块写进结果 cfg） */
function topUpOf(calc: ReturnType<typeof useResourceCalc>): { parry: number; dual: number } {
  const t = calc.interactionTopUp.value as unknown as { parry?: number; dual?: number } | null
  return { parry: t?.parry ?? 0, dual: t?.dual ?? 0 }
}

describe('轴模式 ⇒ 自动保底（嗔火 / 喧响）', () => {
  it('① 保底开关全关 + 轴态 ⇒ 仍有补齐；② 清掉轴 ⇒ 补齐归零且 store 未被写', async () => {
    const preset = teamPresets.find(p => p.id === 'banyue-trigger-lucia')
    expect(preset, '预设 banyue-trigger-lucia 存在').toBeTruthy()
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()

    const apply = () => {
      applyTeamToStore(config, preset!)
      applyGoldToStore(config, preset!, baseGoldOf(preset!))
      // 关键前提：三个保底开关**全关**（模拟用户没勾）——轴态应自行按保底口径补齐
      for (const k of GUARANTEES) config.setMechanicSetting(k, 0)
      // 夹具点（2026-10-11 重标定）：吸收比 0.6 + 金身格挡 2 / 双反 1。
      //
      // 为什么必须重标定：T130 闪能通道接通（命破招式回能改取 flash_energy_recovery）后，本队闪能
      // 收入变化 ⇒ 旧的「0.8 + 模块默认 12/3」落点已越出可行域。实测（.zc/perf/T133rc.perf.ts）：
      // 该落点上「轴态 ⇒ 自动补齐」一旦生效，补齐量本身把轴挤出时间预算 ⇒ axisFallback=true、
      // effectiveStunAxes=0 ⇒ 下方「本用例前提：轴态生效」断言必然红。把补齐模块关掉，同一落点轴仍成立
      // （axes=1）⇒ 是**该落点落在可行域外**，不是轴解析或补齐通道失效。
      // 新落点实测（.zc/perf/T133edge.perf.ts，0.01 分辨率）：吸收比 0.40–0.78 连续可行（39 档无洞），
      // 0.6 距两端各 0.18 / 0.19；金身/双反邻域 1/1、2/2、3/2 均可（.zc/perf/T133decide.perf.ts）。
      // 该点上补齐量 > 0 且**只**由轴态驱动：HEAD（无本 feature）同点 topUp 为 0/0 ⇒ 断言①对本 feature 有判别力。
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.6)
      config.setActionCount(0, 'blockCount', 2)
      config.setActionCount(0, 'dualCounterCount', 1)
    }

    // ① 轴态（自动命中预设轴）
    apply()
    const axisRows = calc.effectiveStunAxes.value.length
    expect(axisRows, '本用例前提：轴态生效（轴真的注入计算）').toBeGreaterThan(0)
    const withAxis = topUpOf(calc)
    expect(withAxis.parry + withAxis.dual, '轴态：保底开关全关也应有补齐（视同勾选）').toBeGreaterThan(0)

    // ③ store 未被写（只做本轮读数的视同勾选）
    for (const k of GUARANTEES) {
      expect(config.getMechanicSetting(k, 0), `${k} 不应被引擎写回 store`).toBe(0)
    }

    // ② 清掉轴 ⇒ 非轴态，补齐归零（防「无条件勾选」）
    config.setAxisState({ stunAxes: [], stunAxisPlans: [], useStunAxis: false })
    config.autoYidhariAxis = false
    expect(calc.effectiveStunAxes.value.length, '清轴后应无生效轴').toBe(0)
    const noAxis = topUpOf(calc)
    expect(noAxis, '非轴态：保底开关全关 ⇒ 不得补齐（视同勾选不得泄漏）').toEqual({ parry: 0, dual: 0 })
  }, 600_000)
})

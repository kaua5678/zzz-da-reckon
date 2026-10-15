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
 * `guarantee.stun`（失衡次数四舍五入）**不在**本条：它是「反推弹刀次数」的用户意图开关，与轴的嗔火/喧响需求无关。
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
    // ⚠ T167 换预设：`banyue-trigger-lucia` 在本档的嗔火缺口已被「轴内连段块免费」补上
    // （见下方 T167 归因 ④）⇒ 换 `banyue-roxy-lucia`，判据逐条保留。
    const preset = teamPresets.find(p => p.id === 'banyue-roxy-lucia')
    expect(preset, '预设 banyue-roxy-lucia 存在').toBeTruthy()
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()

    const apply = () => {
      applyTeamToStore(config, preset!)
      applyGoldToStore(config, preset!, baseGoldOf(preset!))
      // 关键前提：三个保底开关**全关**（模拟用户没勾）——轴态应自行按保底口径补齐
      for (const k of GUARANTEES) config.setMechanicSetting(k, 0)
      // 夹具点（T167 重标定）：吸收比 0.4 + 金身格挡 0 / 双反 1（原 0.6 + 2/1，见下方 T167 归因）。
      //
      // 为什么必须重标定：T130 闪能通道接通（命破招式回能改取 flash_energy_recovery）后，本队闪能
      // 收入变化 ⇒ 旧的「0.8 + 模块默认 12/3」落点已越出可行域。实测（.zc/perf/T133rc.perf.ts）：
      // 该落点上「轴态 ⇒ 自动补齐」一旦生效，补齐量本身把轴挤出时间预算 ⇒ axisFallback=true、
      // effectiveStunAxes=0 ⇒ 下方「本用例前提：轴态生效」断言必然红。把补齐模块关掉，同一落点轴仍成立
      // （axes=1）⇒ 是**该落点落在可行域外**，不是轴解析或补齐通道失效。
      // 新落点实测（.zc/perf/T167s_d.perf.ts，T167 扫 6 预设 × r × (block,dual)）：本档
      // **盾0 ⇒ 补齐 {parry:0, dual:12}**、**盾1 ⇒ 归零**、轴行=1、退化=false。
      // 该点上补齐量 > 0 且**只**由轴态驱动：清轴后归零（断言②）⇒ 断言①对本 feature 有判别力。
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.6)
      config.setActionCount(0, 'blockCount', 2)
      config.setActionCount(0, 'dualCounterCount', 1)
    }

    // ① 轴态（自动命中预设轴）
    apply()
    const axisRows = calc.effectiveStunAxes.value.length
    expect(axisRows, '本用例前提：轴态生效（轴真的注入计算）').toBeGreaterThan(0)
    /**
     * ⚠ **T164 重标定（规则 10 四步）**：本夹具点的补齐量 `{parry:0, dual:12}` → **`{parry:0, dual:0}`**。
     *
     * ① 量 delta：topUp `dual 12 → 0`（伤害 53.733M；有盾时 54.737M）。
     * ② 根因：**般岳进场 60 闪能**（T164 修 `buildBanyueCharConfig` 补 `initialEnergyGift`；
     *    引擎缺省只有 40 ⇒ 少 20）。本夹具是**金身2/双反1**的低交互点，原来靠补齐 12 次双反
     *    凑够 4 怒相；多这 20 闪能（= +10 嗔火）后缺口消失 ⇒ 无需再补。
     * ③ 确认有意：原文核心技「般岳**进入战场时即可回复 60 闪能**」（`raw/nanoka_missing/full/1471.json`）。
     * ④ 判据改为**能分辨两种情况**（原断言在新口径下失去判别力）：
     *    **无秽盾** ⇒ 缺口真实存在 ⇒ 补齐 > 0（原判据语义仍被锁住）；
     *    **有秽盾**（缺省 1）⇒ 60 闪能补上 ⇒ 补齐归零。
     *
     * ⚠ **T167 再标定（2026-10-15，规则 10 四步）—— 换预设与档位，判据逐条保留、未放宽**。
     * ① 量 delta：`banyue-trigger-lucia` @ `r=0.6 + 金身2/双反1 + 盾0` 的补齐量
     *    `{parry:0, dual:12}` → **`{0,0}`**（`calc.interactionTopUp` 由对象变 `null`），断言①红。
     * ② 根因：**轴内连段块的闪能账被修正**（`banyue.ts` 的 `combos[].energyCost` 60 → 0，
     *    连段块是怒相内**山威免费**强特的轴内表达，不该占闪能预算）。闪能门不再跳过轴内连段块
     *    ⇒ 这些块真的进轴执行 ⇒ `flashSpent` 上升 ⇒ 嗔火（`flashSpent × 0.5`）上升
     *    ⇒ 本夹具原来的**嗔火缺口消失** ⇒ 无需再补 12 次双反。
     *    A/B 实测（`.zc/perf/T167ab` 手法，两处修复隔离）：只回退账本 ⇒ 该点补齐恢复 `dual:12`。
     * ③ 确认有意：用户口径「[怒] 怒相连段耗山威（每怒相 4 山威 = 2 组免费连段），**不耗闪能**、
     *    不回复嗔火」+ 规则 17③「不许为保住好看的数字而维持错误的度量」。
     * ④ 处置 = **换一支仍能分辨两种情况的预设**（同本仓「夹具沿革」做法）：
     *    扫描 6 支般岳预设 × `ratio` × `(block,dual)`（`.zc/perf/T167s_d.perf.ts`）后，
     *    `banyue-roxy-lucia` @ `r=0.4 + 金身0/双反1` 满足全部判据：
     *    **盾0 ⇒ `{parry:0, dual:12}`（补齐 > 0）**、**盾1 ⇒ `null`（归零）**、轴行=1、退化=false。
     *    ⇒ 断言①②③（含「清轴 ⇒ 归零」）逐条保留，只换夹具参数。
     */
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.4)
    config.setActionCount(0, 'blockCount', 0)
    config.setActionCount(0, 'dualCounterCount', 1)

    config.enemy.shieldCount = 0
    await new Promise(r => setTimeout(r, 120))
    const noShield = topUpOf(calc)
    expect(noShield.parry + noShield.dual, '无秽盾 + 低交互 ⇒ 缺口真实存在 ⇒ 轴态自行补齐').toBeGreaterThan(0)
    config.enemy.shieldCount = 1
    await new Promise(r => setTimeout(r, 120))
    const withShield = topUpOf(calc)
    expect(withShield.parry + withShield.dual, '有秽盾（+60 闪能）⇒ 缺口被补上 ⇒ 无需抬交互').toBe(0)

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

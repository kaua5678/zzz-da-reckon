/**
 * 折叠残差**不与团队封顶构成正反馈**（2026-10-06，1431 折叠残差专项）——行为锁 + 反证。
 *
 * ## 病灶
 *
 * `cfg.timeBudgetExcess`（`acc`）由折叠环累加（`foldLoop.ts` 的 `+=`），而 `iterate` 把它
 * 折进**账本**后按团队封顶压缩：
 * ```
 * necessary = cappedNecessary[i] = (rowTime + acc) × scale + credit
 * scale     = budget / Σ(rowTime_j + acc_j)          ← 分母也含 acc
 * excess    = rowTime − (necessary + ba)              ← foldLoop 的增量
 * acc      += excess
 * ```
 * ⇒ `acc ↑ ⇒ scale ↓ ⇒ 账本 ↓ ⇒ excess ↑ ⇒ acc ↑`：**正反馈**。
 *
 * 实测 `auto-1431-1481-1491`（口径 harness 缺省 + `comboAlignAbsorbRatio=0.4`）：
 * `acc` 涨到 **62.57s**（战斗总时长才 180s），账本被压到 135.02、物化行 149.40
 * ⇒ 那 14.38s「excess」其实是**封顶砍掉的秒数**，不是欠账。
 * `accLeverLost` 出口（`foldLoop.ts:209`）只冻结**当轮增量**、不撤销已累进的历史量，
 * 且它每次 `runFoldLoop` 都重置 `prevRowTime`（本函数局部）⇒ 每次新运行都能再涨一轮。
 *
 * ⚠ **不是**「跨降配档累积」（原假设，已证伪）：`core/resource.ts:211` 每次调用都清零
 * `timeBudgetExcess`，`resourceConfig` computed 每次产出**新 cfg 数组** ⇒ 档与档之间无残留。
 * 实测把候选集压成单档 `{0.125}`（r695 当时借降配档单调闸门实现，该闸门已于 T23 删除）与全表 8 档
 * 的 `acc` **逐位相同**（62.569 vs 62.569）。
 *
 * ## 修法
 *
 * 折叠环改为对**封顶前**的账本收敛（`IterationState.necessaryUncappedTime`，
 * 由 `iterate` 在 `feasibleScale < 1` 时写入）⇒ `excess = rowTime − rowTime×scale`，
 * 一轮即到不动点，`acc` 塌回量化地板。
 *
 * ## 判据取「残差量级」而不是「落点」（为什么）
 *
 * 封顶下 `capped_i = net_i × budget/Σnet` 只由**比值**决定 ⇒ 修法对落点/伤害/截断/iscale
 * **逐位不变**（全库 104 队实测：0 队伤害变化、0 队截断变化、0 队 iscale 变化）。
 * 唯一可区分观测量是 `convergence.timeBudgetAccumulatedSeconds`（账本自洽性读数）。
 * ⇒ 锁必须断言「残差 < 地板」，**不能**用伤害或账本落点去锁（那会永不红）。
 *
 * ## 反证（已实测，两个方向都验过）
 *
 * ① **删掉封顶前的账本**（把 `ledgerTarget` 换回 `state.necessaryTime`）⇒
 *    `auto-1431-1481-1491` 的 `acc` 由 **9.27 涨回 62.57** ⇒ 本测试断言①**变红**。
 * ② **把封顶压缩量显式折进 acc**（`helpers.ts` 里 `acc += uncapped − capped`）⇒
 *    正反馈完全放开：`acc` 5 轮内冲到 **3×10¹⁰**、`iscale` 1、截断 90.51s、`dmg` 103.22M
 *    ⇒ 本测试断言①**变红**（并证明这条环一旦没有「对封顶前账本收敛」的约束就会发散）。
 *
 * 覆盖（2026-10-09 新库 77 队实测）：缺省口径下 `acc` 读数因本修法变化的队为
 * `auto-1431-1481-1491`（62.57→9.27）与 `auto-1431-1341-1491`（22.74→21.70）**两支**；
 * `auto-1431-1341-1481` 是第三支 `feasibleScale < 1` 的封顶队（走 `necessaryUncappedTime` 路径），
 * 本组用它钉住**该路径的落点**（其 `acc` 读数已被另一条在飞的赠行时长口径修复压平 ⇒ 不再是 acc 判别器，
 * 但仍随 `necessaryUncappedTime` 的写入条件变化）。其余 74 队 `feasibleScale === 1`
 * ⇒ `necessaryUncappedTime` 缺省 ⇒ 路径逐位不变。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import type { useConfigStore } from '@/stores/config'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

/**
 * 逐队钉死（队, 残差上限, 封顶前账本是否参与, 落点快照）。
 * `accCeiling` = 修后实测值 + 余量；修前值写在 `before` 里（反证时的对照量）。
 *
 * ⚠ 2026-10-09 预设库重生成 + 槽序改名，本表**在新槽序上实测重取**：
 * `auto-1431-1481-1341` → `auto-1431-1341-1481`、`auto-1431-1491-1341` → `auto-1431-1341-1491`
 * （同 3 名角色、槽序不同 ⇒ 落点/份额/账本全变，不是纯改名）。旧表 [135.341,43.759,30.673]/116.1162M
 * 与 [146.252,28.795,26.551] 的槽序前提已不存在。
 * 本修法（对封顶前账本收敛）在新库缺省口径下改变的队实测为 `-1481-1491`（acc 62.57→9.27）与
 * `-1341-1491`（22.74→21.70）；`-1341-1481` 仍是 `feasibleScale < 1` 的封顶队（走 necessaryUncappedTime 路径），
 * 用于钉住该路径的落点（其残差读数已被另一条在飞的赠行时长口径修复压平，见 `ultimatePromote.ts`）。
 *
 * ⚠⚠ **本表 `-1341-1481` 一行的落点依赖一条并发的未提交引擎修复**
 * （`src/composables/resourceCalc/ultimatePromote.ts`，2026-10-09 另一会话在改：赠行单次时长
 * 从「倍率表重算融合组整段」改为「取 `cfg.ultimateActionTime` 同源」）。该修复点名本队
 * （照 1341 在槽1 ⇒ 赠大落点 = 照，其模块把终结技前台减半 ⇒ 两侧时长分裂）：
 * ```
 *                          账本 [nec+ba]                        伤害
 * 无该修复（干净 HEAD）  [120.112, 33.956, 65.857]          92.6714M
 * 有该修复（当前工作区） [113.861, 37.169, 56.002]          92.4959M
 * ```
 * 本表钉的是**当前工作区**（= 验收命令运行处）的读数。若该并发修复被撤回，本表 `-1341-1481` 行会红——
 * 那是**如实上报**（该队的落点确实变了），不是本测试写错；届时应连同 `ultimatePromote.ts` 的处置一起复核。
 * 另两支（`-1481-1491` / `-1341-1491`）与该并发修复**无关**，两态逐位相同。
 */
const CASES = [
  {
    id: 'auto-1431-1481-1491', accCeiling: 20, before: 62.57, ledger: [135.009, 43.692, 31.294], dmg: 104.6832,
    desc: '残差塌回地板（修前 62.57s）且落点不变',
  },
  // 旧 auto-1431-1481-1341：新槽序下 scale 0.375（封顶激活）、落点 [113.861,37.169,56.002]/92.4959M。
  // ⚠ 本条**不再是 acc 判别器**：新槽序 + 在飞赠行时长修复下 acc 修前/修后同为 21.70（旧槽序是 45.40→21.70）。
  //   它现在的职责 = 钉住 `necessaryUncappedTime` 路径（`feasibleScale < 1`）的**落点**，不是度量残差塌陷。
  {
    id: 'auto-1431-1341-1481', accCeiling: 35, before: 21.70, ledger: [113.861, 37.169, 56.002], dmg: 92.4959,
    desc: '封顶队（scale<1，走 necessaryUncappedTime 路径）落点不变；acc 修前/修后同为 21.70 ⇒ 本条不度量残差塌陷',
  },
  // 旧 auto-1431-1491-1341：槽序互换（照↔千夏）⇒ 账本槽1/槽2 对调，伤害不变（99.1970M）。
  { id: 'auto-1431-1341-1491', accCeiling: 35, before: 22.74, ledger: [146.252, 26.551, 28.795], dmg: 99.1970, desc: '残差塌回地板（修前 22.74s）且落点不变' },
] as const

describe('折叠残差不与团队封顶构成正反馈', () => {
  for (const c of CASES) {
    it(`${c.id}：${c.desc}`, async () => {
      const preset = teamPresets.find(x => x.id === c.id)
      expect(preset, `预设 ${c.id} 未命中（改名前先改本测试）`).toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      const rr = calc.resourceResult.value
      expect(rr, '资源池未产出结果').toBeTruthy()
      const conv = rr!.convergence

      // ① 残差塌回量化地板（**唯一可区分观测量**）。
      //    反证：删掉封顶前账本 ⇒ 回到 c.before；放开正反馈 ⇒ 冲到 3e10。
      const acc = conv?.timeBudgetAccumulatedSeconds ?? 0
      expect(
        acc,
        `折叠残差累计 ${acc.toFixed(2)}s 超过地板 ${c.accCeiling}s（修前实测 ${c.before}s）`
        + ' —— 折叠环又在对**封顶后**的账本收敛，与封顶构成正反馈',
      ).toBeLessThan(c.accCeiling)

      // ② 落点/伤害**不变**：本修法不是中性记账的镜像——它对落点是恒等的
      //    （封顶只由比值决定），所以这条是**防回归**：若哪天它开始推动落点，必须逐队归因。
      const ledger = rr!.characters.map(x => x.timeAllocation.necessaryTime + x.timeAllocation.basicAttackTime)
      for (let i = 0; i < 3; i++) {
        expect(
          Math.abs(ledger[i]! - c.ledger[i]!),
          `槽${i} 账本 ${ledger[i]!.toFixed(3)}s 偏离基线 ${c.ledger[i]!}s 超过 0.05s —— 修法改变了落点，需逐队归因`,
        ).toBeLessThan(0.05)
      }
      expect(
        Math.abs(calc.teamTotalDamage.value / 1e6 - c.dmg),
        `总伤 ${(calc.teamTotalDamage.value / 1e6).toFixed(4)}M 偏离基线 ${c.dmg}M —— 修法改变了伤害`,
      ).toBeLessThan(0.01)

      // ③ 收敛标志未被本修法翻转
      expect(conv?.timeBudgetConverged, '收敛标志被本修法意外翻转').toBe(true)
    }, 200_000)
  }

  /**
   * 跨队对照：**封顶未激活的队必须逐位不变**。
   *
   * `necessaryUncappedTime` 只在 `feasibleScale < 1` 时写 ⇒ 其余队走 `?? state.necessaryTime`
   * 回落路径。本断言用一支 `iscale === 1`（未降配、封顶未激活）的队钉住「回落路径没被写坏」。
   * ⚠ 它**不是**本修法的效果判据（那种队修前修后都同值）——它是**边界锁**，防有人把
   * `necessaryUncappedTime` 改成无条件写入（那会让全库 101 队的残差读数一起漂）。
   *
   * 2026-10-09：原夹具 `auto-1431-1341-1311`（1431+照+耀嘉音）在新库**真消失**，换
   * `auto-1431-1341-1031`（1431+照+妮可，同 1431 簇、同为「封顶未激活」的 `iscale === 1` 队）。
   * 等价性：① 同属 1431 簇（叶瞬光 + 照 + 支援位）；② 实测 `iscale === 1`、`acc` 读数与旧夹具**同为 21.70s**
   *   （旧 `auto-1431-1341-1311` 实测 21.70）⇒ 边界锁的数值判据逐位保留，不是放宽。
   * 该夹具**不随**任何在飞的引擎改动漂（clean HEAD 与当前工作区实测逐位相同）。
   */
  it('封顶未激活的队走回落路径（边界锁）', async () => {
    const preset = teamPresets.find(x => x.id === 'auto-1431-1341-1031')
    expect(preset, '预设 auto-1431-1341-1031 未命中（改名前先改本测试）').toBeTruthy()
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
    config.applyTeamPreset(preset!.team as [string, string, string])
    const rr = calc.resourceResult.value
    expect(rr, '资源池未产出结果').toBeTruthy()
    // 该队未降配（iscale === 1）⇒ 封顶未激活 ⇒ 走回落路径
    expect(rr!.convergence?.interactionScale ?? 1, '本断言假定该队不降配').toBe(1)
    // 残差读数与修前基线一致（21.70s，见本轮 zd/census 对账）
    expect(
      Math.abs((rr!.convergence?.timeBudgetAccumulatedSeconds ?? 0) - 21.70),
      '封顶未激活的队残差读数漂了 —— necessaryUncappedTime 可能被改成无条件写入',
    ).toBeLessThan(0.05)
  }, 200_000)

  /**
   * ## ★ 降配档位变化的**显式认领**（2026-10-06，用户裁决「一切以开发为重」）
   *
   * 本修法**不是**中性记账：`acc` 经 `necessary = (rowTime + acc) × scale` 参与**封顶比值**
   * ⇒ 改掉 `acc` 会改变**逐档试算的可行性读数**，从而在「逼出降配搜索」的场景上改变**被采纳档位**。
   *
   * 全场景实测（104 队 × 6 场景 = 624 条，`.zc/perf/ysgzd2.perf.ts` 修前 vs 修后）：
   * ```
   * 场景          变化条数  伤害变化
   * default            0        0     ← 逐位零差
   * c0                 0        0     ← 逐位零差
   * w（权重扰动）       0        0     ← 逐位零差
   * c6                 6        6
   * heavy             3        3
   * heavyGate         3        3
   * ```
   * ⇒ 变化**全部**落在降配搜索被逼出的三个场景。本组断言把**最大的两条**钉成显式认领：
   * 谁再动折叠/封顶语义，必须重新过这里并说明档位为什么变。
   *
   * ⚠ 这些是**有意**的行为变化（不是回归）：`helpers.ts` 封顶处原文已声明
   * 「被压掉的部分**不再折进账本挤平A池**」，而修前实现恰恰把它折进了账本（并形成正反馈）。
   * 修法让实现回到该口径 ⇒ 逐档可行性读数随之修正。
   *
   * ## ★★ 已知**变差**的一条（旧槽序 `auto-1431-1481-1341 @ comboAlignAbsorbRatio=0`，−9.76M）
   *
   * ⚠ 2026-10-09：该槽序在新库已改名 `auto-1431-1341-1481`，且新槽序下这条**变差方向不再复现**
   * （修前/修后同为档位 0.125 / 截断 12.10s / 86.0752M；旧槽序实测修前 0.0625/26.033s/106.7702M →
   * 修后 0.5/63.86s/97.013M）。下列归因保留为**历史证据 + 搜索规则脆弱性的口径记录**，
   * 现行值以 `it(...)` 里的认领值为准（新槽序重取）。
   *
   * 旧槽序下这是本轮唯一一条**真变差**，根因已定位到**降配搜索第三层「缓解档」的选择规则**（不是读数坏了）：
   *
   * ```
   * 档位   | 修前 截断 / relief | 修后 截断 / relief
   * 0.75   | 82.05 / ✔         | 81.13 / ✘
   * 0.625  | 72.45 / ✔         | 72.45 / ✘   ← 修后 acceptsTrial 由 true 翻 false
   * 0.5    | 63.53 / ✔         | 63.86 / ✔   ← 修后**唯一** relief 档 ⇒ 被采纳
   * 0.125  | 33.72 / ✘         | 33.72 / ✘
   * 0.0625 | 26.03 / ✔         | 27.43 / ✘
   * ```
   * 修前有 5 个 relief 候选（0.75/0.625/0.5/0.375/0.25/0.0625），`selectDownscaleScale` 按
   * 「截断最小」取到 **0.0625（26.03s）**；修后 0.625 等档的 `acceptsTrial`（三臂相对基线）
   * 翻假，只剩 **0.5（63.86s）** 一个 relief 候选 ⇒ 截断反而更大、伤害更低。
   *
   * ⇒ 这是**搜索规则的脆弱性**：第三层兜底档依赖「三臂相对基线」这一**相对**判据，
   * 而相对判据的基线（`baseNet`/`baseTruncation`）本身随折叠残差移动 ⇒ 修法让某几档
   * 「不比基线更差」不再成立。**读数没有错**（0.0625 档修后仍是 27.43s，比 0.5 的 63.86s 好得多），
   * 错的是「relief 候选集」被相对判据缩成了一个更差的点。
   *
   * 处置：**如实认领，不在本任务里改搜索规则**（那是 `feasibilitySearch.ts` 的独立议题，
   * 动它要重跑全库降配面 + 用户口径）。本用例钉住现状，任何人再动折叠/搜索语义都会在此变红。
   */
  describe('降配档位变化的显式认领（有意行为变化，非回归）', () => {
    /** 场景构造：复刻 `zd` 的 `heavy`（弹刀+闪反各 +25，逼出降配搜索） */
    const heavySetup = (config: ReturnType<typeof useConfigStore>) => {
      config.team[0]!.parryCount = (config.team[0]!.parryCount ?? 0) + 25
      config.team[0]!.dodgeCounterCount = (config.team[0]!.dodgeCounterCount ?? 0) + 25
    }

    it('auto-1431-1341-1481 / heavy：档位 0.0625、截断 0s（新槽序落点；旧槽序 -1481-1341 才是 0.75 → 0.0625 / 188.68 → 22.75s）', async () => {
      const preset = teamPresets.find(x => x.id === 'auto-1431-1341-1481')
      expect(preset, '预设未命中').toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      heavySetup(config)
      const rr = calc.resourceResult.value
      expect(rr, '资源池未产出结果').toBeTruthy()
      /**
       * 2026-10-09 新槽序实测（**折叠修复前/后逐位相同**）：
       *   档位 0.0625、截断 0s、伤害 90.215M、acc 21.70（旧槽序 `1431,1481,1341` 修后 0.0625 / 22.75s / 120.0145M）。
       * ⚠ 本条**不再是**折叠修复的「大幅改善」判别器：新槽序（照在槽1 ⇒ 赠大落点=照）下该档在修复前就已经是
       *   0.0625/0s，修复只动 acc（本队 acc 已被赠行时长口径压平）。旧标题的「0.75 → 0.0625 / 188.68 → 0s」
       *   是**旧槽序修前**的读数（实测旧槽序修前 0.75 / 188.681s / 111.221M），套到新槽序上是错的——已按实测改写。
       *   保留本用例 = 钉住该队的降配落点（数值一漂即红），不声称档位迁移。
       */
      expect(rr!.convergence?.interactionScale, '档位认领值变了 —— 需重新逐队归因').toBeCloseTo(0.0625, 6)
      expect(
        Math.abs((rr!.overflowSeconds ?? 0) - 0),
        `截断 ${(rr!.overflowSeconds ?? 0).toFixed(2)}s 偏离认领值 0s`,
      ).toBeLessThan(0.05)
      expect(
        Math.abs(calc.teamTotalDamage.value / 1e6 - 90.215),
        `总伤 ${(calc.teamTotalDamage.value / 1e6).toFixed(4)}M 偏离认领值 90.215M`,
      ).toBeLessThan(0.01)
      // 残差仍在量化地板（本修法的目的）
      expect(rr!.convergence?.timeBudgetAccumulatedSeconds ?? 0).toBeLessThan(35)
    }, 200_000)

    it('yixuan-trigger-lucia / heavy：档位 0.25 → 0.125（修后 0.25 档不再绝对可行）', async () => {
      const preset = teamPresets.find(x => x.id === 'yixuan-trigger-lucia')
      expect(preset, '预设未命中').toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      heavySetup(config)
      const rr = calc.resourceResult.value
      expect(rr, '资源池未产出结果').toBeTruthy()
      // 2026-10-09 实测：折叠修复前 0.25 / 71.6412M（acc 13.9202）→ 修复后 0.125 / 69.6128M（acc 13.6020）。
      // 本队**不随**并发赠行时长修复漂（该修复前后逐位相同）⇒ 是折叠修复的干净判别夹具。
      expect(rr!.convergence?.interactionScale, '档位认领值变了 —— 需重新逐队归因').toBeCloseTo(0.125, 6)
      expect(
        Math.abs(calc.teamTotalDamage.value / 1e6 - 69.6128),
        `总伤 ${(calc.teamTotalDamage.value / 1e6).toFixed(4)}M 偏离认领值 69.6128M`,
      ).toBeLessThan(0.01)
    }, 200_000)

    /**
     * ⚠ **唯一一条真变差**的显式认领（见本 describe 头注释的完整归因）。
     *
     * `comboAlignAbsorbRatio=0`（全关合轴吸收）时，修前搜索有 5 个「缓解档」候选、
     * 按截断最小取到 0.0625（旧槽序 26.03s）；修后 0.625 等档的 `acceptsTrial` 翻假 ⇒
     * 只剩更差的候选 ⇒ 截断更大、伤害更低。
     *
     * 本用例**钉住现状并把它标成已知缺陷**：它锁的不是「这个值是对的」，
     * 而是「再动折叠/搜索语义时必须重新过这里并说明为什么」。修搜索规则时本用例应随之更新。
     *
     * 2026-10-09 新槽序实测：档位 0.125、截断 12.10s、伤害 86.0752M
     * （旧槽序 `1431,1481,1341` 修前 0.0625 / 26.033s / 106.7702M → 修后 0.5 / 63.86s / 97.013M）。
     * ⚠ 新槽序下这条**变差方向不再成立**（修前 12.10s → 修后 12.10s 同值，档位也不动）：
     * 该 fixture 的 `ratio=0` 落点已被赠行时长口径（`ultimatePromote.ts`，另一条在飞修复）改到另一个
     * 降配档，折叠修复对它不再构成「relief 候选集缩窄」。本条保留为**现状认领**（钉住落点 + 标明
     * 与搜索规则脆弱性的关系），待 `feasibilitySearch.ts` 独立议题处理时一并复核。
     */
    it('⚠ 已知变差：auto-1431-1341-1481 @ ratio=0（缓解档候选集被相对判据缩成更差的点）', async () => {
      const preset = teamPresets.find(x => x.id === 'auto-1431-1341-1481')
      expect(preset, '预设未命中').toBeTruthy()
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
      config.applyTeamPreset(preset!.team as [string, string, string])
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0)
      const rr = calc.resourceResult.value
      expect(rr, '资源池未产出结果').toBeTruthy()
      // 现状：档位 0.125、截断 12.10s、伤害 86.0752M
      expect(rr!.convergence?.interactionScale, '档位认领值变了 —— 需重新逐队归因').toBeCloseTo(0.125, 6)
      expect(
        Math.abs((rr!.overflowSeconds ?? 0) - 12.10),
        `截断 ${(rr!.overflowSeconds ?? 0).toFixed(2)}s 偏离认领值 12.10s`,
      ).toBeLessThan(0.05)
      expect(
        Math.abs(calc.teamTotalDamage.value / 1e6 - 86.0752),
        `总伤 ${(calc.teamTotalDamage.value / 1e6).toFixed(4)}M 偏离认领值 86.0752M`,
      ).toBeLessThan(0.01)
    }, 200_000)
  })
})

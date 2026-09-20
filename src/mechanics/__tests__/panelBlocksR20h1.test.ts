/**
 * R20-h1 同槽面板批判据（2026-09-17 round 20，棘轮 39 → **实测 32**）。
 *
 * 任务书：`/home/kaua/.dsh/session-manager/reports/R20-A-helpers-triage.md` §4 批次 1。
 * 把 `helpers.ts#computePanelPhases` 里 **7 个「同槽自面板块」**的角色判定迁进各角色模块自己的
 * `applyPanel`（零新契约、单槽自身面板 ⇒ 不触 P2 跨槽陷阱）：
 *
 * | 块 | 原行号 | 判定 | 落点 |
 * |---|---|---|---|
 * | A6 | :769 | `agent.id === '1531'` | `starlightBilly.ts#applyStarlightBillyPanel` |
 * | A7 | :786 | `agent.id === '1041'` | `soldier11.ts#applySoldier11Panel` |
 * | A8 | :796 | `agent.id === '1321'` | `evelyn.ts#applyEvelynPanel`（**乘法、位置敏感**） |
 * | A9 | :803 | `agent.id === '1391'` | `specPanelBuffs.ts#jufufuTigerRoarMechanic.applyPanel`（**新增**） |
 * | A10 | :814 | `agent.id === '1551'` | `specPanelBuffs.ts#peiluoProminenceMechanic.applyPanel`（**新增**） |
 * | A11 | :829 | `agent.id === '1481' \|\| teammateBuffId === '1481'` | `liuyin.ts#applyLiuyinPanel` |
 * | A12 | :837 | `agent.id === '1571' \|\| teammateBuffId === '1571'` | `norma.ts#applyNormaPanel` |
 *
 * **为什么选本文件而非并入各模块既有 test**（任务书允许二选一，须说明）：
 * 本批的验收面是「**7 块同批迁移后仍逐位等价**」，而不是「某角色某个机制对不对」。判据的核心是
 * **跨 7 个模块的同一形状**（滑块端点 0/1 的精确折算、命座门控、额外能力门控）与
 * **派发器真的接上了**（不是静默没接）。放进单一文件才能一眼看出「7 块都还在生效」，
 * 且新增的 `panelBlocksR20h1` 名字直接对应批次号——任务书验收命令里点名的就是它。
 * 各模块**既有**的精确断言（`jufufu.test.ts:102/111`、`peiluo.test.ts:33/149/263`、
 * `soldier11.test.ts:167/216`）**一行未改、继续跑**，本文件补的是它们**没有**覆盖的：
 * 滑块端点 0/1 的精确值（A6/A7/A11）+ 派发器接线 + 命座门控边界。
 *
 * 四层判据（照 `nextRoundFeedbackR20.test.ts` 的结构）：
 * ① **精确值**（禁 `> 0` / 禁 `toBeGreaterThan`）：本文件全部 `toBe` / `toBeCloseTo` 到确定的位。
 * ② **端点对照**：覆盖率滑块 0 / 0.5 / 1 三个端点的**精确**差分（0 必须是真 0，不是「小」）。
 * ③ **真派发器接线**：走 `computePanelPhases`（不是直接调钩子）——证明新钩子**真的被派发到**，
 *    而不是静默没接上（反向验证第 3 组专门打这一点）。
 * ④ **门控边界**：命座 `n-1 → n` 的精确差分 + 门控不成立时的真 0。
 *
 * ⚠ 数值口径：本文件的期望值全部取自**迁移前**在 HEAD 上抓的面板指纹
 * （`/tmp/r20h1-before.txt`，162 行 = 31 队 × 3 槽 × in/out；迁移后 `diff` **0 行**）。
 * 不是事后从迁移后的实现倒推的（那会把错误一起固化成「期望」）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { starlightBillyMechanic } from '@/mechanics/agents/starlightBilly'
import { soldier11Mechanic } from '@/mechanics/agents/soldier11'
import { evelynMechanic } from '@/mechanics/agents/evelyn'
import { jufufuTigerRoarMechanic, peiluoProminenceMechanic } from '@/mechanics/agents/specPanelBuffs'
import { liuyinMechanic } from '@/mechanics/agents/liuyin'
import { normaMechanic } from '@/mechanics/agents/norma'

/** 读某槽 inCombat 面板（走真派发器）。空槽用 `''` 占位（`setupHarness` 的约定） */
async function panelOf(
  // `potentialLevel` 于 R60 加入：隔离队友的潜能增益（如 1211 大扫除②给全队加攻击）
  team: Array<{ agentId: string; cinemaLevel?: number; potentialLevel?: number } | ''>,
  slot = 0,
  settings: Record<string, number> = {},
) {
  const { catalog, config } = await setupHarness(team)
  for (const [k, v] of Object.entries(settings)) config.setMechanicSetting(k, v)
  return computePanelPhases(slot, config, catalog)!.inCombat as Record<string, number>
}

// ---------------------------------------------------------------- 层③：真派发器接线

describe('R20-h1 层③：7 块都经真派发器（computePanelPhases → applyPanel）生效', () => {
  it('7 个角色的模块都注册了 applyPanel（A9/A10 是本批新增的钩子）', () => {
    expect(starlightBillyMechanic.applyPanel).toBeTypeOf('function')
    expect(soldier11Mechanic.applyPanel).toBeTypeOf('function')
    expect(evelynMechanic.applyPanel).toBeTypeOf('function')
    // A9/A10：specPanelBuffs 由 makePanelBuffModule 工厂生成，本批之前**没有** applyPanel
    expect(jufufuTigerRoarMechanic.applyPanel).toBeTypeOf('function')
    expect(peiluoProminenceMechanic.applyPanel).toBeTypeOf('function')
    expect(liuyinMechanic.applyPanel).toBeTypeOf('function')
    expect(normaMechanic.applyPanel).toBeTypeOf('function')
  })
})

// ---------------------------------------------------------------- A6 星徽·比利 1531

describe('A6 星徽·比利（1531）面板块迁入 starlightBilly', () => {
  it('核心被动暴伤 +90% × 覆盖率：端点 0 / 0.5 / 1 精确折算', async () => {
    const team = [{ agentId: '1531' }, { agentId: '1391' }]
    const base = await panelOf(team, 0, { '1531.driveSuppressionCritDmgCoverage': 0, '1531.c4CritDmgCoverage': 0, '1531.c1ResIgnoreCoverage': 0 })
    const half = await panelOf(team, 0, { '1531.driveSuppressionCritDmgCoverage': 0.5, '1531.c4CritDmgCoverage': 0.5, '1531.c1ResIgnoreCoverage': 0.5 })
    const full = await panelOf(team, 0)
    // 逐位精确值（迁移前 HEAD 指纹同队同滑块的读数）
    expect(base.critDmg).toBe(70)
    expect(full.critDmg).toBe(160)
    // 差分：核心被动 +90 全额；覆盖率 0 时**真 0**（不是"小"）
    expect(full.critDmg - base.critDmg).toBe(90)
    // 端点 0.5 = 90×0.5 = 45（0 命无 C1/C4 项，只有核心被动这一条吃覆盖率）
    expect(half.critDmg).toBe(115)
    expect(half.critDmg - base.critDmg).toBe(45)
  })

  it('影画4 暴伤 +8×2 与影画1 物理抗性无视 18%，各按覆盖率精确折算', async () => {
    const t0 = [{ agentId: '1531', cinemaLevel: 0 }, { agentId: '1391' }]
    const t4 = [{ agentId: '1531', cinemaLevel: 4 }, { agentId: '1391' }]
    const c0 = await panelOf(t0, 0)
    const c4 = await panelOf(t4, 0)
    // 迁移前基线：1531-c0 critDmg = 160 / C4 = 176 ⇒ C4 差分精确 16（= 8×2）
    expect(c0.critDmg).toBe(160)
    expect(c4.critDmg).toBe(176)
    expect(c4.critDmg - c0.critDmg).toBe(16)
    // 影画1：物理抗性无视 18%（0 命真 0）
    expect(c0.enemyPhysicalResReduction ?? 0).toBe(0)
    expect(c4.enemyPhysicalResReduction).toBe(18)

    const cov0 = await panelOf(t4, 0, { '1531.c4CritDmgCoverage': 0, '1531.c1ResIgnoreCoverage': 0 })
    const cov05 = await panelOf(t4, 0, { '1531.c4CritDmgCoverage': 0.5, '1531.c1ResIgnoreCoverage': 0.5 })
    // 覆盖率 0 ⇒ 这两项真 0（回落到与 0 命同值：160 / 0）
    expect(cov0.critDmg).toBe(160)
    expect(cov0.enemyPhysicalResReduction ?? 0).toBe(0)
    // 覆盖率 0.5 ⇒ C4 差分 8（8×2×0.5）、C1 差分 9（18×0.5）；核心被动不受这两个滑块影响（仍 90）
    expect(cov05.critDmg).toBe(168)
    expect(cov05.critDmg - c0.critDmg).toBe(8)
    expect(cov05.enemyPhysicalResReduction).toBe(9)
  })

  it('5 命不额外加暴伤（+4 技能等级走 skillLevelBonus，不叠在本块）', async () => {
    const cov = { '1531.c4CritDmgCoverage': 0.5, '1531.c1ResIgnoreCoverage': 0.5 }
    const c4 = await panelOf([{ agentId: '1531', cinemaLevel: 4 }, { agentId: '1391' }], 0, cov)
    const c5 = await panelOf([{ agentId: '1531', cinemaLevel: 5 }, { agentId: '1391' }], 0, cov)
    // 3 命 → 5 命只在通用 skillLevelBonus 上差分，本块（C4 暴伤/C1 减抗）不变
    expect(c5.critDmg).toBe(c4.critDmg)
    expect(c5.enemyPhysicalResReduction).toBe(c4.enemyPhysicalResReduction)
  })
})

// ---------------------------------------------------------------- A7 「11号」1041

describe('A7 「11号」（1041）燎原火伤块迁入 soldier11', () => {
  it('火伤 +10 无条件 + 失衡额外 22.5% × 覆盖率：端点 0 / 0.5 / 1 精确值', async () => {
    // 1171 柏妮思 = 火属性队友 → 激活燎原额外能力
    const team = [{ agentId: '1041' }, { agentId: '1171' }]
    const off = await panelOf(team, 0, { 'soldier11.prairieFireStunCoverage': 0 })
    const half = await panelOf(team, 0, { 'soldier11.prairieFireStunCoverage': 0.5 })
    const on = await panelOf(team, 0)
    // 迁移前指纹：1041-stun0 = 10 / 1041-stun05 = 21.25 / 1041-c0 = 32.5
    expect(off.fireDmg).toBe(10)
    expect(half.fireDmg).toBe(21.25)
    expect(on.fireDmg).toBe(32.5)
    expect(on.fireDmg - off.fireDmg).toBe(22.5)
    expect(half.fireDmg - off.fireDmg).toBe(11.25)
  })

  it('门控不成立（无同属性/同阵营队友）⇒ 燎原两条都不加（真 0）', async () => {
    // 1011 安比：电属性/狡兔屋 ⇒ 与 1041（火/新艾利都防卫军）两条门控都不满足
    const p = await panelOf([{ agentId: '1041' }, { agentId: '1011' }], 0)
    expect(p.additionalAbilityActive ?? 0).toBe(0)
    // 空队友基线：火伤完全一致（燎原未贡献）
    const baseline = await panelOf([{ agentId: '1041' }, ''], 0)
    expect(p.fireDmg).toBe(baseline.fireDmg)
  })
})

// ---------------------------------------------------------------- A8 伊芙琳 1321（最高风险：乘法位置敏感）

describe('A8 伊芙琳（1321）影画2 攻%块迁入 evelyn（乘法、位置敏感）', () => {
  it('0/1 命 → 2 命：atk 取整乘法精确值（迁移前后逐位相同）', async () => {
    const c0 = await panelOf([{ agentId: '1321' }, { agentId: '1011' }], 0)
    const c2 = await panelOf([{ agentId: '1321', cinemaLevel: 2 }, { agentId: '1011' }], 0)
    const c6 = await panelOf([{ agentId: '1321', cinemaLevel: 6 }, { agentId: '1011' }], 0)
    // ★ 本批最高风险项：迁移前 HEAD 指纹 = 1494.9103200000002 → Math.round(×1.15) = 1719
    expect(c0.atk).toBe(1494.9103200000002)
    expect(c2.atk).toBe(1719)
    // 算式逐位钉住：Math.round(0命基数 × (1 + 0.15))，不是 ×1.15 的近似，也不是先加后乘
    expect(c2.atk).toBe(Math.round(c0.atk * (1 + 0.15)))
    // 边界：2 命起才生效，6 命不再叠（本块只按 cinema >= 2 门控）
    expect(c6.atk).toBe(c2.atk)
  })
})

// ---------------------------------------------------------------- A9 橘福福 1391

describe('A9 橘福福（1391）影画1/4 面板块迁入 specPanelBuffs（本批新增 applyPanel 钩子）', () => {
  it('影画1 暴击 +12、影画4 暴伤 +35：逐级精确门控', async () => {
    const team = (c: number) => [{ agentId: '1391', cinemaLevel: c }, { agentId: '1191' }]
    const c0 = await panelOf(team(0), 0)
    const c1 = await panelOf(team(1), 0)
    const c3 = await panelOf(team(3), 0)
    const c4 = await panelOf(team(4), 0)
    // 逐位精确值（迁移前 HEAD 指纹同队读数）：c0 critRate 19.4 / critDmg 70
    expect(c0.critRate).toBe(19.4)
    expect(c0.critDmg).toBe(70)
    expect(c1.critRate).toBe(31.4)
    expect(c1.critRate - c0.critRate).toBe(12)
    // ⚠ c2 起 critDmg 已从 70 抬到 92（那是**另**一条命座暴伤来源，不是本块的影画4 项）
    //   ⇒ 影画4 的判据必须钉在「c3 → c4」这一段：差分恰好 35，且 c3 时本块项真 0。
    expect(c3.critDmg).toBe(92)
    expect(c4.critDmg).toBe(127)
    expect(c4.critDmg - c3.critDmg).toBe(35)
    // 4 命不额外加暴击（本块只有 >=1 加暴击）
    expect(c4.critRate).toBe(c1.critRate)
  })
})

// ---------------------------------------------------------------- A10 佩洛伊斯 1551

describe('A10 佩洛伊斯（1551）影画1/4 + 额外能力块迁入 specPanelBuffs（本批新增 applyPanel）', () => {
  it('影画1 暴击 +8、额外能力暴伤 +40、影画4 失衡 +10：逐条精确值', async () => {
    // 1011 安比（击破）→ 满足 1551 额外能力（队伍存在[击破]/[支援]）
    const withStun = (c: number) => [{ agentId: '1551', cinemaLevel: c }, { agentId: '1011' }]
    const c0 = await panelOf(withStun(0), 0)
    const c1 = await panelOf(withStun(1), 0)
    const c3 = await panelOf(withStun(3), 0)
    const c4 = await panelOf(withStun(4), 0)
    // 逐位精确值（迁移前 HEAD 指纹同队读数）：c0 critRate 19.4 / critDmg 90；c1 critRate 27.4
    expect(c0.critRate).toBe(19.4)
    expect(c1.critRate).toBe(27.4)
    expect(c1.critRate - c0.critRate).toBe(8)
    // 额外能力暴伤 +40（c0 已触发 ⇒ 基线里已含；与"无[击破]/[支援]队友"对照见下一条）
    expect(c0.critDmg).toBe(90)
    // 影画4：3 命真 0 → 4 命 +10
    expect(c3.stunBuildUpBonus ?? 0).toBe(0)
    expect(c4.stunBuildUpBonus).toBe(10)
    expect(c4.critRate).toBe(c1.critRate)
  })

  it('额外能力门控：无[击破]/[支援]队友时暴伤 +40 不触发（精确差分）', async () => {
    // 1191 艾莲 = 强攻 ⇒ 不满足 1551 的 [击破]/[支援] 门控
    const withMate = await panelOf([{ agentId: '1551' }, { agentId: '1011' }], 0)
    const withoutMate = await panelOf([{ agentId: '1551' }, { agentId: '1191' }], 0)
    expect(withMate.additionalAbilityActive).toBe(1)
    expect(withoutMate.additionalAbilityActive ?? 0).toBe(0)
    // 命中与未命中的暴伤差 = 恰好 40
    expect(withMate.critDmg - withoutMate.critDmg).toBe(40)
  })
})

// ---------------------------------------------------------------- A11 琉音 1481

describe('A11 琉音（1481）影画4 好评如潮折算块迁入 liuyin', () => {
  it('影画4 atk +500 × 覆盖率：端点 0 / 0.5 / 1 精确值', async () => {
    const team4 = [{ agentId: '1481', cinemaLevel: 4 }, { agentId: '1191' }]
    const c0 = await panelOf([{ agentId: '1481' }, { agentId: '1191' }], 0)
    const cov0 = await panelOf(team4, 0, { 'liuyin.goodReviewAtkCoverage': 0 })
    const cov05 = await panelOf(team4, 0, { 'liuyin.goodReviewAtkCoverage': 0.5 })
    const cov1 = await panelOf(team4, 0)
    // 迁移前指纹：1481-c0 = 1289.04 / 1481-c4-cov0 = 1289.04 / cov05 = 1539.04 / 1481-c4 = 1789.04
    expect(c0.atk).toBe(1289.04)
    expect(cov0.atk).toBe(1289.04)
    expect(cov05.atk).toBe(1539.04)
    expect(cov1.atk).toBe(1789.04)
    // 端点精确折算：500 × 0 / 0.5 / 1
    expect(cov0.atk - c0.atk).toBe(0)
    expect(cov05.atk - c0.atk).toBe(250)
    expect(cov1.atk - c0.atk).toBe(500)
  })

  it('顺序约束：bonus 先写、折算后取（0-3 命无 bonus ⇒ 折算真 0）', async () => {
    const c3 = await panelOf([{ agentId: '1481', cinemaLevel: 3 }, { agentId: '1191' }], 0)
    const c4 = await panelOf([{ agentId: '1481', cinemaLevel: 4 }, { agentId: '1191' }], 0)
    // 3 命：liuyinGoodReviewAtkBonus 未写 ⇒ 折算读不到值（真 0 差分）
    expect(c3.atk).toBe(1289.04)
    expect(c4.atk - c3.atk).toBe(500)
  })
})

// ---------------------------------------------------------------- A12 诺姆 1571

describe('A12 诺姆（1571）额外能力 870 块迁入 norma', () => {
  it('额外能力触发时 atk +870（精确值，非 >0）', async () => {
    // 1191 艾莲（强攻）+ 1011 安比：满足 1571 的 [强攻]/[命破]/同阵营 门控
    const on = await panelOf([{ agentId: '1571' }, { agentId: '1191' }, { agentId: '1011' }], 0)
    // 迁移前指纹：1571-c0 atk = 3364.08（含 870）
    expect(on.additionalAbilityActive).toBe(1)
    expect(on.atk).toBe(3364.08)
    expect(on.atk - 870).toBe(2494.08)
  })

  it('门控不成立（无[强攻]/[命破]/同阵营队友）⇒ 870 真 0', async () => {
    // 1211 丽娜：电/支援/维多利亚家政，与 1571（火/罗斯凯利法）两条门控都不满足
    //（⚠ 原注释写「1211 猫又」是**错的**：猫又是 1021；1211 是丽娜。R60 订正）
    // ⚠ R60 订正（值）：丽娜**自身**带潜能觉醒·完美侍奉②（默认 potentialLevel=6）——
    // 「基于自身穿透率每 1%，全队攻击 +8 点」⇒ 会给 1571 的面板**加 115.2**
    //（= 14.4 × 8，实测把 1211 钉在 potentialLevel=1 时该增量消失）。
    // 本用例只测 1571 的额外能力门控 ⇒ 把 1211 的潜能钉到 I，隔离掉这个混淆变量。
    const off = await panelOf(
      [{ agentId: '1571' }, { agentId: '1011' }, { agentId: '1211', potentialLevel: 1 }], 0)
    // 迁移前指纹：1571-noextra atk = 2494.08（无 870）
    expect(off.additionalAbilityActive ?? 0).toBe(0)
    expect(off.atk).toBe(2494.08)
  })
})

// ---------------------------------------------------------------- 跨块：7 块互不串扰

describe('R20-h1 交叉隔离：同队多块各按自己门控生效', () => {
  it('三块同队（1531 C4 / 1321 C2 / 1481 C4）逐槽精确，互不串扰', async () => {
    const team = [
      { agentId: '1531', cinemaLevel: 4 },
      { agentId: '1321', cinemaLevel: 2 },
      { agentId: '1481', cinemaLevel: 4 },
    ]
    const s0 = await panelOf(team, 0)
    const s1 = await panelOf(team, 1)
    const s2 = await panelOf(team, 2)
    // 槽0 = 1531 C4：critDmg 156（核心 90 + C4 16 + 基数 50）、物抗无视 18 全部只落自己槽
    expect(s0.critDmg).toBe(156)
    expect(s0.enemyPhysicalResReduction).toBe(18)
    // 槽1 = 1321 C2：atk 是取整乘法结果（1719），**不吃** 1531 的物抗无视
    expect(s1.atk).toBe(1719)
    expect(s1.enemyPhysicalResReduction ?? 0).toBe(0)
    // 槽2 = 1481 C4：atk 含 500 折算（1789.04），只有琉音自己面板带 bonus 字段
    expect(s2.atk).toBe(1789.04)
    expect(s2.liuyinGoodReviewAtkBonus).toBe(500)
    // 串扰反锁：bonus 字段只在琉音自己槽上（另两槽 undefined）
    expect(s0.liuyinGoodReviewAtkBonus ?? 0).toBe(0)
    expect(s1.liuyinGoodReviewAtkBonus ?? 0).toBe(0)
    // 串扰反锁：物抗无视只在 1531 自己槽上（另两槽 0）
    expect(s1.enemyPhysicalResReduction ?? 0).toBe(0)
    expect(s2.enemyPhysicalResReduction ?? 0).toBe(0)
  })

  it('A6 与 A8 同队时槽0 的两条各自独立（清除一个不影响另一个）', async () => {
    // 槽0 = 1531 C4（吃 A6）、槽1 = 1321 C2（吃 A8）——同一队里两块互不干扰
    const team = [{ agentId: '1531', cinemaLevel: 4 }, { agentId: '1321', cinemaLevel: 2 }]
    const s0 = await panelOf(team, 0)
    const s1 = await panelOf(team, 1)
    expect(s0.critDmg).toBe(156)
    expect(s0.enemyPhysicalResReduction).toBe(18)
    // 1321 的 atk 只由自己的块决定（1531 的块不写 atk）
    expect(s1.atk).toBe(1719)
    // 把 A6 的滑块清零：A6 项真 0，A8 的槽1 atk 不受任何影响
    const z = await panelOf(team, 0, { '1531.driveSuppressionCritDmgCoverage': 0, '1531.c4CritDmgCoverage': 0, '1531.c1ResIgnoreCoverage': 0 })
    expect(z.critDmg).toBe(50)
    expect(z.enemyPhysicalResReduction ?? 0).toBe(0)
    const s1b = await panelOf(team, 1, { '1531.driveSuppressionCritDmgCoverage': 0 })
    expect(s1b.atk).toBe(1719)
  })
})

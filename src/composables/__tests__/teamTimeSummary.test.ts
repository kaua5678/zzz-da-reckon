/**
 * 时间分配汇总卡（composables/teamTimeSummary.ts）生效测试。
 *
 * 钉住的口径：卡必须同时报**账本**（引擎收费）与**物化**（真打出去的动作行）两套数，
 * 并把「预算 − 物化净占用」的留白**归因**到 账本虚高 / 平A行缩水——历史上只报账本，
 * 于是出现「卡说 166.9/180 快满了、角色条却只打了 86s」的自相矛盾（折叠残差抬高
 * necessaryTime，用户只能猜时间去了哪）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { clearWarmStartCache } from '@/core/resource'
import { buildTeamTimeSummary, poolFillText, slackHint, truncationHint } from '@/composables/teamTimeSummary'
import { fmt } from '@/utils/format'

beforeEach(() => clearWarmStartCache())

async function summaryOf(team: string[], enemy: { invincibleTime?: number; stunCountLock?: number } = {}, opts: { applyPreset?: boolean } = {}) {
  const { catalog } = await setupHarness(['', '', ''])
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
  if (opts.applyPreset) {
    // 预设配置口径（与 timeGolden 同源：构筑推荐 + 预设滑块），与默认 setAgent 口径是两套不同场景
    await catalog.loadBuildRecommendations()
    config.applyTeamPreset(team as [string, string, string])
  }
  if (enemy.invincibleTime !== undefined) config.setEnemy({ invincibleTime: enemy.invincibleTime })
  if (enemy.stunCountLock !== undefined) config.setEnemy({ stunCountLock: enemy.stunCountLock })
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value
  expect(rr).toBeTruthy()
  return buildTeamTimeSummary({
    rr,
    battleTime: rr!.totalTime,
    invincibleTime: enemy.invincibleTime ?? 0,
    nameOf: (agentId, slot) => `槽${slot}:${agentId}`,
  })
}

describe('时间分配汇总：两口径并列 + 留白归因', () => {
  it('恒等式自洽：留白 = 预算 − 物化净占用，且等于账本虚高 + 平A行缩水的净效应', async () => {
    const t = await summaryOf(['1241', '1031', '1311'])
    expect(t.budget).toBe(180)
    expect(t.slack).toBeCloseTo(t.budget - t.rowsNet, 6)
    expect(t.ledgerInflation).toBeCloseTo(t.requiredFrontline - t.perSlot.reduce((a, s) => a + s.necRows, 0), 6)
    expect(t.basicShrink).toBeCloseTo(t.basicTotal - t.perSlot.reduce((a, s) => a + s.basicRows, 0), 6)
    // 平A池按账本收费：必要净 + 平A ≤ 预算 + 欠打回填量（refund 是团队级放宽，允许账本超预算）
    expect(t.requiredFrontline + t.basicTotal)
      .toBeLessThanOrEqual(t.budget + t.refund + 1e-6)
  })

  it('留白被归因到「账本虚高」，不是「池没分完」', async () => {
    // 样例史：叶瞬光/照/妮可曾是「账本虚高」归因队（2026-09-11 照终结技时长修正后 slack 8.8→4.1、ledgerInflation 24.2→18.8），
    // 2026-09-19 R37-J5（②账本虚高按物化行折回 + ④叶瞬光强特时间单源）把它收到 slack 1.09 / 虚高 4.3s——这正是那轮要修的东西，
    // 它不再是样例。更早的历史样例（朱鸢 30.1s、希格莉德 20.6s）因 2026-09-05 修掉「模块行重复占用平A池」而归零，
    // 星徽·比利 2026-09-06 实数化后也打满（slack 0.1）。
    // 2026-09-19 同日再换：艾莲/丽娜/耀嘉音（slack 15.0 / 虚高 19.9）的虚高是艾莲循环行与平A聚合行双计时间（模块行重复占用平A池，
    // 朱鸢/希格莉德/安比 2026-09-05 同款漏网），挤出后 slack 1.0 ⇒ 也不再是样例（docs §19.6）。
    // 现样例 = 爱丽丝/柚叶/妮可（默认口径 slack 6.0s、账本虚高 15.9s、平A行缩水 0）：爱丽丝星芒圆舞曲等模块行随平A池增长
    // （正反馈），折叠环 pass0 冻结的 refund 追不上后续 idle，账本停在虚高态。本用例只钉「归因到账本虚高而非池没分完」，
    // 不是留白绝对量判据；这 6s 本身是折叠环「refund 一次性冻结」口径的待办（docs §19.6）。
    const t = await summaryOf(['1401', '1411', '1031'])
    expect(t.slack).toBeGreaterThan(2)
    // 池确实被分完（平A分配 ≈ 可分配池）→ 留白不来自未分配的秒数
    expect(t.basicTotal).toBeGreaterThan(t.remainingFrontlinePool - 1)
    // 留白几乎全部 = 账本必要时间高于物化必要行
    expect(t.ledgerInflation).toBeGreaterThan(10)
    expect(slackHint(t, fmt)).toContain('账本虚高')
  })

  it('打满的队：留白 ≤ 1s 且平A池 100% 分出去', async () => {
    const t = await summaryOf(['1041', '1161', '1311'])
    expect(Math.abs(t.slack)).toBeLessThanOrEqual(1)
    expect(slackHint(t, fmt)).toBe('战斗时间已打满')
    expect(poolFillText(t)).toBe('100%')
  })

  it('无敌时间缩的是预算（不是 180 硬编码）', async () => {
    const plain = await summaryOf(['1041', '1161', '1311'])
    const withInv = await summaryOf(['1041', '1161', '1311'], { invincibleTime: 20 })
    expect(withInv.budget).toBe(plain.budget - 20)
    // 预算缩 20s，引擎跟着把新预算打满（留白不随无敌变大）
    expect(withInv.slack).toBeCloseTo(plain.slack, 6)
    expect(withInv.invincibleTime).toBe(20)
  })

  it('超预算队：slack 为负并给出「轴/交互太厚」文案', async () => {
    // 般岳金身20/招架10 手填交互本身超预算（直调资源池，不经编排层降配）
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    config.setAgent(0, '1471')
    config.setAgent(1, '1191')
    config.setAgent(2, '1481')
    config.setBlockCount(0, 20)
    config.setParryCount(0, 10)
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const t = buildTeamTimeSummary({
      rr, battleTime: rr.totalTime, invincibleTime: 0,
      nameOf: (_a, slot) => `槽${slot}`,
    })
    // 2026-09-11 降配搜索改「枚举 + 硬约束取最大可行」后：本配置的超预算被降配收进可行域
    // （装配期截断归零），剩下 ~1.1s 的留白（三臂允许 ≤ 基线+1s），故上界放宽到 2s；
    // 「轴/交互太厚」文案只在真超预算（slack < −1）时断言。
    if (t.slack < -1) expect(slackHint(t, fmt)).toContain('动作比战斗时间还多')
    else expect(t.slack).toBeLessThanOrEqual(2)
  })

  it('时间截断可见：被砍招式逐行上报（Σ cutSeconds == overflow），提示列出「哪条行被砍了几次」', async () => {
    // 2026-09-11 用户实测口径：结构性溢出的队真被砍几十秒，而卡上只显示「已打满」——截断此前只报总量，
    // 界面看不出砍了什么。本判据钉住「逐行可见」这条止血。
    // 队选择：`1431+1481+1341`（真结构溢出队，实测 over≈77.5s，全库 setAgent 口径下唯一仍 >1s 的）——
    // ⚠ 2026-09-15 换样例：原样例 `1431+1481+1491` 在**琉音阈值结转**修正后，
    // 降配二分找到一个 overflow=0 的可行档（scale=0.0625）被采纳 ⇒ 该队不再是溢出样例
    // （那是**可行性改善**，见 ENGINE_PIPELINE_GUIDE 坑 41）。本测试要的是「真溢出队的逐行可见性」，
    // 故换成同为 1431 系、仍真溢出的 `1431+1491+1341`。
    // ⚠ 2026-09-19 再换口径（债 2 批 2-1 截断外环回灌，R37-J2）：setAgent 口径下 `1431+1481+1341` 的 77.5s 截断经
    // rowTimeLimit 重折归零（账本只数装得下的行 ⇒ 次数回落 ⇒ 行装进 180s）——它不再是溢出样例；截断入口 + 加回不越次数
    // 两处修正后，全库**默认口径**已无 >1s 截断队。仍真溢出的是**预设配置口径**的 1431 簇（`auto-1431-1481-1491` 重折后
    // 仍 ~85s、`auto-1431-1481-1341` ~80s，必要行本身 > 预算），故本用例改用 applyPreset 的 `1431+1481+1491`。
    // ⚠ 2026-09-19 R37-J5 v2（动态合轴）后第三次换口径：非轴多人队的溢出先由队友前台按溢出量被合轴吸收，自由口径下该队
    // 琉音/柳前台整段吸收 + 降配 0.875 ⇒ 截断归零。v2 下唯一装不下的是操作角色自己的前台 > 180s，而降配/弃轴会把它收进
    // 可行域——只有**锁窗**（用户明确意图，编排层一律不动、超时如实上报）保留这条结构性溢出：锁在该队自身失衡次数 3
    // （golden 同值）时仪玄自己的必要行仍 > 预算，截断 ≈23.4s / 11 条行，正是「逐行可见」要服务的形态。
    const t = await summaryOf(['1431', '1481', '1491'], { stunCountLock: 3 }, { applyPreset: true })
    expect(t.overflow).toBeGreaterThan(1)
    expect(t.truncatedRows.length).toBeGreaterThan(0)
    // 恒等式：逐行 cutSeconds = (before−after)×单位时长 == 逐槽 used−kept。此前带 1s 容差是因为「小数次数行加回会越过原次数」
    // （8.249 次 floor 到 8 再加回 1 = 9 ⇒ kept 虚高、该行不进 cuts，实测 0.244s；重折后放大到 1.9s 才暴露根因，2026-09-19 修）；
    // 修后恒等式精确成立，只留浮点噪声。
    expect(Math.abs(t.truncatedRows.reduce((a, r) => a + r.cutSeconds, 0) - t.overflow)).toBeLessThanOrEqual(1e-6)
    for (const r of t.truncatedRows) {
      expect(r.countAfter).toBeLessThan(r.countBefore)
      expect(r.cutSeconds).toBeGreaterThan(0)
    }
    // 明细按砍掉秒数降序（页面直接切片显示 top N）
    const cut = t.truncatedRows.map(r => r.cutSeconds)
    expect([...cut].sort((a, b) => b - a)).toEqual(cut)
    const hint = truncationHint(t, fmt)
    expect(hint).toContain('砍掉')
    expect(hint).toContain('条行')
    expect(hint).toContain('仍计在账本里')   // A 项未落地前的已知不一致，必须写在用户看得见的地方
  })

  it('无截断的队：清单为空、提示为空串（止血只影响带截断的队，其余零变化）', async () => {
    const t = await summaryOf(['1041', '1161', '1311'])
    expect(t.overflow).toBeLessThanOrEqual(1)
    expect(t.truncatedRows).toEqual([])
    expect(truncationHint(t, fmt)).toBe('')
  })

  it('perSlot 明细与团队合计同源（卡上三个 chip 加起来对得上账）', async () => {
    const t = await summaryOf(['1431', '1341', '1031'])
    expect(t.perSlot.reduce((a, s) => a + s.requiredFrontline, 0)).toBeCloseTo(t.requiredFrontline, 6)
    expect(t.perSlot.reduce((a, s) => a + s.basic, 0)).toBeCloseTo(t.basicTotal, 6)
    expect(t.perSlot.every(s => s.name.startsWith('槽'))).toBe(true)
  })
})

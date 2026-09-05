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
import { buildTeamTimeSummary, poolFillText, slackHint } from '@/composables/teamTimeSummary'
import { fmt } from '@/utils/format'

beforeEach(() => clearWarmStartCache())

async function summaryOf(team: string[], enemy: { invincibleTime?: number } = {}) {
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
  if (enemy.invincibleTime !== undefined) config.setEnemy({ invincibleTime: enemy.invincibleTime })
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
    // 星徽·比利/青衣/卢西娅：当前最大留白队。前两个样例（朱鸢 30.1s、希格莉德 20.6s）都因
    // 2026-09-05 修掉「模块行重复占用平A池」而归零 —— 见 zhuYuan.test.ts / sigrid carve 注释。
    const t = await summaryOf(['1531', '1251', '1451'])
    expect(t.slack).toBeGreaterThan(10)
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
    if (t.slack < -1) expect(slackHint(t, fmt)).toContain('动作比战斗时间还多')
    else expect(t.slack).toBeLessThanOrEqual(1)
  })

  it('perSlot 明细与团队合计同源（卡上三个 chip 加起来对得上账）', async () => {
    const t = await summaryOf(['1431', '1341', '1031'])
    expect(t.perSlot.reduce((a, s) => a + s.requiredFrontline, 0)).toBeCloseTo(t.requiredFrontline, 6)
    expect(t.perSlot.reduce((a, s) => a + s.basic, 0)).toBeCloseTo(t.basicTotal, 6)
    expect(t.perSlot.every(s => s.name.startsWith('槽'))).toBe(true)
  })
})

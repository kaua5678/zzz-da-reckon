/**
 * 倍率表系数演算记录 —— 引擎口径测试。
 *
 * 数据基线：@/data/standardMultiplierTable 的标准职业稀有度倍率表（1级A级社区标准表 +
 * 等级×2/×1.5 + 限定S×1.1 / 常驻S×1.05 / 命破伤害×0.8）。
 * 本文件用 catalog.json 全量数据跑 deriveCoefficientReport，钉住已人工验证的角色纵向系数，
 * 防止标准表常数或聚合口径被无意改动：
 *   - 爱丽丝(1401) 失衡 90%（用户给出口径，实测中位 90.2%）
 *   - 伊德海莉(1051，「章鱼」) 喧响 ~49%（用户给出口径 50%）
 *   - 耀嘉音(1311)/琉音(1481) 回能 50%、叶瞬光(1431) 失衡 50% + 喧响 80%、蕾米埃尔(1581) 喧响 50%
 *   - 悠真(1201) 积蓄 70%、薇薇安(1331) 积蓄 80%、南宫羽(1511) 喧响 90%
 *   - 凯撒(1071)/月城柳(1221) 失衡 ~91%/~91%
 *   - 可琳(1061) A 级基线：五列全部 ≈100%；秽盾列全角色无角色系数
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Agent, AgentSkills } from '@/types/catalog'
import { LEVEL1_TO_LEVEL12 } from '@/core/skillLevel'
import { STANDARD_S_AGENT_IDS } from '@/data/standardMultiplierTable'
import {
  buildDirectDamageTimeline,
  classifyMove,
  deriveCoefficientReport,
  parseEnergyCost,
  type AgentVerticalRow,
  type CoefficientReport,
  type MoveEval,
} from '@/composables/multiplierCoefficients'

const catalogData = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { agents: Agent[]; agentSkills: AgentSkills[] }

const report: CoefficientReport = deriveCoefficientReport(catalogData.agents, catalogData.agentSkills)

function verticalOf(agentId: string): AgentVerticalRow {
  const row = report.vertical.find((v) => v.agentId === agentId)
  expect(row, `角色 ${agentId} 应有纵向系数行`).toBeDefined()
  return row!
}

function coefOf(agentId: string, rowId: string): number {
  const coef = verticalOf(agentId).coefficients[rowId as keyof AgentVerticalRow['coefficients']]
  expect(coef, `角色 ${agentId} 的 ${rowId} 列应有系数（有干净样本）`).toBeDefined()
  return coef!.value
}

function expectNear(actual: number, expected: number, tol: number, label: string): void {
  expect(actual, label).toBeGreaterThan(expected - tol)
  expect(actual, label).toBeLessThan(expected + tol)
}

/** 用户/社区已确认的角色纵向系数（口径钉子） */
const PINNED_COEFFICIENTS: Array<{ agentId: string; agentName: string; rowId: string; value: number; tol: number }> = [
  { agentId: '1401', agentName: '爱丽丝', rowId: 'daze', value: 0.9, tol: 0.02 },
  { agentId: '1401', agentName: '爱丽丝', rowId: 'decibel_recovery', value: 0.7, tol: 0.02 },
  { agentId: '1051', agentName: '伊德海莉(章鱼)', rowId: 'decibel_recovery', value: 0.49, tol: 0.02 },
  { agentId: '1311', agentName: '耀嘉音', rowId: 'energy_recovery', value: 0.5, tol: 0.02 },
  { agentId: '1481', agentName: '琉音', rowId: 'energy_recovery', value: 0.5, tol: 0.02 },
  { agentId: '1431', agentName: '叶瞬光', rowId: 'daze', value: 0.5, tol: 0.02 },
  { agentId: '1431', agentName: '叶瞬光', rowId: 'decibel_recovery', value: 0.8, tol: 0.02 },
  { agentId: '1581', agentName: '蕾米埃尔', rowId: 'decibel_recovery', value: 0.5, tol: 0.02 },
  { agentId: '1201', agentName: '悠真', rowId: 'anomaly_buildup', value: 0.7, tol: 0.02 },
  { agentId: '1331', agentName: '薇薇安', rowId: 'anomaly_buildup', value: 0.8, tol: 0.02 },
  { agentId: '1511', agentName: '南宫羽', rowId: 'decibel_recovery', value: 0.9, tol: 0.02 },
  { agentId: '1071', agentName: '凯撒', rowId: 'daze', value: 0.91, tol: 0.02 },
  { agentId: '1221', agentName: '月城柳', rowId: 'daze', value: 0.91, tol: 0.02 },
  { agentId: '1221', agentName: '月城柳', rowId: 'decibel_recovery', value: 0.9, tol: 0.02 },
]

describe('倍率表系数演算：角色纵向系数', () => {
  it.each(PINNED_COEFFICIENTS)(
    '$agentName($agentId) $rowId ≈ $value',
    ({ agentId, rowId, value, tol }) => {
      expectNear(coefOf(agentId, rowId), value, tol, `${agentId} ${rowId}`)
    },
  )

  it('A 级基线角色可琳五列全部 ≈100%', () => {
    for (const rowId of ['daze', 'energy_recovery', 'decibel_recovery', 'anomaly_buildup', 'ether_purify']) {
      expectNear(coefOf('1061', rowId), 1.0, 0.02, `可琳 ${rowId}`)
    }
  })

  it('秽盾列全角色无角色系数（全部 ≈100%）', () => {
    for (const v of report.vertical) {
      const coef = v.coefficients.ether_purify
      if (!coef) continue
      expect(coef.value, `${v.agentName}(${v.agentId}) 秽盾`).toBeGreaterThan(0.97)
      expect(coef.value, `${v.agentName}(${v.agentId}) 秽盾`).toBeLessThan(1.03)
    }
  })

  it('支援突击锚点：全角色直伤系数中位数 ≈1（偏离者是「版本直伤系数」特例）', () => {
    const dd = report.vertical.map((v) => v.directDamage?.value).filter((x): x is number => x != null)
    expect(dd.length).toBeGreaterThan(50)
    const sorted = [...dd].sort((a, b) => a - b)
    const med = sorted[Math.floor(sorted.length / 2)]
    expect(med).toBeGreaterThan(0.95)
    expect(med).toBeLessThan(1.05)
  })

  it('般岳锚点修正后直伤 ≈1（冲霄已改判闪避反击，昂霄为锚点）；苍角分段合并后直伤 ≈1', () => {
    for (const [agentId, label] of [['1471', '般岳'], ['1131', '苍角']] as const) {
      const ddValue = verticalOf(agentId).directDamage?.value
      expect(ddValue, `${label}应有直伤系数`).toBeDefined()
      expectNear(ddValue!, 1.0, 0.015, `${label} 直伤锚点`)
    }
    // 分段合并标记：苍角「席卷打击」合并为一条
    const xijuan = report.moves.find((m) => m.agentId === '1131' && m.moveName === '支援突击：席卷打击')
    expect(xijuan, '席卷打击合并单元应存在').toBeDefined()
    expect(xijuan!.flags).toContain('支援突击分段已合并')
  })

  it('覆盖全部在册角色', () => {
    expect(report.vertical.length).toBeGreaterThanOrEqual(55)
    expect(report.vertical.length).toBeLessThanOrEqual(catalogData.agents.length)
  })
})

describe('倍率表系数演算：招式分类', () => {
  const mkMove = (overrides: Record<string, unknown>) => overrides as unknown as Parameters<typeof classifyMove>[0]

  it('连携/终结按类别与职业分流', () => {
    const chainMove = mkMove({ name: { zhCN: '连携技：春临 #1' }, timeType: 'normal' })
    expect(classifyMove(chainMove, 'chain', 'anomaly')).toBe('chain')

    const ultMove = mkMove({ name: { zhCN: '终结技：名残雪' }, timeType: 'ultimate' })
    expect(classifyMove(ultMove, 'chain', 'anomaly')).toBe('ultimateAnomaly')
    expect(classifyMove(ultMove, 'chain', 'stun')).toBe('ultimateStun')
    expect(classifyMove(ultMove, 'chain', 'attack')).toBe('ultimateAttack')
  })

  it('assist 类按名称前缀分流，招架 #1/#2/#3 对应轻/重/连续', () => {
    expect(classifyMove(mkMove({ name: { zhCN: '快速支援：云闪' } }), 'assist', 'attack')).toBe('quickAssist')
    expect(classifyMove(mkMove({ name: { zhCN: '支援突击：重睹天日' } }), 'assist', 'support')).toBe('assistFollowUp')
    expect(classifyMove(mkMove({ name: { zhCN: '招架支援：铁壁 #1' } }), 'assist', 'defense')).toBe('parryLight')
    expect(classifyMove(mkMove({ name: { zhCN: '招架支援：铁壁 #2' } }), 'assist', 'defense')).toBe('parryHeavy')
    expect(classifyMove(mkMove({ name: { zhCN: '招架支援：铁壁 #3' } }), 'assist', 'defense')).toBe('parryChain')
  })

  it('强化特殊技看 energyCost 或名称前缀；冲刺攻击在 dodge/basic 类都能识别', () => {
    expect(classifyMove(mkMove({ id: 'x1', name: { zhCN: '强化特殊技：飞雪 #1' }, energyCost: { 'Energy Cost': '40' } }), 'special', 'anomaly')).toBe('exSpecial')
    expect(classifyMove(mkMove({ id: 'x2', name: { zhCN: '强化特殊技：归烬·天坠' } }), 'special', 'rupture')).toBe('exSpecial')
    expect(classifyMove(mkMove({ id: 'x3', name: { zhCN: '特殊技：飞雪' } }), 'special', 'anomaly')).toBe('special')
    expect(classifyMove(mkMove({ id: 'x4', name: { zhCN: '冲刺攻击：冬蜂' } }), 'dodge', 'attack')).toBe('dashAttack')
    expect(classifyMove(mkMove({ id: 'x5', name: { zhCN: '普通攻击：扫除开始 #3' }, skillTags: ['dashAttack'] }), 'basic', 'attack')).toBe('dashAttack')
  })

  it('定点分类覆盖：般岳「支援突击：冲霄」实为闪避反击公式（金身格挡后招式，时间 −1.5s）', () => {
    expect(classifyMove(mkMove({ id: '1471029', name: { zhCN: '支援突击：冲霄' } }), 'assist', 'rupture')).toBe('dodgeCounter')
    // 锚点由「支援突击：昂霄」承担：与支援突击公式五列比值 ≈1.000
    const axiao = report.moves.find((m) => m.moveId === '1471026')
    expect(axiao, '昂霄应在演算结果中').toBeDefined()
    for (const rowId of ['damage', 'daze', 'decibel_recovery', 'anomaly_buildup']) {
      const cell = axiao!.cells.find((c) => c.rowId === rowId)
      expect(cell, `昂霄 ${rowId} 格应存在`).toBeDefined()
      expectNear(cell!.ratio, 1.0, 0.01, `昂霄 ${rowId}`)
    }
    // 冲霄有效时间 = 2.667 − 1.5 = 1.167s：秽盾 150+100×1.167=266.7 精确相等，积蓄/喧响 ≈1.000；
    // 伤害/失衡为 ~0.94/~0.93（般岳自身特调，偏差清单呈现）
    const cxiao = report.moves.find((m) => m.moveId === '1471029')
    expect(cxiao, '冲霄应在演算结果中').toBeDefined()
    expectNear(cxiao!.t ?? 0, 1.167, 0.001, '冲霄有效时间')
    for (const [rowId, expected] of [['ether_purify', 1.0], ['anomaly_buildup', 1.0], ['decibel_recovery', 1.0], ['damage', 0.94], ['daze', 0.93]] as const) {
      const cell = cxiao!.cells.find((c) => c.rowId === rowId)
      expect(cell, `冲霄 ${rowId} 格应存在`).toBeDefined()
      expectNear(cell!.ratio, expected, 0.01, `冲霄 ${rowId}`)
    }
  })

  it('真斗「孤影·断獠」改判闪避反击：纯 t 列（喧响/积蓄）精确命中，无支援突击锚点', () => {
    // 用户口径：弹刀后连续攻击，结构同闪反（只有 t 项）。喧响 27.5t / 积蓄 100t 两列 ≈1.000；
    // 伤害/失衡/秽盾为各段自有数值。改判后真斗不再有支援突击 → 直伤系数记 null。
    for (const moveId of ['1441024', '1441025']) {
      const move = report.moves.find((m) => m.moveId === moveId)
      expect(move, `断獠段 ${moveId} 应在演算结果中`).toBeDefined()
      expect(move!.moveType).toBe('dodgeCounter')
      for (const rowId of ['decibel_recovery', 'anomaly_buildup']) {
        const cell = move!.cells.find((c) => c.rowId === rowId)
        expect(cell, `断獠 ${moveId} ${rowId} 格应存在`).toBeDefined()
        expectNear(cell!.ratio, 1.0, 0.01, `断獠 ${moveId} ${rowId}`)
      }
    }
    expect(verticalOf('1441').directDamage, '真斗已无支援突击，直伤应为 —').toBeNull()
  })

  it('招架常数数据校准后两段比值中位数 ≈1（主簇中位 95.511/95.178）', () => {
    const medOf = (moveType: string, rowId: string, minSamples: number) => {
      const ratios = report.moves
        .filter((m) => m.moveType === moveType)
        .flatMap((m) => m.cells.filter((c) => c.rowId === rowId).map((c) => c.ratio))
        .sort((a, b) => a - b)
      expect(ratios.length, `${moveType} ${rowId} 应有样本`).toBeGreaterThan(minSamples)
      return ratios[Math.floor(ratios.length / 2)]
    }
    expectNear(medOf('parryLight', 'daze', 40), 1.0, 0.01, '轻招架失衡')
    expectNear(medOf('parryHeavy', 'daze', 40), 1.0, 0.01, '重招架失衡')
    expectNear(medOf('parryChain', 'daze', 20), 1.0, 0.01, '连续招架失衡')
  })

  it('parseEnergyCost 取首个非持续项数值并区分闪能', () => {
    expect(parseEnergyCost(mkMove({ energyCost: { 'Energy Cost': '60' } }))).toEqual({ value: 60, kind: 'energy' })
    expect(parseEnergyCost(mkMove({ energyCost: { 'Activation Energy Cost': '40', 'Charged Attack Energy Cost': '20 Energy/sec' } }))).toEqual({ value: 40, kind: 'energy' })
    expect(parseEnergyCost(mkMove({ energyCost: { 'Energy Cost': '20 Energy/s' } }))).toBeNull()
    expect(parseEnergyCost(mkMove({ energyCost: { 'Flash Energy Cost': '40' } }))).toEqual({ value: 40, kind: 'flashEnergy' })
  })
})

describe('倍率表系数演算：强化特殊技（逐段评估，不参与纵向聚合）', () => {
  function exMovesOf(agentId: string): MoveEval[] {
    return report.moves.filter((m) => m.agentId === agentId && m.moveType === 'exSpecial')
  }

  it('露西(A级, 每段独立计60耗能)各段伤害比值 ≈1', () => {
    const dmg = exMovesOf('1151').flatMap((m) => m.cells.filter((c) => c.rowId === 'damage').map((c) => c.ratio))
    expect(dmg.length).toBe(2)
    for (const r of dmg) {
      expect(r).toBeGreaterThan(0.95)
      expect(r).toBeLessThan(1.05)
    }
  })

  it('不做整套合并：妮可 4 段保持逐段记录', () => {
    expect(exMovesOf('1031').length).toBe(4)
  })

  it('缺耗能标注的强特带标记', () => {
    const flagged = report.moves.filter((m) => m.moveType === 'exSpecial' && m.flags.includes('缺耗能标注'))
    expect(Array.isArray(flagged)).toBe(true)
  })

  it('闪能质量×1.2：般岳「山摇」(闪能20) 比值 ≈ 手算值', () => {
    // 手算：伤害 (5.55835×20×1.2 + 140×0.65)×2×1.1×0.8(命破) = 394.94 → 342.9/394.94 ≈ 0.868
    //       喧响 (1.909×20×1.2 + 41.25×0.65) = 72.63 → 53.5425/72.63 ≈ 0.737
    const move = report.moves.find((m) => m.agentId === '1471' && m.moveName === '强化特殊技：山摇')
    expect(move, '般岳山摇应在演算结果中').toBeDefined()
    expect(move!.flags).toContain('闪能消耗(质量×1.2)')
    const ratioOf = (rowId: string) => {
      const cell = move!.cells.find((c) => c.rowId === rowId)
      expect(cell, `山摇 ${rowId} 格应存在`).toBeDefined()
      return cell!.ratio
    }
    expectNear(ratioOf('damage'), 0.868, 0.01, '山摇 damage')
    expectNear(ratioOf('decibel_recovery'), 0.737, 0.01, '山摇 decibel')
  })

  it('真斗锚点：强特(闪能80)代入 ×1.2 规则后五列比值全部 ≈1', () => {
    // 真斗是最接近纯闪能转化的命破角色（用户口径），耗能 80 点经 nanoka param「闪能消耗: 80点」
    // 确认并由 scripts/patch-move-energy-cost.mjs 录入。手算（A 级无稀有度系数、命破伤害×0.8）：
    //   伤害 (5.55835×80×1.2 + 140×2.017)×2×0.8 = 1305.57 → 1306/1305.57 ≈ 1.0003
    //   失衡 (4.175×80×1.2 + 130×2.017)×1.5     = 994.52  → 993.3/994.52 ≈ 0.9988
    //   喧响 (1.909×80×1.2 + 41.25×2.017)       = 266.47  → ≈1.0002；积蓄/秽盾同样 ≈1.000
    const zd = report.moves.find((m) => m.moveId === '1441015')
    expect(zd, '真斗强特 归烬·天坠 应在演算结果中').toBeDefined()
    expect(zd!.flags).toContain('闪能消耗(质量×1.2)')
    expect(zd!.flags).not.toContain('缺耗能标注')
    for (const rowId of ['damage', 'daze', 'decibel_recovery', 'anomaly_buildup', 'ether_purify']) {
      const cell = zd!.cells.find((c) => c.rowId === rowId)
      expect(cell, `真斗强特 ${rowId} 格应存在`).toBeDefined()
      expectNear(cell!.ratio, 1.0, 0.01, `真斗强特 ${rowId}（闪能×1.2 锚点）`)
    }
  })
})

describe('倍率表系数演算：等级换算常量', () => {
  it('1级→12级：伤害×2、失衡×1.5（与 core/skillLevel 同源）', () => {
    expect(LEVEL1_TO_LEVEL12.damage).toBeCloseTo(2, 10)
    expect(LEVEL1_TO_LEVEL12.daze).toBeCloseTo(1.5, 10)
  })
})

describe('倍率表系数演算：限定S首次UP × 版本直伤系数（时间图表页数据源）', () => {
  const points = buildDirectDamageTimeline(catalogData.agents, catalogData.agentSkills)

  it('覆盖全部限定 S 角色，常驻 S 不参与', () => {
    const limitedS = catalogData.agents.filter((a) => a.rarity === 'S' && !STANDARD_S_AGENT_IDS.has(String(a.id)))
    expect(points.length).toBe(limitedS.length)
    expect(points.find((p) => p.agentId === '1021'), '猫又是常驻S，不应出现').toBeUndefined()
    expect(points.every((p) => p.nodeIndex >= 0)).toBe(true)
  })

  it('按首次 UP 节点序排序；叶瞬光(2.5 合并池) 直伤 ≈×1.27', () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i].nodeIndex).toBeGreaterThanOrEqual(points[i - 1].nodeIndex)
    }
    const ysg = points.find((p) => p.agentId === '1431')
    expect(ysg, '叶瞬光应在散点中').toBeDefined()
    expect(ysg!.nodeId).toBe('2.5')
    expectNear(ysg!.value ?? 0, 1.274, 0.02, '叶瞬光直伤系数')
  })

  it('早期角色 ≈ 标准、3.2 测试服节点带备注；佩洛伊斯为 3.0 上半赠送 S', () => {
    const yixuan = points.find((p) => p.agentId === '1371')
    expect(yixuan!.nodeId).toBe('2.0-1')
    expectNear(yixuan!.value ?? 0, 1.0, 0.03, '仪玄直伤系数')
    const peiroysi = points.find((p) => p.agentId === '1551')
    expect(peiroysi, '佩洛伊斯应在散点中').toBeDefined()
    expect(peiroysi!.nodeId).toBe('3.0-1')
    const testServer = points.filter((p) => p.nodeId === '3.2-1')
    expect(testServer.length).toBeGreaterThan(0)
    expect(points.find((p) => p.agentId === '1551' && p.nodeId === '3.2-1')).toBeUndefined()
    expect(testServer.every((p) => (p.nodeNote ?? '').includes('测试服'))).toBe(true)
  })
})

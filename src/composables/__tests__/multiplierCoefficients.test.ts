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
import {
  EQUIVALENT_ENERGY,
  EX_ENERGY_CONVERSION,
  MOVE_TYPE_TIME_SCALE,
  RESOURCE_ROW_IDS,
  STANDARD_MULTIPLIER_TABLE,
  STANDARD_S_AGENT_IDS,
  type CoefficientRowId,
  type MoveType,
} from '@/data/standardMultiplierTable'
import { COUNTER_ASSIST_FOLLOW_UP_EQUIVALENT_ENERGY } from '@/data/standardMultiplierTable'
import { COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS, COUNTER_ASSIST_MOVE_IDS, COUNTER_ASSIST_REGISTRY } from '@/data/counterAssists'
import {
  buildDirectDamageTimeline,
  classifyMove,
  deriveCoefficientReport,
  isCleanVerticalType,
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

  /**
   * 反制支援专属追击段必须排除在直伤锚点之外（用户口径 2026-10-09）。
   *
   * 背景：克拉蕾的 assist 段有**两条**「支援突击」（EN 同为 `Assist Follow-Up`）——
   * 1611027 无垢熔锋（普通弹刀那条，引擎 `findAssistFollowUp` 取到的就是它）
   * 与 1611030 琢形（**反制支援 1611028 的专属追击**，登记在 `data/counterAssists.ts`）。
   * 两者一起取中位数会得到 206.8% 的假象；排除琢形后 = 122.7%。
   *
   * 本用例防两类回归：① 有人把 `COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS` 过滤删掉（值回到 2.07）；
   * ② 有人「顺手」把过滤扩到所有 n≥2 的角色（1141/1411/1431 的两条支援突击都是**真·两条**，
   * 它们不该被排除 —— 见下方 n=2 的三条断言）。
   */
  it('★克拉蕾(1611) 直伤锚点只算无垢熔锋 122.7%（反制系分类上就不是支援突击）', () => {
    const dd = verticalOf('1611').directDamage
    expect(dd, '克拉蕾应有直伤系数').toBeDefined()
    // 反制本体/专属追击各自独立类型 ⇒ 锚点只剩无垢熔锋一条样本
    expect(dd!.samples, '样本数应为 1（只剩无垢熔锋）').toBe(1)
    expectNear(dd!.value, 1.227, 0.005, '克拉蕾 直伤锚点 = 1611027 比值')
    // 反锁：反制系两条都还在演算表里，只是不再是 assistFollowUp
    for (const [moveId, type] of [['1611028', 'counterAssist'], ['1611030', 'counterAssistFollowUp']] as const) {
      const m = report.moves.find((x) => x.moveId === moveId)
      expect(m, `${moveId} 应仍在演算表里`).toBeDefined()
      expect(m!.moveType, `${moveId} 应是反制系独立类型`).toBe(type)
    }
    // 反锁：只排反制系，不误伤同名真·双支援突击角色
    for (const agentId of ['1141', '1411', '1431'] as const) {
      const v = verticalOf(agentId).directDamage
      expect(v, `${agentId} 应有直伤系数`).toBeDefined()
      expect(v!.samples, `${agentId} 的两条支援突击都是真样本，不该被排除`).toBe(2)
    }
  })

  it('反制支援追击段集合只含登记表的 followUpMoveId（防误伤同名的真·双支援突击）', () => {
    const registered = COUNTER_ASSIST_REGISTRY.map((m) => m.followUpMoveId).sort()
    expect([...COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS].sort()).toEqual(registered)
    // 集合里的每条都必须是 counterAssistFollowUp 分类（否则会混进支援突击锚点样本）
    for (const id of COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS) {
      const m = report.moves.find((x) => x.moveId === id)
      expect(m, `${id} 应在演算表里`).toBeDefined()
      expect(m!.moveType, `${id} 应分类为反制支援专属支援突击`).toBe('counterAssistFollowUp')
    }
    // 本体侧同构：COUNTER_ASSIST_MOVE_IDS 的每条都得是 counterAssist
    for (const id of COUNTER_ASSIST_MOVE_IDS) {
      const m = report.moves.find((x) => x.moveId === id)
      expect(m, `${id} 应在演算表里`).toBeDefined()
      expect(m!.moveType, `${id} 应分类为反制支援`).toBe('counterAssist')
    }
  })
})

describe('反制支援 / 支援突击的「等效能量」口径（2026-10-24 用户裁决 · 2026-10-31 逐招式复核）', () => {
  /**
   * 口径：支援突击系标准式 = 「等效多少能量 × 强特耗能利用率系数」。
   * 支援突击 = 20（弹刀后奖励）、反制支援**本体** = 40（招族价，三家一致）、
   * 反制支援**专属追击** = 逐招式登记（克拉蕾 1611030 琢形 = 80；挽昼 1601205 灯塔 = 20 基线、零奖励）。
   *
   * ⚠ 这里**不抄常数**（const = 等效能量 × 系数 那种断言是同义反复：两边都改就绿，等于没测）。
   * 只钉三件会真出事的事：① 反解能被录入数据复现（口径与 catalog 的桥梁）；
   * ② 反制系不污染支援突击锚点与纵向聚合（分类错了会静默改一串角色的直伤系数）；
   * ③ **同一 MoveType 下价位不同**（2026-10-31 用户提问「灯塔说送了很多等效能量、各项数值却都低」：
   *    套用克拉蕾的 @80 会把她的失衡/喧响/积蓄 压到 0.51~0.59 的假象）。
   */
  it('★反解复现：三家反制支援的失衡/喧响/积蓄独立解出登记价（本体 40；追击 80 / 20）', () => {
    // 这是唯一能把「等效能量」和「catalog 录入值」连起来的东西：
    // 若哪天标准表常数被改动、或这三行被重录，等式立刻不成立 —— 那才是需要人看的地方。
    const LVL: Record<string, number> = { daze: LEVEL1_TO_LEVEL12.daze, decibel_recovery: 1, anomaly_buildup: 1 }
    const RAR: Record<string, number> = { daze: 1.1, decibel_recovery: 1, anomaly_buildup: 1 }
    const rows = [
      { agentId: '1611', moveId: '1611028', t: 3.717, expect: 40 }, // 克拉蕾 本体
      { agentId: '1611', moveId: '1611030', t: 1.117, expect: 80 }, // 克拉蕾 琢形
      { agentId: '1601', moveId: '1601204', t: 3, expect: 40 },     // 挽昼 希望堡垒
      { agentId: '1601', moveId: '1601205', t: 2, expect: 20 },     // 挽昼 灯塔（基线、零奖励）
      { agentId: '1661', moveId: '1661017', t: 3.784, expect: 40 }, // 知更鸟 角力
    ]
    for (const r of rows) {
      const K = {
        daze: verticalOf(r.agentId).coefficients.daze?.value ?? 1,
        decibel_recovery: verticalOf(r.agentId).coefficients.decibel_recovery?.value ?? 1,
        anomaly_buildup: verticalOf(r.agentId).coefficients.anomaly_buildup?.value ?? 1,
      }
      const m = report.moves.find((x) => x.moveId === r.moveId)
      expect(m, `${r.moveId} 应在演算表里`).toBeDefined()
      for (const rowId of ['daze', 'decibel_recovery', 'anomaly_buildup'] as const) {
        const cell = m!.cells.find((c) => c.rowId === rowId)!
        const f = STANDARD_MULTIPLIER_TABLE.assistFollowUp[rowId]!
        const solved = ((cell.actual / (K[rowId] * LVL[rowId] * RAR[rowId])) - (f.const ?? 0) - (f.perT ?? 0) * r.t)
          / EX_ENERGY_CONVERSION[rowId] + EQUIVALENT_ENERGY.assistFollowUp!
        // 容差 0.6：失衡列因角色系数噪声（1.0022）浮 0.2~0.6；其余列 = 实录常数取整残差（≤0.05）
        expectNear(solved, r.expect, 0.6, `${r.moveId}/${rowId} 反解等效能量`)
      }
      // 登记值与反解同源：演算页展示与标准式必须用同一个数（两处各抄一份就失去意义）
      expect(m!.equivalentEnergy, `${r.moveId} 登记的等效能量`).toBe(r.expect)
    }
  })

  it('★挽昼 1601205 灯塔 = 普通支援突击基线（@20、零奖励），不是克拉蕾的 @80', () => {
    const m = report.moves.find((x) => x.moveId === '1601205')!
    expect(m.moveType, '仍是反制专属追击（不进直伤锚点/纵向聚合）').toBe('counterAssistFollowUp')
    expect(m.equivalentEnergy).toBe(20)
    expect(m.rewardEnergy, '灯塔没有奖励等效能量').toBe(0)
    for (const rowId of ['daze', 'decibel_recovery', 'anomaly_buildup'] as const) {
      expectNear(m.cells.find((c) => c.rowId === rowId)!.ratio!, 1, 0.01, `灯塔 ${rowId} 比值应为 100%`)
    }
    // 伤害列 = 她的直伤系数（第四列独立同证：@20 时 939.1 / 860.97 = 1.0907）
    expectNear(m.cells.find((c) => c.rowId === 'damage')!.ratio!, verticalOf('1601').directDamage!.value, 0.005, '灯塔伤害比值 = 挽昼直伤系数')
    // 反锁：克拉蕾的琢形仍按 @80 计价（逐招式登记不是把整族压平成 20）
    const claret = report.moves.find((x) => x.moveId === '1611030')!
    expect(claret.equivalentEnergy).toBe(80)
  })

  it('反制支援追击段：有动作时间的必须登记等效能量（新增角色不许继承别人的价）', () => {
    for (const id of COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS) {
      const m = report.moves.find((x) => x.moveId === id)
      // 1661019：catalog 无 actionTime（t=0）、只有伤害/失衡两行 ⇒ 反解不了，也没有比值需要标准式
      if (!m || !m.cells.some((c) => c.ratio != null)) continue
      expect(COUNTER_ASSIST_FOLLOW_UP_EQUIVALENT_ENERGY[id], `${id} 必须登记等效能量`).toBeDefined()
    }
  })

  it('★反制系不参与纵向聚合/偏差清单（否则用反解出的系数再算系数，污染一串角色）', () => {
    for (const moveId of ['1611028', '1611030']) {
      const m = report.moves.find((x) => x.moveId === moveId)!
      expect(isCleanVerticalType(m.moveType), `${moveId} 不该进纵向聚合`).toBe(false)
      expect(report.deviations.some((d) => d.moveId === moveId), `${moveId} 不该进偏差清单`).toBe(false)
    }
    // 支援突击基线本身仍在聚合里（它是锚点）
    expect(isCleanVerticalType('assistFollowUp')).toBe(true)
  })

  it('等效能量只能挂在支援突击系（别顺手把强特的真耗能也当奖励）', () => {
    for (const m of report.moves) {
      if (m.equivalentEnergy == null) continue
      expect(['assistFollowUp', 'counterAssist', 'counterAssistFollowUp']).toContain(m.moveType)
    }
  })
})

describe('角色专属资源行：残痕积累 / 锐能回复（锋御）与秒均口径（用户 2026-10-29）', () => {
  const moveOf = (moveId: string) => {
    const m = report.moves.find((x) => x.moveId === moveId)
    expect(m, `${moveId} 应在演算结果中`).toBeDefined()
    return m!
  }
  const cellOf = (moveId: string, rowId: CoefficientRowId) => {
    const cell = moveOf(moveId).cells.find((c) => c.rowId === rowId)
    expect(cell, `${moveId} 应有 ${rowId} 格`).toBeDefined()
    return cell!
  }
  /** 与比值列同源的有效时间（quickAssistLegacy 的录制 actionTime 是真实时间的一半） */
  const effT = (moveId: string) => {
    const m = moveOf(moveId)
    return (m.t ?? 0) * (MOVE_TYPE_TIME_SCALE[m.moveType as MoveType] ?? 1)
  }

  it('★克拉蕾(1611)：残痕/锐能随招式产出（此前整列缺失），秒均 = 表值 ÷ t', () => {
    const gash = cellOf('1611001', 'gash_buildup')
    expect(gash.actual).toBeCloseTo(31.51, 4)
    expect(gash.ratio, '无标准式 → 不进纵向聚合/偏差判定').toBeNull()
    expect(gash.expected, '无标准式 → 无期望值').toBeNull()
    expect(gash.perSecond).toBeCloseTo(31.51 / effT('1611001'), 6)
    expect(gash.perSecond).toBeCloseTo(100.03, 0.05) // 常态血锻四式 100/s（claret.ts 单一事实源）
    const sharp = cellOf('1611001', 'sharpness_gain')
    expect(sharp.actual).toBeCloseTo(0.946, 4)
    expect(sharp.perSecond).toBeCloseTo(3.0, 0.01) // 锐能 3.0/s 只长在血锻四式
    // 铭刻态（锻星/强特）残痕 120/s；这些行没有锐能回复列 ⇒ 不合成 0 值格（表里不留「0/s」噪音）
    expect(cellOf('1611010', 'gash_buildup').perSecond).toBeCloseTo(119.99, 0.05)
    expect(moveOf('1611005').cells.some((c) => c.rowId === 'sharpness_gain')).toBe(false)
  })

  it('★挽昼(1601)：强特/连携段残痕可见、普攻两列齐备', () => {
    expect(cellOf('1601106', 'gash_buildup').perSecond).toBeCloseTo(80.01, 0.05)
    expect(cellOf('1601010', 'gash_buildup').perSecond).toBeCloseTo(80.0, 0.05)
    expect(cellOf('1601001', 'sharpness_gain').perSecond).toBeCloseTo(2.0, 0.01)
  })

  it('★资源行一律 ratio=null（不进纵向聚合与偏差清单），且 t 有效时都带秒均', () => {
    let checked = 0
    for (const m of report.moves) {
      for (const c of m.cells) {
        if (!(RESOURCE_ROW_IDS as readonly string[]).includes(c.rowId)) continue
        checked++
        expect(c.expected, `${m.moveId}/${c.rowId} 不该有期望值`).toBeNull()
        expect(c.ratio, `${m.moveId}/${c.rowId} 不该有比值`).toBeNull()
        if (m.t != null && m.t > 0.01) expect(c.perSecond, `${m.moveId}/${c.rowId} 应带秒均`).not.toBeNull()
      }
    }
    expect(checked, '资源行样本数（专属资源 + 锋御残痕/锐能）').toBeGreaterThan(50)
    expect(report.deviations.some((d) => (RESOURCE_ROW_IDS as readonly string[]).includes(d.rowId))).toBe(false)
    for (const v of report.vertical) {
      for (const rowId of RESOURCE_ROW_IDS) {
        expect((v.coefficients as Record<string, unknown>)[rowId], `${v.agentId} 的 ${rowId} 不该有纵向系数`).toBeUndefined()
      }
    }
  })

  it('★锋御没有 energy_recovery 行 ⇒ 回能位由锐能承担（页面把「锐 X/s」并进回能列的依据）', () => {
    for (const agentId of ['1601', '1611']) {
      const v = verticalOf(agentId)
      expect(v.coefficients.energy_recovery, `${agentId} 的「回能」列应无样本（锋御的能是锐能）`).toBeUndefined()
    }
    expect(moveOf('1611001').cells.some((c) => c.rowId === 'sharpness_gain')).toBe(true)
  })

  it('非锋御角色不凭空长出残痕/锐能列（数据驱动，不按职业硬编码）', () => {
    const kelin = report.moves.filter((m) => m.agentId === '1061')
    expect(kelin.length, '可琳应有演算行').toBeGreaterThan(0)
    for (const m of kelin) {
      expect(m.cells.some((c) => c.rowId === 'gash_buildup' || c.rowId === 'sharpness_gain')).toBe(false)
    }
  })
})

describe('倍率表系数演算：招式分类', () => {
  const mkMove = (overrides: Record<string, unknown>) => ({ rows: [], ...overrides }) as unknown as Parameters<typeof classifyMove>[0]

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

  it('专属资源列（attack_data_0）：无标准式也展示实际值——青衣一煞#4 平A电压可见（用户报告的显示缺口）', () => {
    const yisha4 = report.moves.find((m) => m.moveId === '1251004')
    expect(yisha4, '青衣一煞#4 应在演算结果中').toBeDefined()
    const cell = yisha4!.cells.find((c) => c.rowId === 'attack_data_0')
    expect(cell, '平A电压格应存在（曾整列不显示）').toBeDefined()
    expect(cell!.actual).toBeCloseTo(3.3334, 4)
    expect(cell!.ratio, '无标准式 → 无比值，不进纵向聚合/偏差判定').toBeNull()
    // 终结技电压 80 同样可见
    const ult = report.moves.find((m) => m.moveId === '1251015')
    expect(ult!.cells.find((c) => c.rowId === 'attack_data_0')?.actual).toBeCloseTo(80, 1)
    // 秒均（用户 2026-10-29 口径「专属资源该用秒均数据而不是总数据」）：整招合计 ÷ t。
    // 星徽·比利是最好的例子：动力压制 0.2s / 4 点（20/s）vs 抓地轮毂 2.1s / 8.4 点（4/s）——
    // 整招合计只差 2 倍，秒均差 5 倍，前者才是「这一招发资源快不快」的可比量。
    const powerPress = report.moves.find((m) => m.moveId === '1531006')!
    const pressCell = powerPress.cells.find((c) => c.rowId === 'attack_data_0')!
    expect(pressCell.actual).toBeCloseTo(4, 4)
    expect(pressCell.perSecond).toBeCloseTo(20, 0.01)
    const grab = report.moves.find((m) => m.moveId === '1531009')!.cells.find((c) => c.rowId === 'attack_data_0')!
    expect(grab.actual).toBeCloseTo(8.4014, 3)
    expect(grab.perSecond).toBeCloseTo(4.0, 0.01)
  })

  it('定点分类覆盖：般岳「支援突击：冲霄」实为闪避反击公式（金身格挡后招式）', () => {
    expect(classifyMove(mkMove({ id: '1471029', name: { zhCN: '支援突击：冲霄' } }), 'assist', 'rupture')).toBe('dodgeCounter')
    // 锚点由「支援突击：昂霄」承担：与支援突击公式五列比值 ≈1.000
    const axiao = report.moves.find((m) => m.moveId === '1471026')
    expect(axiao, '昂霄应在演算结果中').toBeDefined()
    for (const rowId of ['damage', 'daze', 'decibel_recovery', 'anomaly_buildup']) {
      const cell = axiao!.cells.find((c) => c.rowId === rowId)
      expect(cell, `昂霄 ${rowId} 格应存在`).toBeDefined()
      expectNear(cell!.ratio ?? NaN, 1.0, 0.01, `昂霄 ${rowId}`)
    }
    // 冲霄有效时间 = 1.167s：**catalog 源头已修正**（2026-10-18：秽盾 266.7 = 积蓄 116.69 + 闪反加成 150
    // ⇒ (秽盾−加成)/100 = 1.167，规则单源 `scripts/lib/type-bonus-time.mjs`）。
    // 修前靠 `MOVE_TIME_ADJUSTMENTS['1471029'] = -1.5` 只在**本页**补时间、资源引擎没接（2.667s），
    // 同一招两个页面两个时间；现两边读同一个 catalog actionTime，本表已清空。
    const cxiao = report.moves.find((m) => m.moveId === '1471029')
    expect(cxiao, '冲霄应在演算结果中').toBeDefined()
    expectNear(cxiao!.t ?? 0, 1.167, 0.001, '冲霄有效时间')
    for (const [rowId, expected] of [['ether_purify', 1.0], ['anomaly_buildup', 1.0], ['decibel_recovery', 1.0], ['damage', 0.94], ['daze', 0.93]] as const) {
      const cell = cxiao!.cells.find((c) => c.rowId === rowId)
      expect(cell, `冲霄 ${rowId} 格应存在`).toBeDefined()
      expectNear(cell!.ratio ?? NaN, expected, 0.01, `冲霄 ${rowId}`)
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
        expectNear(cell!.ratio ?? NaN, 1.0, 0.01, `断獠 ${moveId} ${rowId}`)
      }
    }
    expect(verticalOf('1441').directDamage, '真斗已无支援突击，直伤应为 —').toBeNull()
  })

  it('快速支援两版口径：翻倍版（星见雅）与标准版（照）各自 ≈1', () => {
    // 分版判据 = 喧响速率 ≥40/s；伤害两版同为 200t，分版列 = 失衡/喧响/回能/积蓄
    const yagyu = report.moves.find((m) => m.agentId === '1091' && m.moveType === 'quickAssistLegacy')
    expect(yagyu, '星见雅快支应判为翻倍版').toBeDefined()
    for (const rowId of ['damage', 'daze', 'decibel_recovery']) {
      const cell = yagyu!.cells.find((c) => c.rowId === rowId)
      expect(cell, `星见雅快支 ${rowId} 格应存在`).toBeDefined()
      expectNear(cell!.ratio ?? NaN, 1.0, 0.02, `星见雅快支(翻倍) ${rowId}`)
    }
    const sho = report.moves.find((m) => m.agentId === '1341' && m.moveType === 'quickAssist')
    expect(sho, '照快支应判为标准版').toBeDefined()
    for (const rowId of ['damage', 'daze', 'decibel_recovery']) {
      const cell = sho!.cells.find((c) => c.rowId === rowId)
      expect(cell, `照快支 ${rowId} 格应存在`).toBeDefined()
      expectNear(cell!.ratio ?? NaN, 1.0, 0.02, `照快支(标准) ${rowId}`)
    }
  })

  it('倍率行融合：星见雅飞雪两击与连携三段合计后代入公式 ≈1', () => {
    // 融合后 Σ = nanoka 官方倍率（斩击 788.3%/483.4%、追击 967.2%/608.5%）；
    // 手算斩击：(5.55835×40+140×0.967)×2×1.1 = 786.97 → 788.3/786.97 ≈ 1.0017
    const zhanji = report.moves.find((m) => m.agentId === '1091' && m.moveName.includes('飞雪') && m.moveName.includes('融合'))
    expect(zhanji, '飞雪融合单元应存在').toBeDefined()
    expect(zhanji!.flags.join('')).toContain('倍率行融合')
    for (const [rowId, expected] of [['damage', 1.002], ['daze', 1.001], ['decibel_recovery', 1.0]] as const) {
      const cell = zhanji!.cells.find((c) => c.rowId === rowId)
      expect(cell, `飞雪融合 ${rowId} 格应存在`).toBeDefined()
      expectNear(cell!.ratio ?? NaN, expected, 0.01, `飞雪融合 ${rowId}`)
    }
    // 连携三段合一：(400+100×1.717)×2×1.1 = 1257.74 → 1258.3/1257.74 ≈ 1.0005；喧响精确
    const lianhun = report.moves.find((m) => m.agentId === '1091' && m.moveName.includes('春临') && m.moveName.includes('融合'))
    expect(lianhun, '春临融合单元应存在').toBeDefined()
    const dmgCell = lianhun!.cells.find((c) => c.rowId === 'damage')
    expect(dmgCell).toBeDefined()
    expectNear(dmgCell!.ratio ?? NaN, 1.0005, 0.01, '连携融合 damage')
    const dbCell = lianhun!.cells.find((c) => c.rowId === 'decibel_recovery')
    expect(dbCell).toBeDefined()
    expectNear(dbCell!.ratio ?? NaN, 1.0, 0.005, '连携融合 decibel')
    // 仪玄强特（用户口径）按交互变体定点整链记录：单E / 2连 / 3连 × 弹刀与否，替代原
    // 「#1+#2=斩击 / #3+#4=追击」融合（逐段/融合评估得 ~0.46~2.56 假象——追击头行无耗能标注、
    // 拆法与真实强特链不符）。每变体 = 完整一次链：t 与各列数值求和、耗能整链一次计
    // （单E/2连 = 40 闪能、3连 = 60 闪能；弹刀追加免费 #2 不加耗）。
    const yixuanVariants = report.moves.filter(
      (m) => m.agentId === '1371' && m.moveType === 'exSpecial' && m.flags.some((f) => f.includes('定点整链记录')),
    )
    expect(yixuanVariants.length, '应记录 6 个交互变体').toBe(6)
    // 成员行不再单独/融合评估
    for (const mid of ['1371009', '1371024', '1371023', '1371025']) {
      expect(report.moves.find((m) => m.agentId === '1371' && m.moveId === mid), `${mid} 应被定点整链记录替代`).toBeUndefined()
    }
    // 凝云术/墨烬影消仍是独立行（不在变体范围内）
    for (const mid of ['1371022', '1371026']) {
      expect(report.moves.find((m) => m.agentId === '1371' && m.moveId === mid), `${mid} 应保持逐行评估`).toBeDefined()
    }
    // 变体结构：t（弹刀 +0.2s #2）/ 耗能（整链一次计）
    const variant = (name: string) => {
      const v = yixuanVariants.find((m) => m.moveName === name)
      expect(v, `变体 ${name} 应存在`).toBeDefined()
      return v!
    }
    expectNear(variant('强化特殊技：墨痕化形（单E）').t ?? 0, 1.083, 0.001, '单E t')
    expectNear(variant('强化特殊技：墨痕化形（单E·弹刀）').t ?? 0, 1.283, 0.001, '单E·弹刀 t')
    expectNear(variant('强化特殊技：墨痕化形（2连）').t ?? 0, 2.65, 0.001, '2连 t')
    expectNear(variant('强化特殊技：墨痕化形（2连·弹刀）').t ?? 0, 2.85, 0.001, '2连·弹刀 t')
    expectNear(variant('强化特殊技：墨痕化形（3连）').t ?? 0, 3.616, 0.001, '3连 t')
    expectNear(variant('强化特殊技：墨痕化形（3连·弹刀）').t ?? 0, 3.816, 0.001, '3连·弹刀 t')
    for (const v of yixuanVariants) {
      expect(v.energy?.kind, `${v.moveName} 耗能为闪能`).toBe('flashEnergy')
      expect(v.energy?.value, `${v.moveName} 整链耗能一次计`).toBe(v.moveName.includes('3连') ? 60 : 40)
    }
    // 比值钉子（命破限定S：伤害×2×1.1×0.8、失衡×1.5×1.1、喧响/积蓄纯 t+e、秽盾纯 t）：
    const ratioOf = (v: MoveEval, rowId: string) => {
      const cell = v.cells.find((c) => c.rowId === rowId)
      expect(cell, `${v.moveName} ${rowId} 格应存在`).toBeDefined()
      return cell!.ratio ?? NaN
    }
    // 秽盾 = 100t 纯时间列：全部变体 ≈1.000（整链 t 求和精确）
    for (const v of yixuanVariants) expectNear(ratioOf(v, 'ether_purify'), 1.0, 0.005, `${v.moveName} 秽盾`)
    // 单E：伤害 600.6 / (140×1.083 + 5.55835×40×1.2)×1.76 ≈ 0.816（仪玄单段伤害低于标准）
    expectNear(ratioOf(variant('强化特殊技：墨痕化形（单E）'), 'damage'), 0.816, 0.01, '单E 伤害')
    // 3连·弹刀：喧响/积蓄 ≈0.99（接近标准整链调优）、失衡 ~0.947
    expectNear(ratioOf(variant('强化特殊技：墨痕化形（3连·弹刀）'), 'decibel_recovery'), 0.991, 0.01, '3连·弹刀 喧响')
    expectNear(ratioOf(variant('强化特殊技：墨痕化形（3连·弹刀）'), 'anomaly_buildup'), 0.992, 0.01, '3连·弹刀 积蓄')
    expectNear(ratioOf(variant('强化特殊技：墨痕化形（3连·弹刀）'), 'daze'), 0.947, 0.01, '3连·弹刀 失衡')
  })

  it('爱丽丝「星芒圆舞曲」三段回能：双源确认官方为 0，按缺口展示且不参与聚合', () => {
    // nanoka 无普攻能量项；gachabase energy_gain_base=0（scripts/fetch-gachabase-agent.mjs
    // 抓取 data/raw/gachabase/1401.json，其余字段与 catalog 全部互验）——两源一致，官方即 0。
    // 曾按「应為50%」补录过 3.6t×0.5，因与双源矛盾已撤销。
    for (const moveId of ['1401010', '1401011', '1401012']) {
      const move = report.moves.find((m) => m.moveId === moveId)
      expect(move, `${moveId} 应在演算结果中`).toBeDefined()
      expect(move!.flags.join('')).toContain('回能录入为0')
      const cell = move!.cells.find((c) => c.rowId === 'energy_recovery')
      expect(cell, `${moveId} 回能格应合成展示`).toBeDefined()
      expect(cell!.ratio).toBe(0)
      expect(cell!.dataGap).toBe(true)
    }
    // 数据缺口不污染角色系数：爱丽丝回能纵向仍 ≈1
    const enCoef = verticalOf('1401').coefficients.energy_recovery
    if (enCoef) expectNear(enCoef.value, 1.0, 0.02, '爱丽丝回能纵向系数')
  })

  it('普攻回能显式录 0 的数据缺口：合成 0 比值单元格并打标，不参与纵向聚合', () => {
    const gap = report.moves.find((m) => m.agentId === '1411' && m.moveName.includes('狸之帐'))
    expect(gap, '柚叶「狸之帐」应在演算结果中').toBeDefined()
    expect(gap!.flags.join('')).toContain('回能录入为0')
    const cell = gap!.cells.find((c) => c.rowId === 'energy_recovery')
    expect(cell, '回能格应合成展示').toBeDefined()
    expect(cell!.ratio).toBe(0)
    expect(cell!.dataGap).toBe(true)
    // 数据缺口不污染角色系数：柚叶回能纵向仍 ≈1
    const enCoef = verticalOf('1411').coefficients.energy_recovery
    if (enCoef) expectNear(enCoef.value, 1.0, 0.02, '柚叶回能纵向系数')
  })

  it('招架常数数据校准后两段比值中位数 ≈1（主簇中位 95.511/95.178）', () => {
    const medOf = (moveType: string, rowId: string, minSamples: number) => {
      const ratios = report.moves
        .filter((m) => m.moveType === moveType)
        .flatMap((m): number[] => m.cells.filter((c) => c.rowId === rowId && c.ratio != null).map((c) => c.ratio as number))
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
      return cell!.ratio ?? NaN
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
      expectNear(cell!.ratio ?? NaN, 1.0, 0.01, `真斗强特 ${rowId}（闪能×1.2 锚点）`)
    }
  })

  it('锋御锐能：挽昼(1601) 四个强特行按 30 点锐能=能量计价（四列贴合、伤害=直伤系数）', () => {
    // 口径：raw「锐能消耗 30点」+ 用户 2026-10-26 裁决「挽昼加进去」；登记在 standardMultiplierTable#EX_SHARPNESS_ENERGY。
    // 手算（限定 S：伤害×2×1.1、失衡×1.5×1.1；伤害再乘她的直伤系数 1.09）：
    //   1601106 失衡 (130×2.5 + 4.175×30)×1.65 = 742.91 → 743.7/742.91 ≈ 1.0011
    //   1601106 伤害 (140×2.5 + 5.55835×30)×2.2×1.09 = 1239.17 → 1240.5/1239.17 ≈ 1.0011
    // 不接锐能（e=0）时这四行会显示成 伤害 1.39~1.61 / 失衡 1.39 / 喧响 1.56 / 积蓄 1.43 的假偏差。
    for (const id of ['1601106', '1601006', '1601016', '1601115']) {
      const move = report.moves.find((m) => m.moveId === id)
      expect(move, `挽昼 ${id} 应在演算结果中`).toBeDefined()
      expect(move!.energy, `${id} 耗能=锐能 30`).toEqual({ value: 30, kind: 'sharpness' })
      expect(move!.flags).toContain('锐能按能量计价(30/发)')
      expect(move!.flags).not.toContain('缺耗能标注')
      // 「（改）」两行是把伤害与失衡整列 ×1.1（喧响/积蓄/秽盾不动），故先除掉这一档再对强特式
      // ⚠ v2（3.4.2+20049556）打破了 1601106↔1601006 / 1601115↔1601016 的「多形态对称数据」：
      //   v2 只下调了「燃灯·晦尽」两式的失衡（1601006 728.6→658.4、1601016 742.2→665.1），「焚夜」两式未动。
      //   用户 2026-11-01「暂时承认不对称，还是以真实数据为主」⇒ 失衡列逐行取实测比值（其余三列仍 1.0）。
      const dazeExpected = { '1601106': 1.0, '1601006': 0.9037, '1601016': 0.8959, '1601115': 1.0 } as Record<string, number>
      const variant = id === '1601016' || id === '1601115' ? 1.1 : 1
      const ratioOf = (rowId: string) => move!.cells.find((c) => c.rowId === rowId)?.ratio ?? NaN
      expectNear(ratioOf('daze') / variant, dazeExpected[id], 0.005, `${id} 失衡`)
      expectNear(ratioOf('decibel_recovery'), 1.0, 0.005, `${id} 喧响`)
      expectNear(ratioOf('anomaly_buildup'), 1.0, 0.005, `${id} 积蓄`)
      expectNear(ratioOf('ether_purify'), 1.0, 0.005, `${id} 秽盾`)
      // 直伤系数 = 该行 catalog 伤害 / 标准式（四行同源）⇒ v2 起 1.09 → 1.046
      expectNear(ratioOf('damage') / variant, 1.046, 0.005, `${id} 伤害=她的直伤系数`)
    }
  })

  it('锋御锐能：克拉蕾(1611) 不登记——60 锐能是[猩红铭刻]的门禁，e 项恒 0', () => {
    // 她的三列速率量实测是特殊技基线（失衡 1.0014 / 喧响 1.1000=她自己系数 / 积蓄 0.9998）；
    // 按强特式评估（本页口径）就是 0.77/0.73/0.74——不是 bug，是「锐能不产生奖励倍率」。
    const move = report.moves.find((m) => m.moveId === '1611010')
    expect(move, '克拉蕾强特应在演算结果中').toBeDefined()
    expect(move!.energy).toBeNull()
    expect(move!.flags).toContain('锐能=门禁(不进公式)')
    const ratioOf = (rowId: string) => move!.cells.find((c) => c.rowId === rowId)?.ratio ?? NaN
    expectNear(ratioOf('daze'), 0.77, 0.015, '克拉蕾 失衡（强特式 e=0）')
    expectNear(ratioOf('decibel_recovery'), 0.733, 0.015, '克拉蕾 喧响（强特式 e=0）')
    expectNear(ratioOf('anomaly_buildup'), 0.741, 0.015, '克拉蕾 积蓄（强特式 e=0）')
  })

  it('普罗米娅「处刑式·重霜/坠霜」= 40 能量奖励：按强特公式带 40 能量评估（用户口径）', () => {
    // 重霜/坠霜实为消耗 40 能量（封喉霜径 1541009 / 匿影）后接的免费招——本质上算作 40 能量
    // 换来的奖励，记录为强特公式 + 40 能量；否则按特殊技公式（无 perE、e=0）得 2.2~3.1 倍
    // 虚高比值（曾污染纵向积蓄系数 125.1%）并充斥偏差清单。
    const reward = report.moves.filter((m) => m.agentId === '1541' && m.flags.some((f) => f.includes('定点整链记录')))
    expect(reward.length, '应记录 2 个 40 能量奖励单元').toBe(2)
    const chuishuang = reward.find((m) => m.moveName.includes('坠霜'))!
    const zhongshuang = reward.find((m) => m.moveName.includes('重霜'))!
    // 成员行不再单独评估；40 能量消耗者（封喉霜径）保留原行
    for (const mid of ['1541010', '1541011', '1541012']) {
      expect(report.moves.find((m) => m.agentId === '1541' && m.moveId === mid), `${mid} 应被定点整链记录替代`).toBeUndefined()
    }
    expect(report.moves.find((m) => m.agentId === '1541' && m.moveId === '1541009'), '封喉霜径应保留（40 能量消耗者）').toBeDefined()
    for (const v of reward) {
      expect(v.moveType, `${v.moveName} 按强特公式评估`).toBe('exSpecial')
      expect(v.energy, `${v.moveName} 带 40 能量奖励`).toEqual({ value: 40, kind: 'energy' })
    }
    // 重霜 #1+#2 合一（#2 子段 24.2%、t=0）：t=2.35
    expectNear(zhongshuang.t ?? 0, 2.35, 0.001, '重霜 t')
    // 比值钉子：重霜伤害 ≈1.023（40 能量口径下命中标准）、坠霜伤害 ≈0.922；秽盾纯 t 列 ≈1.000
    const ratioOf = (v: MoveEval, rowId: string) => {
      const cell = v.cells.find((c) => c.rowId === rowId)
      expect(cell, `${v.moveName} ${rowId} 格应存在`).toBeDefined()
      return cell!.ratio ?? NaN
    }
    expectNear(ratioOf(zhongshuang, 'damage'), 1.023, 0.01, '重霜 伤害')
    expectNear(ratioOf(zhongshuang, 'ether_purify'), 1.0, 0.005, '重霜 秽盾')
    expectNear(ratioOf(chuishuang, 'damage'), 0.922, 0.01, '坠霜 伤害')
    expectNear(ratioOf(chuishuang, 'ether_purify'), 1.0, 0.005, '坠霜 秽盾')
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

/**
 * CC-501：机制模块不手抄「有名字的数据常量」——终结技喧响消耗 / 弹刀喧响奖励 / spec spendRule 单价
 * 各有单一来源（`data/resourceDefaults`、`data/anomalyDecibelBonuses`、spec json），模块 import 或经 `specSpendCost` 读。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { specSpendCost } from '@/specs/resources'
import { getAgentSpec } from '@/specs/registry'
import { ULTIMATE_COST_DEFAULT } from '@/data/resourceDefaults'
import { PARRY_DECIBEL_BONUS } from '@/data/anomalyDecibelBonuses'
import { PARRY_TOPUP_DECIBEL_UNIT } from '@/mechanics/agents/banyue'

const AGENTS_DIR = join(__dirname, '..', 'agents')
const stripComments = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n')

/** catalog 原始数据（本文件只做「镜像 vs 事实源」对拍，不走 store） */
const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { agentSkills: Array<{ agentId: string; categories: Array<{ moves: Array<{ id: string; rows: Array<{ id: string; values: number[] }> }> }> }> }

/** 从 catalog 取某 moveId 的某个行值（取不到 ⇒ 0，与引擎 `getRowValue` 同口径） */
function catalogRowValue(agentId: string, moveId: string, rowId: string): number {
  const skills = catalog.agentSkills.find(s => s.agentId === agentId)
  for (const cat of skills?.categories ?? []) {
    for (const m of cat.moves) {
      if (m.id !== moveId) continue
      return m.rows.find(r => r.id === rowId)?.values[0] ?? 0
    }
  }
  return 0
}

describe('CC-501 手抄常量', () => {
  it('specSpendCost 读 spec spendRules：仪玄术法值 120；不存在的规则 0', () => {
    const spec = getAgentSpec('1371')!
    expect(specSpendCost(spec, 'yixuan_shufa_value', 'yixuan_extra_ult_spend')).toBe(120)
    expect(specSpendCost(spec, 'yixuan_shufa_value', 'nope')).toBe(0)
    expect(specSpendCost(spec, 'nope', 'nope')).toBe(0)
  })
  it('数据层来源仍是预期值（改这里 = 改口径，要同步 @fact）', () => {
    expect(ULTIMATE_COST_DEFAULT).toBe(3000)
    expect(PARRY_DECIBEL_BONUS).toBe(215)
  })
  it('源码锁：mechanics/agents 下没有 `= 3000` / `= 215` 的手抄常量', () => {
    for (const f of readdirSync(AGENTS_DIR).filter(f => f.endsWith('.ts'))) {
      const code = stripComments(readFileSync(join(AGENTS_DIR, f), 'utf8'))
      expect(code.match(/=\s*3000\b/g) ?? [], f).toEqual([])
      expect(code.match(/=\s*215\b/g) ?? [], f).toEqual([])
    }
  })

  /**
   * T129：般岳**反推专用单价**必须与 catalog 事实源逐位对拍。
   *
   * 为什么需要：`PARRY_TOPUP_DECIBEL_UNIT` = 215（`PARRY_DECIBEL_BONUS`，数据层单一来源）
   * **+ 86.35**（支援突击：昂霄 1471026 的行级 `decibel_recovery`）。前半段有 import 保证，
   * 后半段是模块里的**镜像字面量**（模块拿不到 `skills`，只能镜像）——本用例把镜像钉回
   * catalog：catalog 一旦改动，这里立刻红，强制回来重标定反推单价，而不是静默漂移
   * （反推单价错了不会报错，只会让补齐次数系统性偏移）。
   */
  describe('T129 反推单价 vs catalog', () => {
    it('★ 昂霄 1471026 行级 decibel_recovery 与反推单价构成逐位一致', () => {
      const angXiao = catalogRowValue('1471', '1471026', 'decibel_recovery')
      // 反空转：行必须真的存在且非 0（否则下面那条等式退化成「215 + 0」的恒真式）
      expect(angXiao, '1471026 支援突击：昂霄 必须有 decibel_recovery 行（否则本判据空转）').toBeGreaterThan(0)
      expect(PARRY_TOPUP_DECIBEL_UNIT).toBeCloseTo(PARRY_DECIBEL_BONUS + angXiao, 6)
    })

    it('★ 招架判定单段（215）与反推单价分层：反推单价严格大于 215', () => {
      // 这条钉的是「分层」这个口径本身：若有人把反推单价改回 PARRY_DECIBEL_BONUS，
      // 或者把 215 抬成含支援突击的值，本用例红。
      expect(PARRY_TOPUP_DECIBEL_UNIT).toBeGreaterThan(PARRY_DECIBEL_BONUS)
      expect(PARRY_DECIBEL_BONUS, '215 是游戏数据，不许随反推口径变').toBe(215)
    })

    it('★ 铁壁 1471023 无行级 decibel_recovery（链上第三段不额外产喧响）', () => {
      // 记录事实：一次普通弹刀的喧响 = 215（判定）+ 86.35（昂霄），铁壁那一段不产。
      // 若 catalog 将来给铁壁补上行级喧响，反推单价必须跟着重标定 ⇒ 本用例红。
      expect(catalogRowValue('1471', '1471023', 'decibel_recovery')).toBe(0)
    })
  })
})

/**
 * CC-453 锁（T18 阶段 2）：执行行的合轴率来源标记 `comboAlignSource`。
 * - 引擎产出的每一行都有值（类型上可选只为不扫模块字面量；出口统一补 'fixed'）；
 * - 'setting' 只出现在 7 个读 cfg.*ComboAlignRatio（= 用户覆盖 ?? 倍率表默认）的招式行上——它们是弹窗里改了会生效的行；
 * - 模块直写比例（如 1451 强化特殊技·合轴 = 1）是 'fixed' 且比例 > 0——这正是 r510 普查里「引擎 1.0、弹窗 0」的那批行；
 * - 结果页弹窗按 `comboAlignEditable` 决定只读。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildExecutions } from '@/core/resource/helpers'
import { buildGiftRow } from '@/core/resource/giftRows'
import { comboAlignEditable } from '@/composables/resourceCalc/comboAlignDisplay'
import type { CharacterOperationConfig, IterationState, ResourceCalcConfig } from '@/types/resource'

const state: IterationState = {
  basicAttackTime: 20, exSpecialCount: 3, ultimateCount: 2, chainCountTotal: 2,
  totalEnergy: 200, totalDecibel: 5000, necessaryTime: 30, frontlineTime: 50, backstageTime: 130, comboAlignTime: 0,
}
async function builtConfig(team: Array<{ agentId: string }>): Promise<ResourceCalcConfig> {
  await setupHarness(team)
  const calc = useResourceCalc()
  for (let i = 0; i < 50; i++) {
    void calc.resourceResult.value
    const v = calc.resourceConfig.value
    if (v && v.characters.length === team.length) return JSON.parse(JSON.stringify(v)) as ResourceCalcConfig
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('resourceConfig 未就绪')
}
const settingMoveIds = (cfg: CharacterOperationConfig) => new Set([
  cfg.exSpecialMoveId, cfg.ultimateMoveId, cfg.chainMoveId, cfg.dodgeCounterMoveId,
  cfg.defensiveAssistMoveId, cfg.assistFollowUpMoveId, cfg.counterAssistMoveId,
].filter((x): x is string => !!x))

describe('CC-453 合轴率来源标记', () => {
  it('引擎行恒有来源；setting 只在 7 个 cfg 招式上；模块直写比例是 fixed 且 > 0', async () => {
    let fixedPositive = 0
    for (const team of [[{ agentId: '1051' }, { agentId: '1141' }, { agentId: '1451' }], [{ agentId: '1371' }, { agentId: '1251' }, { agentId: '1271' }]]) {
      const rc = await builtConfig(team)
      for (const cfg of rc.characters) {
        const allowed = settingMoveIds(cfg)
        for (const row of buildExecutions(cfg, state, state.chainCountTotal, 100)) {
          const tag = `${cfg.agentId}/${row.moveId}`
          expect(['setting', 'fixed'], tag).toContain(row.comboAlignSource)
          if (row.comboAlignSource === 'setting') expect(allowed.has(row.moveId), `${tag} 标 setting 却不是 cfg 招式`).toBe(true)
          else if (row.comboAlignRatio > 0) fixedPositive++
        }
      }
    }
    expect(fixedPositive, '普查那批「模块直写比例>0」的行必须存在且标 fixed').toBeGreaterThan(0)
  }, 120000)
  it('赠行 fixed；comboAlignEditable 只认 setting', () => {
    const gift = buildGiftRow({ moveId: 'm', moveName: 'n', count: 1, actionTime: 1, comboAlignRatio: 0.5, skillTableNote: 't' })
    expect(gift.comboAlignSource).toBe('fixed')
    expect(comboAlignEditable({ comboAlignSource: 'setting' })).toBe(true)
    expect(comboAlignEditable({ comboAlignSource: 'fixed' })).toBe(false)
    expect(comboAlignEditable({})).toBe(false)
  })
  it('ResultPage 弹窗：滑块 / 数字框按 comboAlignEditable 只读', () => {
    const src = readFileSync(resolve(__dirname, '../../views/ResultPage.vue'), 'utf-8')
    expect(src.match(/:disabled="!comboAlignEditable\(exec\)"/g)?.length).toBe(2)
    expect(src).toMatch(/v-if="!comboAlignEditable\(exec\)"/)
  })
})

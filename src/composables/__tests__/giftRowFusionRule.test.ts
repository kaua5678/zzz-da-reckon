/**
 * CC-239：编排层赠送 / 手放行吃逻辑编辑器行规则（作用面裁决见 docs/mcp-stun-dual-source.md §24.85 ④：
 * 规则作用于「该招式该行」的一切倍率表取值）。
 *
 * 修前：`ultimatePromote`（转大赠送终结技）/ `chainGift`（赠送连携）的单段回落、赠送终结技失衡值、
 * `damagePoolDirect` 失衡轴手放表直伤都取原始 `values[0]`——而同函数里的多段分支 `fusedRowValue` 与 helpers 主执行
 * 路径都吃规则 ⇒ 同一招「自己放」吃、「被赠送」不吃，且多段/单段终结技被赠送时口径不同。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import type { RowFusionRule } from '@/logicEditor/types'

afterEach(() => setActiveRowFusionRules([]))

/** resourceCalc/ 下允许的内联原始行读取（每处须有裁决）：文件 → 允许条数 */
const RAW_ROW_READ_ALLOW: Record<string, number> = {
  // 平A均值族（averageBasicRows 等），下一轮裁决（交接 §2）
  'skillRows.ts': 3,
  // 按元素累加 anomaly_buildup 判定角色积蓄属性——分类启发式而非计算量，用户倍率规则不应翻转属性（§24.86 不做）
  'panelPhases.ts': 1,
}

describe('CC-239 编排层赠送 / 手放行吃行规则', () => {
  it('行为：被赠送终结技（琉音转大 → 希格莉德 1591016）damage 行规则 ×2 ⇒ 赠送行倍率 ×2', async () => {
    const giftDm = async (rules: RowFusionRule[]) => {
      await setupHarness([{ agentId: '1591' }, { agentId: '1481' }, { agentId: '1211' }], { recommendedBuild: true })
      setActiveRowFusionRules(rules)
      const rr = useResourceCalc().resourceResult.value!
      const row = rr.characters.flatMap(c => c.executions ?? []).find(e => e.source === 'gift' && e.moveId === '1591016')
      expect(row, '琉音队存在 1591016 赠送行').toBeTruthy()
      return row!.damageMultiplier ?? 0
    }
    const base = await giftDm([])
    expect(base).toBeGreaterThan(0)
    const doubled = await giftDm([{ id: 't', name: 't', agentId: '1591', moveId: '1591016', rowId: 'damage', multiplier: 2, enabled: true, note: '' }])
    expect(doubled).toBeCloseTo(base * 2, 6)
  })

  it('源码：resourceCalc/ 内联原始行读取（.values[0]）只允许出现在登记位置', () => {
    const dir = resolve(__dirname, '../resourceCalc')
    const counts: Record<string, number> = {}
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue
      const n = readFileSync(join(dir, name), 'utf-8').split('\n')
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .filter(l => /\.values\??\.?\[0\]/.test(l)).length
      if (n > 0) counts[name] = n
    }
    expect(counts).toEqual(RAW_ROW_READ_ALLOW)
  })
})

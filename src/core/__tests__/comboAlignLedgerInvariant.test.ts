/**
 * CC-455 锁（T19 阶段 1 候选 C，普查稿 `docs/mcp-combo-align-ledger-census.md` §4 / §6.4）：
 * **执行行上声明的合轴率必须被账本兑现。**
 *
 * 背景：引擎不读 `exec.comboAlignRatio` 抵扣团队预算（`core/resource/helpers.ts` 账本只认
 * `extraNecessaryAction` / `estimateExSpecialTime` / 7 个 cfg setting 招式 / 赠行）。模块若只在行上写比例、
 * 不接任何 credit 口，比例就是死数据——CC-454 爱丽丝每队白占 18~21s 前台、伤害低估 10~20%，靠人读数才发现。
 *
 * 不变量（每个角色单人 c0 / c6）：
 *   Σ_{fixed 行, ratio > 0, totalTime > 0} count × actionTime × ratio ≤ timeAllocation.comboAlignCredit + netAllowance + ε
 * - `totalTime > 0` 过滤掉后台行 / 0 时长行（蕾米埃尔 Radiant Turn、仪玄玄墨行）：它们的 ratio=1 是「不占前台」的展示语义，不需要 credit；
 * - `netAllowance` = 模块 `estimateExSpecialTime` 声明 `comboAlignIncludedInNecessary === false`（NET 约定：合轴段已不在
 *   necessaryTime 内）时的 `comboAlignTime`——**唯一豁免口，由模块自己声明**，这里不写任何 id 名单；
 * - `setting` 行不在本锁范围（引擎经 cfg 读比例，CC-453 边界）。
 * 回滚：删本文件（不改引擎、不改行形状，无 zd / golden / ratchet 影响）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics/registry'
import type { CharacterOperationConfig } from '@/types/resource'

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
const agentIds: string[] = (catalogData.agents ?? []).map((a: { id: number | string }) => String(a.id))
const EPS = 1e-6

async function builtSlot0(agentId: string, cinemaLevel: number) {
  await setupHarness([{ agentId, cinemaLevel }])
  const calc = useResourceCalc()
  for (let i = 0; i < 50; i++) {
    const rr = calc.resourceResult.value
    const rc = calc.resourceConfig.value
    if (rr && rc && rc.characters.length >= 1) return { c: rr.characters[0], cfg: rc.characters[0] as CharacterOperationConfig }
    await new Promise(r => setTimeout(r, 10))
  }
  return null
}

describe('CC-455 行上合轴率必须被账本兑现', () => {
  it('Σ fixed 前台行 count×actionTime×ratio ≤ comboAlignCredit + NET 声明量', async () => {
    const violations: string[] = []
    let covered = 0
    for (const agentId of agentIds) {
      for (const cinemaLevel of [0, 6]) {
        const got = await builtSlot0(agentId, cinemaLevel)
        if (!got) continue
        const { c, cfg } = got
        let potential = 0
        const parts: string[] = []
        for (const r of c.executions) {
          if (r.comboAlignSource !== 'fixed') continue
          const ratio = r.comboAlignRatio ?? 0
          if (!(ratio > 0) || !((r.totalTime ?? 0) > 0)) continue
          const v = r.count * r.actionTime * ratio
          potential += v
          parts.push(`${r.moveId}:${r.count}×${r.actionTime}×${ratio.toFixed(3)}=${v.toFixed(3)}`)
        }
        if (potential <= 0) continue
        covered++
        const credit = c.timeAllocation.comboAlignCredit ?? 0
        const est = getAgentMechanic(agentId)?.estimateExSpecialTime?.({ cfg, exSpecialCount: c.exSpecialCount, ultimateCount: c.ultimateCount })
        const netAllowance = est && est.comboAlignIncludedInNecessary === false ? Math.max(0, est.comboAlignTime) : 0
        if (potential > credit + netAllowance + EPS) {
          violations.push(`${agentId} c${cinemaLevel}: 声明 ${potential.toFixed(3)}s > credit ${credit.toFixed(3)} + NET ${netAllowance.toFixed(3)} [${parts.join(' ')}]`)
        }
      }
    }
    expect(violations, '行上写了合轴率但账本没兑现（CC-454 类死数据）——接 extraNecessaryAction / estimateExSpecialTime，或模块声明 NET：\n' + violations.join('\n')).toEqual([])
    expect(covered, '至少应有角色带 fixed 前台合轴行（否则本锁空转）').toBeGreaterThan(0)
  }, 240_000)
})

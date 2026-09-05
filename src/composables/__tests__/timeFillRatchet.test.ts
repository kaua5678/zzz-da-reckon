/**
 * 时间留白棘轮护栏（AGENT 规则 9/12：把「吃不满战斗时间」从裸奔变成机器判据）。
 *
 * 背景：`convergence.timeBudgetIdleSeconds` 与「预算 − 物化前台净占用」的留白此前**零测试引用**，
 * 而 `timeBudgetConverged=true` / `residual=0` 会让「账本虚高 93.7s、动作只打 86s」看起来完全健康。
 * 本文件按预设库逐队跑真实资源池，把留白与超预算钉进 `timeFillRatchet.baseline.json`：
 * - **存量冻结、只拦新增/变差**（与 check-guards 的 useResourceCalc agentId 棘轮同一手法）；
 * - 修好之后跑 `TIME_RATCHET_UPDATE=1 npx vitest run src/composables/__tests__/timeFillRatchet.test.ts`
 *   重生成基线（diff 即「这次改动买回多少秒」的度量）；
 * - 新预设没有基线条目 → 红，逼你显式认领（而不是悄悄引入新的留白）。
 *
 * 口径：队伍用**手动队默认**（`config.setAgent` → 角色专属默认 > 正反馈排除 > 职业基准），
 * 不套预设的 interactions/命座——本护栏量的是引擎时间系统，不是预设保真度。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'

const BASELINE_FILE = new URL('./timeFillRatchet.baseline.json', import.meta.url)
/** 容差：量化（floor 次数）残差 ~1s 属引擎既有口径（坑12/19），不追求精确 0 */
const TOLERANCE = 1.0

interface RatchetEntry { slack: number; over: number }

type RatchetBaseline = Record<string, RatchetEntry>

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as RatchetBaseline

/** 逐队跑一遍真实资源池，量留白（打不满）与超预算（打太多） */
async function measure(team: string[]): Promise<RatchetEntry> {
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value
  expect(rr, `队伍 ${team.join('/')} 资源池未产出结果`).toBeTruthy()
  const t = buildTeamTimeSummary({
    rr: rr!, battleTime: rr!.totalTime,
    invincibleTime: config.enemy.invincibleTime ?? 0,
    nameOf: (_a, slot) => `槽${slot}`,
  })
  // 保留一位小数：浮点末位不参与棘轮（同配置两次全新计算逐位一致由 determinism.test 管）
  return {
    slack: Math.round(Math.max(0, t.slack) * 10) / 10,
    over: Math.round(Math.max(0, -t.slack) * 10) / 10,
  }
}

describe('时间留白棘轮（存量冻结、只拦变差）', () => {
  const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)

  it('每队留白/超预算不超过基线；新预设必须显式认领', async () => {
    const measured: Record<string, RatchetEntry> = {}
    const regressions: string[] = []
    const missing: string[] = []
    for (const p of presets) {
      const key = p.id
      const m = await measure(p.team)
      measured[key] = m
      const b = baseline[key]
      if (!b) { missing.push(`${key} 留白=${m.slack}s 超预算=${m.over}s`); continue }
      if (m.slack > b.slack + TOLERANCE) regressions.push(`${key} 留白 ${b.slack}s → ${m.slack}s`)
      if (m.over > b.over + TOLERANCE) regressions.push(`${key} 超预算 ${b.over}s → ${m.over}s`)
    }
    if (process.env.TIME_RATCHET_UPDATE === '1') {
      const header = { _note: '时间留白棘轮基线（秒）。重生成：TIME_RATCHET_UPDATE=1 npx vitest run src/composables/__tests__/timeFillRatchet.test.ts', _tolerance: TOLERANCE }
      const sorted = Object.fromEntries(Object.entries(measured).sort((a, b) => a[0].localeCompare(b[0])))
      writeFileSync(BASELINE_FILE, JSON.stringify({ ...header, ...sorted }, null, 1) + '\n', 'utf8')
      console.log(`基线已重生成：${Object.keys(sorted).length} 队，留白合计 ${Object.values(measured).reduce((a, m) => a + m.slack, 0).toFixed(0)}s`)
      return
    }
    expect(missing, `新预设缺基线条目（跑 TIME_RATCHET_UPDATE=1 认领）:\n${missing.join('\n')}`).toEqual([])
    expect(regressions, `时间留白变差（若为有意改动，重生成基线并在提交说明里写清）:\n${regressions.join('\n')}`).toEqual([])
  }, 600_000)
})

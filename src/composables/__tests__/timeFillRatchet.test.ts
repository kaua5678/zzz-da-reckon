/**
 * 时间留白棘轮 + **吸引盆护栏**（AGENT 规则 9/12：把「吃不满战斗时间」与「失衡归零」从裸奔变成机器判据）。
 *
 * 吸引盆护栏为什么必须在这里：本引擎是 `平A时间→回能→次数→必要时间→可分配时间→平A时间`
 * 的耦合离散系统，**任何**对收敛动力学的改动（折叠语义、回填、封顶、松弛）都可能把某支队伍
 * 从"能失衡"推进 `stunCount=0` 的吸引盆——实测 2026-09-05 一次会话里连撞 5 次（欠打回填门槛
 * 降到 5s、折叠阻尼松弛、pass0 保留旧语义…全都让 `runArchiveDeploy` 那支队失衡 116k→9.5k）。
 * 当时没有任何测试会因此变红，只有人肉跑全量才发现；而基线是 **124 队 stunCount 全 >0、
 * outerExit 无 maxIter**，所以这条断言零例外、零额外耗时（复用同一次扫描）。
 *
 * **覆盖边界（别高估它）**：本护栏只扫预设库。实测把回填门槛降到 1s 会让部署样本
 * （星见雅/南宫羽/柚叶 对基塔布鲁 690431 期）失衡 116k→0，而**这条断言不红**——那支队不在
 * 预设库里，抓到它的是 `runArchiveDeploy.test.ts`。改收敛动力学后仍要跑全量，不要只信这里。
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

interface RatchetEntry { slack: number; over: number; stun: number; outerExit: string }

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
    stun: calc.stunPoolResult.value?.stunCount ?? 0,
    outerExit: rr!.convergence?.outerExit ?? '—',
  }
}

describe('时间留白棘轮（存量冻结、只拦变差）', () => {
  const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)

  it('每队留白/超预算不超过基线；新预设必须显式认领', async () => {
    const measured: Record<string, RatchetEntry> = {}
    const regressions: string[] = []
    const missing: string[] = []
    const basins: string[] = []
    for (const p of presets) {
      const key = p.id
      const m = await measure(p.team)
      measured[key] = m
      // 吸引盆护栏：失衡归零 / 外层耗尽迭代上限 = 收敛动力学被改坏（零例外，基线 124 队全过）
      if (m.stun <= 0) basins.push(`${key} stunCount=${m.stun}（掉进 0 失衡吸引盆）`)
      if (m.outerExit === 'maxIter') basins.push(`${key} outerExit=maxIter（外层不动点耗尽上限）`)
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
    expect(basins, `吸引盆护栏（改收敛动力学的改动必须先过这条）:\n${basins.join('\n')}`).toEqual([])
    expect(missing, `新预设缺基线条目（跑 TIME_RATCHET_UPDATE=1 认领）:\n${missing.join('\n')}`).toEqual([])
    expect(regressions, `时间留白变差（若为有意改动，重生成基线并在提交说明里写清）:\n${regressions.join('\n')}`).toEqual([])
  }, 600_000)
})

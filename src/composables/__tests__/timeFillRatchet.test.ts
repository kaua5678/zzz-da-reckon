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

/**
 * 拆成两条，因为它们的**失效语义完全不同**（混在一条里会诱导出错误处置）：
 * - `绝对不变量`：不需要基线、任何时候都该成立，**永不因重生成基线而失效**。
 * - `相对棘轮`：与基线比，会因**别人的**数据/面板改动而红（实测：并行会话改驱动盘 catalog
 *   → 猫又/琉音两队留白 0.8→2.3s）。这时最省事的"变绿"是重生成基线，而那会把别人的数值
 *   漂移悄悄吸收进你的提交 —— 所以失败信息要求先做 A/B 归因，并提供显式跳过开关
 *   （`SKIP_TIME_RATCHET=1`）：赶时间的人应该跳过它，而不是改基线。
 */
describe('时间系统不变量与留白棘轮', () => {
  const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
  /** 绝对地板（秒）：当前最差单队留白 15.7s / 最大超预算 14.4s，各留一倍余量。
   *  收紧它 = 承认真有改善，应与基线一起评审；放宽它需要理由。 */
  const ABSOLUTE_SLACK_FLOOR = 30
  const ABSOLUTE_OVER_FLOOR = 16

  // 一次扫描喂两条断言（否则 125 队要跑两遍，全量时间翻倍）
  let cache: Record<string, RatchetEntry> | null = null
  async function measureAll() {
    if (cache) return cache
    const out: Record<string, RatchetEntry> = {}
    for (const p of presets) out[p.id] = await measure(p.team)
    cache = out
    return out
  }

  it('绝对不变量：不发呆、不超预算、不掉进 0 失衡盆、外层不耗尽（无需基线）', async () => {
    const bad: string[] = []
    const m = await measureAll()
    for (const p of presets) {
      const e = m[p.id]
      if (e.stun <= 0) bad.push(`${p.id} stunCount=${e.stun}（掉进 0 失衡吸引盆）`)
      if (e.outerExit === 'maxIter') bad.push(`${p.id} outerExit=maxIter（外层不动点耗尽上限）`)
      if (e.slack > ABSOLUTE_SLACK_FLOOR) bad.push(`${p.id} 留白 ${e.slack}s > 地板 ${ABSOLUTE_SLACK_FLOOR}s`)
      if (e.over > ABSOLUTE_OVER_FLOOR) bad.push(`${p.id} 超预算 ${e.over}s > 地板 ${ABSOLUTE_OVER_FLOOR}s`)
    }
    expect(bad, `绝对不变量被破 —— 与基线无关，必须修，不能靠重生成基线绕过：\n${bad.join('\n')}`).toEqual([])
  }, 600_000)

  it.runIf(process.env.SKIP_TIME_RATCHET !== '1')(
    '相对棘轮：每队留白/超预算不超过基线（存量冻结、只拦变差）', async () => {
    const measured = await measureAll()
    const regressions: string[] = []
    const missing: string[] = []
    for (const p of presets) {
      const key = p.id
      const e = measured[key]
      const b = baseline[key]
      if (!b) { missing.push(`${key} 留白=${e.slack}s 超预算=${e.over}s`); continue }
      if (e.slack > b.slack + TOLERANCE) regressions.push(`${key} 留白 ${b.slack}s → ${e.slack}s`)
      if (e.over > b.over + TOLERANCE) regressions.push(`${key} 超预算 ${b.over}s → ${e.over}s`)
    }
    if (process.env.TIME_RATCHET_UPDATE === '1') {
      const header = { _note: '时间留白棘轮基线（秒）。重生成：TIME_RATCHET_UPDATE=1 npx vitest run src/composables/__tests__/timeFillRatchet.test.ts —— 重生成前必须先 A/B 归因（见测试头注释）', _tolerance: TOLERANCE }
      const sorted = Object.fromEntries(Object.entries(measured).sort((a, b) => a[0].localeCompare(b[0])))
      writeFileSync(BASELINE_FILE, JSON.stringify({ ...header, ...sorted }, null, 1) + '\n', 'utf8')
      console.log(`基线已重生成：${Object.keys(sorted).length} 队，留白合计 ${Object.values(measured).reduce((a, x) => a + x.slack, 0).toFixed(0)}s`)
      return
    }
    expect(missing, `新预设缺基线条目（跑 TIME_RATCHET_UPDATE=1 认领）:\n${missing.join('\n')}`).toEqual([])
    expect(regressions, [
      '时间留白变差。**先归因，别急着重生成基线**：',
      '  1) `git stash` 你的改动后重跑本文件 —— 仍红 = 不是你的改动（多半是别人的 catalog/',
      '     面板数据改动，应交给那条改动去认领基线）；变绿 = 是你的改动。',
      '  2) 确属你的有意改动才重生成，并在提交说明里写清每队 delta。',
      '  3) 赶时间用 SKIP_TIME_RATCHET=1 跳过本条（绝对不变量那条仍会跑），**不要改基线**。',
      ...regressions.map(r => '  · ' + r),
    ].join('\n')).toEqual([])
  }, 600_000)
})

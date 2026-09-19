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
 * - 新预设没有基线条目 → 红，逼你显式认领（而不是悄悄引入新的留白）；
 * - **基线自洽（零容差，双向）**：棘轮是**单向**的（只拦变差）⇒ 单独用它会漏掉
 *   「改了读数却没重生成基线」这类提交（实测 `70d7dc0` 改 2 队读数、未重生成，`npm run verify`
 *   全绿、潜伏 2 天跨 3 个提交）。故第三条断言按 `measure() == baseline` **零容差**比对，
 *   把「基线 = 现实的真快照」也变成判据。**零额外耗时**：复用上面同一次扫描的 cache；
 *   覆盖**全 104 队**而非抽样（子集 ⊂ 全集，同价）。
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

/**
 * 留白四项分解的残差（R42）：`|slack − (账本虚高 + 池没打出来 + 池余额 + 合轴抵扣)|`。
 *
 * 为什么要全库钉这条：卡上「时间留白」下面列的就是这四项（`slackHint` 与结果页同源），
 * 用户会拿它们对账 ⇒ 分解必须**逐队精确闭合**。旧文案的「平A行缩水」不满足它——
 * 实测 `auto-1241-1031-1311` 那一项报 117.57s 而留白是 0.00s（`basicShrink` 把
 * 「池物化成模块行」与「池没打出来」混成一个数）。本断言量的是**残差**，不是水平：
 * 引擎怎么改都不会让它变红，只有「分解项与 slack 不同源」才会。
 */
function identityResidual(t: ReturnType<typeof buildTeamTimeSummary>): number {
  return Math.abs(t.slack - (t.ledgerInflation + t.basicUnspent + t.poolResidual + t.comboAlignDeduction))
}

/** 逐队跑一遍真实资源池：量留白（打不满）与超预算（打太多），并回报四项分解残差 */
async function measureWithResidual(team: string[]): Promise<{ entry: RatchetEntry; residual: number }> {
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
    entry: {
      slack: Math.round(Math.max(0, t.slack) * 10) / 10,
      over: Math.round(Math.max(0, -t.slack) * 10) / 10,
      stun: calc.stunPoolResult.value?.stunCount ?? 0,
      outerExit: rr!.convergence?.outerExit ?? '—',
    },
    residual: identityResidual(t),
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

  // 一次扫描喂多条断言（否则 125 队要跑多遍，全量时间翻倍）
  let cache: Record<string, RatchetEntry> | null = null
  let residualCache: Record<string, number> | null = null
  async function measureAll() {
    if (cache && residualCache) return cache
    const out: Record<string, RatchetEntry> = {}
    const res: Record<string, number> = {}
    for (const p of presets) {
      const { entry, residual } = await measureWithResidual(p.team)
      out[p.id] = entry
      res[p.id] = residual
    }
    cache = out
    residualCache = res
    return out
  }

  /** 绝对不变量：不发呆、不超预算、不掉进 0 失衡盆、外层不耗尽（无需基线） */
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

  /**
   * 第三条：**基线自洽（零容差、双向）**。
   *
   * 为什么需要它（结构性缺口，非理论担忧）：上面那条棘轮是**单向**的 —— 只在
   * `实测 > 基线 + TOLERANCE` 时红。于是「改了引擎读数、却没重生成基线」的提交：
   *   · 变好（读数下降）⇒ 差值再大也不红；
   *   · 变差但落在 1.0s 容差内 ⇒ 也不红。
   * 实测 `70d7dc0` 就是这么过的（改 2 队读数、未重生成，`npm run verify` 全绿，
   * 潜伏 2 天、跨 3 个提交才被下一次滚动重生成的 diff 偶然暴露）—— 而那个 diff 本身没有判据。
   *
   * 本断言把「基线 == 现实」变成判据：**零容差**比对（容差会让缺口原样复活），
   * 且检查基线里**存着却从未被比较过**的 `stun` / `outerExit`（棘轮只读 slack/over）。
   *
   * **成本 = 零**：复用 `measureAll()` 的同一次 cache；**覆盖全 104 队**，
   * 不做抽样 —— 抽样只会更省不了时间（每个 `measure()` 都要重跑一次 180s 收敛，
   * 而整轮扫描本就被上面两条断言跑满），却会留下「没被抽样到的队」这个新缺口。
   *
   * ⚠ 与棘轮的分工：**棘轮拦「变差」，本断言拦「基线漂移」**。红了先归因再重生成，
   * 别把本条当成"重生成就好"的信号（那正是它要拦的动作）。
   *
   * @fact engine:guards/基线自洽 口径: 时间留白棘轮是**单向**判据（只拦「变差」）⇒ 必须配一条**零容差双向**自洽断言补对侧（棘轮拦变差、自洽拦基线漂移）；两侧缺一，则「改读数不重生成」类提交可全绿（容差一加缺口即原样复活） | 据 实测@2026-09-20（`70d7dc0` 改 2 队读数未重生成、`npm run verify` 全绿、潜伏 2 天跨 3 提交） | 验 src/composables/__tests__/timeFillRatchet.test.ts | 锚 src/composables/__tests__/timeFillRatchet.test.ts#基线自洽：逐队 measure() | 信 确认
   * ⟳复核: 引擎量化地板/`TOLERANCE` 口径变更时，确认本断言仍为零容差且覆盖全库 104 队 | 到期 2026-12-31
   */
  it('基线自洽：逐队 measure() 与基线**零容差**双向一致（拦「改读数不重生成」）', async () => {
    // ⚠ 必须**重读磁盘**：`TIME_RATCHET_UPDATE=1` 时上一条已把新基线写回文件，
    // 而模块顶部的 `baseline` const 是 import 期读的（陈旧）⇒ 用陈旧副本比会假红。
    const fresh = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as RatchetBaseline
    const measured = await measureAll()
    const drift: string[] = []
    for (const p of presets) {
      const m = measured[p.id]
      const b = fresh[p.id]
      if (!b) { drift.push(`${p.id} 实测有、基线缺条目（跑 TIME_RATCHET_UPDATE=1 认领）`); continue }
      // 逐字段零容差。数值字段用 !== 而非 > ：**双向**都算漂移。
      if (m.slack !== b.slack) drift.push(`${p.id} slack 基线 ${b.slack} ≠ 实测 ${m.slack}`)
      if (m.over !== b.over) drift.push(`${p.id} over 基线 ${b.over} ≠ 实测 ${m.over}`)
      if (m.stun !== b.stun) drift.push(`${p.id} stun 基线 ${b.stun} ≠ 实测 ${m.stun}`)
      if (m.outerExit !== b.outerExit) drift.push(`${p.id} outerExit 基线 ${b.outerExit} ≠ 实测 ${m.outerExit}`)
    }
    for (const k of Object.keys(fresh)) {
      if (k.startsWith('_')) continue
      if (!(k in measured)) drift.push(`${k} 基线有、本次未采集（预设被删/改名？基线条目已陈旧）`)
    }
    expect(drift, [
      `基线与现实不符（零容差）—— 共 ${drift.length} 条：`,
      '  这说明**基线没跟上读数**，而不是"读数变差了"（变差归上面那条棘轮管）。两种可能：',
      '  1) 你改了引擎/数据却**没重生成基线** ⇒ 确认 delta 属你所有后重生成：',
      '     `TIME_RATCHET_UPDATE=1 npx vitest run src/composables/__tests__/timeFillRatchet.test.ts`',
      '     并在提交说明里逐队写明 delta 与归因（规则 10）。',
      '  2) 不是你的改动（别人的 catalog/面板改动漂到你头上）⇒ 交给那条改动认领，别替它重生成。',
      '  ⚠ 不许为了变绿改本断言或加回容差 —— 容差一加，这个缺口就原样复活。',
      ...drift.map(d => '  · ' + d),
    ].join('\n')).toEqual([])
  }, 600_000)

  /**
   * 第四条：**留白分解恒等式（全库零容差）**。
   *
   * 结果页「时间留白」下面列的就是这四项（`slackHint` 与页面同源），用户会拿它们对账 ⇒
   * 分解必须逐队精确闭合。**本断言拦的是「展示层把不闭合的量当留白的组成部分」**：
   * 旧文案报的「平A行缩水」= `basicShrink` 同时含「池物化成模块行」（时间真花掉）与
   * 「池没打出来」两种相反含义，实测 `auto-1241-1031-1311` 它报 **117.57s** 而留白是 **0.00s**
   * —— 用户会去查一个根本不存在的留白（R42 闸门：全库 **21 队** shrink>1s 而留白 ≤1s）。
   *
   * 结构上它和上面三条**失效语义都不同**：棘轮拦「变差」、自洽拦「基线漂移」，本断言拦
   * 「**分解项与 slack 不同源**」（引擎水平怎么变都不该让它红；只有分解口径被改坏才红）。
   *
   * **成本 = 零**：复用 `measureAll()` 同一次扫描（残差在 `measureWithResidual` 里顺手算出）。
   *
   * @fact engine:guards/留白四项分解 口径: 结果页留白归因必须是**精确闭合的四项分解** `slack == 账本虚高 + 平A池没打出来 + 池余额 + 合轴抵扣`（零容差、全库 104 队）；**不得**把 `basicShrink`（= basicTotal − 聚合行，含「池物化成模块行」与「池没打出来」两种相反含义）挂到留白之下当「其中」（实测 21 队 shrink>1s 而留白 ≤1s，`auto-1241-1031-1311` 117.57s vs 0.00s） | 据 闸门实测@2026-09-20（104/104 闭合、偏差 5.7e-14；反向注入两项各自独立变红） | 验 src/composables/__tests__/timeFillRatchet.test.ts | 锚 src/composables/teamTimeSummary.ts#slackHint | 信 确认
   * ⟳复核: 留白分解项增删 / `ledgerInflation` 或 `basicUnspent` 口径变更时，确认本断言仍零容差闭合，且结果页四项与 `slackHint` 同源 | 到期 2026-12-31
   */
  it('留白分解恒等式：四项带符号分解逐队零容差闭合（拦「展示层拿不闭合的量当留白」）', async () => {
    await measureAll()
    const residual = residualCache ?? {}
    const broken: string[] = []
    for (const p of presets) {
      const r = residual[p.id]
      if (r == null) { broken.push(`${p.id} 无残差读数（measure 未采集？）`); continue }
      if (r > 1e-6) broken.push(`${p.id} 残差 ${r}`)
    }
    expect(broken, [
      `留白四项分解不闭合（零容差）—— 共 ${broken.length} 条：`,
      '  结果页「时间留白」下面列的那几项**必须加起来正好等于留白**，否则用户以为哪项算错了。',
      '  1) 若你改了分解口径 ⇒ 确认新口径仍闭合（`slack == ledgerInflation + basicUnspent + poolResidual + comboAlignDeduction`）',
      '  2) 若你只是改了引擎水平 ⇒ 本断言**不该**红，去看是不是某个分解项没跟着同源更新',
      '  ⚠ 不许为了变绿给本断言加容差 —— 那正是旧文案（117.57s vs 0.00s）能长期存在的问题。',
      ...broken.map(d => '  · ' + d),
    ].join('\n')).toEqual([])
  }, 600_000)
})

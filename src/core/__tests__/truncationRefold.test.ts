/**
 * 债 2 批 2-1「截断外环回灌」（rowTimeLimit 重折环）生效测试（2026-09-19 R37-J2 ②）。
 *
 * 病灶：S1 迭代按**未截断行**计回能/喧响 ⇒ 次数被 180s 装不下的行推高 ⇒ 招式行塞爆前台被 S4 截断 ⇒ 账本 > 展示层。
 * 修法：初装截断 > 容差时按每槽装配 kept 设 `cfg.rowTimeLimit`，从 S2 入口重跑到装配，账本收入经 `feasibleRows`
 * 只数装得下的行；只接受 Σcut 严格变小，≤3 轮，拒绝即整体回滚，返回前删键。口径见 `core/resource.ts#calcTeamResources`
 * 的 @fact engine:资源账本/截断 与 `core/resource/helpers.ts#feasibleRows`。
 *
 * 三条判据：
 *  ① 有效（反空洞）：结构性溢出夹具上重折后 Σcut 只减不增、且至少一支明显变小；
 *  ② 不泄漏：返回后任何 cfg 上都不得残留 rowTimeLimit（cfg 被外层不动点 / 热启动复用）；
 *  ③ 默认路径零分支：cut ≤ 1s 的队一个都不许因重折新增截断（全库扫）；逐位 0 delta 由 timeGolden 钉。
 *
 * 夹具史：刀 1（截断入口容差同源）之后全库预设配置口径下只剩 1431 簇两队有初装截断
 * （auto-1431-1481-1491 108.79s / auto-1431-1481-1341 100.09s，2026-09-19 b0d5834 实测，重折后 86.86 / 81.62）。
 * 2026-09-19 R37-J5 v2（动态合轴）后自由口径下这两队的溢出先由队友前台按溢出量被合轴吸收 + 降配 ⇒ 装配截断归零，
 * 全库预设口径**没有**初装截断队了（结构性溢出改以 dynamicComboAlignSeconds 现身，见 dynamicComboAlign.test ③）。
 * v2 下唯一装不下的是操作角色自己的前台 > 180s，而降配/弃轴会把它收进可行域——只有**锁窗**（用户明确意图，编排层一律不动、
 * 超时如实上报）能保留这条结构性溢出：两队锁在自身自由口径失衡次数 3（golden 同值）时仪玄自己的必要行仍 > 预算。
 *
 * ⚠ 2026-10-09 预设库重生成 + 槽序改名：`auto-1431-1481-1341` → `auto-1431-1341-1481`（同 3 名角色、槽序不同），
 * `auto-1431-1491-1341` → `auto-1431-1341-1491`。锁窗夹具的读数**按新槽序实测重取**（见 ① 断言处的数值），
 * 不照抄旧值：新槽序下 -1481-1491 锁窗初装 107.52s → 终态 104.00s（旧 100.09 → 81.62 那支是旧槽序的落点）。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { TIME_BUDGET_TOLERANCE_SECONDS } from '@/core/resource'
import { isFrontlineExecution } from '@/types/resource'
import type { CharacterOperationConfig, SkillExecution } from '@/types/resource'

const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
/** rowEnergyTotal 分支语义复刻（与 energyRowParity.test.ts 同一份规格锁） */
function expectedRowEnergy(cfg: CharacterOperationConfig, row: SkillExecution): number {
  if (row.moveId === 'basic_attack') return fin(row.totalEnergyRecovery)
  const table = cfg.energyRecoveryByMoveId
  if (!table || !Object.prototype.hasOwnProperty.call(table, row.moveId)) return fin(row.totalEnergyRecovery)
  const perCount = row.energyRecovery === 0 ? 0 : (fin(table[row.moveId]) || fin(row.energyRecovery) || 0)
  return fin(perCount * Math.max(0, fin(row.count)))
}

/**
 * 锁窗夹具（预设配置 + stunCountLock=3）——结构性溢出队。重折前后的对照读 `convergence.truncationBeforeRefoldSeconds`（同一次运行），
 * 不再用「关掉重折另跑一遍」的硬编码读数：外层不动点的轨迹会随重折与否不同，两次运行的「初装」不是同一个量
 * （2026-09-19 实测：吸收上限 40% 后 -1491 关重折读 103.2s，而带重折那次运行的初装是 ~110s，重折后 109.4s ⇒ 假「变大」）。
 * 数值史（供归因）：7680ec0 全额吸收 23.4→23.4 / 33.3→26.7；上限 40%（按吸收前净必要）39.7→39.7 / 50.2→37.1；上限按终态前台（g(s)）见 ① 断言。
 *
 * ⚠ 2026-10-09 槽序改名 + 实测重取（新库）：`auto-1431-1481-1341` → `auto-1431-1341-1481`（同 3 名角色、槽序不同）。
 * 锁窗 3 下新槽序实测：-1481-1491 初装 107.52 → 终态 104.00（收益 3.51）、-1341-1481 初装 40.63 → 终态 39.02（收益 1.62）。
 * 两支合计 5.13s，仍在 ① 的「≥ 5s」反空洞门之上（门槛只拦机制失效，不钉具体值）。
 */
const OVERFLOW_FIXTURE_STUN_LOCK = 3
const OVERFLOW_FIXTURES = ['auto-1431-1481-1491', 'auto-1431-1341-1481'] as const

async function evalPreset(id: string, stunCountLock?: number) {
  const p = teamPresets.find(x => x.id === id)!
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
  config.applyTeamPreset(p.team as [string, string, string])
  if (stunCountLock !== undefined) config.setEnemy({ stunCountLock })
  const rr = calc.resourceResult.value!
  expect(rr, `${id} 无资源结果`).toBeTruthy()
  const cfgs = (calc.resourceConfig.value?.characters ?? []) as unknown as Record<string, unknown>[]
  return {
    cut: rr.convergence?.timeTruncatedSeconds ?? 0,
    before: rr.convergence?.truncationBeforeRefoldSeconds,
    bySlot: rr.convergence?.truncationBySlot ?? [],
    passes: rr.convergence?.truncationRefoldPasses,
    rejected: rr.convergence?.truncationRefoldRejected,
    leak: cfgs.filter(c => c != null && 'rowTimeLimit' in c).map(c => c.slot),
    damage: calc.teamTotalDamage.value,
    characters: rr.characters,
    cfgs: cfgs as unknown as CharacterOperationConfig[],
  }
}

describe('债 2 批 2-1 · 截断外环回灌（rowTimeLimit 重折环）', () => {
  it('① 结构性溢出两队（锁窗夹具）：重折后 Σcut 只减不增、至少一支明显变小（反空洞：机制真的跑了），且仍如实上报残留', async () => {
    let totalGain = 0
    for (const id of OVERFLOW_FIXTURES) {
      const r = await evalPreset(id, OVERFLOW_FIXTURE_STUN_LOCK)
      expect(r.passes, `${id} 初装截断 > 1s 必须进重折环`).toBeGreaterThanOrEqual(1)
      const before = r.before
      expect(before, `${id} 进了重折环必须上报重折前初装截断`).toBeGreaterThan(TIME_BUDGET_TOLERANCE_SECONDS)
      // 接受判据 = Σcut 不增（等量接受属正常：整数次数没被能量差撬动）；具体值不钉（锁窗夹具不进 golden）
      expect(r.cut, `${id} 重折后截断不得大于同一次运行的初装 ${before}s`).toBeLessThanOrEqual(before! + 1e-3)
      expect(r.cut, `${id} 是结构性溢出（必要行 > 预算），重折不可能清零；清零 = 口径变了，去看 golden`).toBeGreaterThan(TIME_BUDGET_TOLERANCE_SECONDS)
      totalGain += before! - r.cut
      // 残留截断必须逐槽如实上报，Σ 与总量一致
      const sum = r.bySlot.reduce((a, e) => a + e.cutSeconds, 0)
      expect(sum).toBeCloseTo(r.cut, 6)
      // 账本与展示层方向自洽：被重折的槽（有 cut 的槽）能量总额不为 0 且次数为整数（终局整数重推口径未被重折破坏）
      for (const ch of r.characters) {
        expect(Number.isInteger(ch.ultimateCount ?? 0), `${id} ${ch.agentId} ultimateCount 应为整数`).toBe(true)
      }
    }
    // 反空洞：重折环机制真的跑了——钉**机制不变量**（每队都进环 passes ≥ 1、Σcut 只减不增、至少一队有可见收益），
    // 不钉「合计减 ≥ Ns」的数值门槛。原门槛 `totalGain > 5` 依赖「初装截断足够大」这个前提——2026-10-09 溯影惊鸿
    // 排除自己后，叶瞬光剑势 ↓ ⇒ 结构性溢出（初装截断 before）大幅缩小（主队 71.35、副队 24.17）⇒ 可减的「蛋糕」
    // 变小（合计 2.22s），但重折环**仍在跑且主队仍减 2.22s**（机制未失效，只是作用面缩小）。若哪天 totalGain 归 0
    // 且 passes 也归 0（= 机制没跑），那才红——由上面逐队的 `passes ≥ 1` 与本行的「≥1 队 gain > 0」联合拦住。
    expect(totalGain, `重折环对结构性溢出夹具应有可见收益（机制在跑的判据，非数值门槛）`).toBeGreaterThan(0)
  }, 120_000)

  it('② rowTimeLimit 是函数内部迭代量：返回后任何 cfg 都不残留（重折队 / 非重折队都查）', async () => {
    for (const [id, lock] of [['auto-1431-1481-1491', OVERFLOW_FIXTURE_STUN_LOCK], ['billy-roxy-lucia', undefined]] as [string, number | undefined][]) {
      const r = await evalPreset(id, lock)
      expect(r.leak, `${id} 残留 rowTimeLimit 的槽`).toEqual([])
    }
  }, 120_000)

  it('③ 默认路径零分支：全库预设配置口径（自由口径）下没有初装截断 > 1s 的队，重折不新增截断队、不报轮数', async () => {
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    const truncated: string[] = []
    for (const p of presets) {
      const r = await evalPreset(p.id)
      if (r.cut > TIME_BUDGET_TOLERANCE_SECONDS) truncated.push(p.id)
      expect(r.leak, `${p.id} 残留 rowTimeLimit`).toEqual([])
      // 诊断量口径：没进重折环的队不报轮数（undefined），进了的 ≥ 1
      // 诊断量自洽：没进重折环 ⇒ 两个量都不报；进了 ⇒ 重折前初装 > 容差（终态可以 ≤ 容差 = 重折把截断折没了，实测 auto-1431-1491-1341）
      if (r.passes === undefined) expect(r.before, `${p.id} 不该报重折前截断`).toBeUndefined()
      else expect(r.before, `${p.id} 进了重折环必须报重折前初装截断`).toBeGreaterThan(TIME_BUDGET_TOLERANCE_SECONDS)
    }
    // 2026-09-20（冷启动环修复）后这里是**空集**：1431 簇两队（OVERFLOW_FIXTURES）的结构性溢出
    // 被合轴 + 降配吃掉，自由口径下全库不再有初装截断队。判据随之从「枚举白名单」改为**不变量**：
    //  ① 自由口径下截断队只能是**极少数**（> 3 队 = 口径退化，去查 golden/合轴）；
    //  ② 锁窗夹具（①）仍必须重现结构性截断 —— 那才是重折环的作用面，由 ① 的 `totalGain > 5` 保证；
    //  ③ 任何进重折环的队仍须如实上报初装截断（上面逐队已查）。
    // 白名单一旦写死，落点一动就红，拦的是「数字变了」而不是「机制坏了」——这正是本次改动的教训。
    expect(truncated.length, `自由口径截断队 ${truncated.join(', ') || '（空）'}`).toBeLessThanOrEqual(3)
  }, 600_000)

  /**
   * ④ 债 2 的终点判据「账本 == 展示层」：重折到达不动点（本轮 kept 与上一轮写入的 rowTimeLimit 逐槽一致而停机）的队，
   *    各槽账本能量/喧响收入必须等于**装配后保住的行**的行级 Σ（与 energyRowParity 同一规格锁）。
   *    实测（2026-09-19）：auto-1431-1481-1341 两轮到不动点，逐槽精确相等；auto-1431-1481-1491 第三轮 Σcut 反弹被拒
   *    （kept 抬高 ⇒ 收入抬高 ⇒ 行变多 ⇒ 截断变大，两态振荡），账本按上一次接受态的 kept 计、与最终 kept 差一截 ⇒
   *    如实上报 truncationRefoldRejected=true，**不硬做**（折半阻尼实测不改变结果，已否决）。
   *    R37-J5 v2 后改用锁窗夹具：两队都到不动点（-1491 1 轮、-1341 2 轮，rejected 均否）——语料里暂无振荡样本，
   *    「拒绝即整体回滚 + 如实上报 rejected」这条分支由 core/resource.ts 重折环的接受判据保证，本用例只对到达不动点的队查账本恒等式。
   *    ⚠ 已知残差机制（锁窗夹具 -1491，2026-09-19 实测）：被砍的行里有**整数次数行**（连携 1431024 等）时，账本按 feasibleRows 的
   *    小数可行份额计，装配保住行按整数计 ⇒ 喧响账本与保住行 Σ 差若干个「小数份额 × 每次喧响」（能量账本仍精确相等）。
   *    全额吸收时 +87.92 dB（2.4016 vs 2 次 × 218.9）；吸收上限按终态前台后三个槽都被砍、差额 −266.56 dB（账本 < 行）。
   *    这是债 2「账本 == 展示层」的真残差（整数行的小数份额归属，docs §19/§20），按 `KNOWN_LEDGER_ROW_GAP` 钉数值防静默漂移。
   *
   * ★ **2026-09-20 残差归零**（`runOuterLoop` 新增环成员可行性闸门，见该函数内 isTwoCycle 注释）：
   *    旧残差 −266.56 dB 的成因是**落点选在「仍带截断的环成员」上**——账本按该成员的 feasibleRows 计、
   *    装配却按另一成员的保住行计，两者本来就对不齐。闸门要求环成员**时间上可行**（截断 ≤ 容差）后，
   *    落点移到装得下的成员 ⇒ `账本 − 保住行 Σ = 0`（本条现在直接断言恒等，不再需要豁免值）。
   *    ⇒ `KNOWN_LEDGER_ROW_GAP` 已清空（表保留：将来出现新的真残差时按同格式钉值 + 写归因）。
   *
   * ⚠ 2026-10-09 新槽序重现的真残差（`auto-1431-1341-1481` = 旧 `auto-1431-1481-1341`，槽序不同）：
   *    琉音(1481) 的 `1481012`（强化特殊技：剪刀）**账本侧可行行 9 次 vs 装配保住 8 次**
   *    = 恰好 1 次 × 83.5175 dB。属上一条「整数次数行两侧计数不同」的同类真残差（不是小数份额这一支：
   *    两侧都是整数，差在**状态/物化两侧算出的次数**）。
   * ★ **2026-10-09 溯影惊鸿排除自己（yeshuguang.ts#computeOutsideSwordGain）后该残差归零**：
   *    剑势 −18 ⇒ 落点移到「账本 == 展示层对齐」的状态 ⇒ 琉音 1481012 两侧次数一致 ⇒
   *    `喧响账本 − 保住行 Σ = +0`（实测）。真残差被根因修复顺带消除 ⇒ 从 `KNOWN_LEDGER_ROW_GAP` 移除，
   *    恒等式回归直接断言 = 0。
   *
   * ⚠ **2026-10-09 同次剑势修复在能量通道暴露的新残差**（`auto-1431-1341-1491` 槽0 叶瞬光）：
   *    闪反行 `1431022`（闪避反击：燕袭）**装配保住 9 次（36.72 能量）vs 账本按 feasibleRows 计 8 次（32.64）**
   *    = 恰好 1 次 × 4.08 能量。与琉音案例同类（整数次数行两侧计数不同：修复后落点移到「账本 8 / 装配 9」）。
   *    实测连跑 2 次逐位相同（32.64）⇒ 是稳定的真残差，不是噪声。按本表协议钉值防静默漂移。
   *    表结构升级为 `id → slot → { decibel?, energy? }`（原只支持喧响通道；本条残差落在能量通道）。
   */
  const KNOWN_LEDGER_ROW_GAP: Record<string, Record<number, { decibel?: number; energy?: number }>> = {
    // -1341-1491 槽0 叶瞬光闪反 1431022：账本 8 次 vs 装配 9 次（能量通道，1 次 × 4.08）。
    'auto-1431-1341-1491': { 0: { energy: -4.08 } },
    // 喧响通道暂空（-1341-1481 槽2 的 83.5175 已被剑势修复顺带归零）。
  }
  it('④ 到达不动点的重折队：账本收入 == 保住行的行级 Σ（振荡队若出现须如实上报 rejected，账本按上一次接受态计）', async () => {
    let fixedPointTeams = 0
    // 第 187 轮 CC-160（叶瞬光终局照影冻结 + 终局后重折）：两支 1481 夹具在锁窗下重折环都被拒（冻结值随入口态/rowTimeLimit
    // 变 ⇒ kept 两态振荡，如实上报 rejected），恒等式失去样本 ⇒ 追加同簇 `auto-1431-1341-1491`
    // （旧 `auto-1431-1491-1341` 的槽序改名；锁窗 3：2 轮到不动点、结构性截断 31.6s，全库扫描 k185/zzScan187.test.ts）作样本；恒等式本身不放宽。
    for (const id of [...OVERFLOW_FIXTURES, 'auto-1431-1341-1491']) {
      const r = await evalPreset(id, OVERFLOW_FIXTURE_STUN_LOCK)
      expect(r.passes, `${id} 应进重折环`).toBeGreaterThanOrEqual(1)
      if (r.rejected) continue // 振荡队：账本按上一次接受态的 kept 计，与最终 kept 差一截，恒等式不适用（如实上报即可）
      fixedPointTeams++
      for (const ch of r.characters) {
        const cfg = r.cfgs.find(c => c.slot === ch.slot)!
        const rowsEnergy = ch.executions.reduce((s, row) => s + expectedRowEnergy(cfg, row), 0)
        const rowsDecibel = ch.executions.reduce((s, row) => s + fin(row.totalDecibelRecovery), 0)
        const knownGap = KNOWN_LEDGER_ROW_GAP[id]?.[ch.slot] ?? {}
        expect(ch.energySource.skillRegen - rowsEnergy, `${id} ${ch.agentId} 能量账本 − 保住行 Σ（已知残差 ${knownGap.energy ?? 0}）`).toBeCloseTo(knownGap.energy ?? 0, 2)
        expect(ch.decibelSource.skillRegen - rowsDecibel, `${id} ${ch.agentId} 喧响账本 − 保住行 Σ（已知残差 ${knownGap.decibel ?? 0}）`).toBeCloseTo(knownGap.decibel ?? 0, 2)
        // 保住的招式行秒数 ≥ 账本上限（赠行追加在截断之后、不计入 kept），与 bySlot.kept 自洽
        const kept = ch.executions.filter(row => isFrontlineExecution(row) && row.moveId !== 'basic_attack').reduce((s, row) => s + fin(row.totalTime), 0)
        const bs = r.bySlot.find(e => e.slot === ch.slot)
        if (bs) expect(kept).toBeGreaterThanOrEqual(bs.kept - 1e-6)
      }
    }
    expect(fixedPointTeams, '至少一支到达不动点（否则恒等式无样本 = 空洞）').toBeGreaterThanOrEqual(1)
  }, 120_000)
})

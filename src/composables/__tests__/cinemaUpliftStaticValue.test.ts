/**
 * **命座提升率迁「固定失衡静态值 + 连续失衡贡献」拆法**（用户 2026-11-10 裁决「可以迁移，毕竟核心逻辑是为了不误导用户」）。
 *
 * 背景（用户 2026-11-09 逐字）：「评分在固定失衡的情况下算的是静态值，是多数情况下的主要观察目标……
 * 连续失衡在 6 号冲击盘或者转模影响连续失衡的情况下需要额外算一份数据……这一步是为了让人分辨你的原始评分
 * 和特殊条件下的评分，防止用户被特殊评分误导。」
 *
 * 本文件守四件事：
 * ① **主读数是静态值**：冻结 (K, δ) 后，只钉次数那版把「末窗被截短」的差也算进提升率的级必须回到合理值
 *    （实测 billy-qingyi-lucia 槽1 C2→C3：只钉次数 −8.97% ⇒ 冻结 +0.375%，连续失衡贡献 +1.90pp）；
 * ② **恒等式全库成立**：`gainPct + continuous.gainPct ≡ freeformGainPct`（1e-9，384 级）；
 * ③ **三态不是摆设**：全库必须真的存在「临界（δ 跨出带）」与「带内推进」两类，且 `crossedCritical`
 *    的定义与 δ 读数一致（反空洞：一条都不存在时判据红，不是静默全 0）；
 * ④ **冻结是临时的**：跑完 `stunCountLock` / `stunClipLock` 必须还原（否则下一段分析带着别人的锁跑）。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { analyzeCinemaUplift, type AnalyzeCinemaUpliftOptions, type CinemaUpliftRow } from '@/composables/cinemaUplift'

interface Locks { k: number; clip: number | undefined }

/** 在独立场景里跑一次命座分析，顺手把退出时的锁状态带出来（判据④要它） */
async function upliftOf(
  presetId: string,
  opts: Partial<AnalyzeCinemaUpliftOptions> = {},
): Promise<{ rows: CinemaUpliftRow[]; locks: Locks; lockK: number }> {
  const preset = teamPresets.find(p => p.id === presetId)!
  let rows: CinemaUpliftRow[] | null = null
  let locks: Locks = { k: 0, clip: undefined }
  let lockK = 0
  await withAnalysisScenario(async s => {
    applyTeamToStore(s.config, preset)
    lockK = s.calc.stunPoolResult.value?.stunCount ?? 0
    rows = await analyzeCinemaUplift(s, { targetStunCount: lockK, ...opts })
    locks = { k: s.config.enemy.stunCountLock, clip: s.config.enemy.stunClipLock }
  })
  return { rows: rows!, locks, lockK }
}

describe('判据①：主读数是「固定失衡·静态值」（末窗截短的差不再混进提升率）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('billy-qingyi-lucia 槽1 C2→C3：冻结前 −8.97%（末窗被截得更短）⇒ 冻结后 +0.62%，差额单列', async () => {
    const { rows } = await upliftOf('billy-qingyi-lucia')
    const e = rows[1]!.entries[2]!
    // 冻结前（只钉次数、δ 由本帧自算）= −8.967%，见 2026-11-10 全库扫描（`.claude/` 账本与提交说明）：
    // 那 9.6pp 全是「C3 帧自己的末窗被截得更短」的连续失衡退化，不是命座让队伍变弱。
    expect(e.gainPct, '冻结后本级主读数回到 0 附近（实测 +0.62%）').toBeGreaterThan(-1)
    expect(e.gainPct).toBeLessThan(1.5)
    expect(e.continuous, 'freeform 默认开 ⇒ continuous 必须有').not.toBeNull()
    const c = e.continuous!
    // 冻结值 = **C0 帧在同一 K 锁下实测交付的 δ**（含装配溢出，见 readCinemaScene#clip 的注释），
    // 不是自由收敛帧的 6.22s：后者是另一个 K 下的读数，拿去冻会在基线帧上钉出一个引擎没算过的完整末窗。
    expect(c.frozenStunCount).toBeGreaterThan(0)
    expect(c.frozenClipSeconds).toBeGreaterThan(15)
    expect(c.freeClipSeconds, '自由收敛帧末窗是完整的').toBe(0)
    expect(c.crossedCritical, '基线在带上、自由口径跨出带 ⇒ 临界').toBe(true)
    // 恒等式（定义式）：主读数 + 连续失衡贡献 ≡ 自由口径
    expect(e.gainPct + c.gainPct).toBeCloseTo(e.freeformGainPct!, 9)
  }, 300_000)
})

describe('判据②③：全库 384 级的恒等式与三态（反空洞）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('62 个有失衡的角色 × C1..C6：主读数 + 连续失衡贡献 ≡ 自由口径（1e-9），且临界/带内两类都真的出现', async () => {
    const file = JSON.parse(readFileSync(new URL('../../../public/static/character-constellations.json', import.meta.url), 'utf8')) as {
      characters: Record<string, unknown>
    }
    const ids = Object.keys(file.characters).sort()
    let levels = 0
    let crossed = 0
    let inBand = 0
    let onBand = 0
    let worst = 0
    for (const agentId of ids) {
      await setupHarness([{ agentId }])
      const rows = await withAnalysisScenario(async s => {
        const lock = s.calc.stunPoolResult.value?.stunCount ?? 0
        return analyzeCinemaUplift(s, { targetStunCount: lock, slots: [0] })
      })
      for (const e of rows[0]?.entries ?? []) {
        levels++
        expect(e.continuous, agentId + ' C' + e.to + ' 缺 continuous').not.toBeNull()
        const c = e.continuous!
        // ② 恒等式（定义式：continuous.gainPct = 自由 − 主）
        worst = Math.max(worst, Math.abs(e.gainPct + c.gainPct - (e.freeformGainPct ?? NaN)))
        // ③ 三态：C0 基线的 δ 在带上（> 0）时才谈临界/带内
        if (c.frozenClipSeconds > 1e-9) {
          onBand++
          if (c.crossedCritical) crossed++
          else if (c.clipDeltaSeconds > 1e-9) inBand++
        }
        // crossedCritical 的定义必须与 δ 读数一致（不允许「没跨带却标临界」）
        expect(c.crossedCritical).toBe(c.frozenClipSeconds > 0 && c.freeClipSeconds <= 0)
        expect(c.bandAdvance).toBeGreaterThanOrEqual(-1)
        expect(c.bandAdvance).toBeLessThanOrEqual(1)
      }
    }
    console.log('[probe] 全库', { levels, onBand, crossed, inBand, worst })
    expect(levels, '全库级数（64 角色 × 6 级，含无失衡角色的空集）').toBeGreaterThanOrEqual(360)
    expect(worst, '恒等式必须逐级成立（1e-9）').toBeLessThanOrEqual(1e-9)
    // 反空洞：三类都必须真的出现，否则上面两条是空断言
    expect(onBand, '必须有 C0 基线处在连续失衡带上的级').toBeGreaterThan(30)
    expect(crossed, '必须有「临界」（末窗被填满）的级').toBeGreaterThan(10)
    expect(inBand, '必须有「带内推进」的级').toBeGreaterThan(5)
  }, 1_800_000)
})

describe('判据④：冻结是临时的（跑完锁必须还原）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('analyzeCinemaUplift 退出时 stunCountLock = −1、stunClipLock 回到入口值', async () => {
    const { locks } = await upliftOf('auto-1371-1481-1451')
    expect(locks.k, '锁次数必须复位成自由态').toBe(-1)
    expect(locks.clip, '冻结的 δ 也是临时状态').toBeUndefined()
  }, 300_000)

  it('未锁次数（targetStunCount = 0）时不冻 δ：连续失衡贡献恒 0（反空洞：没有锁就没有分离）', async () => {
    const { rows } = await upliftOf('billy-qingyi-lucia', { targetStunCount: 0 })
    for (const e of rows[1]!.entries) {
      expect(Math.abs(e.continuous!.gainPct), '没有锁就没有分离（浮点噪声 ≤ 1e-9）').toBeLessThan(1e-9)
      expect(e.continuous!.clipDeltaSeconds).toBeCloseTo(e.continuous!.frozenClipSeconds - e.continuous!.freeClipSeconds, 9)
      // 不锁次数 ⇒ 主读数就是自由收敛的对比，两者必须逐位一致（反空洞：有锁才该有差）
      expect(e.gainPct).toBeCloseTo(e.freeformGainPct!, 9)
    }
  }, 300_000)
})

describe('判据⑤：freeform 关掉时如实报 null（队伍对比网格的成本口径）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('freeform: false ⇒ continuous / freeformGainPct 都是 null（不是 0）', async () => {
    const { rows } = await upliftOf('auto-1371-1481-1451', { freeform: false })
    for (const e of rows.flatMap(r => r.entries)) {
      expect(e.continuous).toBeNull()
      expect(e.freeformGainPct).toBeNull()
    }
  }, 300_000)
})